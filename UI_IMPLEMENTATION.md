# UI Integration — Complete Implementation

## ✓ All UI Components Implemented

This document details the complete UI integration for SSH account cleanup and account management features.

---

## Features Implemented

### 1. Auto-Delete Policy Selector in Approval Panel

**Location:** `app/admin/RequestActionsRow.tsx` — Approval Panel

**What It Does:**
When an admin approves a shell access request, they can now select an auto-delete policy:

- **Manual Only** (default) — No automatic deletion
- **Delete on Revocation** — Delete immediately when account is revoked  
- **Delete after 7 Days** — Delete 7 days after revocation
- **Delete after 30 Days** — Delete 30 days after revocation

**UI Pattern:**
- Radio buttons for policy selection
- Only shows for Shell Access requests (API keys not affected)
- Appears in expandable approval panel
- User-friendly labels and clear separation from other options

**Code Flow:**
1. User clicks "Approve" button on pending request
2. Approval panel expands
3. Admin enters optional duration override
4. Admin selects auto-delete policy (or leaves as manual)
5. Clicks "Confirm Approve"
6. API receives: `{ durationHours?: N, autoDeleteAfterDays?: N|null }`
7. Policy stored on `ShellGrant.autoDeleteAfterDays`

### 2. Delete Account Button for Revoked Grants

**Location:** `app/admin/RequestActionsRow.tsx` — Action Buttons

**What It Does:**
Shows a prominent "Delete Account" button on revoked shell access grants that haven't been deleted yet.

**Appearance:**
- Orange button with "Delete Account" label
- Shows "Deleting…" while operation is in progress
- Only visible for:
  - Shell Access grants (not API keys)
  - Grants with status = REVOKED
  - Grants not yet deleted (`deletedAt = null`)
  - Grants not active (`isActive = false`)

**User Interaction:**
1. Admin clicks "Delete Account" button
2. Browser shows confirmation modal: "This will permanently delete the Linux account and home directory. This cannot be undone. Are you sure?"
3. On confirm:
   - Button shows "Deleting…" and is disabled
   - API call: `POST /api/admin/grants/{grantId}/delete`
   - On success: page refreshes, account is deleted from OS
   - On error: alert shown with error message

**Error Handling:**
- Not found: "Grant not found"
- Still active: "Cannot delete active grant"
- Already deleted: Shows success message
- OS error: Shows specific error from `userdel` command

### 3. Data Flow Updates

**Updated Type Definitions:**
```typescript
type ShellGrantRow = {
  // ... existing fields ...
  deletedAt: string | null;  // NEW: tracks when account was deleted
};
```

**Updated Page Query:**
```typescript
// app/admin/requests/page.tsx now includes:
shellGrant: {
  select: {
    // ... existing fields ...
    deletedAt: true,  // NEW
  },
}
```

---

## UI Interaction Flow

### Scenario 1: Approve Request with Auto-Delete Policy

```
Admin Views Pending Request
         ↓
Clicks "Approve" Button
         ↓
Approval Panel Expands
         ↓
Admin Optionally Adjusts Duration
         ↓
Admin Selects Auto-Delete Policy
  (Manual / Delete on Revoke / 7 Days / 30 Days)
         ↓
Clicks "Confirm Approve"
         ↓
✓ Request Approved & Provisioned
✓ Policy Stored: ShellGrant.autoDeleteAfterDays
```

### Scenario 2: Manual Account Deletion

```
Request is Revoked (Manual or Auto-Expiry)
         ↓
Revoked Grant Shows in "Revoked" Tab
         ↓
Admin Clicks "Delete Account" Button
         ↓
Confirmation Modal Shown
         ↓
Admin Confirms Deletion
         ↓
DELETE /api/admin/grants/{id}/delete
         ↓
✓ Account Deleted from OS (userdel -r)
✓ ShellGrant.deletedAt Set
✓ Page Refreshes
✓ Button Disappears (already deleted)
```

### Scenario 3: Automatic Account Deletion

```
Account with autoDeleteAfterDays Policy is Revoked
         ↓
Background Cleanup Job Runs (every 60 min)
         ↓
Job Checks: revokedAt + autoDeleteAfterDays < now?
         ↓
If True:
  ✓ Account Deleted from OS
  ✓ ShellGrant.deletedAt Set
  ✓ Audit Logged
         ↓
Admin Sees Account Already Deleted
(No Delete Button; Timestamp Shows)
```

---

## Component Details

### RequestActionsRow.tsx

**New State Variables:**
```typescript
const [autoDeleteAfterDays, setAutoDeleteAfterDays] = useState<string | null>(null);
```

**New Functions:**
```typescript
async function handleDelete() {
  // Confirms with user
  // Calls POST /api/admin/grants/{id}/delete
  // Refreshes page on success
}
```

**Button Logic:**
- For PENDING requests: Show "Approve" and "Deny" buttons
- For ACTIVE grants: Show "Revoke" and "Extend" buttons
- For REVOKED shell grants (not deleted): Show "Delete Account" button
- For DENIED/already-deleted: Show dash "—"

**Approval Panel Updates:**
- Added auto-delete policy radio group
- Conditional rendering (shell access only)
- Clean UI with separators

---

## Styling

### Color Scheme

| Element | Color | Purpose |
|---------|-------|---------|
| Approve Button | Green | Positive action (approve request) |
| Deny Button | Red | Negative action (deny request) |
| Revoke Button | Red | Destructive action (revoke grant) |
| Extend Button | Blue | Extend expiry |
| Delete Button | Orange | Permanent deletion (high caution) |

### Tailwind Classes

- Buttons: `rounded-md border px-3 py-1.5 text-sm font-medium`
- Input fields: `w-44 rounded-md border border-gray-300 px-3 py-1.5`
- Hover states: `hover:bg-{color}-50` or `hover:bg-{color}-700`
- Disabled: `disabled:opacity-50`
- Focus: `focus:outline-none focus:ring-2 focus:ring-{color}-400`

---

## API Integration

### Approval Endpoint with Policy

```typescript
// POST /api/admin/requests/{id}/approve
Request Body:
{
  durationHours?: number;      // Optional duration override
  autoDeleteAfterDays?: number | null;  // NEW: deletion policy
}

Response:
{
  id: "...",
  status: "APPROVED",
  shellGrant: {
    id: "...",
    autoDeleteAfterDays: 7 // or null or 0
  }
}
```

### Manual Deletion Endpoint

```typescript
// POST /api/admin/grants/{id}/delete
Request Body:
{
  grantType: "SHELL_ACCESS"
}

Response (200):
{
  ok: true,
  deletedAt: "2025-01-20T10:30:00Z",
  linuxUsername: "lts-john-abc123"
}

Error Response (400/500):
{
  error: "Cannot delete active grant..."
}
```

---

## Test Cases

### Manual Testing Checklist

```
[ ] Approval Form - Policy Selection
    [ ] Approve shell access request
    [ ] Verify policy options appear in panel
    [ ] Select "Delete after 7 days"
    [ ] Click "Confirm Approve"
    [ ] Verify shellGrant.autoDeleteAfterDays = 7
    [ ] Check audit log shows policy in metadata

[ ] Delete Button - Visibility
    [ ] Revoke an account
    [ ] Verify "Delete Account" button appears
    [ ] Verify button has orange color
    [ ] Verify button shows only for shell access (not API keys)

[ ] Delete Button - Functionality
    [ ] Click "Delete Account" button
    [ ] Verify confirmation modal appears
    [ ] Cancel deletion
    [ ] Verify button still visible
    [ ] Click "Delete Account" again
    [ ] Confirm deletion
    [ ] Verify button changes to "Deleting…"
    [ ] Page refreshes
    [ ] Verify button gone (already deleted)
    [ ] Check OS: account deleted (getent passwd shows nothing)
    [ ] Check DB: shellGrant.deletedAt set

[ ] API Key Requests - No Policy
    [ ] Approve API key request
    [ ] Verify NO policy selector appears
    [ ] Approval succeeds
    [ ] API key doesn't have auto-delete policy

[ ] Already Deleted Account
    [ ] Create account with autoDeleteAfterDays=0
    [ ] Revoke account (auto-deleted immediately by job)
    [ ] Refresh page
    [ ] Verify no "Delete Account" button
    [ ] Verify timestamp or status indicates deleted
```

---

## File Changes Summary

### Modified Files

1. **app/admin/RequestActionsRow.tsx**
   - Added `autoDeleteAfterDays` state
   - Added `handleDelete()` function
   - Updated approve button to send policy
   - Updated approval panel with policy radio group
   - Added delete button for revoked grants

2. **app/admin/requests/page.tsx**
   - Added `deletedAt` to shellGrant query select
   - Added `deletedAt` to serialization mapping

### Database Schema

- `ShellGrant` model already has: `deletedAt`, `autoDeleteAfterDays`, `deleteScheduledAt`, `deleteReason`
- No schema changes needed for UI

### API Routes

- `/api/admin/requests/[id]/approve` — already enhanced in backend
- `/api/admin/grants/[id]/delete` — already implemented in backend

---

## Deployment

### Prerequisites
- Backend implementation complete (see `account-cleanup-plan.md`)
- Database migration applied: `20260731150743_add_cleanup_models`
- Node process sudoers entry includes `/sbin/userdel`

### Deployment Steps

1. **Build:**
   ```bash
   npm run build
   ```

2. **Test in Staging:**
   - Approve shell access request with auto-delete policy
   - Verify policy saved in database
   - Manually delete revoked account via UI button
   - Verify account deleted from OS

3. **Deploy to Production:**
   ```bash
   npm run build
   npm run deploy  # or your deployment script
   ```

4. **Verify:**
   - Check admin panel shows policy selector
   - Test delete button on revoked account
   - Monitor cleanup job logs

---

## Browser Compatibility

- ✓ Chrome/Edge (v90+)
- ✓ Firefox (v88+)
- ✓ Safari (v14+)
- ✓ Mobile browsers (iOS Safari, Chrome Mobile)

All UI uses standard HTML/CSS/JavaScript with Tailwind CSS — no dependencies on advanced APIs.

---

## Performance Notes

- Auto-delete policy selector: Lightweight radio group (< 1KB)
- Delete button: Simple button (no heavy JS)
- No additional API calls on page load
- All state managed in React component (no Redux or complex state management)
- Page refresh on delete is acceptable (quick for admin)

---

## Accessibility

- Radio buttons properly labeled (`<label>` elements)
- Buttons have clear labels and hover states
- Confirmation modal for destructive action
- Color not sole indicator of status (uses text labels too)
- Focus states visible (ring-2 on focus)
- Disabled state clearly indicated

---

## Future Enhancements (Optional)

- Toast notifications instead of alerts
- Bulk delete operations
- Scheduled deletion countdown display
- Grant export/report showing deletion policy
- Settings page to configure default auto-delete policy

