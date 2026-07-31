"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ApiKeyGrantRow = {
  id: string;
  requestId: string;
  apiKey: string;
  isActive: boolean;
  createdAt: string;
  revokedAt: string | null;
};

type ShellGrantRow = {
  id: string;
  requestId: string;
  linuxUsername: string;
  isActive: boolean;
  createdAt: string;
  revokedAt: string | null;
  deletedAt: string | null;
};

export type RequestRow = {
  id: string;
  path: "API_KEY" | "SHELL_ACCESS";
  status: "PENDING" | "APPROVED" | "DENIED" | "REVOKED";
  requestedDurationHours: number;
  grantedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  notes: string | null;
  user: { id: string; username: string; email: string };
  apiKeyGrant: ApiKeyGrantRow | null;
  shellGrant: ShellGrantRow | null;
};

function isExpired(row: RequestRow): boolean {
  if (!row.expiresAt) return false;
  return new Date(row.expiresAt) < new Date();
}

type PanelMode = "approve" | "deny" | "extend" | "delete" | null;

export default function RequestActionsRow({
  row,
  colSpan,
  children,
}: {
  row: RequestRow;
  colSpan: number;
  /** Render-prop: receives the action buttons node, must render a <tr> */
  children: (buttons: React.ReactNode) => React.ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<PanelMode>(null);
  const [durationOverride, setDurationOverride] = useState("");
  const [denyNotes, setDenyNotes] = useState("");
  const [extendHours, setExtendHours] = useState("");
  const [autoDeleteAfterDays, setAutoDeleteAfterDays] = useState<string | null>(null);

  const expired = isExpired(row);
  const isActiveGrant =
    row.status === "APPROVED" &&
    !expired &&
    (row.apiKeyGrant?.isActive || row.shellGrant?.isActive);

  function openPanel(mode: PanelMode) {
    setPanel((prev) => (prev === mode ? null : mode));
    setDurationOverride("");
    setDenyNotes("");
    setExtendHours("");
  }

  async function handleApprove() {
    setBusy(true);
    try {
      const body: { durationHours?: number; autoDeleteAfterDays?: number | null } = {};
      const parsed = parseInt(durationOverride, 10);
      if (!isNaN(parsed) && parsed > 0) body.durationHours = parsed;
      
      // Add auto-delete policy if provided (only for shell access)
      if (row.path === "SHELL_ACCESS" && autoDeleteAfterDays !== null) {
        const policyValue = parseInt(autoDeleteAfterDays, 10);
        if (!isNaN(policyValue) && policyValue >= 0) {
          body.autoDeleteAfterDays = policyValue;
        }
      }
      
      const res = await fetch(`/api/admin/requests/${row.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(data?.error ?? "Failed to approve request.");
        return;
      }
      setPanel(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDeny() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/requests/${row.id}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: denyNotes || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(data?.error ?? "Failed to deny request.");
        return;
      }
      setPanel(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    if (!confirm("Revoke this grant? The user will lose access immediately.")) return;
    const grantId = row.path === "API_KEY" ? row.apiKeyGrant?.id : row.shellGrant?.id;
    if (!grantId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/grants/${grantId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantType: row.path }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(data?.error ?? "Failed to revoke grant.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleExtend() {
    const parsed = parseInt(extendHours, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 720) {
      alert("Please enter a number of hours between 1 and 720.");
      return;
    }
    const grantId = row.path === "API_KEY" ? row.apiKeyGrant?.id : row.shellGrant?.id;
    if (!grantId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/grants/${grantId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantType: row.path, additionalHours: parsed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(data?.error ?? "Failed to extend grant.");
        return;
      }
      setPanel(null);
      setExtendHours("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm("This will permanently delete the Linux account and home directory.\n\nThis cannot be undone. Are you sure?")) return;
    const grantId = row.shellGrant?.id;
    if (!grantId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/grants/${grantId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantType: "SHELL_ACCESS" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(data?.error ?? "Failed to delete account.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // ── Action buttons rendered inside the parent's <td> ──────────────────────
  const buttons: React.ReactNode = (() => {
    if (row.status === "PENDING") {
      return (
        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => openPanel("approve")}
            disabled={busy}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              panel === "approve"
                ? "bg-green-700 text-white"
                : "bg-green-600 text-white hover:bg-green-700"
            } disabled:opacity-50`}
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => openPanel("deny")}
            disabled={busy}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              panel === "deny"
                ? "border-red-500 bg-red-50 text-red-800"
                : "border-red-300 text-red-700 hover:bg-red-50"
            } disabled:opacity-50`}
          >
            Deny
          </button>
        </div>
      );
    }
    if (isActiveGrant) {
      return (
        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={() => void handleRevoke()}
            disabled={busy}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy ? "Revoking…" : "Revoke"}
          </button>
          <button
            type="button"
            onClick={() => openPanel("extend")}
            disabled={busy}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
              panel === "extend"
                ? "border-blue-500 bg-blue-50 text-blue-800"
                : "border-blue-300 text-blue-700 hover:bg-blue-50"
            } disabled:opacity-50`}
          >
            Extend
          </button>
        </div>
      );
    }
    // Show delete button for revoked shell access grants that haven't been deleted yet
    if (
      row.status === "REVOKED" &&
      row.path === "SHELL_ACCESS" &&
      row.shellGrant &&
      row.shellGrant.isActive === false &&
      !row.shellGrant.deletedAt // Show only if not already deleted
    ) {
      return (
        <button
          type="button"
          onClick={() => void handleDelete()}
          disabled={busy}
          className="rounded-md border border-orange-400 px-3 py-1.5 text-sm font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete Account"}
        </button>
      );
    }
    return <span className="block text-right text-xs text-gray-400">—</span>;
  })();

  // ── Panel content rendered as a full-width <tr> beneath the data row ──────
  const panelContent: React.ReactNode = (() => {
    if (panel === "approve") {
      return (
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Duration override (hours)
              </label>
              <input
                type="number"
                min={1}
                placeholder={`Default: ${row.requestedDurationHours}h`}
                value={durationOverride}
                onChange={(e) => setDurationOverride(e.target.value)}
                className="w-44 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
              />
            </div>
          </div>

          {/* Auto-delete policy selector for shell access */}
          {row.path === "SHELL_ACCESS" && (
            <div className="border-t border-gray-200 pt-4">
              <label className="mb-2 block text-xs font-medium text-gray-700">
                Auto-delete account after revocation (optional)
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="autoDelete"
                    value="null"
                    checked={autoDeleteAfterDays === null}
                    onChange={() => setAutoDeleteAfterDays(null)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Manual only</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="autoDelete"
                    value="0"
                    checked={autoDeleteAfterDays === "0"}
                    onChange={() => setAutoDeleteAfterDays("0")}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Delete on revocation</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="autoDelete"
                    value="7"
                    checked={autoDeleteAfterDays === "7"}
                    onChange={() => setAutoDeleteAfterDays("7")}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Delete after 7 days</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="autoDelete"
                    value="30"
                    checked={autoDeleteAfterDays === "30"}
                    onChange={() => setAutoDeleteAfterDays("30")}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Delete after 30 days</span>
                </label>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-gray-200 pt-4">
            <button
              type="button"
              onClick={() => void handleApprove()}
              disabled={busy}
              className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? "Approving…" : "Confirm Approve"}
            </button>
            <button
              type="button"
              onClick={() => setPanel(null)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }
    if (panel === "deny") {
      return (
        <div className="flex flex-wrap items-end gap-4 p-4">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Reason / notes (optional)
            </label>
            <input
              type="text"
              placeholder="Reason for denial…"
              value={denyNotes}
              onChange={(e) => setDenyNotes(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDeny()}
              disabled={busy}
              className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? "Denying…" : "Confirm Deny"}
            </button>
            <button
              type="button"
              onClick={() => setPanel(null)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }
    if (panel === "extend") {
      return (
        <div className="flex flex-wrap items-end gap-4 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Additional hours (1–720)
            </label>
            <input
              type="number"
              min={1}
              max={720}
              placeholder="e.g. 24"
              value={extendHours}
              onChange={(e) => setExtendHours(e.target.value)}
              className="w-36 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExtend()}
              disabled={busy}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "Extending…" : "Confirm Extend"}
            </button>
            <button
              type="button"
              onClick={() => setPanel(null)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }
    return null;
  })();

  return (
    <>
      {/* Data row — rendered via render-prop so parent controls all <td>s */}
      {children(buttons)}

      {/* Panel row — full-width, only rendered when a panel is open */}
      {panelContent && (
        <tr className="bg-gray-50">
          <td colSpan={colSpan} className="px-0 py-0">
            <div className="border-t border-gray-200">
              {panelContent}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
