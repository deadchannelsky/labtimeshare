/**
 * Expiry Job — automatically revokes GPU access grants that have passed their expiresAt time,
 * and automatically deletes accounts based on retention policy.
 *
 * Runs on configurable intervals using node-cron.
 * Started via Next.js instrumentation.ts on server startup.
 *
 * Env vars:
 *   EXPIRY_CHECK_INTERVAL_MINUTES — how often to check for expired grants (default: 5)
 *   CLEANUP_CHECK_INTERVAL_MINUTES — how often to check for accounts ready for deletion (default: 60)
 */

import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { revokeApiKey, revokeShellAccess, deleteShellAccount } from "@/lib/provisioner";
import { writeAuditLog, writeDetailedAuditLog } from "@/lib/audit";
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
 
 /**
  * Run automated cleanup of shell accounts that are ready for deletion based on retention policy.
 * Finds revoked shell grants with autoDeleteAfterDays set and revokedAt in the past.
 */
export async function runCleanupCheck(): Promise<void> {
  const now = new Date();
  let deletedCount = 0;
  let failureCount = 0;

  // Find shell grants that are:
  // 1. Revoked (isActive = false)
  // 2. Not yet deleted (deletedAt = null)
  // 3. Have autoDeleteAfterDays set
  // 4. Past their deletion threshold
  const grantsReadyForDeletion = await prisma.shellGrant.findMany({
    where: {
      isActive: false,
      deletedAt: null,
      autoDeleteAfterDays: { not: null },
      revokedAt: {
        lt: new Date(now.getTime() - (24 * 60 * 60 * 1000)), // at least 1 day old; will refine based on policy
      },
    },
    include: { request: true },
  });

  if (grantsReadyForDeletion.length === 0) {
    return;
  }

  console.log(
    `[cleanupJob] Found ${grantsReadyForDeletion.length} account(s) ready for deletion`
  );

  for (const grant of grantsReadyForDeletion) {
    if (!grant.autoDeleteAfterDays || !grant.revokedAt) {
      continue; // skip if no policy or not revoked
    }

    // Calculate if past deletion threshold
    const deletionThresholdTime = new Date(
      grant.revokedAt.getTime() + grant.autoDeleteAfterDays * 24 * 60 * 60 * 1000
    );

    if (now < deletionThresholdTime) {
      continue; // not yet time to delete
    }

    try {
      await deleteShellAccount(grant.id, "auto_cleanup_policy");
      deletedCount++;
      console.log(
        `[cleanupJob] Deleted account: ${grant.linuxUsername} (grant: ${grant.id})`
      );
    } catch (err) {
      failureCount++;
      console.error(
        `[cleanupJob] Failed to delete account ${grant.id}:`,
        err
      );
    }
  }

  if (deletedCount > 0 || failureCount > 0) {
    console.log(
      `[cleanupJob] Cleanup run complete — deleted ${deletedCount}, failed ${failureCount}`
    );
  }
}

let jobStarted = false;

export function startExpiryJob(): void {
  if (jobStarted) return; // guard against double-start in dev hot-reload
  jobStarted = true;

  // Start expiry check job
  const expiryIntervalMinutes = parseInt(
    process.env.EXPIRY_CHECK_INTERVAL_MINUTES ?? "5",
    10
  );

  const expirySchedule = `*/${expiryIntervalMinutes} * * * *`;

  cron.schedule(expirySchedule, async () => {
    try {
      await runExpiryCheck();
    } catch (err) {
      console.error("[expiryJob] Unexpected error during expiry check:", err);
    }
  });

  console.log(
    `[expiryJob] Expiry check started — running every ${expiryIntervalMinutes} minute(s)`
  );

  // Start cleanup job (account deletion based on retention policy)
  const cleanupIntervalMinutes = parseInt(
    process.env.CLEANUP_CHECK_INTERVAL_MINUTES ?? "60",
    10
  );

  if (cleanupIntervalMinutes > 0) {
    const cleanupSchedule = `*/${cleanupIntervalMinutes} * * * *`;

    cron.schedule(cleanupSchedule, async () => {
      try {
        await runCleanupCheck();
      } catch (err) {
        console.error("[cleanupJob] Unexpected error during cleanup check:", err);
      }
    });

    console.log(
      `[cleanupJob] Cleanup job started — running every ${cleanupIntervalMinutes} minute(s)`
    );
  } else {
    console.log(
      `[cleanupJob] Cleanup job disabled (CLEANUP_CHECK_INTERVAL_MINUTES = 0)`
    );
  }
}
