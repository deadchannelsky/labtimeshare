"use client";

import { useState } from "react";

interface RevealKeyButtonProps {
  requestId: string;
  linuxUsername: string;
  serverIp: string;
}

interface Credentials {
  sshPrivateKey: string;
  initialPassword: string | null;
  linuxUsername: string;
}

export default function RevealKeyButton({
  requestId,
  linuxUsername,
  serverIp,
}: RevealKeyButtonProps) {
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedPw, setCopiedPw] = useState(false);

  async function handleReveal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/reveal-key`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to reveal credentials");
        return;
      }
      const data = await res.json();
      setCreds(data);
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard(text: string, which: "key" | "pw") {
    await navigator.clipboard.writeText(text);
    if (which === "key") {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedPw(true);
      setTimeout(() => setCopiedPw(false), 2000);
    }
  }

  if (creds) {
    const keyFilename = `${creds.linuxUsername}_id_ed25519`;

    return (
      <div className="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              SSH Credentials — Save These Now
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              The private key is shown <strong>once only</strong> and has been deleted from the server.
            </p>
          </div>
        </div>

        {/* Password */}
        {creds.initialPassword && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-gray-700">Password (for password auth)</p>
              <button
                onClick={() => copyToClipboard(creds.initialPassword!, "pw")}
                className="text-xs text-blue-600 border border-blue-300 px-2 py-0.5 rounded hover:bg-blue-50"
              >
                {copiedPw ? "Copied!" : "Copy"}
              </button>
            </div>
            <code className="block bg-white border border-gray-200 rounded px-3 py-2 text-sm font-mono text-gray-900 tracking-wider">
              {creds.initialPassword}
            </code>
          </div>
        )}

        {/* Private key */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-gray-700">
              Private Key — save as <code className="bg-gray-100 px-1 rounded">{keyFilename}</code>
            </p>
            <button
              onClick={() => copyToClipboard(creds.sshPrivateKey, "key")}
              className="text-xs text-blue-600 border border-blue-300 px-2 py-0.5 rounded hover:bg-blue-50"
            >
              {copiedKey ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="bg-gray-900 text-green-400 rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-48">
            {creds.sshPrivateKey}
          </pre>
        </div>

        {/* Instructions */}
        <div className="rounded border border-gray-200 bg-white p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            How to connect
          </p>

          <div className="space-y-3 text-xs text-gray-700">
            {/* Option A: key auth */}
            <div>
              <p className="font-medium text-gray-800 mb-1">Option A — SSH key (recommended)</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-600">
                <li>
                  Copy the private key above and save it to a file:
                  <code className="ml-1 bg-gray-100 rounded px-1 font-mono">
                    ~/.ssh/{keyFilename}
                  </code>
                </li>
                <li>
                  Set correct permissions:
                  <code className="ml-1 bg-gray-100 rounded px-1 font-mono">
                    chmod 600 ~/.ssh/{keyFilename}
                  </code>
                </li>
                <li>
                  Connect:
                  <code className="ml-1 bg-gray-100 rounded px-1 font-mono">
                    ssh -i ~/.ssh/{keyFilename} {linuxUsername}@{serverIp}
                  </code>
                </li>
              </ol>
            </div>

            {/* Option B: password auth */}
            {creds.initialPassword && (
              <div>
                <p className="font-medium text-gray-800 mb-1">Option B — Password</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-600">
                  <li>
                    Connect:
                    <code className="ml-1 bg-gray-100 rounded px-1 font-mono">
                      ssh {linuxUsername}@{serverIp}
                    </code>
                  </li>
                  <li>Enter the password shown above when prompted.</li>
                </ol>
              </div>
            )}

            {/* Windows note */}
            <div className="border-t border-gray-100 pt-2 text-gray-500">
              <p className="font-medium text-gray-700 mb-0.5">Windows users</p>
              <p>
                Save the key as a <code className="bg-gray-100 rounded px-1 font-mono">.pem</code> file
                and use it in PuTTY (via PuTTYgen to convert) or Windows Terminal / PowerShell with the
                same <code className="bg-gray-100 rounded px-1 font-mono">ssh -i</code> command above.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
      <button
        onClick={handleReveal}
        disabled={loading}
        className="w-full text-sm text-center bg-amber-50 border border-amber-300 text-amber-800 px-3 py-2 rounded hover:bg-amber-100 transition-colors disabled:opacity-50"
      >
        {loading ? "Loading…" : "Reveal SSH Credentials (one-time)"}
      </button>
      <p className="text-xs text-gray-400">
        Password, private key, and connection instructions will be shown once and then the key is deleted.
      </p>
    </div>
  );
}
