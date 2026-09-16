import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Staff login is the one unauthenticated bcrypt oracle in the app. These pin
// the two limiters (per address, per account), the cookie attributes, and that
// a wrong password never leaks whether the address exists.

const loginStaff = vi.fn();

vi.mock("@/lib/staffAuth", () => ({
  loginStaff: (...a: unknown[]) => loginStaff(...a),
  STAFF_COOKIE: "staff_session",
}));
vi.mock("@/lib/env", () => ({ isSecureOrigin: () => true }));

const { POST } = await import("@/app/api/auth/login/route");
const { resetRateLimits } = await import("@/lib/rateLimit");

function login(email: string, password: string, ip = "10.0.0.1") {
  return POST(
    new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email, password }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  loginStaff.mockResolvedValue(null);
});

describe("POST /api/auth/login", () => {
  it("rejects a malformed body", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/auth/login", { method: "POST", body: "not json" })
    );
    expect(res.status).toBe(400);
    expect(loginStaff).not.toHaveBeenCalled();
  });

  it("normalises the address before checking", async () => {
    await login("  Admin@Example.COM ", "pw");
    expect(loginStaff).toHaveBeenCalledWith("admin@example.com", "pw");
  });

  it("answers the same 401 for a wrong password and an unknown address", async () => {
    const a = await login("nobody@example.com", "pw");
    const b = await login("admin@example.com", "wrong");
    expect(a.status).toBe(401);
    expect(await a.json()).toEqual(await b.json());
  });

  it("sets an httpOnly, secure, lax session cookie on success", async () => {
    loginStaff.mockResolvedValue("jwt-token");
    const res = await login("admin@example.com", "pw");
    expect(res.status).toBe(200);
    const cookie = res.cookies.get("staff_session");
    expect(cookie?.value).toBe("jwt-token");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
  });

  it("locks one account after 5 attempts regardless of address", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await login("admin@example.com", "wrong", `10.0.0.${i}`)).status).toBe(401);
    }
    const res = await login("admin@example.com", "wrong", "10.0.0.99");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    // Locked before the bcrypt compare, so the oracle is not consulted.
    expect(loginStaff).toHaveBeenCalledTimes(5);
  });

  it("locks one address after 10 attempts across accounts", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await login(`user${i}@example.com`, "wrong")).status).toBe(401);
    }
    expect((await login("user99@example.com", "wrong")).status).toBe(429);
  });

  it("keeps a second address working while the first is locked", async () => {
    for (let i = 0; i < 11; i++) await login(`user${i}@example.com`, "wrong", "10.0.0.1");
    expect((await login("fresh@example.com", "wrong", "10.0.0.2")).status).toBe(401);
  });
});
