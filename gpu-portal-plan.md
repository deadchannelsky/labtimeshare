# GPU Access Self-Service Portal — Plan

## Top-Level Overview

Build a self-service web portal called **LabTimeShare** that allows coworkers to request time-limited, approval-gated access to a shared GPU server. The portal runs directly on the RHEL GPU server. Approvers review and approve/deny requests through an admin panel. Access is automatically provisioned on approval and automatically revoked when the time window expires. Admins can extend any active grant.

### Stack
- **Framework:** Next.js (TypeScript) — full-stack, single deployable app
- **Database:** SQLite via Prisma ORM
- **Background jobs:** `node-cron` embedded in the Next.js server process for expiry enforcement
- **Auth:** Username + password (Argon2 hashing), HTTP-only session cookie (JWT)
- **Deployment:** RHEL server, `npm run build && npm start`, optionally behind nginx

### Access Paths Supported
| Path | What the User Gets |
|---|---|
| **Path 1 — API Key** | A UUID API key that is added to the vLLM router's permitted-keys file, allowing authenticated inference calls |
| **Path 3 — Shell Access** | A Linux OS user account created on the RHEL server with an SSH keypair; user receives credentials via portal UI; VPN-only access |

> Path 2 (Linux VM standup) is dropped in favor of Path 3 (direct OS shell access) as more practical.

### Core Flows
```
User registers → Admin approves account → User logs in →
User submits access request (selects Path + duration) →
Approver sees pending request in admin panel →
Approver approves or denies →
Access is auto-provisioned (API key written / OS user created) →
Expiry job fires → Access auto-revoked →
Admin may extend any active grant at any time
```

---

## Sub-Tasks

---

### Sub-Task 1 — Project Scaffolding & Database Schema

**Intent:** Initialize the Next.js TypeScript project, install all dependencies, configure Prisma with SQLite, and define the full database schema. This is the foundation every other sub-task builds on.

**Expected Outcomes:**
- `package.json` with all required dependencies
- Prisma schema file defining all models
- SQLite database created and migrated
- Next.js app boots locally

**Todo List:**
1. Run `npx create-next-app@latest` with TypeScript, App Router, Tailwind CSS
2. Install dependencies: `prisma`, `@prisma/client`, `argon2`, `jose` (JWT), `node-cron`, `uuid`, `zod`
3. Initialize Prisma with SQLite provider
4. Define Prisma schema models (see below)
5. Run initial migration (`prisma migrate dev`)
6. Seed an initial admin user

**Prisma Models:**
- `User` — id, email, username, passwordHash, role (`USER` | `APPROVER` | `ADMIN`), status (`PENDING` | `ACTIVE` | `DISABLED`), createdAt
- `AccessRequest` — id, userId, path (`API_KEY` | `SHELL_ACCESS`), status (`PENDING` | `APPROVED` | `DENIED` | `REVOKED`), requestedDurationHours, grantedAt, expiresAt, reviewedBy, reviewedAt, notes, createdAt
- `ApiKeyGrant` — id, requestId, apiKey (UUID), isActive, createdAt, revokedAt
- `ShellGrant` — id, requestId, linuxUsername, sshPublicKey, sshPrivateKey (shown once), isActive, createdAt, revokedAt
- `AuditLog` — id, actorId, action, targetId, targetType, metadata (JSON), createdAt

**Relevant Context:** None yet — greenfield project.

**Status:** `[x] done`

---

### Sub-Task 2 — Authentication System

**Intent:** Implement username/password auth with HTTP-only JWT session cookies. New user registrations start in `PENDING` status and cannot log in until an admin/approver sets them to `ACTIVE`. This covers registration, login, logout, and session middleware.

**Expected Outcomes:**
- `/register` page — user submits username, email, password; account created in `PENDING` state
- `/login` page — active users can log in; pending/disabled users see a clear message
- Session middleware that protects all `/dashboard` and `/admin` routes
- Logout clears the session cookie
- Passwords hashed with Argon2

**Todo List:**
1. Create auth utility: `lib/auth.ts` — password hash/verify with Argon2, JWT sign/verify with `jose`
2. Create session middleware: `middleware.ts` — reads JWT from HTTP-only cookie, redirects unauthenticated requests
3. Build `/register` page and `POST /api/auth/register` route
4. Build `/login` page and `POST /api/auth/login` route
5. Build `POST /api/auth/logout` route (clears cookie)
6. Add role-based route protection (ADMIN/APPROVER only for `/admin/*`)

**Relevant Context:**
- Sub-Task 1 must be complete (User model needed)
- Session cookie name: `lts-session`
- JWT payload: `{ userId, role, username }`

**Status:** `[x] done`

---

### Sub-Task 3 — User Dashboard & Access Request Form

**Intent:** Build the logged-in user experience: a dashboard showing their current grants and request history, and a form to submit new access requests.

**Expected Outcomes:**
- `/dashboard` — shows active grants (with expiry countdown), pending requests, and past requests
- `/dashboard/request` — form to select access path (API Key or Shell Access) and desired duration (dropdown: 1h, 4h, 8h, 24h, 72h, 1 week — or custom hours)
- Submitted requests appear immediately as `PENDING` on the dashboard
- Active Shell Access grants show a one-time credentials panel (SSH private key + username + server IP) that is only shown once after approval
- Active API Key grants show the key value

**Todo List:**
1. Build `GET /api/requests` — returns the current user's requests and grants
2. Build `POST /api/requests` — validates and creates a new AccessRequest
3. Build `/dashboard` page with request history table and active grant cards
4. Build `/dashboard/request` page with path selector and duration picker
5. Build credentials reveal component for Shell Access (private key shown once, then hidden)
6. Build API key display component for API Key grants

**Relevant Context:**
- Sub-Tasks 1 and 2 must be complete
- Server IP displayed in credentials panel should come from an env var `SERVER_IP`
- SSH private key is stored in `ShellGrant.sshPrivateKey` — display it once and prompt user to copy it

**Status:** `[x] done`

---

### Sub-Task 4 — Admin Panel: User Management

**Intent:** Build the admin panel section for managing user accounts — approving new registrations, changing roles, and disabling accounts.

**Expected Outcomes:**
- `/admin/users` — table of all users with status, role, and action buttons
- Approving a `PENDING` user sets their status to `ACTIVE`
- Admin can promote a user to `APPROVER` role
- Admin can disable/re-enable an account
- All actions are recorded in `AuditLog`

**Todo List:**
1. Build `GET /api/admin/users` — returns all users (admin/approver only)
2. Build `PATCH /api/admin/users/[id]` — update status or role
3. Build `/admin/users` page with sortable user table and inline action buttons
4. Add audit log writes for all user management actions

**Relevant Context:**
- Sub-Tasks 1 and 2 must be complete
- Only `ADMIN` role should be able to change roles; both `ADMIN` and `APPROVER` can approve new users

**Status:** `[x] done`

---

### Sub-Task 5 — Admin Panel: Request Review & Grant Management

**Intent:** Build the approver-facing panel for reviewing pending access requests, approving or denying them, viewing active grants, revoking grants early, and extending expiry.

**Expected Outcomes:**
- `/admin/requests` — table of all requests with status filter tabs (Pending / Active / Expired / Denied)
- Approver can approve a pending request — triggers provisioning (Sub-Task 6)
- Approver can deny a request with an optional note
- Approver can revoke any active grant immediately — triggers revocation (Sub-Task 6)
- Approver can extend expiry of an active grant (sets a new `expiresAt`)
- All actions recorded in `AuditLog`

**Todo List:**
1. Build `GET /api/admin/requests` — returns all requests with grant details
2. Build `POST /api/admin/requests/[id]/approve` — approve with duration, triggers provisioning
3. Build `POST /api/admin/requests/[id]/deny` — deny with optional note
4. Build `POST /api/admin/grants/[id]/revoke` — revoke active grant, triggers revocation
5. Build `POST /api/admin/grants/[id]/extend` — update `expiresAt`
6. Build `/admin/requests` page with tabbed request table and action buttons
7. Add audit log writes for all actions

**Relevant Context:**
- Sub-Tasks 1 and 2 must be complete
- Provisioning and revocation logic lives in Sub-Task 6; this sub-task calls those service functions
- The approve action sets `grantedAt = now`, `expiresAt = now + requestedDurationHours`

**Status:** `[x] done`

---

### Sub-Task 6 — Provisioning & Revocation Service

**Intent:** Implement the server-side service functions that actually provision and revoke the two access paths. This is the core integration layer between the portal and the OS/vLLM router. Runs on the same machine, so it can use `child_process` to execute shell commands as a privileged user.

**Expected Outcomes:**
- `lib/provisioner.ts` — a module with four exported functions: `provisionApiKey`, `revokeApiKey`, `provisionShellAccess`, `revokeShellAccess`
- API Key provisioning: generates UUID, appends it to the vLLM router's permitted-keys file (path configured via env var `VLLM_KEYS_FILE`), saves key to `ApiKeyGrant`
- API Key revocation: removes the key line from the permitted-keys file, marks `ApiKeyGrant.isActive = false`
- Shell provisioning: calls `useradd` to create a Linux user (username derived from portal username + request ID suffix), generates SSH keypair, writes pubkey to `~/.ssh/authorized_keys`, saves both keys to `ShellGrant`
- Shell revocation: calls `usermod -L` to lock the account, removes the authorized_keys entry, marks `ShellGrant.isActive = false`
- All provisioning steps are logged to `AuditLog`

**Todo List:**
1. Create `lib/provisioner.ts` with the four provisioning/revocation functions
2. Implement `provisionApiKey`: generate UUID, append to `VLLM_KEYS_FILE`, create `ApiKeyGrant` record
3. Implement `revokeApiKey`: read keys file, remove matching line, rewrite file, update DB record
4. Implement `provisionShellAccess`: run `useradd -m -s /bin/bash <username>`, generate SSH keypair (using `ssh-keygen` or the `ssh2` npm package), set up `~/.ssh/authorized_keys`, create `ShellGrant` record
5. Implement `revokeShellAccess`: run `usermod -L <username>`, clear `~/.ssh/authorized_keys` for that user, update DB record
6. Wrap all shell command calls in try/catch with error logging — provisioning failures should mark the grant as failed, not silently succeed
7. Document required OS permissions (the Node process must run as root or a sudoers-enabled user for `useradd`/`usermod`)

**Relevant Context:**
- Called from Sub-Task 5 (admin approval/revocation) and Sub-Task 7 (automated expiry)
- `VLLM_KEYS_FILE` env var — path to the file the vLLM router reads for permitted API keys (one key per line)
- Linux usernames must be unique — use pattern `lts-<username>-<shortId>` to avoid conflicts
- SSH keypair generation: use Node `crypto` + `ssh2` library, or shell out to `ssh-keygen -t ed25519`

**Status:** `[x] done`

---

### Sub-Task 7 — Automated Expiry Job

**Intent:** Implement a background cron job that runs on a short interval, finds all active grants past their `expiresAt` time, and revokes them automatically by calling the provisioner service.

**Expected Outcomes:**
- A cron job runs every 5 minutes (configurable via env var)
- Any `ApiKeyGrant` or `ShellGrant` that is `isActive = true` and `expiresAt < now` is revoked
- The associated `AccessRequest` status is updated to `REVOKED`
- Revocations are logged to `AuditLog`
- The cron job starts automatically when the Next.js server starts

**Todo List:**
1. Create `lib/expiryJob.ts` using `node-cron`
2. Query DB for all active grants where `expiresAt < now`
3. For each expired grant, call `revokeApiKey` or `revokeShellAccess` from the provisioner
4. Update `AccessRequest.status = REVOKED`
5. Write to `AuditLog`
6. Start the cron job in Next.js server initialization (via a custom `server.ts` or Next.js instrumentation hook `instrumentation.ts`)

**Relevant Context:**
- Sub-Task 6 must be complete before this sub-task
- Next.js App Router supports `instrumentation.ts` at the root for server-side startup code — preferred over a custom server
- The cron interval env var: `EXPIRY_CHECK_INTERVAL_MINUTES` (default: 5)

**Status:** `[x] done`

---

### Sub-Task 8 — Audit Log Viewer

**Intent:** Build a read-only admin page that displays the full audit log, giving admins visibility into all provisioning, revocation, and user management actions.

**Expected Outcomes:**
- `/admin/audit` — paginated table of all audit log entries
- Shows: timestamp, actor, action, target, metadata summary
- Filterable by action type and date range

**Todo List:**
1. Build `GET /api/admin/audit` — returns paginated, filterable audit log entries
2. Build `/admin/audit` page with sortable/filterable table
3. Add navigation link in admin sidebar

**Relevant Context:**
- Sub-Tasks 1 and 2 must be complete
- `AuditLog` model defined in Sub-Task 1

**Status:** `[x] done`

---

### Sub-Task 9 — Environment Configuration & Deployment

**Intent:** Document and implement all environment variable configuration, write a deployment guide for RHEL, and optionally produce a systemd service unit file for running the portal as a managed service.

**Expected Outcomes:**
- `.env.example` file listing all required and optional env vars with descriptions
- `README.md` with setup instructions: install Node, clone repo, configure env, migrate DB, build, start
- `lts-portal.service` systemd unit file for running under systemd on RHEL
- Instructions for the Node process permissions needed for `useradd`/`usermod` (sudoers entry)

**Environment Variables:**
```
DATABASE_URL=file:./lts.db
JWT_SECRET=<random 64-char string>
SERVER_IP=<GPU server LAN IP>
VLLM_KEYS_FILE=/path/to/vllm/permitted_keys.txt
EXPIRY_CHECK_INTERVAL_MINUTES=5
NEXT_PUBLIC_APP_NAME=LabTimeShare
PORT=3000
```

**Todo List:**
1. Write `.env.example`
2. Write `README.md` with full setup steps
3. Write `lts-portal.service` systemd unit file
4. Document the sudoers entry required: `node-user ALL=(ALL) NOPASSWD: /sbin/useradd, /sbin/usermod`

**Relevant Context:**
- All other sub-tasks must be complete before this one
- The portal process must have permission to write to `VLLM_KEYS_FILE` and to run `useradd`/`usermod`

**Status:** `[x] done`

---

## Implementation Order

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
```

Sub-Tasks 3, 4, and 5 can be worked in parallel after Sub-Task 2.
Sub-Task 6 must precede Sub-Task 7.
Sub-Task 9 is last.
