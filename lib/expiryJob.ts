/**
 * Expiry Job — automatically revokes GPU access grants that have passed their expiresAt time.
 *
 * Runs on a configurable interval (default 5 minutes) using node-cron.
 * Started via Next.js instrumentation.ts on server startup.
 *
 * Env vars:
 *   EXPIRY_CHECK_INTERVAL_MINUTES — how often to check (default: 5)
 */

import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { revokeApiKey, revokeShellAccess } from "@/lib/provisioner";
import { writeAuditLog } from "@/lib/audit";
import { closeAndDeregister } from "@/lib/sessionRegistry";

const SYSTEM_ACTOR = "system";

export async function runExpiryCheck(): Promise<void> {
  const now = new Date();

  // Find all active API key grants that have expired
  const expiredApiKeys = await prisma.apiKeyGrant.findMany({
    where: {
      isActive: true,
      request: {
        expiresAt: { lt: now },
        status: "APPROVED",
      },
    },
    include: { request: true },
  });

  // Find all active shell grants that have expired
  const expiredShellGrants = await prisma.shellGrant.findMany({
    where: {
      isActive: true,
      request: {
        expiresAt: { lt: now },
        status: "APPROVED",
      },
    },
    include: { request: true },
  });

  if (expiredApiKeys.length === 0 && expiredShellGrants.length === 0) {
    return; // nothing to do
  }

  console.log(
    `[expiryJob] Revoking ${expiredApiKeys.length} API key grant(s) and ${expiredShellGrants.length} shell grant(s)`
  );

  // Revoke expired API key grants
  for (const grant of expiredApiKeys) {
    try {
      await revokeApiKey(grant.id);
      await prisma.accessRequest.update({
        where: { id: grant.requestId },
        data: { status: "REVOKED" },
      });
      await writeAuditLog({
        actorId: SYSTEM_ACTOR,
        action: "GRANT_EXPIRED_AUTO_REVOKED",
        targetId: grant.id,
        targetType: "ApiKeyGrant",
        metadata: {
          requestId: grant.requestId,
          expiredAt: grant.request.expiresAt?.toISOString(),
        },
      });
    } catch (err) {
      console.error(
        `[expiryJob] Failed to revoke API key grant ${grant.id}:`,
        err
      );
    }
  }

  // Revoke expired shell access grants
  for (const grant of expiredShellGrants) {
    try {
      closeAndDeregister(grant.id);
      await revokeShellAccess(grant.id);
      await prisma.accessRequest.update({
        where: { id: grant.requestId },
        data: { status: "REVOKED" },
      });
      await writeAuditLog({
        actorId: SYSTEM_ACTOR,
        action: "GRANT_EXPIRED_AUTO_REVOKED",
        targetId: grant.id,
        targetType: "ShellGrant",
        metadata: {
          requestId: grant.requestId,
          expiredAt: grant.request.expiresAt?.toISOString(),
        },
      });
    } catch (err) {
      console.error(
        `[expiryJob] Failed to revoke shell grant ${grant.id}:`,
        err
      );
    }
  }
}

let jobStarted = false;

export function startExpiryJob(): void {
  if (jobStarted) return; // guard against double-start in dev hot-reload
  jobStarted = true;

  const intervalMinutes = parseInt(
    process.env.EXPIRY_CHECK_INTERVAL_MINUTES ?? "5",
    10
  );

  // node-cron schedule: run every N minutes
  const schedule = `*/${intervalMinutes} * * * *`;

  cron.schedule(schedule, async () => {
    try {
      await runExpiryCheck();
    } catch (err) {
      console.error("[expiryJob] Unexpected error during expiry check:", err);
    }
  });

  console.log(
    `[expiryJob] Started — checking every ${intervalMinutes} minute(s)`
  );
}
