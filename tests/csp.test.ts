import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

// The page policy is what stands between an escaped-but-not-quite string and a
// running <script>. These pin that no page policy ever allows unsafe-inline
// scripts, that each request gets its own nonce, and that Next is handed the
// same nonce it must stamp on its bootstrap.

vi.mock("@/lib/env", () => ({ isSecureOrigin: () => true }));

const { proxy, buildCsp } = await import("@/proxy");

describe("buildCsp", () => {
  it("allows scripts only by nonce in production", () => {
    const csp = buildCsp("abc123", { dev: false, https: true });
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
  });

  it("adds unsafe-eval in development only, for React's debug callstacks", () => {
    expect(buildCsp("n", { dev: true, https: false })).toContain("'unsafe-eval'");
  });

  it("upgrades insecure requests only on an https origin", () => {
    expect(buildCsp("n", { dev: false, https: true })).toContain("upgrade-insecure-requests");
    expect(buildCsp("n", { dev: false, https: false })).not.toContain("upgrade-insecure-requests");
  });

  it("keeps the rest of the policy closed", () => {
    const csp = buildCsp("n", { dev: false, https: true });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("base-uri 'self'");
  });
});

describe("proxy", () => {
  const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']+)'/)?.[1];

  it("sets the same fresh nonce on the response policy and the x-nonce request header", () => {
    const res = proxy(new NextRequest("http://venue.example/t/TBL1"));
    const csp = res.headers.get("content-security-policy");
    const nonce = nonceOf(csp);
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    // NextResponse.next() exposes the overridden request headers with this prefix.
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });

  it("mints a different nonce for every request", () => {
    const a = nonceOf(proxy(new NextRequest("http://venue.example/")).headers.get("content-security-policy"));
    const b = nonceOf(proxy(new NextRequest("http://venue.example/")).headers.get("content-security-policy"));
    expect(a).not.toBe(b);
  });
});
