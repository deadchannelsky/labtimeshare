import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

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

  let body: { notes?: string } = {};
  try {
    const raw = await request.json().catch(() => null);
    if (raw && typeof raw === "object") {
      body = raw as { notes?: string };
    }
  } catch {
    // empty body is fine
  }

  const updated = await prisma.accessRequest.update({
    where: { id },
    data: {
      status: "DENIED",
      reviewedBy: session.userId,
      reviewedAt: new Date(),
      notes: body.notes ?? null,
    },
  });

  await writeAuditLog({
    actorId: session.userId,
    action: "REQUEST_DENIED",
    targetId: id,
    targetType: "AccessRequest",
    metadata: { notes: body.notes ?? null },
  });

  return NextResponse.json(updated);
}
