import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { RequestRow } from "../RequestActionsRow";
import RequestsTableClient from "./RequestsTableClient";

export default async function AdminRequestsPage() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  if (session.role !== "ADMIN" && session.role !== "APPROVER") {
    redirect("/dashboard");
  }

  const rawRequests = await prisma.accessRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, username: true, email: true } },
      apiKeyGrant: true,
      shellGrant: {
        select: {
          id: true,
          requestId: true,
          linuxUsername: true,
          sshPublicKey: true,
          isActive: true,
          createdAt: true,
          revokedAt: true,
          deletedAt: true,
        },
      },
    },
  });

  // Serialize dates to strings for client component
  const requests: RequestRow[] = rawRequests.map((r) => ({
    id: r.id,
    path: r.path,
    status: r.status,
    requestedDurationHours: r.requestedDurationHours,
    grantedAt: r.grantedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    notes: r.notes ?? null,
    user: r.user,
    apiKeyGrant: r.apiKeyGrant
      ? {
          id: r.apiKeyGrant.id,
          requestId: r.apiKeyGrant.requestId,
          apiKey: r.apiKeyGrant.apiKey,
          isActive: r.apiKeyGrant.isActive,
          createdAt: r.apiKeyGrant.createdAt.toISOString(),
          revokedAt: r.apiKeyGrant.revokedAt?.toISOString() ?? null,
        }
      : null,
    shellGrant: r.shellGrant
      ? {
          id: r.shellGrant.id,
          requestId: r.shellGrant.requestId,
          linuxUsername: r.shellGrant.linuxUsername,
          isActive: r.shellGrant.isActive,
          createdAt: r.shellGrant.createdAt.toISOString(),
          revokedAt: r.shellGrant.revokedAt?.toISOString() ?? null,
          deletedAt: r.shellGrant.deletedAt?.toISOString() ?? null,
        }
      : null,
  }));

  return <RequestsTableClient requests={requests} />;
}
