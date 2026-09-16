// Fixed-window rate limiter for endpoints the table-session rules do not cover
// — principally staff login, which is an unauthenticated bcrypt oracle.
//
// The app is a single long-lived process on the venue's own machine, so the
// counters live in memory: there is no second instance for a shared store to
// synchronise with.
//
// Counters reset when the server restarts. That is an acceptable trade for one
// venue — an attacker cannot force a restart, and a restart mid-attack costs
// them the window they had already burned.

type Window = { count: number; resetAt: number };

// Read directly rather than through getEnv(): the limiter is imported by every
// unauthenticated route and must not couple those to full env validation in
// tests. src/lib/env.ts still validates the value at boot.
const trustProxy = () => process.env.TRUST_PROXY === "1";

const globalForLimiter = globalThis as unknown as { limiterMemory?: Map<string, Window> };
const windows = (globalForLimiter.limiterMemory ??= new Map<string, Window>());

// Bounds memory if a large number of distinct keys is ever seen. Expired
// entries are dropped first, so this only bites under a deliberate flood.
const MAX_KEYS = 10_000;

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

function evictExpired(now: number): void {
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

/**
 * Counts one hit against `key`. Returns allowed=false once `limit` hits have
 * landed inside the current `windowSec` window.
 */
export function rateLimit(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  const namespaced = `rl:${key}`;
  const entry = windows.get(namespaced);

  if (!entry || entry.resetAt <= now) {
    if (windows.size >= MAX_KEYS) evictExpired(now);
    windows.set(namespaced, { count: 1, resetAt: now + windowSec * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
  }

  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

/** Forget one key's window — used to refund a budget after a legitimate success. */
export function clearRateLimit(key: string): void {
  windows.delete(`rl:${key}`);
}

/** Test seam: clear every window. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * Best-effort client IP. "" when it cannot be determined.
 *
 * X-Forwarded-For is client-controlled unless a proxy we run rewrites it.
 * Next fills the header from the socket only when the client sent none, so a
 * client can always plant a first hop. With TRUST_PROXY=1 the proxy has
 * appended the real address as the LAST hop and that is what is read;
 * otherwise the first hop is the best available and every per-IP limit is
 * advisory — which is why the unauthenticated write paths also carry a
 * venue-wide cap that does not depend on the address at all.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return trustProxy() ? hops[hops.length - 1] : hops[0];
  }
  return req.headers.get("x-real-ip")?.trim() || "";
}

/**
 * A budget for writes an anonymous caller can trigger: the per-IP window plus
 * a global one, so a client rotating forged addresses is still bounded by the
 * global cap. Returns true when a write may proceed.
 */
export function writeBudget(
  scope: string,
  ip: string,
  perIp: { limit: number; windowSec: number },
  global: { limit: number; windowSec: number }
): boolean {
  const byIp = rateLimit(`${scope}:ip:${ip || "unknown"}`, perIp.limit, perIp.windowSec).allowed;
  const overall = rateLimit(`${scope}:all`, global.limit, global.windowSec).allowed;
  return byIp && overall;
}
