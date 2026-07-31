# Account Cleanup Routine — Implementation Plan

## Top-Level Overview

Implement a comprehensive SSH user account cleanup system that fills critical gaps in the current lifecycle management:
1. **SSH Key Revocation by Fingerprint** — explicitly track and revoke keys instead of truncating
2. **Permanent Account Deletion** — remove revoked accounts and home directories after a configurable retention period or on-demand
3. **Enhanced Audit Trail** — track each step of account deletion separately (key revoked, password cleared, account locked, home deleted)
4. **Configurable Retention Policy** — admins can choose auto-delete N days after revocation or manual-only deletion
5. **Manual Deletion Tools** — API route + UI button for immediate account deletion

The implementation balances **safety** (retention period before auto-delete) with **automation** (opt-in auto-deletion) and **control** (manual override).

---

## Database Schema Changes

### New Models & Fields

#### 1. `SshKeyRecord` Model
Tracks each SSH public key generated for a ShellGrant to enable fingerprint-based revocation:

```prisma
model SshKeyRecord {
  id           String    @id @default(cuid())
  shellGrantId String
  publicKey    String
  keyType      String      // "ed25519"
  fingerprint  String      // SHA256 hex digest for explicit revocation
  comment      String      // "lts:username"
  isRevoked    Boolean   @default(false)
  revokedAt    DateTime?
  createdAt    DateTime  @default(now())
  
  shellGrant   ShellGrant @relation(fields: [shellGrantId], references: [id], onDelete: Cascade)
  
  @@index([shellGrantId])
  @@index([fingerprint])
}
```

#### 2. `AuditLogDetail` Model
Tracks sub-steps of complex operations (e.g., account deletion) with per-step success/failure:

```prisma
model AuditLogDetail {
  id            String   @id @default(cuid())
  auditLogId    String
  step          String   // "ssh_key_revoked", "password_cleared", "account_locked", "home_deleted"
  status        String   // "SUCCESS" | "FAILED"
  errorMessage  String?
  metadata      String?  // JSON with step-specific data (e.g., key fingerprint, OS exit code)
  createdAt     DateTime @default(now())
  
  auditLog      AuditLog @relation(fields: [auditLogId], references: [id], onDelete: Cascade)
  
  @@index([auditLogId])
}
```

#### 3. `ShellGrant` Field Additions
Track deletion policy and status:

```prisma
model ShellGrant {
  // ... existing fields ...
  
  // Deletion policy (set at grant creation time by approver)
  autoDeleteAfterDays Int?     // null = manual only, N > 0 = auto-delete after N days
  deleteScheduledAt   DateTime? // when auto-delete job scheduled this for deletion
  deleteReason        String?   // "auto_expired", "manual_request", "policy_violation"
  
  // ... rest of model ...
}
```

#### 4. `AuditLog` Relation Update
Add backref to AuditLogDetail:

```prisma
model AuditLog {
  // ... existing fields ...
  details       AuditLogDetail[]
}
```

---

## Sub-Tasks

### Sub-Task 1 — Database Migrations

**Intent:** Create Prisma migrations for the new models and schema changes. Establish the foundation for enhanced audit logging and SSH key tracking.

**Expected Outcomes:**
- New `SshKeyRecord` table created
- New `AuditLogDetail` table created
- `ShellGrant` table has new fields: `autoDeleteAfterDays`, `deleteScheduledAt`, `deleteReason`
- `AuditLog` table has foreign key to `AuditLogDetail`
- Prisma client regenerated

**Todo List:**
1. Create Prisma migration: `npx prisma migrate dev --name add_cleanup_models`
2. Define `SshKeyRecord`, `AuditLogDetail` models and relations
3. Add fields to `ShellGrant` model
4. Add relation to `AuditLog` model
5. Run migration and verify schema

**Relevant Context:**
- Schema file: `prisma/schema.prisma`
- Existing migration pattern: see `20260730154141_make_ssh_private_key_required`
- Run migrations in dev first, then deploy to prod

**Status:** `[ ] pending`

---

### Sub-Task 2 — Enhanced SSH Key Tracking in Provisioner

**Intent:** Modify the provisioning logic to generate SSH keys and immediately create a `SshKeyRecord` with fingerprint tracking. This enables explicit key revocation later.

**Expected Outcomes:**
- When `provisionShellAccess()` creates an SSH keypair, also generate and store the fingerprint
- `SshKeyRecord` created in DB linked to the `ShellGrant`
- Fingerprint computed from public key (SHA256 hex)
- Audit log records the key creation with fingerprint metadata
- No changes to revocation logic yet (that comes in Sub-Task 3)

**Todo List:**
1. Add helper function `computeKeyFingerprint(publicKey: string): string` to `lib/provisioner.ts`
   - Use `crypto.createHash('sha256')` to compute fingerprint from public key
   - Return hex digest (uppercase format matching OpenSSH)
2. In `provisionShellAccess()`, after SSH keypair generation:
   - Compute fingerprint using helper
   - Create `SshKeyRecord` entry with public key, fingerprint, key type, comment
3. Update audit log metadata for `SHELL_ACCESS_PROVISIONED` to include `keyFingerprint`
4. Test: provision a shell access grant, verify `SshKeyRecord` created with correct fingerprint

**Relevant Context:**
- File: `lib/provisioner.ts` — `provisionShellAccess()` function
- Key generation: `generateSshKeypair()` already returns public key
- Fingerprint format: SSH uses SHA256, displayed as `SHA256:BASE64` but we store hex for DB simplicity

**Status:** `[ ] pending`

---

### Sub-Task 3 — Explicit SSH Key Revocation by Fingerprint

**Intent:** Modify revocation logic to explicitly track which keys are revoked in the database before clearing `authorized_keys`. Replace the truncate approach with fingerprint-based removal.

**Expected Outcomes:**
- `revokeShellAccess()` now marks all `SshKeyRecord` entries for the grant as revoked
- `authorized_keys` is cleared only after DB is updated (order matters for audit trail)
- Audit trail shows key fingerprints that were revoked
- `AuditLogDetail` records each step (key revoked, password cleared, account locked, home cleared)
- Existing tests pass; behavior is transparent to callers

**Todo List:**
1. Modify `revokeShellAccess(grantId: string)` in `lib/provisioner.ts`:
   - Before OS operations, query `SshKeyRecord` entries for this grant
   - Update all to `isRevoked = true, revokedAt = now()`
   - Store fingerprints in audit metadata
2. Create helper function `createDetailedAuditLog(auditLogId, steps)` to write `AuditLogDetail` records
   - Called after `revokeShellAccess()` completes
   - Takes array of steps: `{ step, status, errorMessage?, metadata? }`
   - Creates one `AuditLogDetail` per step
3. Update `revokeShellAccess()` to return struct: `{ success: boolean, steps: Step[] }`
   - Track: "key_revoked", "password_cleared", "account_locked", "home_cleared"
   - Each step records success/failure
4. In `expiryJob.ts` and revoke API route, call the new helper to write detailed audit logs after revocation
5. Test: revoke a grant, verify `SshKeyRecord` marked revoked, `AuditLogDetail` entries created for each step

**Relevant Context:**
- File: `lib/provisioner.ts` — `revokeShellAccess()` function
- File: `lib/expiryJob.ts` — calls `revokeShellAccess()` and should write detailed audit logs
- File: `app/api/admin/grants/[id]/revoke/route.ts` — manual revoke endpoint
- Audit helper: `lib/audit.ts` — add new function `writeDetailedAuditLog()`

**Status:** `[ ] pending`

---

### Sub-Task 4 — Permanent Account Deletion Logic

**Intent:** Implement core functions to permanently delete revoked shell accounts and their home directories from the OS and database. This is the business logic that both manual and automatic deletion will call.

**Expected Outcomes:**
- `deleteShellAccount(grantId: string): Promise<DeleteResult>` function exported from provisioner
- Executes: `userdel -r <username>` (removes user and home directory)
- Handles errors (account already deleted, permission issues, etc.)
- Returns struct: `{ success, deletedAt, error?, metadata }`
- Marks `ShellGrant` as deleted in DB (or soft-delete flag, TBD with user)
- Audit trail records deletion with all steps (key revoked before, account deleted, DB cleaned)
- No changes to live shell sessions (not part of this sub-task, handled elsewhere)

**Todo List:**
1. Add `deleteShellAccount(grantId: string)` function to `lib/provisioner.ts`:
   - Lookup `ShellGrant` and verify `isActive = false` (can only delete revoked accounts)
   - Extract `linuxUsername`
   - Execute `sudo /sbin/userdel -r "<username>"` with timeout
   - Handle errors: ENOENT (already deleted) is idempotent, other errors logged
   - Return `{ success, deletedAt, error?, linuxUsername }`
2. Update `ShellGrant` schema to track deletion:
   - Add `deletedAt` field (DateTime?) — when account was actually deleted from OS
   - Keep `ShellGrant` record in DB (soft delete) for audit trail
   - Or full delete with `onDelete: Cascade` in `AuditLog` — decide with user constraints
3. Call after deletion: update `ShellGrant` with `deletedAt = now()`, `deleteReason`
4. Write audit log: `SHELL_ACCOUNT_DELETED` with `{ linuxUsername, deletedAt, reason }`
5. Test: create + revoke + delete a grant, verify account gone from OS and DB marked deleted

**Relevant Context:**
- File: `lib/provisioner.ts`
- File: `prisma/schema.prisma` — add `deletedAt`, `deleteReason` to `ShellGrant`
- OS command: `sudo /sbin/userdel -r` removes user + home directory
- Idempotency: account already deleted by sysadmin should not fail

**Status:** `[ ] pending`

---

### Sub-Task 5 — Automatic Cleanup Job (Retention Policy)

**Intent:** Implement a background cron job that periodically finds revoked accounts past their retention window and auto-deletes them (if opted-in via `autoDeleteAfterDays`). Runs separately from (or integrated with) the expiry job.

**Expected Outcomes:**
- New cron job or extend `expiryJob.ts` with cleanup phase
- Every N minutes, queries for `ShellGrant` where `isActive = false, autoDeleteAfterDays is not null, revokedAt < now - (autoDeleteAfterDays * 24h)`
- For each matching grant, calls `deleteShellAccount()`
- Updates `ShellGrant` with `deletedAt`, `deleteReason = "auto_cleanup_policy"`
- Logs audit entry per deletion
- Continues through failures (one grant's deletion failure doesn't block others)
- Emits console log with count of deletions

**Todo List:**
1. Create `runCleanupCheck()` function in `lib/expiryJob.ts` (or new `lib/cleanupJob.ts`)
   - Query: `ShellGrant where { isActive: false, autoDeleteAfterDays: { not: null }, revokedAt: { lt: now - N*24h } }`
   - For each grant: try `deleteShellAccount()`, catch errors, log, continue
   - Write audit log per deletion
   - Return count of successful deletions
2. Integrate into cron schedule:
   - Option A: Separate cron job in `startExpiryJob()` (two schedules)
   - Option B: Extend existing expiry job with cleanup phase (one schedule)
   - Choose based on separation of concerns — recommend separate for clarity
3. Add env var: `CLEANUP_CHECK_INTERVAL_MINUTES` (default: 60)
4. Add env var: `CLEANUP_CHECK_INTERVAL_MINUTES` and document in `.env.example`
5. Emit console log on each run: `[cleanupJob] Deleted X accounts, Y failures`
6. Test: create + revoke grant with `autoDeleteAfterDays=0` (immediate), wait for job, verify deletion

**Relevant Context:**
- File: `lib/expiryJob.ts` or new `lib/cleanupJob.ts`
- File: `instrumentation.ts` — start both jobs (or single integrated job)
- Job scheduling: `node-cron` package already available
- Env vars: update `.env.example`

**Status:** `[ ] pending`

---

### Sub-Task 6 — Manual Deletion Admin API

**Intent:** Expose an HTTP endpoint that allows admins/approvers to immediately delete a revoked account on-demand, bypassing the retention window.

**Expected Outcomes:**
- `POST /api/admin/grants/[id]/delete` route
- Requires ADMIN or APPROVER role
- Accepts: `{ grantType: "SHELL_ACCESS" }` (API key deletion not implemented yet)
- Validates: grant exists, is revoked (isActive=false), is shell access
- Calls `deleteShellAccount(id)` and writes audit log
- Returns `{ ok: true, deletedAt }` or error
- Error cases handled: already deleted, permission denied, DB errors

**Todo List:**
1. Create `app/api/admin/grants/[id]/delete/route.ts`
2. Implement route following existing pattern:
   - Auth: session check + role check (ADMIN | APPROVER)
   - Parse params: `{ id }` from route
   - Validate body: `{ grantType: "SHELL_ACCESS" }`
   - Lookup grant: `ShellGrant.findUnique({ where: { id } })`
   - Verify revoked: check `isActive = false`, `revokedAt is not null`
   - Call `deleteShellAccount(id)`
   - Write audit log: `SHELL_ACCOUNT_DELETED_MANUAL` with `{ userId, reason: "manual_request" }`
   - Respond: `{ ok: true, deletedAt }`
3. Handle errors:
   - 404: grant not found
   - 400: grant is still active (cannot delete active account)
   - 500: OS deletion failed (include error message)
4. Test: manually delete a revoked grant via API, verify success response and audit log

**Relevant Context:**
- File: `app/api/admin/grants/[id]/delete/route.ts` (new)
- Pattern: copy from `app/api/admin/grants/[id]/revoke/route.ts`
- Status codes: 200 (success), 400 (invalid state), 404 (not found), 500 (OS error)

**Status:** `[ ] pending`

---

### Sub-Task 7 — Admin UI: Deletion UI Controls

**Intent:** Add UI components to the admin panel to display deletion status and trigger manual deletion.

**Expected Outcomes:**
- Revoked Shell Access grants now show `deletedAt` timestamp if deleted
- Add "Delete Account" button on active revoked grants (only if `isActive = false`)
- Button disabled/grayed if account already deleted
- Clicking button triggers deletion via API, shows confirmation modal
- On success, refresh grant list and show "Account deleted" message
- Optional: show `autoDeleteAfterDays` policy and countdown timer to auto-deletion

**Todo List:**
1. Locate admin requests/grants UI: `app/admin/requests/page.tsx` or equivalent
2. In grant row/card for revoked shell access:
   - Display `deletedAt` if set, else display auto-delete countdown (if `autoDeleteAfterDays` set)
   - Add "Delete Now" button (visible only if `isActive=false` and `deletedAt=null`)
3. Create `DeleteAccountButton` component:
   - Shows confirmation modal: "This will permanently delete the Linux account and home directory. This cannot be undone."
   - On confirm: call `POST /api/admin/grants/[id]/delete`
   - On success: disable button, show "Deleted" badge, refresh table
   - On error: show error toast
4. Wire up in grant table/list view
5. Test: UI shows buttons, deletion works, state updates correctly

**Relevant Context:**
- File: `app/admin/requests/page.tsx` or similar (grant display)
- Component pattern: use existing button/modal components from codebase
- State refresh: reload page or re-query grant list

**Status:** `[ ] pending`

---

### Sub-Task 8 — Approval Form: Auto-Delete Policy Selection

**Intent:** When an approver approves a shell access request, allow them to optionally select an auto-delete policy (e.g., "Delete 7 days after expiry").

**Expected Outcomes:**
- Approval form has new optional field: "Auto-delete account after expiry? (days)"
- Dropdown/input: Manual only (null), 0 (delete on revoke), 7, 30, 90 days
- If selected, stores `autoDeleteAfterDays` on the `AccessRequest` → propagated to `ShellGrant` on creation
- Default: null (manual only) — no change in behavior for existing workflows
- Audit log records the policy choice in metadata

**Todo List:**
1. Locate approval flow: `app/api/admin/requests/[id]/approve/route.ts`
2. Add optional field to approve request: `autoDeleteAfterDays: number | null`
3. Validate: if provided, must be 0, 7, 30, 90, or other safe value
4. On approval, pass to `provisionShellAccess()` or set directly on `AccessRequest`
5. When `ShellGrant` is created, copy `autoDeleteAfterDays` from `AccessRequest`
6. Write audit metadata: `{ autoDeleteAfterDays }`
7. Update approval UI form to show dropdown (next sub-task, may be combined)
8. Test: approve with auto-delete policy, verify grant record has policy set, cleanup job respects it

**Relevant Context:**
- File: `app/api/admin/requests/[id]/approve/route.ts`
- File: `lib/provisioner.ts` — `provisionShellAccess()` signature may need update
- Approval UI: typically done in next sub-task (Sub-Task 9)

**Status:** `[ ] pending`

---

### Sub-Task 9 — Admin UI: Approval Form with Policy

**Intent:** Extend the admin request approval UI to include the auto-delete policy selector.

**Expected Outcomes:**
- When approving a shell access request, approver sees dropdown/radio group for policy
- Options: "Manual only", "Delete on expiry", "Delete after 7 days", "Delete after 30 days", etc.
- Form submission passes choice to approve API
- On success, displays confirmation: "Account approved with auto-delete in X days"

**Todo List:**
1. Locate approval request form UI: `app/admin/requests/page.tsx` or `app/admin/requests/[id]/page.tsx`
2. Add form field: policy selector (dropdown or radio group)
3. Call approve API with `autoDeleteAfterDays` parameter
4. Show result message with policy info
5. Test: approve request with different policies, verify stored correctly

**Relevant Context:**
- File: may be combined with UI component creation
- Pattern: existing form components in codebase

**Status:** `[ ] pending`

---

### Sub-Task 10 — Environment Configuration & Documentation

**Intent:** Document new environment variables, update deployment guides, and provide admin instructions for the cleanup system.

**Expected Outcomes:**
- `.env.example` updated with new vars: `CLEANUP_CHECK_INTERVAL_MINUTES`
- `README.md` updated with cleanup system documentation:
  - Explanation of auto-delete policy
  - How to manually delete accounts via admin panel
  - Retention window behavior
  - Audit trail visibility
- New section: "Account Cleanup & Retention Policy"
- Deployment checklist includes cleanup job startup verification

**Todo List:**
1. Update `.env.example`:
   - Add: `CLEANUP_CHECK_INTERVAL_MINUTES=60`
   - Document: "How often (in minutes) to check for revoked accounts ready for auto-deletion. Set to 0 to disable auto-cleanup."
2. Update `README.md`:
   - Add "Account Cleanup & Retention Policy" section
   - Explain auto-delete vs manual delete
   - Document environment variables
   - Show admin panel UI for deletion
3. Add troubleshooting section: common cleanup issues
4. Verify all env vars are listed and documented

**Relevant Context:**
- Files: `.env.example`, `README.md`
- Previous pattern: see how other features are documented

**Status:** `[ ] pending`

---

## Implementation Order

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10
```

**Sequential:** Each sub-task builds on previous. Database changes first (Sub-Task 1), then provisioning changes (Sub-Task 2), then revocation changes (Sub-Task 3), then deletion logic (Sub-Task 4), then automation (Sub-Task 5), then manual controls (Sub-Task 6–7), then approval workflow (Sub-Task 8–9), then documentation (Sub-Task 10).

**No parallelization:** Each sub-task requires output of the previous.

---

## Testing Strategy

- **Unit tests:** Test helper functions (fingerprint computation, deletion logic)
- **Integration tests:** Provision → Revoke → Delete flow
- **Manual testing:** Admin UI deletion buttons, approval form policy selector
- **Audit verification:** Confirm `AuditLogDetail` entries created for each step
- **Retention policy:** Verify cleanup job respects `autoDeleteAfterDays` and `revokedAt` timestamp

---

## Rollback & Safety

- Schema changes are migrations (reversible with `prisma migrate revert`)
- Deletion logic only runs on accounts already marked `isActive=false` (safe)
- Auto-delete job is opt-in per grant (default: manual only, no change)
- Manual deletion requires admin approval + confirmation modal
- All deletions logged to audit trail with full metadata


---

## Implementation Summary

All 8 of 10 sub-tasks have been completed. The remaining 2 are UI-only and can be completed independently.

### Completed Sub-Tasks

#### Sub-Task 1 ✓ — Database Migrations
- Created migration `20260731150743_add_cleanup_models`
- Added `SshKeyRecord` model with fingerprint tracking and cascade delete
- Added `AuditLogDetail` model for detailed operation logging
- Enhanced `ShellGrant` with: `deletedAt`, `autoDeleteAfterDays`, `deleteScheduledAt`, `deleteReason`
- Updated `AuditLog` with FK to `AuditLogDetail` (cascade delete)
- Migration applied successfully; Prisma client regenerated

#### Sub-Task 2 ✓ — Enhanced SSH Key Tracking
- Added `computeKeyFingerprint()` helper in `lib/provisioner.ts`
  - Computes SHA256 hash from public key base64-encoded portion
  - Returns uppercase hex digest for consistency
- Updated `provisionShellAccess()` to:
  - Create `SshKeyRecord` with fingerprint, key type ("ed25519"), comment
  - Pass fingerprint to audit log metadata
  - Throw on fingerprint computation failure (critical for tracking)

#### Sub-Task 3 ✓ — Explicit SSH Key Revocation
- Refactored `revokeShellAccess()` to return `RevocationStepResult[]`
- Now performs 4 tracked steps:
  1. Mark all SSH keys as revoked in `SshKeyRecord` (new)
  2. Lock account: `usermod -L`
  3. Clear authorized_keys file
  4. Mark grant as revoked in DB
- Integrated `writeDetailedAuditLog()` for per-step tracking
- Each step records: success/failure, error message, relevant metadata
- Imported `writeDetailedAuditLog` in import

#### Sub-Task 4 ✓ — Permanent Account Deletion Logic
- Added `deleteShellAccount(grantId, deleteReason)` function in `lib/provisioner.ts`
- Validates: grant is revoked (throws if active), returns early if already deleted (idempotent)
- Executes two main steps:
  1. OS deletion: `userdel -r <username>` with error resilience
  2. DB update: set `deletedAt`, `deleteReason`, clear `deleteScheduledAt`
- Handles non-existent accounts as successful (idempotent)
- Returns `DeleteResult` struct with `success`, `deletedAt`, `linuxUsername`, `deleteReason`
- Calls `writeDetailedAuditLog()` with step tracking and error messages

#### Sub-Task 5 ✓ — Automatic Cleanup Job
- Added `runCleanupCheck()` function in `lib/expiryJob.ts`
- Queries for revoked, not-yet-deleted grants with `autoDeleteAfterDays` set
- Calculates deletion threshold: `revokedAt + (autoDeleteAfterDays * 24h)`
- Calls `deleteShellAccount()` for each grant past threshold
- Continues through failures (per-grant error handling)
- Logs counts: deleted, failed
- Extended `startExpiryJob()` to schedule cleanup job on separate cron interval
- Respects `CLEANUP_CHECK_INTERVAL_MINUTES` env var (default 60, set to 0 to disable)
- Logs startup message indicating enabled/disabled status

#### Sub-Task 6 ✓ — Manual Deletion Admin API
- Created `app/api/admin/grants/[id]/delete/route.ts`
- Follows existing admin route patterns:
  - Session check (401) → Role check (403) → Parse JSON → Validate schema
  - Lookup grant (404) → Verify revoked (400) → Check not already deleted
  - Call `deleteShellAccount()` with "manual_admin_request" reason
  - Write audit log with user context
- Schema: `{ grantType: "SHELL_ACCESS" }` (only shell access deletable)
- Response: `{ ok: true, deletedAt, linuxUsername }` or error JSON
- Error cases: unauthorized, forbidden, not found, not revoked, already deleted, OS error

#### Sub-Task 8 ✓ — Approval Form: Auto-Delete Policy Selection (API)
- Updated `app/api/admin/requests/[id]/approve/route.ts`
- Added Zod schema: `ApproveSchema` with optional `autoDeleteAfterDays: number | null`
- Approval flow now:
  1. Validates request including optional `autoDeleteAfterDays`
  2. Provisions grant (API key or shell access)
  3. If shell access + `autoDeleteAfterDays` provided, updates `ShellGrant.autoDeleteAfterDays`
  4. Writes audit log including `autoDeleteAfterDays` in metadata
- Accepts null to explicitly disable auto-delete (overrides any default)
- Accepts 0 for immediate deletion on revocation
- Accepts positive integers for N-day delays

#### Sub-Task 10 ✓ — Environment Configuration & Documentation
- Updated `.env.example`:
  - Added `CLEANUP_CHECK_INTERVAL_MINUTES=60` with documentation
  - Documented purpose of both interval vars
  - Added explanatory comments on auto-delete policy
- Updated `README.md`:
  - New section: "Account Cleanup & Retention Policy" (detailed)
  - Documented SSH key revocation flow (multi-layer defense)
  - Documented account deletion policy options
  - Documented auto-cleanup job behavior
  - Documented manual deletion (UI + API)
  - Documented audit trail steps
  - Updated Security Notes to reflect new capabilities
- All documentation is comprehensive and clear

### Pending Sub-Tasks (UI-Only)

#### Sub-Task 7 — Admin UI: Deletion UI Controls
**Not implemented yet** (UI development).
- Requires: Add "Delete Account" button to revoked shell access grants
- Show deletion status (deletedAt or auto-delete countdown)
- Implement confirmation modal before deletion
- Call `POST /api/admin/grants/[id]/delete` on confirmation

#### Sub-Task 9 — Admin UI: Approval Form with Policy
**Not implemented yet** (UI development).
- Requires: Add form field to approval request modal/page
- Selector: dropdown or radio for auto-delete policy
- Options: Manual only, Delete on revocation, Delete after N days
- Call `POST /api/admin/requests/[id]/approve` with `autoDeleteAfterDays` parameter

### Code Quality

- **TypeScript**: All new code is fully typed, no `any` types
- **Error Handling**: Comprehensive try-catch with logging at each step
- **Idempotency**: All operations are safe to retry
- **Audit Trail**: Every action logged with full context and error tracking
- **Conventions**: Follows existing codebase patterns for APIs, provisioner, and jobs
- **Documentation**: Inline comments explain non-obvious logic

### Testing Checklist

- ✓ Build completes with no TypeScript errors
- ✓ Database migration applies successfully
- ✓ New API routes are registered
- ✓ Provisioner functions compile and export correctly
- ✓ Cleanup job integrates with cron scheduler
- ⏳ Manual testing: provision → revoke → delete account flow
- ⏳ Manual testing: auto-cleanup job with various retention policies
- ⏳ Manual testing: audit trail detailed logging
- ⏳ UI testing: delete button and approval form policy selector

### Deployment Notes

1. Run migration on production: `npx prisma migrate deploy`
2. Set `CLEANUP_CHECK_INTERVAL_MINUTES` in `.env` (default 60 works well)
3. Ensure sudoers entry includes `userdel -r` if not already present:
   ```
   nodeuser ALL=(ALL) NOPASSWD: /sbin/useradd, /sbin/usermod, /sbin/userdel, ...
   ```
4. Monitor logs for `[cleanupJob]` and `[provisioner]` messages
5. Test manual deletion API on revoked accounts before releasing to users

