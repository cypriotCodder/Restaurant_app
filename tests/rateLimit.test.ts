import { describe, it, expect, beforeEach, vi } from "vitest";
import { rateLimit, clientIp, resetRateLimits } from "@/lib/rateLimit";

// The limiter is the only thing standing between the staff login and an
// unthrottled bcrypt oracle, so these pin the window arithmetic.

beforeEach(() => {
  // Each test gets a clean window store.
  resetRateLimits();
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows exactly `limit` hits inside the window, then blocks", async () => {
    for (let i = 0; i < 3; i++) {
      expect((rateLimit("k", 3, 60)).allowed).toBe(true);
    }
    const blocked = rateLimit("k", 3, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("counts each key independently", async () => {
    rateLimit("a", 1, 60);
    expect((rateLimit("a", 1, 60)).allowed).toBe(false);
    expect((rateLimit("b", 1, 60)).allowed).toBe(true);
  });

  it("reports the remaining budget as it is consumed", async () => {
    expect((rateLimit("k", 3, 60)).remaining).toBe(2);
    expect((rateLimit("k", 3, 60)).remaining).toBe(1);
    expect((rateLimit("k", 3, 60)).remaining).toBe(0);
  });

  it("starts a fresh window once the old one expires", async () => {
    vi.useFakeTimers();
    rateLimit("k", 1, 60);
    expect((rateLimit("k", 1, 60)).allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect((rateLimit("k", 1, 60)).allowed).toBe(true);
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
