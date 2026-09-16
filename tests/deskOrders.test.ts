import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The desk's status transitions are what decide when a ticket reaches the
// kitchen printer and when a customer may no longer cancel. These pin the
// allowed graph, the venue scoping, and that acceptance — and only acceptance —
// queues a POS delivery.

const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const requireStaff = vi.fn();
const enqueue = vi.fn();
const publish = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    order: {
      findFirst: (...a: unknown[]) => orderFindFirst(...a),
      update: (...a: unknown[]) => orderUpdate(...a),
    },
  },
}));
vi.mock("@/lib/staffAuth", () => ({ requireStaff: (...a: unknown[]) => requireStaff(...a) }));
vi.mock("@/lib/pos/outbox", () => ({ enqueuePosDeliveryInBackground: (...a: unknown[]) => enqueue(...a) }));
vi.mock("@/lib/bus", () => ({ publish: (...a: unknown[]) => publish(...a) }));

const { PATCH } = await import("@/app/api/desk/orders/[id]/route");

const STAFF = { sub: "staff_1", venueId: "venue_1", role: "desk", name: "Mutfak", ver: 0 };

function patch(body: unknown, id = "order_1") {
  return PATCH(
    new NextRequest(`http://localhost/api/desk/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(STAFF);
  orderFindFirst.mockResolvedValue({ id: "order_1", status: "received", sessionId: "s1", tableId: "t1" });
  orderUpdate.mockImplementation(async ({ data }: { data: { status: string } }) => ({
    id: "order_1",
    status: data.status,
    sessionId: "s1",
    tableId: "t1",
  }));
});

describe("auth and scoping", () => {
  it("401s without a staff session", async () => {
    requireStaff.mockResolvedValue(null);
    expect((await patch({ status: "accepted" })).status).toBe(401);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("only finds orders in the staff member's venue", async () => {
    orderFindFirst.mockResolvedValue(null);
    expect((await patch({ status: "accepted" })).status).toBe(404);
    expect(orderFindFirst.mock.calls[0][0].where).toEqual({ id: "order_1", venueId: "venue_1" });
  });
});

describe("transition graph", () => {
  const allowed: [string, string][] = [
    ["received", "accepted"],
    ["received", "rejected"],
    ["accepted", "preparing"],
    ["accepted", "ready"],
    ["preparing", "ready"],
    ["ready", "served"],
  ];
  for (const [from, to] of allowed) {
    it(`allows ${from} → ${to}`, async () => {
      orderFindFirst.mockResolvedValue({ id: "order_1", status: from, sessionId: "s1", tableId: "t1" });
      const res = await patch({ status: to, rejectReason: to === "rejected" ? "Stokta yok" : undefined });
      expect(res.status).toBe(200);
      expect(orderUpdate.mock.calls[0][0].data.status).toBe(to);
    });
  }

  const refused: [string, string][] = [
    ["received", "served"],
    ["ready", "accepted"],
    ["served", "ready"],
    ["rejected", "accepted"],
    ["cancelled", "accepted"],
    ["received", "cancelled"],
  ];
  for (const [from, to] of refused) {
    it(`refuses ${from} → ${to}`, async () => {
      orderFindFirst.mockResolvedValue({ id: "order_1", status: from, sessionId: "s1", tableId: "t1" });
      const res = await patch({ status: to, rejectReason: "x" });
      expect(res.status).toBe(409);
      expect(orderUpdate).not.toHaveBeenCalled();
    });
  }

  it("requires a reason to reject", async () => {
    expect((await patch({ status: "rejected" })).status).toBe(400);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("clears the reject reason on every other transition", async () => {
    await patch({ status: "accepted", rejectReason: "stale" });
    expect(orderUpdate.mock.calls[0][0].data.rejectReason).toBeNull();
  });
});

describe("kitchen handoff", () => {
  it("queues the POS ticket on acceptance", async () => {
    await patch({ status: "accepted" });
    expect(enqueue).toHaveBeenCalledWith("order_1");
  });

  it("does not queue a ticket on any other transition", async () => {
    orderFindFirst.mockResolvedValue({ id: "order_1", status: "accepted", sessionId: "s1", tableId: "t1" });
    await patch({ status: "preparing" });
    await patch({ status: "ready" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("tells the phone and the board", async () => {
    await patch({ status: "accepted" });
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "order.updated", orderId: "order_1", sessionId: "s1", tableId: "t1" })
    );
  });
});
