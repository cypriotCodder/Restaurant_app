import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// /scan is the only unauthenticated write path in the app: every attempt used
// to append an OrderAttempt row with no limit, so a loop on this URL would fill
// the venue's single disk.
//
// The signature is not brute-forceable (144 bits), so these limits exist to
// bound writes — and, critically, must not lock out a busy restaurant, where
// every customer shares one NAT'd public IP.

const tableFindUnique = vi.fn();
const logAttempt = vi.fn();
const mintSession = vi.fn();
const verifyTableQr = vi.fn();

vi.mock("@/lib/db", () => ({ db: { table: { findUnique: (...a: unknown[]) => tableFindUnique(...a) } } }));
vi.mock("@/lib/attempts", () => ({ logAttempt: (...a: unknown[]) => logAttempt(...a) }));
vi.mock("@/lib/tableSession", () => ({
  mintSession: (...a: unknown[]) => mintSession(...a),
  SESSION_COOKIE: "table_session",
}));
vi.mock("@/lib/qr", () => ({ verifyTableQr: (...a: unknown[]) => verifyTableQr(...a) }));
vi.mock("@/lib/env", () => ({
  isSecureOrigin: () => false,
  // Redirects are built against the venue origin, not req.url.
  baseUrl: () => "http://venue.example",
}));

const { GET } = await import("@/app/scan/[code]/route");
const { resetRateLimits } = await import("@/lib/rateLimit");

const TABLE = {
  id: "table_1",
  code: "TBL1",
  venueId: "venue_1",
  qrVersion: 1,
  active: true,
  venue: { qrSecret: "secret" },
};

function scan(ip: string, sig = "badsig") {
  return GET(
    new NextRequest(`http://localhost/scan/TBL1?k=${sig}`, { headers: { "x-forwarded-for": ip } }),
    { params: Promise.resolve({ code: "TBL1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  tableFindUnique.mockResolvedValue(TABLE);
  mintSession.mockResolvedValue("tok_1");
  verifyTableQr.mockReturnValue(false);
});

describe("failed scans", () => {
  it("logs each failure up to the limit", async () => {
    for (let i = 0; i < 20; i++) await scan("10.0.0.1");
    expect(logAttempt).toHaveBeenCalledTimes(20);
    expect(logAttempt.mock.calls.every((c) => c[1] === "invalid_qr")).toBe(true);
  });

  it("stops writing ledger rows once an IP is flooding", async () => {
    for (let i = 0; i < 20; i++) await scan("10.0.0.1");
    logAttempt.mockClear();

    for (let i = 0; i < 50; i++) await scan("10.0.0.1");
    // Exactly one row recording the flood, not fifty.
    expect(logAttempt).toHaveBeenCalledTimes(1);
    expect(logAttempt.mock.calls[0][1]).toBe("rate_limited");
  });

  it("stops querying the database once an IP is blocked", async () => {
    for (let i = 0; i < 20; i++) await scan("10.0.0.1");
    tableFindUnique.mockClear();
    for (let i = 0; i < 10; i++) await scan("10.0.0.1");
    // A flood must cost neither a row nor a query.
    expect(tableFindUnique).not.toHaveBeenCalled();
  });

  it("still shows the re-scan wall rather than an error", async () => {
    for (let i = 0; i < 25; i++) await scan("10.0.0.1");
    const res = await scan("10.0.0.1");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("err=invalid");
  });

  it("counts each IP separately", async () => {
    for (let i = 0; i < 20; i++) await scan("10.0.0.1");
    tableFindUnique.mockClear();
    await scan("10.0.0.2");
    // A second attacker's budget is their own — and so is a second venue's.
    expect(tableFindUnique).toHaveBeenCalled();
  });
});

describe("successful scans", () => {
  beforeEach(() => verifyTableQr.mockReturnValue(true));

  it("does not lock out a restaurant sharing one NAT'd IP", async () => {
    // 60 covers each scanning twice is an ordinary evening, and every one of
    // them arrives from the same public address.
    for (let i = 0; i < 120; i++) {
      const res = await scan("203.0.113.9", "goodsig");
      expect(res.headers.get("location")).not.toContain("err=invalid");
    }
    expect(mintSession).toHaveBeenCalledTimes(120);
  });

  it("sets the session cookie on success", async () => {
    const res = await scan("203.0.113.9", "goodsig");
    expect(res.cookies.get("table_session")?.value).toBe("tok_1");
  });

  it("redirects to the venue origin, not the address the server is bound to", async () => {
    // Next reconstructs req.url from the bind address, so a redirect built from
    // it yields localhost/0.0.0.0 — which a customer's phone resolves against
    // ITSELF. The page never loads and it looks like a broken QR code.
    const res = await scan("203.0.113.9", "goodsig");
    expect(res.headers.get("location")).toBe("http://venue.example/t/TBL1");
  });

  it("refunds the failure budget after a valid scan", async () => {
    // A party whose QR was regenerated mid-meal fails several times before
    // someone reprints the card; once they scan the right one they must not
    // still be sitting on a spent budget.
    verifyTableQr.mockReturnValue(false);
    for (let i = 0; i < 19; i++) await scan("10.0.0.5");

    verifyTableQr.mockReturnValue(true);
    await scan("10.0.0.5", "goodsig");

    verifyTableQr.mockReturnValue(false);
    tableFindUnique.mockClear();
    await scan("10.0.0.5");
    // Budget was reset, so this still reaches the lookup rather than the wall.
    expect(tableFindUnique).toHaveBeenCalled();
  });
});

describe("unknown and inactive tables", () => {
  it("walls an unknown code and counts it against the failure budget", async () => {
    tableFindUnique.mockResolvedValue(null);
    const res = await scan("10.0.0.7");
    expect(res.headers.get("location")).toContain("err=invalid");
    expect(logAttempt.mock.calls[0][1]).toBe("table_inactive");
  });

  it("walls a deactivated table", async () => {
    tableFindUnique.mockResolvedValue({ ...TABLE, active: false });
    verifyTableQr.mockReturnValue(true);
    const res = await scan("10.0.0.8", "goodsig");
    expect(res.headers.get("location")).toContain("err=invalid");
    expect(mintSession).not.toHaveBeenCalled();
  });
});
