import { describe, it, expect, vi, beforeEach } from "vitest";

// Desk corrections touch money and the kitchen at the same time: the bill total
// moves, and a ticket may already be on the pass. The rules that matter are
// that the total is never taken from the client, quantities only go down, and
// an order can never be emptied into a zero-item ghost.

const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const itemUpdate = vi.fn();
const editCreate = vi.fn();
const publish = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    order: {
      findFirst: (...a: unknown[]) => orderFindFirst(...a),
      update: (...a: unknown[]) => orderUpdate(...a),
    },
    orderItem: { update: (...a: unknown[]) => itemUpdate(...a) },
    orderEdit: {
      create: (...a: unknown[]) => editCreate(...a),
      findMany: vi.fn(),
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  },
}));
vi.mock("@/lib/bus", () => ({ publish: (...a: unknown[]) => publish(...a) }));

const { editOrder } = await import("@/lib/orderEdit");

const STAFF = { id: "staff_1", name: "Mutfak" };

const line = (id: string, name: string, qty: number, unit: number, voided = false) => ({
  id,
  nameSnapshot: name,
  qty,
  unitPriceKurus: unit,
  voidedAt: voided ? new Date() : null,
});

function order(over: Record<string, unknown> = {}) {
  return {
    id: "order_1",
    venueId: "venue_1",
    sessionId: "sess_1",
    tableId: "table_1",
    status: "accepted",
    deliveries: [],
    items: [line("li_1", "Türk Kahvesi", 2, 9000), line("li_2", "Espresso", 1, 8000)],
    ...over,
  };
}

const edit = (lines: { itemId: string; qty: number }[], o = order()) => {
  orderFindFirst.mockResolvedValue(o);
  return editOrder("order_1", "venue_1", STAFF, { lines });
};

beforeEach(() => {
  vi.clearAllMocks();
  orderUpdate.mockResolvedValue({});
  itemUpdate.mockResolvedValue({});
  editCreate.mockResolvedValue({});
});

describe("re-pricing", () => {
  it("recomputes the total from stored snapshots, not from the client", async () => {
    // 2×9000 + 1×8000 = 26000; reducing the coffee to 1 gives 17000.
    const result = await edit([{ itemId: "li_1", qty: 1 }]);
    expect(result).toMatchObject({ ok: true, totalKurus: 17000 });
    expect(orderUpdate.mock.calls[0][0].data).toEqual({ totalKurus: 17000 });
  });

  it("excludes a voided line from the new total", async () => {
    const result = await edit([{ itemId: "li_1", qty: 0 }]);
    expect(result).toMatchObject({ ok: true, totalKurus: 8000 });
  });

  it("voids rather than deletes, so the history survives", async () => {
    await edit([{ itemId: "li_1", qty: 0 }]);
    const data = itemUpdate.mock.calls[0][0].data;
    expect(data.qty).toBe(0);
    expect(data.voidedAt).toBeInstanceOf(Date);
  });
});

describe("what may be changed", () => {
  it("refuses to increase a quantity — that is a new order", async () => {
    const result = await edit([{ itemId: "li_1", qty: 5 }]);
    expect(result).toEqual({ ok: false, error: "unknown_line" });
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("refuses a line that is not on this order", async () => {
    expect(await edit([{ itemId: "li_999", qty: 1 }])).toEqual({
      ok: false,
      error: "unknown_line",
    });
  });

  it("refuses to revive a line that was already voided", async () => {
    const o = order({ items: [line("li_1", "Kahve", 2, 9000, true), line("li_2", "Espresso", 1, 8000)] });
    expect(await edit([{ itemId: "li_1", qty: 1 }], o)).toEqual({
      ok: false,
      error: "unknown_line",
    });
  });

  it("rejects an edit that changes nothing", async () => {
    expect(await edit([{ itemId: "li_1", qty: 2 }])).toEqual({ ok: false, error: "no_change" });
  });

  it("refuses to empty the order entirely", async () => {
    // An order with no lines is a rejection or a cancellation — both of which
    // carry a reason this path does not.
    const result = await edit([
      { itemId: "li_1", qty: 0 },
      { itemId: "li_2", qty: 0 },
    ]);
    expect(result).toEqual({ ok: false, error: "empties_order" });
    expect(itemUpdate).not.toHaveBeenCalled();
  });
});

describe("which orders are editable", () => {
  for (const status of ["received", "accepted", "preparing", "ready"]) {
    it(`allows editing a ${status} order`, async () => {
      const result = await edit([{ itemId: "li_1", qty: 1 }], order({ status }));
      expect(result).toMatchObject({ ok: true });
    });
  }

  for (const status of ["served", "rejected", "cancelled"]) {
    it(`refuses to edit a ${status} order`, async () => {
      const result = await edit([{ itemId: "li_1", qty: 1 }], order({ status }));
      expect(result).toEqual({ ok: false, error: "not_editable", status });
    });
  }

  it("refuses an order belonging to another venue", async () => {
    orderFindFirst.mockResolvedValue(null);
    expect(await editOrder("order_1", "other_venue", STAFF, { lines: [{ itemId: "li_1", qty: 1 }] }))
      .toEqual({ ok: false, error: "not_found" });
    expect(orderFindFirst.mock.calls[0][0].where.venueId).toBe("other_venue");
  });
});

describe("the kitchen's paper copy", () => {
  it("flags an edit made after a ticket reached the outbox", async () => {
    const o = order({ deliveries: [{ id: "d1" }] });
    const result = await edit([{ itemId: "li_1", qty: 1 }], o);
    expect(result).toMatchObject({ ok: true, afterPrint: true });
  });

  it("does not flag an edit made before anything was sent", async () => {
    const result = await edit([{ itemId: "li_1", qty: 1 }], order({ status: "received" }));
    expect(result).toMatchObject({ ok: true, afterPrint: false });
  });
});

describe("audit trail", () => {
  it("records who changed what, and whether the kitchen already had it", async () => {
    await edit([{ itemId: "li_1", qty: 1 }], order({ deliveries: [{ id: "d1" }] }));
    const data = editCreate.mock.calls[0][0].data;
    expect(data.staffId).toBe("staff_1");
    expect(data.staffName).toBe("Mutfak");
    expect(data.afterPrint).toBe(true);
    expect(JSON.parse(data.changesJson)).toEqual([
      { name: "Türk Kahvesi", fromQty: 2, toQty: 1 },
    ]);
  });

  it("tells the customer's phone and the desk that the order moved", async () => {
    await edit([{ itemId: "li_1", qty: 1 }]);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "order.updated", orderId: "order_1", tableId: "table_1" })
    );
  });

  it("publishes nothing when the edit was refused", async () => {
    await edit([{ itemId: "li_1", qty: 2 }]);
    expect(publish).not.toHaveBeenCalled();
  });
});
