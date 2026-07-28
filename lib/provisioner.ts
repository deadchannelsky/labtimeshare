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
import { v4 as uuidv4 } from "uuid";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

const execAsync = promisify(exec);

// System actor ID for provisioner-initiated audit log entries
const SYSTEM_ACTOR = "system";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getVllmKeysFile(): string {
  const p = process.env.VLLM_KEYS_FILE;
  if (!p) throw new Error("VLLM_KEYS_FILE env var is not set");
  return p;
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

  // Write to the vLLM router's keys file
  try {
    await appendLine(keysFile, apiKey);
  } catch (err) {
    console.error("[provisioner] Failed to write API key to keys file:", err);
    throw new Error(
      `API key provisioning failed: could not write to ${keysFile}`
    );
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

  try {
    await removeLine(keysFile, grant.apiKey);
  } catch (err) {
    // Log but don't hard-fail — we still mark it revoked in the DB
    console.error("[provisioner] Failed to remove API key from keys file:", err);
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

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + request.requestedDurationHours * 60 * 60 * 1000
  );

  await prisma.shellGrant.create({
    data: {
      requestId,
      linuxUsername,
      sshPublicKey: keypair.publicKey,
      sshPrivateKey: keypair.privateKey,
      isActive: true,
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
    },
  });
}

// ─── Shell Access — Revoke ────────────────────────────────────────────────────

export async function revokeShellAccess(grantId: string): Promise<void> {
  const grant = await prisma.shellGrant.findUniqueOrThrow({
    where: { id: grantId },
  });

  if (!grant.isActive) return; // idempotent

  const { linuxUsername } = grant;

  // Lock the account so SSH logins are rejected immediately
  try {
    await execAsync(`sudo /sbin/usermod -L "${linuxUsername}"`, {
      timeout: 15_000,
    });
  } catch (err) {
    console.error("[provisioner] usermod -L failed:", err);
    // Continue — still clear authorized_keys and mark DB revoked
  }

  // Remove the authorized_keys entry so the key itself is invalid
  const authKeysFile = `/home/${linuxUsername}/.ssh/authorized_keys`;
  try {
    await execAsync(`sudo truncate -s 0 "${authKeysFile}"`, {
      timeout: 10_000,
    });
  } catch (err) {
    console.error("[provisioner] Failed to clear authorized_keys:", err);
    // Non-fatal — account is already locked
  }

  await prisma.shellGrant.update({
    where: { id: grantId },
    data: { isActive: false, revokedAt: new Date() },
  });

  await writeAuditLog({
    actorId: SYSTEM_ACTOR,
    action: "SHELL_ACCESS_REVOKED",
    targetId: grantId,
    targetType: "ShellGrant",
    metadata: { linuxUsername },
  });
}
