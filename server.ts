/**
 * server.ts — Custom Node HTTP server for LabTimeShare.
 *
 * Replaces `next start` as the process entry point.
 * Mounts the Next.js request handler for all HTTP traffic and attaches a
 * ws.Server on the same port to handle WebSocket upgrades for the web terminal.
 *
 * Terminal WebSocket route: /api/terminal/:grantId
 *
 * Usage (production):  node server.js   (after `next build`)
 * Usage (development): tsx server.ts    (or `next dev` — WS not available in dev)
 */

import http from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { handleTerminalUpgrade } from "./lib/terminalSession";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME ?? "0.0.0.0";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const TERMINAL_PATH_RE = /^\/api\/terminal\/([^/]+)$/;

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const pathname = parse(req.url ?? "/").pathname ?? "";
    const match = TERMINAL_PATH_RE.exec(pathname);

    if (!match) {
      // Not a terminal path — destroy the socket (Next.js doesn't handle upgrades)
      socket.destroy();
      return;
    }

    const grantId = match[1];

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
      handleTerminalUpgrade(ws, grantId, req.headers.cookie).catch((err) => {
        console.error("[server] Unhandled error in handleTerminalUpgrade:", err);
        ws.close(1011, "Internal server error");
      });
    });
  });

  server.listen(port, hostname, () => {
    console.log(
      `> LabTimeShare ready on http://${hostname}:${port} [${dev ? "dev" : "production"}]`
    );
  });
});
