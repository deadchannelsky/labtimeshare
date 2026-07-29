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

type PanelMode = "approve" | "deny" | "extend" | null;

export default function RequestActionsRow({ row }: { row: RequestRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<PanelMode>(null);

  // Form values
  const [durationOverride, setDurationOverride] = useState("");
  const [denyNotes, setDenyNotes] = useState("");
  const [extendHours, setExtendHours] = useState("");

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
      const body: { durationHours?: number } = {};
      const parsed = parseInt(durationOverride, 10);
      if (!isNaN(parsed) && parsed > 0) body.durationHours = parsed;
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

  // ── Button bar (lives in the Actions <td>) ─────────────────────────────────
  const buttons = () => {
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
    return <span className="block text-right text-xs text-gray-400">—</span>;
  };

  // ── Expanded panel content (rendered as a separate <tr> by the table) ──────
  const panelContent = () => {
    if (panel === "approve") {
      return (
        <div className="flex flex-wrap items-end gap-4 p-4">
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
          <div className="flex items-center gap-2">
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
  };

  return { buttons, panelContent, hasPanel: panel !== null };
}
