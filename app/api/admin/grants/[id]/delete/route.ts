import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { deleteShellAccount } from "@/lib/provisioner";
import { writeDetailedAuditLog } from "@/lib/audit";

const DeleteSchema = z.object({
  grantType: z.enum(["SHELL_ACCESS"]),
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

  const parsed = DeleteSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Validation error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const { grantType } = parsed.data;

  if (grantType !== "SHELL_ACCESS") {
    return NextResponse.json(
      { error: "Only SHELL_ACCESS grants can be deleted" },
      { status: 400 }
    );
  }

  // Lookup shell grant
  const grant = await prisma.shellGrant.findUnique({ where: { id } });
  if (!grant) {
    return NextResponse.json({ error: "Grant not found" }, { status: 404 });
  }

  // Verify grant is revoked (cannot delete active accounts)
  if (grant.isActive) {
    return NextResponse.json(
      {
        error: "Cannot delete active grant — grant must be revoked first",
      },
      { status: 400 }
    );
  }

  // Check if already deleted
  if (grant.deletedAt) {
    return NextResponse.json({
      ok: true,
      message: "Account already deleted",
      deletedAt: grant.deletedAt,
    });
  }

  // Perform deletion
  try {
    const result = await deleteShellAccount(id, "manual_admin_request");

    // Write audit log for manual deletion request (in addition to the detailed log in deleteShellAccount)
    await writeDetailedAuditLog({
      actorId: session.userId,
      action: "SHELL_ACCOUNT_DELETION_REQUESTED",
      targetId: id,
      targetType: "ShellGrant",
      steps: [
        {
          step: "deletion_initiated",
          status: "SUCCESS",
          metadata: { requestedBy: session.userId, username: session.username },
        },
      ],
      metadata: { linuxUsername: grant.linuxUsername, requestedBy: session.userId },
    });

    return NextResponse.json({
      ok: true,
      deletedAt: result.deletedAt,
      linuxUsername: result.linuxUsername,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Deletion failed";
    console.error("[delete] deleteShellAccount error:", err);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
