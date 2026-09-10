import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// A double-tapped "Submit Order" on a laggy connection used to place two
// separate orders. These cover the replay path: same key, one order.

const orderCount = vi.fn();
const menuItemFindMany = vi.fn();
const orderCreate = vi.fn();
const orderFindFirst = vi.fn();
const orderFindFirstOrThrow = vi.fn();
const getActiveSession = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    order: {
      count: (...a: unknown[]) => orderCount(...a),
      findFirst: (...a: unknown[]) => orderFindFirst(...a),
      findFirstOrThrow: (...a: unknown[]) => orderFindFirstOrThrow(...a),
      create: (...a: unknown[]) => orderCreate(...a),
    },
    menuItem: { findMany: (...a: unknown[]) => menuItemFindMany(...a) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        order: {
          findFirst: async () => ({ number: 41 }),
          create: (...a: unknown[]) => orderCreate(...a),
        },
      }),
  },
}));
vi.mock("@/lib/tableSession", () => ({ getActiveSession: (...a: unknown[]) => getActiveSession(...a) }));
vi.mock("@/lib/attempts", () => ({ logAttempt: vi.fn() }));
vi.mock("@/lib/bus", () => ({ publish: vi.fn() }));

const { POST } = await import("@/app/api/orders/route");

const SESSION = { id: "sess_1", venueId: "venue_1", tableId: "table_1", tableCode: "TBL1", tableName: "Masa 1" };
const KEY = "5f1c9b2a-double-tap-key";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const submission = (key?: string) => ({
  items: [{ itemId: "item_1", qty: 1 }],
  ...(key ? { idempotencyKey: key } : {}),
});

/** Prisma's unique-violation shape for the given index columns. */
const p2002 = (target: string[]) => Object.assign(new Error("unique"), { code: "P2002", meta: { target } });

beforeEach(() => {
  vi.clearAllMocks();
  getActiveSession.mockResolvedValue(SESSION);
  orderCount.mockResolvedValue(0);
  menuItemFindMany.mockResolvedValue([
    { id: "item_1", nameTr: "Espresso", priceKurus: 8000, available: true, modifierGroups: [] },
  ]);
  orderFindFirst.mockResolvedValue(null);
  orderCreate.mockResolvedValue({ id: "order_1", number: 42 });
});

describe("order idempotency", () => {
  it("creates the order normally on the first submission", async () => {
    const res = await POST(request(submission(KEY)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orderId: "order_1", number: 42 });
    expect(orderCreate).toHaveBeenCalledTimes(1);
    // The key is persisted, or the replay lookup could never match.
    expect(orderCreate.mock.calls[0][0].data.idempotencyKey).toBe(KEY);
  });

  it("returns the existing order instead of creating a second one", async () => {
    orderFindFirst.mockResolvedValue({ id: "order_1", number: 42 });
    const res = await POST(request(submission(KEY)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orderId: "order_1", number: 42, replayed: true });
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it("scopes the replay lookup to the submitting session", async () => {
    await POST(request(submission(KEY)));
    expect(orderFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: "sess_1", idempotencyKey: KEY } })
    );
  });

  it("resolves a simultaneous double-tap that both got past the replay check", async () => {
    // Both requests read "no existing order", both insert, one loses the race.
    orderCreate.mockRejectedValueOnce(p2002(["sessionId", "idempotencyKey"]));
    orderFindFirstOrThrow.mockResolvedValue({ id: "order_1", number: 42 });

    const res = await POST(request(submission(KEY)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, orderId: "order_1", number: 42 });
    expect(orderFindFirstOrThrow).toHaveBeenCalled();
  });

  it("does not mistake an idempotency conflict for a ticket-number conflict", async () => {
    // A number conflict retries against a fresh max; an idempotency conflict
    // must not, or the double-tap would still create a second order.
    orderCreate.mockRejectedValueOnce(p2002(["sessionId", "idempotencyKey"]));
    orderFindFirstOrThrow.mockResolvedValue({ id: "order_1", number: 42 });
    await POST(request(submission(KEY)));
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it("still retries a genuine ticket-number collision", async () => {
    orderCreate
      .mockRejectedValueOnce(p2002(["venueId", "number"]))
      .mockResolvedValueOnce({ id: "order_2", number: 43 });
    const res = await POST(request(submission(KEY)));
    expect(res.status).toBe(200);
    expect(orderCreate).toHaveBeenCalledTimes(2);
  });

  it("accepts a submission with no key at all (older cached client)", async () => {
    const res = await POST(request(submission()));
    expect(res.status).toBe(200);
    expect(orderFindFirst).not.toHaveBeenCalled();
    expect(orderCreate.mock.calls[0][0].data.idempotencyKey).toBeUndefined();
  });
});
