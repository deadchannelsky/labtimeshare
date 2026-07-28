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

export default function RequestActionsRow({ row }: { row: RequestRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Approve state
  const [showApproveForm, setShowApproveForm] = useState(false);
  const [durationOverride, setDurationOverride] = useState("");

  // Deny state
  const [showDenyForm, setShowDenyForm] = useState(false);
  const [denyNotes, setDenyNotes] = useState("");

  // Extend state
  const [showExtendForm, setShowExtendForm] = useState(false);
  const [extendHours, setExtendHours] = useState("");

  async function handleApprove() {
    setBusy(true);
    try {
      const body: { durationHours?: number } = {};
      const parsed = parseInt(durationOverride, 10);
      if (!isNaN(parsed) && parsed > 0) {
        body.durationHours = parsed;
      }
      const res = await fetch(`/api/admin/requests/${row.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        alert(data?.error ?? "Failed to approve request.");
        return;
      }
      setShowApproveForm(false);
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
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        alert(data?.error ?? "Failed to deny request.");
        return;
      }
      setShowDenyForm(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    if (!confirm("Revoke this grant? The user will lose access immediately.")) {
      return;
    }
    const grantType = row.path;
    const grantId =
      grantType === "API_KEY" ? row.apiKeyGrant?.id : row.shellGrant?.id;
    if (!grantId) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/grants/${grantId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantType }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
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
    const grantType = row.path;
    const grantId =
      grantType === "API_KEY" ? row.apiKeyGrant?.id : row.shellGrant?.id;
    if (!grantId) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/grants/${grantId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantType, additionalHours: parsed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        alert(data?.error ?? "Failed to extend grant.");
        return;
      }
      setShowExtendForm(false);
      setExtendHours("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const expired = isExpired(row);
  const isActiveGrant =
    row.status === "APPROVED" &&
    !expired &&
    (row.apiKeyGrant?.isActive || row.shellGrant?.isActive);

  if (row.status === "PENDING") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 justify-end flex-wrap">
          <button
            type="button"
            onClick={() => {
              setShowApproveForm((v) => !v);
              setShowDenyForm(false);
            }}
            disabled={busy}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => {
              setShowDenyForm((v) => !v);
              setShowApproveForm(false);
            }}
            disabled={busy}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Deny
          </button>
        </div>

        {showApproveForm && (
          <div className="rounded border border-green-200 bg-green-50 p-3 text-sm">
            <label className="block mb-1 text-gray-700 font-medium">
              Duration override (hours, optional)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                placeholder={`Default: ${row.requestedDurationHours}h`}
                value={durationOverride}
                onChange={(e) => setDurationOverride(e.target.value)}
                className="w-40 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={busy}
                className="rounded bg-green-600 px-3 py-1 text-sm text-white hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? "Approving…" : "Confirm Approve"}
              </button>
              <button
                type="button"
                onClick={() => setShowApproveForm(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {showDenyForm && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm">
            <label className="block mb-1 text-gray-700 font-medium">
              Notes (optional)
            </label>
            <div className="flex items-start gap-2">
              <textarea
                rows={2}
                placeholder="Reason for denial…"
                value={denyNotes}
                onChange={(e) => setDenyNotes(e.target.value)}
                className="w-56 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => void handleDeny()}
                  disabled={busy}
                  className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? "Denying…" : "Confirm Deny"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDenyForm(false)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (isActiveGrant) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 justify-end flex-wrap">
          <button
            type="button"
            onClick={() => void handleRevoke()}
            disabled={busy}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {busy ? "Revoking…" : "Revoke"}
          </button>
          <button
            type="button"
            onClick={() => setShowExtendForm((v) => !v)}
            disabled={busy}
            className="rounded-md border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            Extend
          </button>
        </div>

        {showExtendForm && (
          <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">
            <label className="block mb-1 text-gray-700 font-medium">
              Additional hours (1–720)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={720}
                placeholder="e.g. 24"
                value={extendHours}
                onChange={(e) => setExtendHours(e.target.value)}
                className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => void handleExtend()}
                disabled={busy}
                className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Extending…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setShowExtendForm(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // DENIED / REVOKED / expired — no actions
  return <span className="text-xs text-gray-400">—</span>;
}
