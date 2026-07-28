/**
 * Next.js instrumentation hook — runs once on server startup (not on every request).
 * Used to start the grant expiry background job.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run in the Node.js runtime (not in Edge runtime or during build)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startExpiryJob } = await import("@/lib/expiryJob");
    startExpiryJob();
  }
}
