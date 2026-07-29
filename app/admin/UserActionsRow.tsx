"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type UserRow = {
  id: string;
  username: string;
  role: "USER" | "APPROVER" | "ADMIN";
  status: "PENDING" | "ACTIVE" | "DISABLED";
};

export default function UserActionsRow({
  user,
  currentUserId,
  currentUserRole,
}: {
  user: UserRow;
  currentUserId: string;
  currentUserRole: "USER" | "APPROVER" | "ADMIN";
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);

  const isSelf = user.id === currentUserId;
  const canChangeRole = currentUserRole === "ADMIN";
  const canResetPassword = currentUserRole === "ADMIN";

  const statusAction: { label: string; nextStatus: "ACTIVE" | "DISABLED" } =
    user.status === "PENDING"
      ? { label: "Approve", nextStatus: "ACTIVE" }
      : user.status === "ACTIVE"
        ? { label: "Disable", nextStatus: "DISABLED" }
        : { label: "Enable", nextStatus: "ACTIVE" };

  async function updateUser(payload: {
    status?: "ACTIVE" | "DISABLED";
    role?: "USER" | "APPROVER" | "ADMIN";
  }) {
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(data?.error ?? "Failed to update user.");
        return;
      }
      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError("");
    setResetSuccess(false);
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setResetError(data?.error ?? "Failed to reset password.");
        return;
      }
      setResetSuccess(true);
      setNewPassword("");
      setTimeout(() => {
        setShowResetPassword(false);
        setResetSuccess(false);
      }, 2000);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 justify-end">
        {/* Status action: Approve / Disable / Enable */}
        <button
          type="button"
          onClick={() => updateUser({ status: statusAction.nextStatus })}
          disabled={isSubmitting || isSelf}
          className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Saving..." : statusAction.label}
        </button>

        {/* Role selector */}
        <select
          value={user.role}
          onChange={(e) => {
            const nextRole = e.target.value as "USER" | "APPROVER" | "ADMIN";
            if (nextRole !== user.role) void updateUser({ role: nextRole });
          }}
          disabled={isSubmitting || !canChangeRole}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 disabled:bg-gray-100 disabled:text-gray-400"
        >
          <option value="USER">USER</option>
          <option value="APPROVER">APPROVER</option>
          <option value="ADMIN">ADMIN</option>
        </select>

        {/* Reset password toggle */}
        {canResetPassword && (
          <button
            type="button"
            onClick={() => {
              setShowResetPassword((v) => !v);
              setResetError("");
              setResetSuccess(false);
              setNewPassword("");
            }}
            className="px-3 py-1.5 rounded-md border border-orange-300 text-sm text-orange-700 hover:bg-orange-50"
          >
            Reset Password
          </button>
        )}
      </div>

      {/* Inline reset password form */}
      {showResetPassword && (
        <form
          onSubmit={handleResetPassword}
          className="flex items-center gap-2 justify-end"
        >
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={`New password for ${user.username}`}
            minLength={8}
            required
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <button
            type="submit"
            disabled={isSubmitting || newPassword.length < 8}
            className="px-3 py-1.5 rounded-md bg-orange-600 text-white text-sm hover:bg-orange-700 disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Set Password"}
          </button>
          <button
            type="button"
            onClick={() => setShowResetPassword(false)}
            className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-500 hover:bg-gray-50"
          >
            Cancel
          </button>
          {resetError && (
            <span className="text-xs text-red-600">{resetError}</span>
          )}
          {resetSuccess && (
            <span className="text-xs text-green-600">Password updated.</span>
          )}
        </form>
      )}
    </div>
  );
}
