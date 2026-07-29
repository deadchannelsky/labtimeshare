/**
 * Next.js instrumentation hook — runs once on server startup (not on every request).
 * Used to start the grant expiry background job.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in the Node.js runtime (not in Edge runtime or during build)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Warn loudly at startup if critical env vars are missing
    if (!process.env.SERVER_IP || process.env.SERVER_IP === "192.168.1.100") {
      console.warn(
        "[config] WARNING: SERVER_IP is not set or is still the default placeholder. " +
        "Shell access credentials will show the wrong IP address. " +
        "Set SERVER_IP in .env to the VPN-reachable IP of this machine " +
        "(run `ip -4 addr show` to find it)."
      );
    }
    if (!process.env.VLLM_KEYS_FILE) {
      console.warn(
        "[config] WARNING: VLLM_KEYS_FILE is not set. " +
        "API key grants will be stored in the database but not written to the vLLM router."
      );
    }
    if (!process.env.JWT_SECRET) {
      console.error("[config] FATAL: JWT_SECRET is not set. Authentication will not work.");
    }

    const { startExpiryJob } = await import("@/lib/expiryJob");
    startExpiryJob();
  }
}
