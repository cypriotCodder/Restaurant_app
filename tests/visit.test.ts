import { describe, it, expect, vi, beforeEach } from "vitest";

// The visit is what a bill covers, and settling one is the only place in the
// app that records money. These pin the rules that protect it: rejected orders
// never appear on a bill, a table with food still cooking is not closed by
// accident, and settling revokes the party's phones so the next group starts
// clean.

const visitFindFirst = vi.fn();
const visitFindMany = vi.fn();
const visitFindUnique = vi.fn();
const visitCreate = vi.fn();
const visitUpdate = vi.fn();
const visitDelete = vi.fn();
const orderCount = vi.fn();
const orderUpdateMany = vi.fn();
const sessionUpdateMany = vi.fn();
const publish = vi.fn();

vi.mock("@/lib/db", () => {
  // Settlement runs in an interactive transaction whose client is the same
  // set of mocks, so assertions read the same spies either way. The
  // conditional close (updateMany) is routed to `visitUpdate` so the settle
  // tests keep reading its data.
  const client = {
    tableVisit: {
      findFirst: (...a: unknown[]) => visitFindFirst(...a),
      findMany: (...a: unknown[]) => visitFindMany(...a),
      findUnique: (...a: unknown[]) => visitFindUnique(...a),
      create: (...a: unknown[]) => visitCreate(...a),
      update: (...a: unknown[]) => visitUpdate(...a),
      updateMany: (...a: unknown[]) => visitUpdate(...a),
      delete: (...a: unknown[]) => visitDelete(...a),
    },
    order: {
      count: (...a: unknown[]) => orderCount(...a),
      updateMany: (...a: unknown[]) => orderUpdateMany(...a),
    },
    tableSession: { updateMany: (...a: unknown[]) => sessionUpdateMany(...a) },
    $transaction: async (arg: unknown) =>
      typeof arg === "function" ? arg(client) : Promise.all(arg as Promise<unknown>[]),
  };
  return { db: client };
});
vi.mock("@/lib/bus", () => ({ publish: (...a: unknown[]) => publish(...a) }));

const { openOrJoinVisit, buildBill, settleVisit, requestBill, closeAbandonedVisits, ABANDON_AFTER_MS } =
  await import("@/lib/visit");

const item = (name: string, qty: number, unit: number, note = "") => ({
  nameSnapshot: name,
  qty,
  unitPriceKurus: unit,
  note,
  modifiersJson: "[]",
});

function visitWithOrders(orders: unknown[]) {
  return {
    id: "visit_1",
    tableId: "table_1",
    status: "open",
    openedAt: new Date(),
    billRequestedAt: null,
    table: { id: "table_1", name: "Masa 3" },
    orders,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  visitUpdate.mockResolvedValue({ count: 1 });
  orderUpdateMany.mockResolvedValue({ count: 0 });
  sessionUpdateMany.mockResolvedValue({ count: 0 });
  orderCount.mockResolvedValue(0);
});

describe("openOrJoinVisit", () => {
  it("joins the party already at the table rather than starting a second one", async () => {
    visitFindFirst.mockResolvedValue({ id: "visit_existing" });
    expect(await openOrJoinVisit("table_1", "venue_1")).toBe("visit_existing");
    expect(visitCreate).not.toHaveBeenCalled();
  });

  it("treats a table that has asked for the bill as still occupied", async () => {
    visitFindFirst.mockResolvedValue({ id: "visit_existing" });
    await openOrJoinVisit("table_1", "venue_1");
    const where = visitFindFirst.mock.calls[0][0].where;
    expect(where.status.in).toEqual(["open", "bill_requested"]);
  });

  it("opens a visit when the table is idle", async () => {
    visitFindFirst.mockResolvedValue(null);
    visitCreate.mockResolvedValue({ id: "visit_new", openedAt: new Date() });
    visitFindMany.mockResolvedValue([{ id: "visit_new" }]);
    expect(await openOrJoinVisit("table_1", "venue_1")).toBe("visit_new");
  });

  it("resolves a simultaneous scan race to the older visit", async () => {
    // Two phones scan an idle table at the same moment: both see no visit and
    // both create one. The loser must discard its row, or the table ends up
    // with two open visits and the bill splits in half.
    visitFindFirst.mockResolvedValue(null);
    visitCreate.mockResolvedValue({ id: "visit_mine", openedAt: new Date() });
    visitFindMany.mockResolvedValue([{ id: "visit_theirs" }, { id: "visit_mine" }]);
    visitDelete.mockResolvedValue({});

    expect(await openOrJoinVisit("table_1", "venue_1")).toBe("visit_theirs");
    expect(visitDelete).toHaveBeenCalledWith({ where: { id: "visit_mine" } });
  });
});

describe("buildBill", () => {
  it("totals every order at the table across phones", async () => {
    visitFindUnique.mockResolvedValue(
      visitWithOrders([
        { sessionId: "s1", items: [item("Türk Kahvesi", 2, 9000)] },
        { sessionId: "s2", items: [item("Şiş Köfte", 1, 24000)] },
      ])
    );
    const bill = await buildBill("visit_1");
    expect(bill!.totalKurus).toBe(42000);
    expect(bill!.lines).toHaveLength(2);
  });

  it("splits the total per phone, labelled for staff rather than by session id", async () => {
    visitFindUnique.mockResolvedValue(
      visitWithOrders([
        { sessionId: "s1", items: [item("Kahve", 1, 9000)] },
        { sessionId: "s2", items: [item("Köfte", 1, 24000)] },
        { sessionId: "s1", items: [item("Ayran", 1, 4500)] },
      ])
    );
    const bill = await buildBill("visit_1");
    expect(bill!.phones).toEqual([
      { sessionId: "s1", label: "Telefon 1", totalKurus: 13500 },
      { sessionId: "s2", label: "Telefon 2", totalKurus: 24000 },
    ]);
  });

  it("keeps refused and withdrawn orders off the bill", async () => {
    visitFindUnique.mockResolvedValue(visitWithOrders([]));
    await buildBill("visit_1");
    const where = visitFindUnique.mock.calls[0][0].include.orders.where;
    // A customer cancellation must not be charged for any more than a staff
    // rejection: in both cases nothing was served.
    expect(where.status.notIn).toEqual(expect.arrayContaining(["rejected", "cancelled"]));
  });

  it("returns null for a visit that does not exist", async () => {
    visitFindUnique.mockResolvedValue(null);
    expect(await buildBill("nope")).toBeNull();
  });
});

describe("settleVisit", () => {
  const settleInput = { paymentMethod: "cash" as const, staffId: "staff_1" };

  it("refuses to close a table with food still in the kitchen", async () => {
    visitFindFirst.mockResolvedValue({ id: "visit_1", status: "open", tableId: "table_1" });
    orderCount.mockResolvedValue(2);
    const result = await settleVisit("visit_1", "venue_1", settleInput);
    expect(result).toEqual({ ok: false, error: "orders_in_flight" });
    expect(visitUpdate).not.toHaveBeenCalled();
  });

  it("closes anyway when staff deliberately override", async () => {
    visitFindFirst.mockResolvedValue({ id: "visit_1", status: "open", tableId: "table_1" });
    orderCount.mockResolvedValue(2);
    visitFindUnique.mockResolvedValue(visitWithOrders([{ sessionId: "s1", items: [item("Kahve", 1, 9000)] }]));
    const result = await settleVisit("visit_1", "venue_1", { ...settleInput, force: true });
    expect(result).toEqual({ ok: true, totalKurus: 9000 });
  });

  it("records the method and snapshots the total taken", async () => {
    visitFindFirst.mockResolvedValue({ id: "visit_1", status: "open", tableId: "table_1" });
    visitFindUnique.mockResolvedValue(visitWithOrders([{ sessionId: "s1", items: [item("Kahve", 2, 9000)] }]));
    await settleVisit("visit_1", "venue_1", { paymentMethod: "card", staffId: "staff_7" });

    const data = visitUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("closed");
    expect(data.closedReason).toBe("settled");
    expect(data.paymentMethod).toBe("card");
    // Snapshotted, so a later menu price edit cannot rewrite the night's takings.
    expect(data.totalKurus).toBe(18000);
    expect(data.paidAmountKurus).toBe(18000);
    expect(data.closedByStaffId).toBe("staff_7");
  });

  it("marks exactly the billed orders paid and revokes the party's phones", async () => {
    visitFindFirst.mockResolvedValue({ id: "visit_1", status: "open", tableId: "table_1" });
    visitFindUnique.mockResolvedValue(
      visitWithOrders([{ id: "o1", sessionId: "s1", items: [item("Kahve", 1, 9000)] }])
    );
    await settleVisit("visit_1", "venue_1", settleInput);

    const paid = orderUpdateMany.mock.calls[0][0];
    expect(paid.data.paymentStatus).toBe("paid");
    // By id, not by visit: an order placed after the bill was totalled must
    // not be marked paid for money nobody handed over.
    expect(paid.where).toEqual({ id: { in: ["o1"] } });
    // The party has paid and left; their phones must not keep ordering.
    expect(sessionUpdateMany.mock.calls[0][0].where).toMatchObject({ visitId: "visit_1", revokedAt: null });
  });

  it("does not settle the same table twice", async () => {
    visitFindFirst.mockResolvedValue({ id: "visit_1", status: "closed", tableId: "table_1" });
    expect(await settleVisit("visit_1", "venue_1", settleInput)).toEqual({
      ok: false,
      error: "already_closed",
    });
  });

  it("loses the race to a second till cleanly", async () => {
    // Both tills read "open"; the other one's close lands first, so ours
    // matches no row. Nothing is marked paid twice and nothing is published.
    visitFindFirst.mockResolvedValue({ id: "visit_1", status: "open", tableId: "table_1" });
    visitFindUnique.mockResolvedValue(visitWithOrders([]));
    visitUpdate.mockResolvedValue({ count: 0 });
    expect(await settleVisit("visit_1", "venue_1", settleInput)).toEqual({
      ok: false,
      error: "already_closed",
    });
    expect(visitUpdate.mock.calls[0][0].where).toEqual({ id: "visit_1", status: { not: "closed" } });
    expect(orderUpdateMany).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("refuses a visit belonging to another venue", async () => {
    visitFindFirst.mockResolvedValue(null);
    expect(await settleVisit("visit_1", "other_venue", settleInput)).toEqual({
      ok: false,
      error: "not_found",
    });
    const where = visitFindFirst.mock.calls[0][0].where;
    expect(where.venueId).toBe("other_venue");
  });
});

describe("requestBill", () => {
  it("marks the visit and notifies the desk", async () => {
    visitFindFirst.mockResolvedValue({ id: "visit_1", status: "open", tableId: "table_1" });
    expect(await requestBill("visit_1", "venue_1")).toBe(true);
    expect(visitUpdate.mock.calls[0][0].data.status).toBe("bill_requested");
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "bill.requested", tableId: "table_1" })
    );
  });

  it("is idempotent — a second tap re-pings without resetting the wait time", async () => {
    visitFindFirst.mockResolvedValue({ id: "visit_1", status: "bill_requested", tableId: "table_1" });
    expect(await requestBill("visit_1", "venue_1")).toBe(true);
    expect(visitUpdate).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalled();
  });

  it("refuses once the table has been settled", async () => {
    visitFindFirst.mockResolvedValue({ id: "visit_1", status: "closed", tableId: "table_1" });
    expect(await requestBill("visit_1", "venue_1")).toBe(false);
  });
});

describe("closeAbandonedVisits", () => {
  it("only considers visits whose phones are all dead and which have gone quiet", async () => {
    visitFindMany.mockResolvedValue([]);
    await closeAbandonedVisits();

    const where = visitFindMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(["open", "bill_requested"]);
    // A party can legitimately let every phone idle out (30 min) while still
    // sitting there waiting for food, so neither condition alone is enough.
    expect(where.sessions.none).toMatchObject({ revokedAt: null });
    expect(where.orders.none.createdAt.gt).toBeInstanceOf(Date);

    const cutoff = where.openedAt.lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(ABANDON_AFTER_MS - 1000);
  });

  it("closes each stale visit as abandoned, not as settled", async () => {
    visitFindMany.mockResolvedValue([{ id: "visit_1", venueId: "venue_1", tableId: "table_1" }]);
    visitFindUnique.mockResolvedValue(visitWithOrders([{ sessionId: "s1", items: [item("Kahve", 1, 9000)] }]));

    expect(await closeAbandonedVisits()).toBe(1);
    const data = visitUpdate.mock.calls[0][0].data;
    expect(data.status).toBe("closed");
    // Never "settled": nobody paid, and the takings must not claim otherwise.
    expect(data.closedReason).toBe("abandoned");
    expect(data.paymentMethod).toBeUndefined();
    expect(data.totalKurus).toBe(9000);
  });

  it("frees the table so the next party can be seated", async () => {
    visitFindMany.mockResolvedValue([{ id: "visit_1", venueId: "venue_1", tableId: "table_1" }]);
    visitFindUnique.mockResolvedValue(visitWithOrders([]));
    await closeAbandonedVisits();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "visit.closed", tableId: "table_1" })
    );
  });

  it("does nothing when every open table is still active", async () => {
    visitFindMany.mockResolvedValue([]);
    expect(await closeAbandonedVisits()).toBe(0);
    expect(visitUpdate).not.toHaveBeenCalled();
  });
});
