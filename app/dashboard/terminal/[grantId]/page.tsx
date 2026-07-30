"use client";

/**
 * /dashboard/terminal/[grantId] — In-browser SSH terminal.
 *
 * Connects to the WebSocket endpoint at /api/terminal/[grantId] via the
 * custom server.ts WebSocket handler. Renders an xterm.js terminal that
 * is sized to fill its container and stays in sync with window resize events.
 *
 * The lts-session cookie is sent automatically with the WS handshake
 * (same origin), so no explicit credential passing is needed here.
 */

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { AttachAddon } from "@xterm/addon-attach";
import "@xterm/xterm/css/xterm.css";

export default function TerminalPage() {
  const { grantId } = useParams<{ grantId: string }>();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Build WebSocket URL from current origin (works for both ws:// and wss://)
    const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${wsProtocol}://${window.location.host}/api/terminal/${grantId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "\"Cascadia Code\", \"Fira Code\", \"Menlo\", monospace",
      fontSize: 14,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
      },
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    const attachAddon = new AttachAddon(ws);

    term.loadAddon(fitAddon);
    term.loadAddon(attachAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    // Send initial dimensions once the socket is open
    ws.addEventListener("open", () => {
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    // Handle server-initiated close (grant expired / revoked)
    ws.addEventListener("close", (e) => {
      term.writeln(
        `\r\n\x1b[33m[Session closed: ${e.reason || "connection ended"}]\x1b[0m`
      );
    });

    ws.addEventListener("error", () => {
      term.writeln("\r\n\x1b[31m[Connection error — please return to dashboard]\x1b[0m");
    });

    // Resize observer keeps terminal in sync with container size
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        const { cols, rows } = term;
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, [grantId]);

  return (
    <div className="flex flex-col h-screen bg-[#0d1117]">
      {/* Minimal top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d]">
        <span className="text-xs text-[#8b949e] font-mono">
          LabTimeShare — Web Terminal
        </span>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-xs text-[#58a6ff] hover:underline"
        >
          ← Back to Dashboard
        </button>
      </div>

      {/* Terminal container — fills remaining height */}
      <div ref={containerRef} className="flex-1 p-2 overflow-hidden" />
    </div>
  );
}
