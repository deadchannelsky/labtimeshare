import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import SignOutButton from "./SignOutButton";
import RevealKeyButton from "./RevealKeyButton";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeRemaining(expiresAt: Date): string {
  const diffMs = expiresAt.getTime() - Date.now();
  if (diffMs <= 0) return "Expired";
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m remaining`;
  if (minutes === 0) return `${hours}h remaining`;
  return `${hours}h ${minutes}m remaining`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: string): React.ReactNode {
  const styles: Record<string, string> = {
    PENDING:
      "bg-yellow-100 text-yellow-800 border border-yellow-300",
    APPROVED:
      "bg-green-100 text-green-800 border border-green-300",
    DENIED: "bg-red-100 text-red-800 border border-red-300",
    REVOKED: "bg-gray-100 text-gray-600 border border-gray-300",
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {status}
    </span>
  );
}

function pathLabel(path: string): string {
  return path === "API_KEY" ? "API Key Access" : "Shell Access";
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const serverIp = process.env.SERVER_IP ?? "unknown";

  const requests = await prisma.accessRequest.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    include: {
      apiKeyGrant: true,
      shellGrant: true,
    },
  });

  const now = new Date();

  // Active grants: APPROVED status and expiresAt in the future
  const activeGrants = requests.filter(
    (r) =>
      r.status === "APPROVED" &&
      r.expiresAt !== null &&
      r.expiresAt > now
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {process.env.NEXT_PUBLIC_APP_NAME ?? "LabTimeShare"}
            </h1>
            <p className="text-sm text-gray-500">Welcome, {session.username}</p>
          </div>
          <div className="flex items-center gap-3">
            {(session.role === "ADMIN" || session.role === "APPROVER") && (
              <Link
                href="/admin/users"
                className="text-sm font-medium text-gray-600 hover:text-gray-900 border border-gray-300 px-3 py-2 rounded-md hover:bg-gray-50 transition-colors"
              >
                Admin Panel
              </Link>
            )}
            <Link
              href="/dashboard/change-password"
              className="text-sm font-medium text-gray-600 hover:text-gray-900 border border-gray-300 px-3 py-2 rounded-md hover:bg-gray-50 transition-colors"
            >
              Change Password
            </Link>
            <Link
              href="/dashboard/request"
              className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Request Access
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        {/* ── Active Grants ─────────────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Active Grants
          </h2>
          {activeGrants.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500 text-center">
              No active grants.{" "}
              <Link
                href="/dashboard/request"
                className="text-blue-600 underline"
              >
                Request access
              </Link>{" "}
              to get started.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {activeGrants.map((req) => {
                const timeRemaining = req.expiresAt
                  ? formatTimeRemaining(req.expiresAt)
                  : "–";

                if (req.path === "API_KEY" && req.apiKeyGrant) {
                  return (
                    <div
                      key={req.id}
                      className="bg-white border border-gray-200 rounded-lg p-5 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-800">
                          API Key Access
                        </span>
                        <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded">
                          {timeRemaining}
                        </span>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 mb-1">
                          Your API Key
                        </p>
                        <code className="block bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs font-mono break-all">
                          {req.apiKeyGrant.apiKey}
                        </code>
                      </div>
                      {req.expiresAt && (
                        <p className="text-xs text-gray-400">
                          Expires {formatDate(req.expiresAt)}
                        </p>
                      )}
                    </div>
                  );
                }

                if (req.path === "SHELL_ACCESS" && req.shellGrant) {
                  const keyAlreadyRevealed =
                    req.shellGrant.sshPrivateKey === null;
                  return (
                    <div
                      key={req.id}
                      className="bg-white border border-gray-200 rounded-lg p-5 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-800">
                          Shell Access
                        </span>
                        <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded">
                          {timeRemaining}
                        </span>
                      </div>
                      <div className="space-y-2 text-xs">
                        <div>
                          <span className="text-gray-500">Linux User: </span>
                          <code className="font-mono text-gray-800">
                            {req.shellGrant.linuxUsername}
                          </code>
                        </div>
                        <div>
                          <span className="text-gray-500">Server IP: </span>
                          <code className="font-mono text-gray-800">
                            {serverIp}
                          </code>
                        </div>
                        <div>
                          <span className="text-gray-500">Connect via: </span>
                          <code className="font-mono text-gray-800">
                            ssh {req.shellGrant.linuxUsername}@{serverIp}
                          </code>
                        </div>
                      </div>
                      {/* SSH private key reveal */}
                      {keyAlreadyRevealed ? (
                        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-xs text-yellow-800">
                          SSH private key has already been revealed and is no
                          longer stored. Use your saved key to connect.
                        </div>
                      ) : (
                        <RevealKeyButton requestId={req.id} />
                      )}
                      {req.expiresAt && (
                        <p className="text-xs text-gray-400">
                          Expires {formatDate(req.expiresAt)}
                        </p>
                      )}
                    </div>
                  );
                }

                return null;
              })}
            </div>
          )}
        </section>

        {/* ── Request History ───────────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Request History
          </h2>
          {requests.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500 text-center">
              No requests yet.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Date
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Path
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Duration
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {requests.map((req) => (
                    <tr key={req.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {formatDate(req.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {pathLabel(req.path)}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {req.requestedDurationHours}h
                      </td>
                      <td className="px-4 py-3">
                        {statusBadge(req.status)}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {req.notes ?? "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
