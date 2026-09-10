import Redis from "ioredis";

// Fixed-window rate limiter for endpoints that are not otherwise throttled by
// the table-session rules — principally staff login, which is an unauthenticated
// bcrypt oracle and the one abuse path the session design does not cover.
//
// Backed by Redis so the limit holds across serverless instances. With
// REDIS_URL unset (tests, CI, a bare local run) it degrades to a per-process
// in-memory window rather than failing, matching how src/lib/bus.ts behaves.

const globalForLimiter = globalThis as unknown as {
  limiterRedis?: Redis;
  limiterMemory?: Map<string, { count: number; resetAt: number }>;
};

const redisUrl = process.env.REDIS_URL;

function client(): Redis {
  return (globalForLimiter.limiterRedis ??= (() => {
    const c = new Redis(redisUrl!, { maxRetriesPerRequest: 2, lazyConnect: true });
    c.on("error", (err) => console.error("ratelimit redis:", err.message));
    return c;
  })());
}

function memory(): Map<string, { count: number; resetAt: number }> {
  return (globalForLimiter.limiterMemory ??= new Map());
}

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSec: number };

/**
 * Counts one hit against `key`. Returns allowed=false once `limit` hits have
 * landed inside the current `windowSec` window.
 *
 * Fails OPEN: if Redis is unreachable the request is allowed through, because
 * losing the cache must not lock every staff member out of the desk mid-service.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  const namespaced = `rl:${key}`;

  if (!redisUrl) {
    const now = Date.now();
    const entry = memory().get(namespaced);
    if (!entry || entry.resetAt <= now) {
      memory().set(namespaced, { count: 1, resetAt: now + windowSec * 1000 });
      return { allowed: true, remaining: limit - 1, retryAfterSec: 0 };
    }
    entry.count += 1;
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSec,
    };
  }

  try {
    const c = client();
    // INCR then EXPIRE-on-first-hit is the standard fixed window: the TTL is
    // set only when the counter is created, so the window does not slide.
    const count = await c.incr(namespaced);
    if (count === 1) await c.expire(namespaced, windowSec);
    const ttl = count === 1 ? windowSec : await c.ttl(namespaced);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSec: ttl > 0 ? ttl : windowSec,
    };
  } catch (err) {
    console.error("ratelimit failed open:", (err as Error).message);
    return { allowed: true, remaining: limit, retryAfterSec: 0 };
  }
}

/** Best-effort client IP from the proxy chain; "" when it cannot be determined. */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    ""
  );
}
