"use client";

import { useState } from "react";

interface RevealKeyButtonProps {
  requestId: string;
}

export default function RevealKeyButton({ requestId }: RevealKeyButtonProps) {
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleReveal() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/reveal-key`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to reveal key");
        return;
      }
      const data = await res.json();
      setPrivateKey(data.sshPrivateKey);
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!privateKey) return;
    await navigator.clipboard.writeText(privateKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (privateKey) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-gray-700">
            SSH Private Key{" "}
            <span className="text-red-600 font-semibold">
              (save this — it will not be shown again)
            </span>
          </p>
          <button
            onClick={handleCopy}
            className="text-xs text-blue-600 border border-blue-300 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="bg-gray-900 text-green-400 rounded p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
          {privateKey}
        </pre>
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
        {loading ? "Loading…" : "Reveal SSH Key (one-time)"}
      </button>
      <p className="text-xs text-gray-400">
        The key will be permanently deleted from the server after you view it.
      </p>
    </div>
  );
}
