import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import {
  provisionApiKey,
  provisionShellAccess,
} from "@/lib/provisioner";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getSession(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "ADMIN" && session.role !== "APPROVER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const existing = await prisma.accessRequest.findUnique({ where: { id } });

  if (!existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (existing.status !== "PENDING") {
    return NextResponse.json(
      { error: "Request is not in PENDING status" },
      { status: 400 }
    );
  }

  let body: { durationHours?: number } = {};
  try {
    const raw = await request.json().catch(() => null);
    if (raw && typeof raw === "object") {
      body = raw as { durationHours?: number };
    }
  } catch {
    // empty body is fine
  }

  // If caller provides a duration override, update requestedDurationHours first
  if (typeof body.durationHours === "number" && body.durationHours > 0) {
    await prisma.accessRequest.update({
      where: { id },
      data: {
        requestedDurationHours: body.durationHours,
        reviewedBy: session.userId,
        reviewedAt: new Date(),
      },
    });
  } else {
    await prisma.accessRequest.update({
      where: { id },
      data: {
        reviewedBy: session.userId,
        reviewedAt: new Date(),
      },
    });
  }

  if (existing.path === "API_KEY") {
    await provisionApiKey(id);
  } else {
    await provisionShellAccess(id);
  }

  await writeAuditLog({
    actorId: session.userId,
    action: "REQUEST_APPROVED",
    targetId: id,
    targetType: "AccessRequest",
    metadata: {
      path: existing.path,
      durationHours: body.durationHours ?? existing.requestedDurationHours,
      userId: existing.userId,
    },
  });

  const updated = await prisma.accessRequest.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, username: true, email: true } },
      apiKeyGrant: true,
      shellGrant: true,
    },
  });

  return NextResponse.json(updated);
}
