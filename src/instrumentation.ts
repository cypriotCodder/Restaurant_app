// Runs once when the server starts. Validating here means a deployment with a
// missing or malformed variable fails immediately and visibly, instead of
// booting "healthy" and only breaking when a customer scans a QR.
export async function register() {
  // Only the Node.js server runtime has the full environment; skip on edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` also loads this module while collecting page data. Validating
  // is fine there, but starting timers is not.
  const isBuild = process.env.NEXT_PHASE === "phase-production-build";

  const { getEnv } = await import("./lib/env");
  getEnv();

  // In development, warn loudly when the configured origin is not an address
  // this machine actually has. A stale NEXT_PUBLIC_BASE_URL is invisible from
  // the server — every page still serves fine locally — while every QR code it
  // generates points at an address that no longer exists, which looks to a
  // phone exactly like a broken app.
  if (!isBuild && process.env.NODE_ENV !== "production") {
    const { warnIfOriginUnreachable } = await import("./lib/devOrigin");
    warnIfOriginUnreachable();
  }

  // The server schedules the POS sweep and the retention prune itself; there
  // is no external scheduler to depend on.
  if (!isBuild) {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
