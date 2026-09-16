import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BusEvent } from "@/lib/bus";

// The customer stream receives every order event in the venue, so its filter is
// what decides how many database reads one order costs: filtering by table from
// the event itself is O(1) per event, filtering inside serialize was O(open
// phones). These pin that the rejection happens before the query.

const orderFindUnique = vi.fn();
const getActiveSession = vi.fn();
const sseResponse = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { order: { findUnique: (...a: unknown[]) => orderFindUnique(...a) } },
}));
vi.mock("@/lib/tableSession", () => ({
  getActiveSession: (...a: unknown[]) => getActiveSession(...a),
}));
vi.mock("@/lib/sse", () => ({
  sseResponse: (...a: unknown[]) => {
    sseResponse(...a);
    return new Response("stream");
  },
}));

const { GET } = await import("@/app/api/session/stream/route");

const SESSION = { id: "sess_1", venueId: "venue_1", tableId: "table_1", tableCode: "TBL1", tableName: "Masa 1" };

const orderEvent = (over: Partial<Extract<BusEvent, { type: "order.created" }>> = {}): BusEvent => ({
  type: "order.created",
  venueId: "venue_1",
  orderId: "order_1",
  sessionId: "sess_9",
  tableId: "table_1",
  ...over,
});

/** Runs the route and hands back the filter/serialize it registered. */
async function handlers() {
  await GET();
  const [filter, serialize] = sseResponse.mock.calls[0] as [
    (e: BusEvent) => boolean,
    (e: BusEvent) => Promise<object | null>,
  ];
  return { filter, serialize };
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveSession.mockResolvedValue(SESSION);
  orderFindUnique.mockResolvedValue({
    id: "order_1",
    tableId: "table_1",
    status: "accepted",
    rejectReason: null,
  });
});

describe("customer stream filter", () => {
  it("accepts an order event for this table", async () => {
    const { filter } = await handlers();
    expect(filter(orderEvent())).toBe(true);
  });

  it("rejects an order event for another table without a database read", async () => {
    const { filter } = await handlers();
    expect(filter(orderEvent({ tableId: "table_2" }))).toBe(false);
    // The filter is the only thing that ran; serialize is never reached, so no
    // query is issued for the other 39 tables' orders.
    expect(orderFindUnique).not.toHaveBeenCalled();
  });

  it("rejects events from another venue", async () => {
    const { filter } = await handlers();
    expect(filter(orderEvent({ venueId: "venue_2" }))).toBe(false);
  });

  it("still passes venue-wide menu changes through", async () => {
    const { filter } = await handlers();
    expect(filter({ type: "menu.changed", venueId: "venue_1" })).toBe(true);
    expect(filter({ type: "menu.changed", venueId: "venue_2" })).toBe(false);
  });

  it("passes a revocation of THIS session and nobody else's", async () => {
    const { filter, serialize } = await handlers();
    const mine = { type: "session.revoked", venueId: "venue_1", sessionId: "sess_1" } as const;
    expect(filter(mine)).toBe(true);
    expect(await serialize(mine)).toEqual({ type: "session.revoked" });
    // Another phone at the same table being ended must not knock this one off.
    expect(filter({ type: "session.revoked", venueId: "venue_1", sessionId: "sess_2" })).toBe(false);
  });
});

describe("customer stream payload", () => {
  it("reads the order once for a relevant event", async () => {
    const { serialize } = await handlers();
    expect(await serialize(orderEvent())).toEqual({
      type: "order.updated",
      orderId: "order_1",
      status: "accepted",
      rejectReason: null,
    });
    expect(orderFindUnique).toHaveBeenCalledTimes(1);
  });

  it("selects only the fields it sends, not the whole order row", async () => {
    const { serialize } = await handlers();
    await serialize(orderEvent());
    expect(orderFindUnique.mock.calls[0][0].select).toBeDefined();
  });

  it("drops the event if the order moved tables since it was published", async () => {
    orderFindUnique.mockResolvedValue({ id: "order_1", tableId: "table_2", status: "accepted", rejectReason: null });
    const { serialize } = await handlers();
    expect(await serialize(orderEvent())).toBeNull();
  });

  it("drops the event if the order no longer exists", async () => {
    orderFindUnique.mockResolvedValue(null);
    const { serialize } = await handlers();
    expect(await serialize(orderEvent())).toBeNull();
  });
});

describe("session guard", () => {
  it("refuses to open a stream without an active table session", async () => {
    getActiveSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(sseResponse).not.toHaveBeenCalled();
  });
});
