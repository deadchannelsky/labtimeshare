import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

const UpdateUserSchema = z
  .object({
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    role: z.enum(["USER", "APPROVER", "ADMIN"]).optional(),
  })
  .refine((value) => value.status !== undefined || value.role !== undefined, {
    message: "At least one field must be provided",
  });

export async function PATCH(
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateUserSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Validation error";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (parsed.data.role !== undefined && session.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only admins can change roles" },
      { status: 403 }
    );
  }

  const { id } = await context.params;

  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const data: { status?: "ACTIVE" | "DISABLED"; role?: "USER" | "APPROVER" | "ADMIN" } = {};

  if (parsed.data.status !== undefined) {
    data.status = parsed.data.status;
  }

  if (parsed.data.role !== undefined) {
    data.role = parsed.data.role;
  }

  const updatedUser = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      createdAt: true,
    },
  });

  if (
    parsed.data.status !== undefined &&
    parsed.data.status !== existingUser.status
  ) {
    await writeAuditLog({
      actorId: session.userId,
      action: "USER_STATUS_CHANGED",
      targetId: existingUser.id,
      targetType: "User",
      metadata: { from: existingUser.status, to: parsed.data.status },
    });
  }

  if (parsed.data.role !== undefined && parsed.data.role !== existingUser.role) {
    await writeAuditLog({
      actorId: session.userId,
      action: "USER_ROLE_CHANGED",
      targetId: existingUser.id,
      targetType: "User",
      metadata: { from: existingUser.role, to: parsed.data.role },
    });
  }

  return NextResponse.json(updatedUser);
}
