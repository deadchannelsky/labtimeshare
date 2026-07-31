import { prisma } from "@/lib/prisma";

export async function writeAuditLog({
  actorId,
  action,
  targetId,
  targetType,
  metadata,
}: {
  actorId?: string | null;
  action: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: actorId ?? undefined,
      action,
      targetId,
      targetType,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  });
}

/**
 * Write detailed audit log entries for each step of a complex operation (e.g., account deletion).
 * Creates a parent AuditLog entry and then AuditLogDetail records for each step.
 */
export async function writeDetailedAuditLog({
  actorId,
  action,
  targetId,
  targetType,
  steps,
  metadata,
}: {
  actorId?: string | null;
  action: string;
  targetId?: string;
  targetType?: string;
  steps: Array<{
    step: string;
    status: "SUCCESS" | "FAILED";
    errorMessage?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  // Create parent audit log entry
  const auditLog = await prisma.auditLog.create({
    data: {
      actorId: actorId ?? undefined,
      action,
      targetId,
      targetType,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  });

  // Create detailed step entries
  if (steps.length > 0) {
    await prisma.auditLogDetail.createMany({
      data: steps.map((step) => ({
        auditLogId: auditLog.id,
        step: step.step,
        status: step.status,
        errorMessage: step.errorMessage ?? undefined,
        metadata: step.metadata ? JSON.stringify(step.metadata) : undefined,
      })),
    });
  }
}
