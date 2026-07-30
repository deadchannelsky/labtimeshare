/**
 * sessionRegistry — in-memory map of active web terminal sessions.
 *
 * Keyed by ShellGrant.id. Used by the expiry job to forcibly close
 * any open browser terminal the instant a grant is revoked or expires.
 */

import type { WebSocket } from "ws";

const sessions = new Map<string, WebSocket>();

/** Register an open WebSocket session for a given grant. */
export function registerSession(grantId: string, ws: WebSocket): void {
  sessions.set(grantId, ws);
}

/** Close the WebSocket (if open) and remove it from the registry. */
export function closeAndDeregister(grantId: string): void {
  const ws = sessions.get(grantId);
  if (ws) {
    try {
      ws.close(1000, "Grant expired or revoked");
    } catch {
      // already closed — ignore
    }
    sessions.delete(grantId);
  }
}

/** Called by terminalSession when the connection closes naturally. */
export function deregisterSession(grantId: string): void {
  sessions.delete(grantId);
}
