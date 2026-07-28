import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { revokeApiKey, revokeShellAccess } from "@/lib/provisioner";

const RevokeSchema = z.object({
  grantType: z.enum(["API_KEY", "SHELL_ACCESS"]),
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

  const parsed = RevokeSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Validation error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { grantType } = parsed.data;

  let requestId: string;
  let targetType: string;

  if (grantType === "API_KEY") {
    const grant = await prisma.apiKeyGrant.findUnique({ where: { id } });
    if (!grant) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    requestId = grant.requestId;
    targetType = "ApiKeyGrant";
    await revokeApiKey(id);
  } else {
    const grant = await prisma.shellGrant.findUnique({ where: { id } });
    if (!grant) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    requestId = grant.requestId;
    targetType = "ShellGrant";
    await revokeShellAccess(id);
  }

  await prisma.accessRequest.update({
    where: { id: requestId },
    data: { status: "REVOKED" },
  });

  await writeAuditLog({
    actorId: session.userId,
    action: "GRANT_REVOKED",
    targetId: id,
    targetType,
    metadata: { grantType, requestId },
  });

  return NextResponse.json({ ok: true });
}
