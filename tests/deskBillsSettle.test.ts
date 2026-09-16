import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The only endpoint that records money. These pin its input contract and the
// mapping from settlement outcomes to status codes the desk relies on.

const requireStaff = vi.fn();
const settleVisit = vi.fn();

vi.mock("@/lib/staffAuth", () => ({ requireStaff: (...a: unknown[]) => requireStaff(...a) }));
vi.mock("@/lib/visit", () => ({ settleVisit: (...a: unknown[]) => settleVisit(...a) }));

const { POST } = await import("@/app/api/desk/bills/[id]/settle/route");

const STAFF = { sub: "staff_1", venueId: "venue_1", role: "desk", name: "Kasa", ver: 0 };

function settle(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/desk/bills/visit_1/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "visit_1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(STAFF);
  settleVisit.mockResolvedValue({ ok: true, totalKurus: 42000 });
});

describe("POST /api/desk/bills/[id]/settle", () => {
  it("401s without staff", async () => {
    requireStaff.mockResolvedValue(null);
    expect((await settle({ paymentMethod: "cash" })).status).toBe(401);
    expect(settleVisit).not.toHaveBeenCalled();
  });

  it("rejects an unknown payment method", async () => {
    expect((await settle({ paymentMethod: "crypto" })).status).toBe(400);
    expect(settleVisit).not.toHaveBeenCalled();
  });

  it("rejects a negative or fractional paid amount", async () => {
    expect((await settle({ paymentMethod: "cash", paidAmountKurus: -1 })).status).toBe(400);
    expect((await settle({ paymentMethod: "cash", paidAmountKurus: 10.5 })).status).toBe(400);
  });

  it("passes the staff id, venue and override through", async () => {
    await settle({ paymentMethod: "card", paidAmountKurus: 40000, force: true });
    expect(settleVisit).toHaveBeenCalledWith("visit_1", "venue_1", {
      paymentMethod: "card",
      paidAmountKurus: 40000,
      staffId: "staff_1",
      force: true,
    });
  });

  it("returns the settled total", async () => {
    const res = await settle({ paymentMethod: "cash" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, totalKurus: 42000 });
  });

  it("maps outcomes to the codes the desk keys its messages on", async () => {
    settleVisit.mockResolvedValue({ ok: false, error: "orders_in_flight" });
    expect((await settle({ paymentMethod: "cash" })).status).toBe(409);
    settleVisit.mockResolvedValue({ ok: false, error: "already_closed" });
    expect((await settle({ paymentMethod: "cash" })).status).toBe(409);
    settleVisit.mockResolvedValue({ ok: false, error: "not_found" });
    expect((await settle({ paymentMethod: "cash" })).status).toBe(404);
  });
});
