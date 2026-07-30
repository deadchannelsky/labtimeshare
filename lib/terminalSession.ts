/**
 * terminalSession — handles a single WebSocket↔SSH shell session.
 *
 * Called from server.ts on every WebSocket upgrade to /api/terminal/[grantId].
 *
 * Flow:
 *   1. Parse lts-session JWT from the WS handshake Cookie header.
 *   2. Look up the ShellGrant, verify isActive and ownership.
 *   3. Open an ssh2 Client to localhost:22 using the stored private key.
 *   4. Pipe: browser xterm.js ←WS→ ssh2 shell stream ←SSH→ SSHD.
 *   5. Tear down both sides cleanly on any close/error event.
 */

import { Client as SshClient } from "ssh2";
import type { WebSocket } from "ws";
import { prisma } from "@/lib/prisma";
import { verifyJwt } from "@/lib/auth";
import { registerSession, deregisterSession } from "@/lib/sessionRegistry";

// Default pty dimensions — overridden by the first resize message from the client.
const DEFAULT_COLS = 220;
const DEFAULT_ROWS = 50;

interface ResizeMessage {
  type: "resize";
  cols: number;
  rows: number;
}

function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export async function handleTerminalUpgrade(
  ws: WebSocket,
  grantId: string,
  cookieHeader: string | undefined
): Promise<void> {
  // ── 1. Authenticate ──────────────────────────────────────────────────────────
  const token = cookieHeader ? parseCookie(cookieHeader, "lts-session") : null;
  const session = token ? await verifyJwt(token) : null;

  if (!session) {
    ws.close(4001, "Unauthorized");
    return;
  }

  // ── 2. Authorise — verify grant exists, is active, and belongs to this user ──
  const grant = await prisma.shellGrant.findUnique({
    where: { id: grantId },
    include: { request: true },
  });

  if (
    !grant ||
    !grant.isActive ||
    !grant.sshPrivateKey ||
    grant.request.userId !== session.userId
  ) {
    ws.close(4004, "Grant not found or not active");
    return;
  }

  // ── 3. Open SSH connection ────────────────────────────────────────────────────
  const ssh = new SshClient();
  let streamReady = false;

  registerSession(grantId, ws);

  ssh.on("ready", () => {
    ssh.shell(
      {
        term: "xterm-256color",
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      },
      (err, stream) => {
        if (err) {
          console.error(`[terminal] ssh.shell error for grant ${grantId}:`, err);
          ws.close(1011, "SSH shell error");
          ssh.end();
          return;
        }

        streamReady = true;

        // ── 4. Pipe WS → SSH ───────────────────────────────────────────────────
        ws.on("message", (data: Buffer | string) => {
          // Check for a JSON resize control message
          if (typeof data === "string") {
            try {
              const msg = JSON.parse(data) as ResizeMessage;
              if (msg.type === "resize" && msg.cols && msg.rows) {
                stream.setWindow(msg.rows, msg.cols, 0, 0);
                return;
              }
            } catch {
              // not JSON — fall through and write as-is
            }
            stream.write(data);
          } else {
            stream.write(data);
          }
        });

        // ── 4. Pipe SSH → WS ───────────────────────────────────────────────────
        stream.on("data", (chunk: Buffer) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(chunk);
          }
        });

        stream.stderr.on("data", (chunk: Buffer) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(chunk);
          }
        });

        // ── 5. Teardown ────────────────────────────────────────────────────────
        stream.on("close", () => {
          ws.close(1000, "Shell closed");
          ssh.end();
          deregisterSession(grantId);
        });

        ws.on("close", () => {
          if (streamReady) stream.end();
          ssh.end();
          deregisterSession(grantId);
        });

        ws.on("error", (err) => {
          console.error(`[terminal] WS error for grant ${grantId}:`, err);
          if (streamReady) stream.end();
          ssh.end();
          deregisterSession(grantId);
        });
      }
    );
  });

  ssh.on("error", (err) => {
    console.error(`[terminal] SSH client error for grant ${grantId}:`, err);
    ws.close(1011, "SSH connection error");
    deregisterSession(grantId);
  });

  ssh.connect({
    host: "127.0.0.1",
    port: 22,
    username: grant.linuxUsername,
    privateKey: grant.sshPrivateKey,
  });
}
