import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

const ExtendSchema = z.object({
  grantType: z.enum(["API_KEY", "SHELL_ACCESS"]),
  additionalHours: z.number().int().min(1).max(720),
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ExtendSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Validation error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { grantType, additionalHours } = parsed.data;

  // Resolve the requestId from the appropriate grant table
  let requestId: string;

  if (grantType === "API_KEY") {
    const grant = await prisma.apiKeyGrant.findUnique({ where: { id } });
    if (!grant) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    requestId = grant.requestId;
  } else {
    const grant = await prisma.shellGrant.findUnique({ where: { id } });
    if (!grant) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    requestId = grant.requestId;
  }

  const accessRequest = await prisma.accessRequest.findUnique({
    where: { id: requestId },
  });

  if (!accessRequest) {
    return NextResponse.json(
      { error: "Access request not found" },
      { status: 404 }
    );
  }

  // Extend from current expiresAt (or now if somehow null)
  const baseTime = accessRequest.expiresAt ?? new Date();
  const newExpiresAt = new Date(
    baseTime.getTime() + additionalHours * 60 * 60 * 1000
  );

  await prisma.accessRequest.update({
    where: { id: requestId },
    data: { expiresAt: newExpiresAt },
  });

  await writeAuditLog({
    actorId: session.userId,
    action: "GRANT_EXTENDED",
    targetId: id,
    targetType: grantType === "API_KEY" ? "ApiKeyGrant" : "ShellGrant",
    metadata: { additionalHours, newExpiresAt: newExpiresAt.toISOString() },
  });

  return NextResponse.json({ ok: true, expiresAt: newExpiresAt });
}
