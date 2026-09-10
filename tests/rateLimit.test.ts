import { describe, it, expect, beforeEach, vi } from "vitest";
import { rateLimit, clientIp } from "@/lib/rateLimit";

// These exercise the in-memory fallback path (REDIS_URL is unset under vitest),
// which is the same window arithmetic the Redis path implements with INCR/EXPIRE.

beforeEach(() => {
  // Each test gets a clean window store.
  (globalThis as { limiterMemory?: unknown }).limiterMemory = undefined;
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows exactly `limit` hits inside the window, then blocks", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await rateLimit("k", 3, 60)).allowed).toBe(true);
    }
    const blocked = await rateLimit("k", 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("counts each key independently", async () => {
    await rateLimit("a", 1, 60);
    expect((await rateLimit("a", 1, 60)).allowed).toBe(false);
    expect((await rateLimit("b", 1, 60)).allowed).toBe(true);
  });

  it("reports the remaining budget as it is consumed", async () => {
    expect((await rateLimit("k", 3, 60)).remaining).toBe(2);
    expect((await rateLimit("k", 3, 60)).remaining).toBe(1);
    expect((await rateLimit("k", 3, 60)).remaining).toBe(0);
  });

  it("starts a fresh window once the old one expires", async () => {
    vi.useFakeTimers();
    await rateLimit("k", 1, 60);
    expect((await rateLimit("k", 1, 60)).allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect((await rateLimit("k", 1, 60)).allowed).toBe(true);
  });
});

describe("clientIp", () => {
  it("takes the first hop of x-forwarded-for", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" },
    });
    expect(clientIp(req)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip, then to empty", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "198.51.100.2" } }))).toBe("198.51.100.2");
    expect(clientIp(new Request("http://x"))).toBe("");
  });
});
