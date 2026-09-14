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
 * Best-effort client IP. Behind the venue's reverse proxy this is the
 * X-Forwarded-For the proxy sets; "" when it cannot be determined.
 */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    ""
  );
}
