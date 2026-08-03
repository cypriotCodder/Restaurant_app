import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The order route's rate limits are the last line of the anti-abuse design:
// even with a live session, a script must not be able to flood the kitchen.
// Everything below the limit check (pricing, the transaction, the POS outbox)
// is mocked out so these assertions are about the limits alone.

const orderCount = vi.fn();
const menuItemFindMany = vi.fn();
const orderCreate = vi.fn();
const orderFindFirst = vi.fn();
const getActiveSession = vi.fn();
const logAttempt = vi.fn();
const publish = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    order: {
      count: (...a: unknown[]) => orderCount(...a),
      findFirst: (...a: unknown[]) => orderFindFirst(...a),
      create: (...a: unknown[]) => orderCreate(...a),
    },
    menuItem: { findMany: (...a: unknown[]) => menuItemFindMany(...a) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        order: {
          findFirst: (...a: unknown[]) => orderFindFirst(...a),
          create: (...a: unknown[]) => orderCreate(...a),
        },
      }),
  },
}));
vi.mock("@/lib/tableSession", () => ({
  getActiveSession: (...a: unknown[]) => getActiveSession(...a),
}));
vi.mock("@/lib/attempts", () => ({ logAttempt: (...a: unknown[]) => logAttempt(...a) }));
vi.mock("@/lib/bus", () => ({ publish: (...a: unknown[]) => publish(...a) }));

const { POST } = await import("@/app/api/orders/route");

const SESSION = { id: "sess_1", venueId: "venue_1", tableId: "table_1", tableCode: "TBL1", tableName: "Masa 1" };

function request(body: unknown) {
  return new NextRequest("http://localhost/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ONE_ITEM = { items: [{ itemId: "item_1", qty: 1 }] };

/** recent = orders by this session in the window; open = unfinished at table. */
function counts(recent: number, open: number) {
  orderCount.mockReset();
  orderCount.mockResolvedValueOnce(recent).mockResolvedValueOnce(open);
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveSession.mockResolvedValue(SESSION);
  menuItemFindMany.mockResolvedValue([
    { id: "item_1", nameTr: "Espresso", priceKurus: 8000, available: true, modifierGroups: [] },
  ]);
  orderFindFirst.mockResolvedValue({ number: 41 });
  orderCreate.mockResolvedValue({ id: "order_1", number: 42 });
});

describe("session guard", () => {
  it("rejects an order with no active session and logs the attempt", async () => {
    getActiveSession.mockResolvedValue(null);
    const res = await POST(request(ONE_ITEM));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "no_session" });
    expect(logAttempt).toHaveBeenCalledWith(expect.anything(), "expired_session");
    expect(orderCreate).not.toHaveBeenCalled();
  });
});

describe("per-session rate limit (5 orders / 10 min)", () => {
  it("allows the 5th order in the window", async () => {
    counts(4, 0);
    const res = await POST(request(ONE_ITEM));
    expect(res.status).toBe(200);
    expect(orderCreate).toHaveBeenCalled();
  });

  it("blocks the 6th order in the window with 429", async () => {
    counts(5, 0);
    const res = await POST(request(ONE_ITEM));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("records the rate_limited outcome in the abuse ledger", async () => {
    counts(5, 0);
    await POST(request(ONE_ITEM));
    expect(logAttempt).toHaveBeenCalledWith(
      expect.anything(),
      "rate_limited",
      expect.objectContaining({ sessionId: "sess_1", tableId: "table_1", venueId: "venue_1" })
    );
  });

  it("counts only orders inside the 10 minute window", async () => {
    counts(0, 0);
    await POST(request(ONE_ITEM));
    const where = orderCount.mock.calls[0][0].where;
    expect(where.sessionId).toBe("sess_1");
    const windowStart = where.createdAt.gt.getTime();
    expect(Date.now() - windowStart).toBeGreaterThan(9 * 60 * 1000);
    expect(Date.now() - windowStart).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
  });
});

describe("per-table open-order limit (10 unfinished)", () => {
  it("allows a 10th open order", async () => {
    counts(0, 9);
    expect((await POST(request(ONE_ITEM))).status).toBe(200);
  });

  it("blocks once 10 orders are already open at the table", async () => {
    counts(0, 10);
    const res = await POST(request(ONE_ITEM));
    expect(res.status).toBe(429);
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("counts open orders across the whole table, not just this session", async () => {
    counts(0, 0);
    await POST(request(ONE_ITEM));
    const where = orderCount.mock.calls[1][0].where;
    expect(where.tableId).toBe("table_1");
    expect(where.sessionId).toBeUndefined();
    expect(where.status.in).toEqual(["received", "accepted", "preparing", "ready"]);
  });
});

describe("payload validation", () => {
  it("rejects an empty basket", async () => {
    counts(0, 0);
    expect((await POST(request({ items: [] }))).status).toBe(400);
  });

  it("rejects more than 30 lines in one order", async () => {
    counts(0, 0);
    const items = Array.from({ length: 31 }, () => ({ itemId: "item_1", qty: 1 }));
    expect((await POST(request({ items }))).status).toBe(400);
  });

  it("rejects a quantity above the per-line maximum", async () => {
    counts(0, 0);
    expect((await POST(request({ items: [{ itemId: "item_1", qty: 21 }] }))).status).toBe(400);
  });
});

describe("successful order", () => {
  it("publishes order.created only after the write commits", async () => {
    counts(0, 0);
    const res = await POST(request(ONE_ITEM));
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith({
      type: "order.created",
      venueId: "venue_1",
      orderId: "order_1",
      sessionId: "sess_1",
    });
  });

  it("prices server-side from the live menu, ignoring any client-sent price", async () => {
    counts(0, 0);
    await POST(request({ items: [{ itemId: "item_1", qty: 3, priceKurus: 1 }] }));
    expect(orderCreate.mock.calls[0][0].data.totalKurus).toBe(24000);
  });
});
