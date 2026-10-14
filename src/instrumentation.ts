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
  const env = getEnv();

  // TRUST_PROXY=1 makes the rate limiter believe the last X-Forwarded-For hop,
  // which is only the proxy's word if nothing else can reach this port. The
  // standalone server binds 0.0.0.0 unless HOSTNAME says otherwise (it does
  // not read HOST), so a mistyped variable leaves the limits forgeable from
  // the wifi while everything looks healthy.
  if (!isBuild && process.env.NODE_ENV === "production" && env.TRUST_PROXY === "1") {
    const bind = process.env.HOSTNAME ?? "";
    if (!["127.0.0.1", "::1", "localhost"].includes(bind)) {
      console.warn(
        `[env] TRUST_PROXY=1 but the server is bound to ${bind || "0.0.0.0"}, not loopback. ` +
          "Set HOSTNAME=127.0.0.1 so only the reverse proxy can reach it."
      );
    }
  }

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
