# LabTimeShare — GPU Access Self-Service Portal

A self-service portal that allows coworkers to request time-limited, approval-gated access to a shared GPU server. Runs directly on the RHEL GPU server.

## Access Paths

| Path | What the user gets |
|---|---|
| **API Key** | A UUID API key added to the vLLM router's permitted-keys file for authenticated inference calls |
| **Shell Access** | A Linux OS user account with an SSH keypair for direct GPU server access (VPN-only) |

---

## Requirements

- **Node.js** 20 or later
- **npm** 9 or later
- The portal process user must have `sudo` permission for `useradd` and `usermod`
- `ssh-keygen` must be available on the server (`openssh` package)
- The vLLM router's permitted-keys file must be writable by the portal process user

---

## Setup

### 1. Install Node.js (if not already installed)

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Or via RHEL dnf
sudo dnf module install nodejs:20
```

### 2. Clone the repository

```bash
git clone <repo-url> /opt/labtimeshare
cd /opt/labtimeshare
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in all values:

```env
DATABASE_URL=file:./lts.db
JWT_SECRET=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
SERVER_IP=<your GPU server LAN IP address>
VLLM_KEYS_FILE=/path/to/vllm/permitted_keys.txt
EXPIRY_CHECK_INTERVAL_MINUTES=5
NEXT_PUBLIC_APP_NAME=LabTimeShare
PORT=3000
```

> **`VLLM_KEYS_FILE`** — this file is read by your vLLM router to check permitted API keys (one UUID per line). The portal appends keys to it on approval and removes them on revocation. Create the file if it does not exist and ensure your vLLM router configuration points to it.

### 5. Set up the database

```bash
# Apply the database schema
npx prisma migrate deploy

# Seed the initial admin user (username: admin, password: admin)
npx prisma db seed
```

> **Change the admin password immediately after first login** via the admin user management panel.

### 6. Configure sudoers for OS user management

The portal creates and locks Linux user accounts when shell access is provisioned or revoked. The Node.js process user needs passwordless `sudo` for these two commands.

Create a sudoers drop-in file:

```bash
sudo visudo -f /etc/sudoers.d/labtimeshare
```

Add the following line (replace `nodeuser` with the user that runs the portal process):

```
nodeuser ALL=(ALL) NOPASSWD: /sbin/useradd, /sbin/usermod, /bin/mkdir, /usr/bin/tee, /bin/chmod, /bin/chown, /usr/bin/truncate
```

### 7. Build and start

```bash
npm run build
npm start
```

The portal will be available at `http://<SERVER_IP>:3000`.

---

## Running as a systemd Service (Recommended)

A systemd unit file is included at `lts-portal.service`. To install it:

```bash
# Copy the unit file (edit it first to set User= and WorkingDirectory=)
sudo cp lts-portal.service /etc/systemd/system/

# Reload systemd and enable the service
sudo systemctl daemon-reload
sudo systemctl enable lts-portal
sudo systemctl start lts-portal

# Check status
sudo systemctl status lts-portal

# View logs
sudo journalctl -u lts-portal -f
```

---

## Placing Behind nginx (Optional)

```nginx
server {
    listen 80;
    server_name labtimeshare.internal;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

---

## First Use

1. Navigate to `http://<SERVER_IP>:3000`
2. Log in as `admin` / `admin` and immediately change the password via the Users panel
3. Create APPROVER accounts for other admins via `/admin/users`
4. Users can self-register at `/register` — their accounts start as **PENDING** until an admin approves them

---

## Architecture

```
Next.js App Router (TypeScript)
├── app/
│   ├── (auth)/         — Login and register pages
│   ├── dashboard/      — User-facing: active grants, request form
│   └── admin/          — Admin panel: users, requests, audit log
├── app/api/            — API routes (auth, requests, admin)
├── lib/
│   ├── prisma.ts       — Prisma client singleton
│   ├── auth.ts         — Password hashing, JWT
│   ├── session.ts      — Session cookie helpers
│   ├── provisioner.ts  — OS-level provisioning and revocation
│   ├── expiryJob.ts    — Background cron job for auto-expiry
│   └── audit.ts        — Audit log writer
├── prisma/
│   ├── schema.prisma   — Database schema
│   └── lts.db          — SQLite database (created on first run)
└── instrumentation.ts  — Starts the expiry cron job on server boot
```

### Database Models
- **User** — portal accounts with role (USER / APPROVER / ADMIN) and status (PENDING / ACTIVE / DISABLED)
- **AccessRequest** — a user's request for a specific access path with duration
- **ApiKeyGrant** — an issued API key linked to a request
- **ShellGrant** — a created Linux user account + SSH keypair linked to a request
- **AuditLog** — immutable record of all provisioning and admin actions

---

## vLLM Router Integration

The portal manages a plain text file (`VLLM_KEYS_FILE`) that your vLLM router reads to validate API keys. The format is one UUID per line:

```
550e8400-e29b-41d4-a716-446655440000
6ba7b810-9dad-11d1-80b4-00c04fd430c8
```

Configure your vLLM router to read this file as its permitted API keys source. When a user's API key grant is approved, the portal appends a new UUID. When the grant expires or is revoked, the portal removes the corresponding line.

---

## Security Notes

- All SSH access is VPN-only — no public SSH exposure
- SSH private keys are shown once in the portal UI and then deleted from the database
- Revoked shell accounts are locked (`usermod -L`) and their `authorized_keys` is cleared
- Expired grants are auto-revoked by a background job running every 5 minutes (configurable)
- Passwords are hashed with Argon2id
- Sessions use HTTP-only JWT cookies (24-hour expiry)
