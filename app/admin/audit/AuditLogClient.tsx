"use client";

import { useEffect, useState, useCallback } from "react";

interface AuditEntry {
  id: string;
  action: string;
  actorId: string;
  actor: { id: string; username: string } | null;
  targetId: string | null;
  targetType: string | null;
  metadata: string | null;
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function parseMetadata(raw: string | null): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 0)
      .replace(/[{}"]/g, "")
      .replace(/,/g, ", ");
  } catch {
    return raw;
  }
}

const ACTION_LABELS: Record<string, string> = {
  API_KEY_PROVISIONED: "API Key Provisioned",
  API_KEY_REVOKED: "API Key Revoked",
  SHELL_ACCESS_PROVISIONED: "Shell Access Provisioned",
  SHELL_ACCESS_REVOKED: "Shell Access Revoked",
  GRANT_EXPIRED_AUTO_REVOKED: "Auto-Expired",
  GRANT_REVOKED: "Grant Revoked (manual)",
  GRANT_EXTENDED: "Grant Extended",
  REQUEST_APPROVED: "Request Approved",
  REQUEST_DENIED: "Request Denied",
  USER_STATUS_CHANGED: "User Status Changed",
  USER_ROLE_CHANGED: "User Role Changed",
};

const ACTION_COLORS: Record<string, string> = {
  API_KEY_PROVISIONED: "bg-green-100 text-green-800",
  SHELL_ACCESS_PROVISIONED: "bg-green-100 text-green-800",
  REQUEST_APPROVED: "bg-green-100 text-green-800",
  API_KEY_REVOKED: "bg-red-100 text-red-800",
  SHELL_ACCESS_REVOKED: "bg-red-100 text-red-800",
  GRANT_REVOKED: "bg-red-100 text-red-800",
  GRANT_EXPIRED_AUTO_REVOKED: "bg-orange-100 text-orange-800",
  REQUEST_DENIED: "bg-red-100 text-red-800",
  GRANT_EXTENDED: "bg-blue-100 text-blue-800",
  USER_STATUS_CHANGED: "bg-yellow-100 text-yellow-800",
  USER_ROLE_CHANGED: "bg-purple-100 text-purple-800",
};

export default function AuditLogClient() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (actionFilter) params.set("action", actionFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const res = await fetch(`/api/admin/audit?${params.toString()}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [page, actionFilter, fromDate, toDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset to page 1 when filters change
  const handleFilterChange = () => setPage(1);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Action</label>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                handleFilterChange();
              }}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                handleFilterChange();
              }}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                handleFilterChange();
              }}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          {(actionFilter || fromDate || toDate) && (
            <div className="flex flex-col justify-end gap-1">
              <button
                onClick={() => {
                  setActionFilter("");
                  setFromDate("");
                  setToDate("");
                  setPage(1);
                }}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">
            Loading…
          </div>
        ) : !data || data.entries.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No audit log entries found.
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Actor
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Action
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Target
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                      {formatDate(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {entry.actor?.username ?? entry.actorId ?? "system"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          ACTION_COLORS[entry.action] ??
                          "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {entry.targetType && entry.targetId
                        ? `${entry.targetType} / ${entry.targetId.slice(0, 8)}…`
                        : "—"}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-xs text-gray-500">
                      {parseMetadata(entry.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
              <p className="text-sm text-gray-500">
                {data.total} total entr{data.total === 1 ? "y" : "ies"} &middot;
                Page {data.page} of {data.totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={data.page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50"
                >
                  Previous
                </button>
                <button
                  disabled={data.page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
