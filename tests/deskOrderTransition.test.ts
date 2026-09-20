import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Staff moving an order through its lifecycle. The rule that costs real money
// is acceptance: it is the POS handoff point, so an order accepted twice is a
// ticket printed twice and food cooked twice. Two desk devices watching the
// same board — or one double-tap on a slow link — are the way that happens.

const orderFindFirst = vi.fn();
const orderUpdateMany = vi.fn();
const requireStaff = vi.fn();
const publish = vi.fn();
const enqueue = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    order: {
      findFirst: (...a: unknown[]) => orderFindFirst(...a),
      updateMany: (...a: unknown[]) => orderUpdateMany(...a),
    },
  },
}));
vi.mock("@/lib/staffAuth", () => ({ requireStaff: (...a: unknown[]) => requireStaff(...a) }));
vi.mock("@/lib/bus", () => ({ publish: (...a: unknown[]) => publish(...a) }));
vi.mock("@/lib/pos/outbox", () => ({
  enqueuePosDeliveryInBackground: (...a: unknown[]) => enqueue(...a),
}));

const { PATCH } = await import("@/app/api/desk/orders/[id]/route");

const STAFF = { sub: "staff_1", venueId: "venue_1", role: "desk", name: "Ayşe", ver: 1 };
const ORDER = {
  id: "order_1",
  venueId: "venue_1",
  sessionId: "sess_1",
  tableId: "table_1",
  status: "received",
};

const patch = (body: unknown, id = "order_1") =>
  PATCH(
    new NextRequest(`http://localhost/api/desk/orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(STAFF);
  orderFindFirst.mockResolvedValue(ORDER);
  orderUpdateMany.mockResolvedValue({ count: 1 });
});

describe("desk order transitions", () => {
  it("accepts a received order and enqueues exactly one ticket", async () => {
    const res = await patch({ status: "accepted" });
    expect(res.status).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith("order_1");
  });

  it("scopes the write to the status it read, so a concurrent accept cannot also win", async () => {
    await patch({ status: "accepted" });
    expect(orderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "order_1", status: "received" } })
    );
  });

  it("does not enqueue a second ticket when another device accepted first", async () => {
    // The row was already moved out of `received` between our read and write.
    orderUpdateMany.mockResolvedValue({ count: 0 });
    orderFindFirst.mockResolvedValueOnce(ORDER).mockResolvedValueOnce({ status: "accepted" });

    const res = await patch({ status: "accepted" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "invalid_transition", from: "accepted" });
    expect(enqueue).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a transition the lifecycle does not allow", async () => {
    orderFindFirst.mockResolvedValue({ ...ORDER, status: "served" });
    const res = await patch({ status: "accepted" });
    expect(res.status).toBe(409);
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("requires a reason to reject", async () => {
    const res = await patch({ status: "rejected" });
    expect(res.status).toBe(400);
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });

  it("does not enqueue for transitions other than acceptance", async () => {
    orderFindFirst.mockResolvedValue({ ...ORDER, status: "accepted" });
    const res = await patch({ status: "preparing" });
    expect(res.status).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    requireStaff.mockResolvedValue(null);
    const res = await patch({ status: "accepted" });
    expect(res.status).toBe(401);
    expect(orderUpdateMany).not.toHaveBeenCalled();
  });
});
