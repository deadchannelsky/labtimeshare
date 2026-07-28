"use client";

import { useState, useMemo } from "react";
import type { RequestRow } from "../RequestActionsRow";
import RequestActionsRow from "../RequestActionsRow";

type TabId = "all" | "pending" | "active" | "expired" | "denied";

const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "active", label: "Active" },
  { id: "expired", label: "Expired" },
  { id: "denied", label: "Denied" },
];

function isExpired(row: RequestRow): boolean {
  if (!row.expiresAt) return false;
  return new Date(row.expiresAt) < new Date();
}

function matchesTab(row: RequestRow, tab: TabId): boolean {
  switch (tab) {
    case "all":
      return true;
    case "pending":
      return row.status === "PENDING";
    case "active":
      return row.status === "APPROVED" && !isExpired(row);
    case "expired":
      return row.status === "REVOKED" || (row.status === "APPROVED" && isExpired(row));
    case "denied":
      return row.status === "DENIED";
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: RequestRow["status"]) {
  const styles: Record<RequestRow["status"], string> = {
    PENDING: "bg-yellow-100 text-yellow-800 border border-yellow-300",
    APPROVED: "bg-green-100 text-green-800 border border-green-300",
    DENIED: "bg-red-100 text-red-800 border border-red-300",
    REVOKED: "bg-gray-100 text-gray-600 border border-gray-300",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function pathBadge(path: RequestRow["path"]) {
  return path === "API_KEY" ? (
    <span className="rounded bg-blue-100 border border-blue-300 px-2 py-0.5 text-xs font-medium text-blue-800">
      API Key
    </span>
  ) : (
    <span className="rounded bg-purple-100 border border-purple-300 px-2 py-0.5 text-xs font-medium text-purple-800">
      Shell Access
    </span>
  );
}

export default function RequestsTableClient({
  requests,
}: {
  requests: RequestRow[];
}) {
  const [activeTab, setActiveTab] = useState<TabId>("all");

  const filtered = useMemo(
    () => requests.filter((r) => matchesTab(r, activeTab)),
    [requests, activeTab]
  );

  const countFor = (tab: TabId) =>
    requests.filter((r) => matchesTab(r, tab)).length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Request Review &amp; Grant Management
        </h2>
        <p className="text-sm text-gray-500">
          Approve or deny pending requests, revoke active grants, or extend expiry.
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-gray-200 px-6 pt-3">
        {TABS.map((tab) => {
          const count = countFor(tab.id);
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-t px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-b-2 border-blue-600 text-blue-700"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs ${
                  isActive
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                User
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Path
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Duration
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Requested At
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-600">
                Expires At
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-gray-400"
                >
                  No requests found.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {row.user.username}
                    </div>
                    <div className="text-xs text-gray-500">{row.user.email}</div>
                  </td>
                  <td className="px-4 py-3">{pathBadge(row.path)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                    {row.requestedDurationHours}h
                  </td>
                  <td className="px-4 py-3">{statusBadge(row.status)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                    {formatDate(row.expiresAt)}
                  </td>
                  <td className="px-4 py-3 min-w-[200px]">
                    <RequestActionsRow row={row} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
