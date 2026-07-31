/**
 * Provisioner — creates and revokes GPU server access for the two supported paths.
 *
 * This module runs on the same RHEL machine as the portal.
 * It shells out to OS commands for user/SSH management, and reads/writes the
 * vLLM router's permitted-keys file for API key access.
 *
 * Required OS permissions (sudoers entry for the Node process user):
 *   lts-user ALL=(ALL) NOPASSWD: /sbin/useradd, /sbin/usermod
 *
 * Required env vars:
 *   VLLM_KEYS_FILE  — absolute path to the vLLM router's permitted API keys file (one key per line)
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "@/lib/prisma";
import { writeAuditLog, writeDetailedAuditLog } from "@/lib/audit";

const execAsync = promisify(exec);

// Automated provisioner actions have no human actor — actorId is null
const SYSTEM_ACTOR = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVllmKeysFile(): string | null {
  return process.env.VLLM_KEYS_FILE ?? null;
}

/**
 * Compute SHA256 fingerprint from an SSH public key.
 * Input format: "ssh-ed25519 AAAAC3... lts:username"
 * Output: SHA256 hex digest (uppercase for consistency with OpenSSH)
 */
function computeKeyFingerprint(publicKeyLine: string): string {
  const keyData = publicKeyLine.split(" ")[1]; // extract the base64-encoded key part
  if (!keyData) {
    throw new Error("Invalid public key format: cannot extract key data");
  }
  const hash = crypto.createHash("sha256");
  hash.update(Buffer.from(keyData, "base64"));
  return hash.digest("hex").toUpperCase();
}

/**
 * Append a single line to a file, creating it if it does not exist.
 * Uses a simple lock via sequential awaits — single-process portal is fine.
 */
async function appendLine(filePath: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, line + "\n", "utf8");
}

/**
 * Remove all lines matching `value` from a file.
 */
async function removeLine(filePath: string, value: string): Promise<void> {
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // file doesn't exist — nothing to remove
    throw err;
  }
  const filtered = content
    .split("\n")
    .filter((l) => l.trim() !== value.trim() && l.trim() !== "")
    .join("\n");
  await fs.writeFile(filePath, filtered ? filtered + "\n" : "", "utf8");
}

/**
 * Generate an ed25519 SSH keypair using ssh-keygen (available on RHEL).
 * Returns { privateKey, publicKey } as PEM/OpenSSH strings.
 */
async function generateSshKeypair(
  username: string
): Promise<{ privateKey: string; publicKey: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lts-ssh-"));
  const keyPath = path.join(tmpDir, "id_ed25519");
  try {
    await execAsync(
      `ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "lts:${username}"`,
      { timeout: 15_000 }
    );
    const privateKey = await fs.readFile(keyPath, "utf8");
    const publicKey = await fs.readFile(keyPath + ".pub", "utf8");
    return { privateKey: privateKey.trim(), publicKey: publicKey.trim() };
  } finally {
    // Always clean up temp files
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// ─── API Key — Provision ──────────────────────────────────────────────────────

export async function provisionApiKey(requestId: string): Promise<void> {
  const request = await prisma.accessRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { user: { select: { username: true } } },
  });

  const apiKey = uuidv4();
  const keysFile = getVllmKeysFile();

  // Write to the vLLM router's keys file (skip with warning if not configured)
  if (!keysFile) {
    console.warn(
      "[provisioner] VLLM_KEYS_FILE is not set — API key will be stored in DB but NOT written to the router keys file."
    );
  } else {
    try {
      await appendLine(keysFile, apiKey);
    } catch (err) {
      console.error("[provisioner] Failed to write API key to keys file:", err);
      throw new Error(
        `API key provisioning failed: could not write to ${keysFile}`
      );
    }
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + request.requestedDurationHours * 60 * 60 * 1000
  );

  await prisma.apiKeyGrant.create({
    data: {
      requestId,
      apiKey,
      isActive: true,
    },
  });

  await prisma.accessRequest.update({
    where: { id: requestId },
    data: { status: "APPROVED", grantedAt: now, expiresAt },
  });

  await writeAuditLog({
    actorId: SYSTEM_ACTOR,
    action: "API_KEY_PROVISIONED",
    targetId: requestId,
    targetType: "AccessRequest",
    metadata: { username: request.user.username, expiresAt: expiresAt.toISOString() },
  });
}

// ─── API Key — Revoke ─────────────────────────────────────────────────────────

export async function revokeApiKey(grantId: string): Promise<void> {
  const grant = await prisma.apiKeyGrant.findUniqueOrThrow({
    where: { id: grantId },
  });

  if (!grant.isActive) return; // already revoked — idempotent

  const keysFile = getVllmKeysFile();

  if (!keysFile) {
    console.warn("[provisioner] VLLM_KEYS_FILE is not set — skipping keys file cleanup on revoke.");
  } else {
    try {
      await removeLine(keysFile, grant.apiKey);
    } catch (err) {
      // Log but don't hard-fail — we still mark it revoked in the DB
      console.error("[provisioner] Failed to remove API key from keys file:", err);
    }
  }

  await prisma.apiKeyGrant.update({
    where: { id: grantId },
    data: { isActive: false, revokedAt: new Date() },
  });

  await writeAuditLog({
    actorId: SYSTEM_ACTOR,
    action: "API_KEY_REVOKED",
    targetId: grantId,
    targetType: "ApiKeyGrant",
    metadata: { apiKey: grant.apiKey },
  });
}

// ─── Shell Access — Provision ─────────────────────────────────────────────────

export async function provisionShellAccess(requestId: string): Promise<void> {
  const request = await prisma.accessRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { user: { select: { username: true } } },
  });

  // Linux usernames: max 32 chars, lowercase, alphanumeric + hyphens
  const shortId = requestId.slice(0, 6).toLowerCase();
  const baseUsername = request.user.username
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
  const linuxUsername = `lts-${baseUsername}-${shortId}`;

  // Create the Linux user account
  try {
    await execAsync(
      `sudo /sbin/useradd -m -s /bin/bash "${linuxUsername}"`,
      { timeout: 30_000 }
    );
  } catch (err) {
    console.error("[provisioner] useradd failed:", err);
    throw new Error(`Shell provisioning failed: useradd returned an error for ${linuxUsername}`);
  }

  // Generate SSH keypair
  let keypair: { privateKey: string; publicKey: string };
  try {
    keypair = await generateSshKeypair(linuxUsername);
  } catch (err) {
    // Attempt to clean up the created user before re-throwing
    await execAsync(`sudo /sbin/userdel -r "${linuxUsername}"`).catch(() => {});
    console.error("[provisioner] ssh-keygen failed:", err);
    throw new Error(`Shell provisioning failed: could not generate SSH keypair`);
  }

  // Set up ~/.ssh/authorized_keys for the new user
  const sshDir = `/home/${linuxUsername}/.ssh`;
  const authKeysFile = `${sshDir}/authorized_keys`;
  try {
    await execAsync(`sudo mkdir -p "${sshDir}"`, { timeout: 10_000 });
    await execAsync(
      `echo '${keypair.publicKey}' | sudo tee "${authKeysFile}" > /dev/null`,
      { timeout: 10_000 }
    );
    await execAsync(`sudo chmod 700 "${sshDir}"`, { timeout: 10_000 });
    await execAsync(`sudo chmod 600 "${authKeysFile}"`, { timeout: 10_000 });
    await execAsync(
      `sudo chown -R "${linuxUsername}:${linuxUsername}" "${sshDir}"`,
      { timeout: 10_000 }
    );
  } catch (err) {
    await execAsync(`sudo /sbin/userdel -r "${linuxUsername}"`).catch(() => {});
    console.error("[provisioner] authorized_keys setup failed:", err);
    throw new Error(`Shell provisioning failed: could not set up SSH authorized_keys`);
  }

  // Generate a random password and set it on the account
  // Format: 3 groups of 4 alphanumeric chars separated by hyphens — readable but strong enough for a temp account
  const initialPassword = [
    crypto.randomBytes(3).toString("hex"),
    crypto.randomBytes(3).toString("hex"),
    crypto.randomBytes(3).toString("hex"),
  ].join("-");

  try {
    await execAsync(
      `echo '${linuxUsername}:${initialPassword}' | sudo chpasswd`,
      { timeout: 10_000 }
    );
  } catch (err) {
    // Non-fatal: SSH key auth still works. Log and continue.
    console.error("[provisioner] chpasswd failed:", err);
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + request.requestedDurationHours * 60 * 60 * 1000
  );

  // Compute SSH key fingerprint for tracking
  let keyFingerprint: string;
  try {
    keyFingerprint = computeKeyFingerprint(keypair.publicKey);
  } catch (err) {
    console.error("[provisioner] Failed to compute key fingerprint:", err);
    throw new Error(`Shell provisioning failed: could not compute key fingerprint`);
  }

  const shellGrant = await prisma.shellGrant.create({
    data: {
      requestId,
      linuxUsername,
      sshPublicKey: keypair.publicKey,
      sshPrivateKey: keypair.privateKey,
      initialPassword,
      isActive: true,
    },
  });

  // Create SSH key record for fingerprint tracking and explicit revocation
  await prisma.sshKeyRecord.create({
    data: {
      shellGrantId: shellGrant.id,
      publicKey: keypair.publicKey,
      keyType: "ed25519",
      fingerprint: keyFingerprint,
      comment: `lts:${linuxUsername}`,
      isRevoked: false,
    },
  });

  await prisma.accessRequest.update({
    where: { id: requestId },
    data: { status: "APPROVED", grantedAt: now, expiresAt },
  });

  await writeAuditLog({
    actorId: SYSTEM_ACTOR,
    action: "SHELL_ACCESS_PROVISIONED",
    targetId: requestId,
    targetType: "AccessRequest",
    metadata: {
      linuxUsername,
      expiresAt: expiresAt.toISOString(),
      keyFingerprint,
    },
  });
}

// ─── Shell Access — Revoke ────────────────────────────────────────────────────

export interface RevocationStepResult {
  step: string;
  status: "SUCCESS" | "FAILED";
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function revokeShellAccess(grantId: string): Promise<RevocationStepResult[]> {
  const grant = await prisma.shellGrant.findUniqueOrThrow({
    where: { id: grantId },
  });

  if (!grant.isActive) return []; // idempotent

  const { linuxUsername } = grant;
  const steps: RevocationStepResult[] = [];
  const now = new Date();

  // Step 1: Revoke SSH keys in database (mark all key records as revoked)
  try {
    const keyRecords = await prisma.sshKeyRecord.findMany({
      where: { shellGrantId: grantId, isRevoked: false },
    });

    if (keyRecords.length > 0) {
      await prisma.sshKeyRecord.updateMany({
        where: { shellGrantId: grantId, isRevoked: false },
        data: { isRevoked: true, revokedAt: now },
      });

      const fingerprints = keyRecords.map((kr) => kr.fingerprint);
      steps.push({
        step: "ssh_keys_revoked",
        status: "SUCCESS",
        metadata: { count: keyRecords.length, fingerprints },
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[provisioner] Failed to revoke SSH keys in DB:", err);
    steps.push({
      step: "ssh_keys_revoked",
      status: "FAILED",
      errorMessage: errorMsg,
    });
  }

  // Step 2: Lock the account so SSH logins are rejected immediately
  try {
    await execAsync(`sudo /sbin/usermod -L "${linuxUsername}"`, {
      timeout: 15_000,
    });
    steps.push({
      step: "account_locked",
      status: "SUCCESS",
      metadata: { linuxUsername },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[provisioner] usermod -L failed:", err);
    steps.push({
      step: "account_locked",
      status: "FAILED",
      errorMessage: errorMsg,
    });
    // Continue — still clear authorized_keys
  }

  // Step 3: Clear authorized_keys file
  const authKeysFile = `/home/${linuxUsername}/.ssh/authorized_keys`;
  try {
    await execAsync(`sudo truncate -s 0 "${authKeysFile}"`, {
      timeout: 10_000,
    });
    steps.push({
      step: "authorized_keys_cleared",
      status: "SUCCESS",
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[provisioner] Failed to clear authorized_keys:", err);
    steps.push({
      step: "authorized_keys_cleared",
      status: "FAILED",
      errorMessage: errorMsg,
    });
    // Non-fatal — account is already locked
  }

  // Step 4: Mark grant as revoked in database
  try {
    await prisma.shellGrant.update({
      where: { id: grantId },
      data: { isActive: false, revokedAt: now },
    });
    steps.push({
      step: "grant_marked_revoked",
      status: "SUCCESS",
      metadata: { grantId },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[provisioner] Failed to update grant status:", err);
    steps.push({
      step: "grant_marked_revoked",
      status: "FAILED",
      errorMessage: errorMsg,
    });
  }

  // Write detailed audit log with all steps
  await writeDetailedAuditLog({
    actorId: SYSTEM_ACTOR,
    action: "SHELL_ACCESS_REVOKED",
    targetId: grantId,
    targetType: "ShellGrant",
    steps,
    metadata: { linuxUsername },
  });

  return steps;
}

// ─── Shell Access — Delete ────────────────────────────────────────────────────

export interface DeleteResult {
  success: boolean;
  deletedAt: Date;
  linuxUsername: string;
  deleteReason?: string;
  error?: string;
}

/**
 * Permanently delete a revoked shell access account from the OS and mark it deleted in the DB.
 * Only operates on accounts that are already revoked (isActive = false).
 * Idempotent: returns early if already deleted.
 */
export async function deleteShellAccount(
  grantId: string,
  deleteReason: string = "manual_request"
): Promise<DeleteResult> {
  const grant = await prisma.shellGrant.findUniqueOrThrow({
    where: { id: grantId },
  });

  const { linuxUsername } = grant;
  const now = new Date();

  // Prevent deletion of active accounts
  if (grant.isActive) {
    throw new Error(
      `Cannot delete active shell account: ${linuxUsername} (grant is still active)`
    );
  }

  // Idempotent: if already deleted, return early
  if (grant.deletedAt) {
    return {
      success: true,
      deletedAt: grant.deletedAt,
      linuxUsername,
      deleteReason: grant.deleteReason ?? undefined,
    };
  }

  const steps: RevocationStepResult[] = [];

  // Step 1: Delete OS user account and home directory
  try {
    const { stderr, stdout } = await execAsync(
      `sudo /sbin/userdel -r "${linuxUsername}"`,
      { timeout: 30_000 }
    );
    console.log(
      `[provisioner] Successfully deleted OS user: ${linuxUsername}`,
      stdout || ""
    );
    steps.push({
      step: "os_account_deleted",
      status: "SUCCESS",
      metadata: { linuxUsername },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Check if error is due to account not existing (idempotent scenario)
    if (
      errorMsg.includes("does not exist") ||
      errorMsg.includes("No such user")
    ) {
      console.warn(
        `[provisioner] OS user already deleted or never existed: ${linuxUsername}`
      );
      steps.push({
        step: "os_account_deleted",
        status: "SUCCESS",
        metadata: { linuxUsername, note: "already_deleted" },
      });
    } else {
      console.error("[provisioner] userdel failed:", err);
      steps.push({
        step: "os_account_deleted",
        status: "FAILED",
        errorMessage: errorMsg,
      });
      // Throw to prevent marking as deleted if OS deletion fails
      throw new Error(`Failed to delete OS user ${linuxUsername}: ${errorMsg}`);
    }
  }

  // Step 2: Update database to mark as deleted
  try {
    await prisma.shellGrant.update({
      where: { id: grantId },
      data: {
        deletedAt: now,
        deleteReason,
        deleteScheduledAt: null, // clear any scheduled deletion
      },
    });
    steps.push({
      step: "db_marked_deleted",
      status: "SUCCESS",
      metadata: { grantId, deleteReason },
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[provisioner] Failed to update grant deletion status:", err);
    steps.push({
      step: "db_marked_deleted",
      status: "FAILED",
      errorMessage: errorMsg,
    });
  }

  // Write audit log
  await writeDetailedAuditLog({
    actorId: SYSTEM_ACTOR,
    action: "SHELL_ACCOUNT_DELETED",
    targetId: grantId,
    targetType: "ShellGrant",
    steps,
    metadata: { linuxUsername, deleteReason },
  });

  return {
    success: true,
    deletedAt: now,
    linuxUsername,
    deleteReason,
  };
}

