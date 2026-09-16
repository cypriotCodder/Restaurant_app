import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimit, clientIp, writeBudget, resetRateLimits } from "@/lib/rateLimit";

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
  const forwarded = new Request("http://x", {
    headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" },
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it("takes the first hop of x-forwarded-for when exposed directly", () => {
    expect(clientIp(forwarded)).toBe("203.0.113.7");
  });

  it("takes the LAST hop behind a trusted proxy — the one the proxy wrote", () => {
    // A client can plant "203.0.113.7" itself; only the hop Caddy appended is
    // trustworthy, and it is always the last.
    process.env.TRUST_PROXY = "1";
    expect(clientIp(forwarded)).toBe("70.41.3.18");
  });

  it("falls back to x-real-ip, then to empty", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-real-ip": "198.51.100.2" } }))).toBe("198.51.100.2");
    expect(clientIp(new Request("http://x"))).toBe("");
  });
});

describe("writeBudget", () => {
  it("bounds writes globally even when every request claims a new address", () => {
    const perIp = { limit: 5, windowSec: 60 };
    const global = { limit: 8, windowSec: 60 };
    let allowed = 0;
    for (let i = 0; i < 20; i++) {
      if (writeBudget("t", `10.0.0.${i}`, perIp, global)) allowed++;
    }
    expect(allowed).toBe(8);
  });

  it("bounds one address before the global cap is reached", () => {
    const perIp = { limit: 2, windowSec: 60 };
    const global = { limit: 100, windowSec: 60 };
    expect(writeBudget("t", "1.1.1.1", perIp, global)).toBe(true);
    expect(writeBudget("t", "1.1.1.1", perIp, global)).toBe(true);
    expect(writeBudget("t", "1.1.1.1", perIp, global)).toBe(false);
    expect(writeBudget("t", "2.2.2.2", perIp, global)).toBe(true);
  });
});
