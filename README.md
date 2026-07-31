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

## Account Cleanup & Retention Policy

The portal provides comprehensive account lifecycle management with automatic and manual cleanup options:

### SSH Key Revocation

When a shell access grant is revoked (either manually or via auto-expiry):
1. All SSH public keys are explicitly marked as revoked in the database (for audit purposes)
2. The account is locked: `usermod -L` prevents password-based authentication
3. The `authorized_keys` file is cleared, preventing key-based authentication
4. All revocation steps are recorded in the detailed audit trail with timestamps and status

This multi-layered approach ensures immediate access revocation while maintaining a complete audit record.

### Account Deletion Policy

Revoked shell accounts can be automatically or manually deleted. When approving a shell access request, admins can set an auto-delete policy:

- **Manual only (default)** — revoked accounts persist indefinitely; must be manually deleted via admin panel
- **Delete on revocation (0 days)** — account deleted immediately upon revocation
- **Delayed deletion (N days)** — account deleted automatically N days after revocation (e.g., 7, 30, 90 days)

### Auto-Cleanup Job

A background job runs every `CLEANUP_CHECK_INTERVAL_MINUTES` (default: 60) to automatically delete accounts past their retention window:

1. Finds all revoked accounts (isActive=false, deletedAt=null) with an auto-delete policy set
2. Checks if `revokedAt + autoDeleteAfterDays` is in the past
3. Deletes the OS user account (`userdel -r`) and removes the home directory
4. Marks the grant as deleted in the database (soft-delete for audit trail)
5. Logs each deletion to the detailed audit trail

### Manual Account Deletion

Admins/approvers can immediately delete a revoked account via:
- **Admin Panel**: Click "Delete Account" on any revoked shell access grant
- **API**: `POST /api/admin/grants/{id}/delete` with `{ "grantType": "SHELL_ACCESS" }`

Manual deletion requires:
- User has ADMIN or APPROVER role
- Grant exists and is shell access type
- Grant is revoked (isActive = false)

### Audit Trail for Deletions

Every account deletion is logged with detailed steps:
- **ssh_keys_revoked** — SSH public keys marked as revoked
- **account_locked** — Linux account locked via usermod
- **authorized_keys_cleared** — SSH key file cleared
- **os_account_deleted** — OS user and home directory deleted via userdel
- **db_marked_deleted** — Database grant marked with deletedAt timestamp

Each step records success/failure status with error messages if applicable.

### Configuration

```env
# How often to check for expired access grants (default: 5 minutes)
EXPIRY_CHECK_INTERVAL_MINUTES=5

# How often to check for revoked accounts ready for deletion (default: 60 minutes)
# Set to 0 to disable auto-cleanup
CLEANUP_CHECK_INTERVAL_MINUTES=60
```

---

## Security Notes

- All SSH access is VPN-only — no public SSH exposure
- SSH private keys are shown once in the portal UI and then retained for web terminal use (accessible via authenticated portal only)
- SSH keys are explicitly tracked by fingerprint and marked as revoked upon account revocation
- Revoked shell accounts are locked (`usermod -L`), have their `authorized_keys` cleared, and can be permanently deleted
- Expired grants are auto-revoked by a background job running every 5 minutes (configurable)
- Revoked accounts are automatically deleted based on configurable retention policy (manual only by default)
- All account revocation and deletion steps are recorded in detailed audit trail with timestamps and status
- Passwords are hashed with Argon2id
- Sessions use HTTP-only JWT cookies (24-hour expiry)
