import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import {
  provisionApiKey,
  provisionShellAccess,
} from "@/lib/provisioner";

const ApproveSchema = z.object({
  durationHours: z.number().optional(),
  autoDeleteAfterDays: z.number().nullable().optional(),
});

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

  let body: unknown;
  try {
    body = await request.json().catch(() => null);
  } catch {
    body = null;
  }

  const parsed = ApproveSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const { durationHours, autoDeleteAfterDays } = parsed.data;

  // Prepare update data for AccessRequest
  const updateData: {
    requestedDurationHours?: number;
    reviewedBy: string;
    reviewedAt: Date;
  } = {
    reviewedBy: session.userId,
    reviewedAt: new Date(),
  };

  if (typeof durationHours === "number" && durationHours > 0) {
    updateData.requestedDurationHours = durationHours;
  }

  await prisma.accessRequest.update({
    where: { id },
    data: updateData,
  });

  try {
    if (existing.path === "API_KEY") {
      await provisionApiKey(id);
    } else {
      // For shell access, also set auto-delete policy if provided
      await provisionShellAccess(id);
      
      // Update the shell grant with auto-delete policy if provided
      if (autoDeleteAfterDays !== undefined) {
        const shellGrant = await prisma.shellGrant.findUnique({
          where: { requestId: id },
        });
        if (shellGrant && autoDeleteAfterDays !== null) {
          await prisma.shellGrant.update({
            where: { id: shellGrant.id },
            data: { autoDeleteAfterDays: Math.max(0, autoDeleteAfterDays) },
          });
        }
      }
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Provisioning failed";
    console.error("[approve] Provisioning error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  await writeAuditLog({
    actorId: session.userId,
    action: "REQUEST_APPROVED",
    targetId: id,
    targetType: "AccessRequest",
    metadata: {
      path: existing.path,
      durationHours: durationHours ?? existing.requestedDurationHours,
      userId: existing.userId,
      autoDeleteAfterDays:
        autoDeleteAfterDays !== undefined ? autoDeleteAfterDays : null,
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
