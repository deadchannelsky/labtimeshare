"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type UserRow = {
  id: string;
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

  const isSelf = user.id === currentUserId;
  const canChangeRole = currentUserRole === "ADMIN";

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
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        alert(data?.error ?? "Failed to update user.");
        return;
      }

      router.refresh();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      <button
        type="button"
        onClick={() => updateUser({ status: statusAction.nextStatus })}
        disabled={isSubmitting || isSelf}
        className="px-3 py-1.5 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? "Saving..." : statusAction.label}
      </button>

      <select
        value={user.role}
        onChange={(event) => {
          const nextRole = event.target.value as "USER" | "APPROVER" | "ADMIN";
          if (nextRole !== user.role) {
            void updateUser({ role: nextRole });
          }
        }}
        disabled={isSubmitting || !canChangeRole}
        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 disabled:bg-gray-100 disabled:text-gray-400"
      >
        <option value="USER">USER</option>
        <option value="APPROVER">APPROVER</option>
        <option value="ADMIN">ADMIN</option>
      </select>
    </div>
  );
}
