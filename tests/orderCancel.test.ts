import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// A customer withdrawing their own order. Two rules carry the weight: it must
// not be possible after the kitchen has taken the order, and one phone must not
// be able to cancel another diner's food — the orders list is a whole-table
// view, so every order at the table is visible to everyone sitting there.

const orderFindFirst = vi.fn();
const orderUpdateMany = vi.fn();
const getActiveSession = vi.fn();
const logAttempt = vi.fn();
const publish = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    order: {
      findFirst: (...a: unknown[]) => orderFindFirst(...a),
      updateMany: (...a: unknown[]) => orderUpdateMany(...a),
    },
  },
}));
vi.mock("@/lib/tableSession", () => ({ getActiveSession: (...a: unknown[]) => getActiveSession(...a) }));
vi.mock("@/lib/attempts", () => ({ logAttempt: (...a: unknown[]) => logAttempt(...a) }));
vi.mock("@/lib/bus", () => ({ publish: (...a: unknown[]) => publish(...a) }));

const { POST } = await import("@/app/api/orders/[id]/cancel/route");

const SESSION = {
  id: "sess_1",
  venueId: "venue_1",
  tableId: "table_1",
  tableCode: "TBL1",
  tableName: "Masa 1",
  visitId: "visit_1",
};

const cancel = (id = "order_1") =>
  POST(new NextRequest(`http://localhost/api/orders/${id}/cancel`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getActiveSession.mockResolvedValue(SESSION);
  orderFindFirst.mockResolvedValue({ id: "order_1", status: "received", visitId: "visit_1" });
  orderUpdateMany.mockResolvedValue({ count: 1 });
});

describe("ownership", () => {
  it("looks the order up scoped to the caller's own session", async () => {
    await cancel();
    // Not by table: one diner must not be able to cancel another's food.
    expect(orderFindFirst.mock.calls[0][0].where).toEqual({ id: "order_1", sessionId: "sess_1" });
  });

  it("404s for an order belonging to another phone at the same table", async () => {
    orderFindFirst.mockResolvedValue(null);
    const res = await cancel();
    expect(res.status).toBe(404);
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it("requires an active table session", async () => {
    getActiveSession.mockResolvedValue(null);
    expect((await cancel()).status).toBe(401);
  });
});

describe("status gate", () => {
  it("cancels an order the kitchen has not taken yet", async () => {
    const res = await cancel();
    expect(res.status).toBe(200);
    expect(orderUpdateMany.mock.calls[0][0].data).toEqual({ status: "cancelled" });
  });

  for (const status of ["accepted", "preparing", "ready", "served"]) {
    it(`refuses once the order is ${status}`, async () => {
      orderFindFirst.mockResolvedValue({ id: "order_1", status, visitId: "visit_1" });
      const res = await cancel();
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "already_accepted", status });
      expect(orderUpdateMany).not.toHaveBeenCalled();
    });
  }

  it("does not re-cancel an already cancelled order", async () => {
    orderFindFirst.mockResolvedValue({ id: "order_1", status: "cancelled", visitId: "visit_1" });
    expect((await cancel()).status).toBe(409);
  });
});

describe("racing the desk", () => {
  it("loses gracefully when the desk accepts in the same moment", async () => {
    // The read saw "received", but the desk's accept committed first, so the
    // conditional update matches nothing. Both must not win.
    orderUpdateMany.mockResolvedValue({ count: 0 });
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "already_accepted" });
  });

  it("guards the update with the status, not just the id", async () => {
    await cancel();
    expect(orderUpdateMany.mock.calls[0][0].where).toEqual({ id: "order_1", status: "received" });
  });
});

describe("side effects", () => {
  it("tells the desk so the order leaves the board immediately", async () => {
    await cancel();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "order.updated", orderId: "order_1", tableId: "table_1" })
    );
  });

  it("records the withdrawal in the attempt ledger", async () => {
    await cancel();
    expect(logAttempt).toHaveBeenCalledWith(
      expect.anything(),
      "customer_cancelled",
      expect.objectContaining({ orderId: "order_1", sessionId: "sess_1" })
    );
  });

  it("publishes nothing when the cancellation was refused", async () => {
    orderFindFirst.mockResolvedValue({ id: "order_1", status: "preparing", visitId: "visit_1" });
    await cancel();
    expect(publish).not.toHaveBeenCalled();
  });
});
