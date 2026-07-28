import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "ADMIN" && session.role !== "APPROVER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const statusParam = request.nextUrl.searchParams.get("status");
  const validStatuses = ["PENDING", "APPROVED", "DENIED", "REVOKED"] as const;
  type ValidStatus = (typeof validStatuses)[number];

  const whereStatus =
    statusParam && (validStatuses as readonly string[]).includes(statusParam)
      ? (statusParam as ValidStatus)
      : undefined;

  const requests = await prisma.accessRequest.findMany({
    where: whereStatus ? { status: whereStatus } : undefined,
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
        },
      },
    },
  });

  return NextResponse.json(requests);
}
