"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type AccessPath = "API_KEY" | "SHELL_ACCESS";

const DURATION_OPTIONS = [
  { label: "1 hour", value: 1 },
  { label: "4 hours", value: 4 },
  { label: "8 hours", value: 8 },
  { label: "24 hours", value: 24 },
  { label: "72 hours", value: 72 },
  { label: "1 week", value: 168 },
] as const;

export default function RequestAccessPage() {
  const router = useRouter();

  const [selectedPath, setSelectedPath] = useState<AccessPath | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(24);
  const [customHours, setCustomHours] = useState<string>("");
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function effectiveDuration(): number | null {
    if (useCustom) {
      const n = parseInt(customHours, 10);
      return isNaN(n) ? null : n;
    }
    return selectedDuration;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedPath) {
      setError("Please select an access path.");
      return;
    }

    const hours = effectiveDuration();
    if (hours === null || hours < 1 || hours > 168) {
      setError("Please enter a duration between 1 and 168 hours.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: selectedPath,
          requestedDurationHours: hours,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Request failed.");
        return;
      }

      setSuccess(true);
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-md w-full text-center space-y-4">
          <div className="text-4xl">✅</div>
          <h2 className="text-lg font-semibold text-gray-900">
            Request Submitted
          </h2>
          <p className="text-sm text-gray-600">
            Your access request is now pending review. An approver will review
            it shortly.
          </p>
          <Link
            href="/dashboard"
            className="inline-block bg-blue-600 text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Dashboard
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-sm font-semibold text-gray-900">
            Request Access
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* ── Access Path ─────────────────────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-gray-900">
              1. Choose Access Path
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {/* API Key card */}
              <button
                type="button"
                onClick={() => setSelectedPath("API_KEY")}
                className={`text-left p-4 border rounded-lg transition-colors ${
                  selectedPath === "API_KEY"
                    ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="font-medium text-sm text-gray-900 mb-1">
                  API Key Access
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Receive a time-limited API key that allows you to make
                  authenticated inference calls to the vLLM server. No SSH
                  required.
                </p>
              </button>

              {/* Shell Access card */}
              <button
                type="button"
                onClick={() => setSelectedPath("SHELL_ACCESS")}
                className={`text-left p-4 border rounded-lg transition-colors ${
                  selectedPath === "SHELL_ACCESS"
                    ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="font-medium text-sm text-gray-900 mb-1">
                  Shell Access
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Get a Linux OS account on the GPU server with SSH keypair
                  credentials. Requires VPN access. Useful for running jobs
                  directly.
                </p>
              </button>
            </div>
          </section>

          {/* ── Duration ────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-gray-900">
              2. Choose Duration
            </h2>
            <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
              {/* Preset duration buttons */}
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setSelectedDuration(opt.value);
                      setUseCustom(false);
                    }}
                    className={`px-3 py-1.5 text-sm border rounded-md transition-colors ${
                      !useCustom && selectedDuration === opt.value
                        ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                        : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Custom hours */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setUseCustom(!useCustom)}
                  className={`px-3 py-1.5 text-sm border rounded-md transition-colors ${
                    useCustom
                      ? "border-blue-500 bg-blue-50 text-blue-700 font-medium"
                      : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  Custom
                </button>
                {useCustom && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={168}
                      value={customHours}
                      onChange={(e) => setCustomHours(e.target.value)}
                      placeholder="Hours"
                      className="w-24 border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <span className="text-sm text-gray-500">hours (1–168)</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── Error ───────────────────────────────────────────────────── */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* ── Submit ──────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={loading || !selectedPath}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Submitting…" : "Submit Request"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="text-sm text-gray-600 border border-gray-300 px-4 py-2.5 rounded-md hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
