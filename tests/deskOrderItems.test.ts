import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The desk correction endpoint: validation, status mapping, and the one
// side-effect that matters — an amendment ticket goes to the kitchen only when
// the kitchen already has paper for the order.

const requireStaff = vi.fn();
const editOrder = vi.fn();
const enqueueAmendment = vi.fn();

vi.mock("@/lib/staffAuth", () => ({ requireStaff: (...a: unknown[]) => requireStaff(...a) }));
vi.mock("@/lib/orderEdit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orderEdit")>();
  return { orderEditSchema: actual.orderEditSchema, editOrder: (...a: unknown[]) => editOrder(...a) };
});
vi.mock("@/lib/pos/outbox", () => ({
  enqueueAmendmentInBackground: (...a: unknown[]) => enqueueAmendment(...a),
}));

const { PATCH } = await import("@/app/api/desk/orders/[id]/items/route");

const STAFF = { sub: "staff_1", venueId: "venue_1", role: "desk", name: "Mutfak", ver: 0 };
const CHANGES = [{ name: "Kahve", fromQty: 2, toQty: 1 }];

function patch(body: unknown) {
  return PATCH(
    new NextRequest("http://localhost/api/desk/orders/order_1/items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "order_1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(STAFF);
  editOrder.mockResolvedValue({ ok: true, totalKurus: 9000, changes: CHANGES, afterPrint: false });
});

describe("PATCH /api/desk/orders/[id]/items", () => {
  it("401s without staff", async () => {
    requireStaff.mockResolvedValue(null);
    expect((await patch({ lines: [{ itemId: "li_1", qty: 1 }] })).status).toBe(401);
  });

  it("rejects a malformed body before touching the order", async () => {
    expect((await patch({ lines: [] })).status).toBe(400);
    expect((await patch({ lines: [{ itemId: "li_1", qty: -1 }] })).status).toBe(400);
    expect((await patch({ lines: [{ itemId: "li_1", qty: 1.5 }] })).status).toBe(400);
    expect(editOrder).not.toHaveBeenCalled();
  });

  it("passes the staff identity through for the audit trail", async () => {
    await patch({ lines: [{ itemId: "li_1", qty: 1 }] });
    expect(editOrder).toHaveBeenCalledWith(
      "order_1",
      "venue_1",
      { id: "staff_1", name: "Mutfak" },
      { lines: [{ itemId: "li_1", qty: 1 }] }
    );
  });

  it("sends an amendment ticket only when the kitchen already has paper", async () => {
    await patch({ lines: [{ itemId: "li_1", qty: 1 }] });
    expect(enqueueAmendment).not.toHaveBeenCalled();

    editOrder.mockResolvedValue({ ok: true, totalKurus: 9000, changes: CHANGES, afterPrint: true });
    const res = await patch({ lines: [{ itemId: "li_1", qty: 1 }] });
    expect(enqueueAmendment).toHaveBeenCalledWith("order_1", { changes: CHANGES, byStaff: "Mutfak" });
    expect(await res.json()).toMatchObject({ ok: true, amendmentPrinted: true });
  });

  it("maps edit outcomes to status codes", async () => {
    for (const error of ["not_editable", "unknown_line", "no_change", "empties_order", "conflict"]) {
      editOrder.mockResolvedValue({ ok: false, error });
      const res = await patch({ lines: [{ itemId: "li_1", qty: 1 }] });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(error);
    }
    editOrder.mockResolvedValue({ ok: false, error: "not_found" });
    expect((await patch({ lines: [{ itemId: "li_1", qty: 1 }] })).status).toBe(404);
  });
});
