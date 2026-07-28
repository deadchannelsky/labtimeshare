import { prisma } from "@/lib/prisma";

export async function writeAuditLog({
  actorId,
  action,
  targetId,
  targetType,
  metadata,
}: {
  actorId: string;
  action: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId,
      action,
      targetId,
      targetType,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
    },
  });
}
