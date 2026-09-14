import { describe, it, expect, vi, beforeEach } from "vitest";

// These numbers end up on a screen a manager reconciles against the cash
// drawer, so the distinction that matters most is the one the old screen got
// wrong: money TAKEN (settled visits) is not the same as orders PLACED.

const visitFindMany = vi.fn();
const orderCount = vi.fn();
const orderItemAggregate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    tableVisit: { findMany: (...a: unknown[]) => visitFindMany(...a) },
    order: { count: (...a: unknown[]) => orderCount(...a) },
    orderItem: { aggregate: (...a: unknown[]) => orderItemAggregate(...a) },
  },
}));

const { dayBounds, periodReport, openTables, percentChange } = await import("@/lib/reporting");

const settled = (amount: number, method: "cash" | "card") => ({
  paidAmountKurus: amount,
  totalKurus: amount,
  paymentMethod: method,
});

beforeEach(() => {
  vi.clearAllMocks();
  visitFindMany.mockResolvedValue([]);
  orderCount.mockResolvedValue(0);
  orderItemAggregate.mockResolvedValue({ _sum: { qty: 0 } });
});

describe("dayBounds", () => {
  it("spans exactly one day, midnight to midnight", () => {
    const { from, to } = dayBounds(0);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(from.getSeconds()).toBe(0);
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("gives a FULL previous day, not a rolling 24 hours", () => {
    // This is the bug being fixed: deriving "yesterday" from a 24-hour window
    // truncated it to however long ago the manager happened to be looking, so
    // the comparison was wrong by a different amount every hour.
    const today = dayBounds(0);
    const yesterday = dayBounds(1);
    expect(yesterday.to.getTime()).toBe(today.from.getTime());
    expect(yesterday.to.getTime() - yesterday.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("does not overlap adjacent days", () => {
    expect(dayBounds(1).to.getTime()).toBe(dayBounds(0).from.getTime());
    expect(dayBounds(2).to.getTime()).toBe(dayBounds(1).from.getTime());
  });
});

describe("periodReport — takings", () => {
  it("counts only visits that were actually settled", async () => {
    await periodReport("venue_1", new Date(0), new Date());
    const where = visitFindMany.mock.calls[0][0].where;
    expect(where.status).toBe("closed");
    // A walkout closed by the sweep is not money; counting it would inflate
    // takings against a drawer that never received it.
    expect(where.closedReason).toBe("settled");
  });

  it("splits takings by payment method for till reconciliation", async () => {
    visitFindMany.mockResolvedValue([
      settled(20000, "cash"),
      settled(15000, "card"),
      settled(5000, "cash"),
    ]);
    const r = await periodReport("venue_1", new Date(0), new Date());
    expect(r.settledKurus).toBe(40000);
    expect(r.cashKurus).toBe(25000);
    expect(r.cardKurus).toBe(15000);
    expect(r.settledVisits).toBe(3);
  });

  it("averages per settled table, which is the restaurant's average check", async () => {
    visitFindMany.mockResolvedValue([settled(30000, "cash"), settled(10000, "card")]);
    const r = await periodReport("venue_1", new Date(0), new Date());
    expect(r.avgCheckKurus).toBe(20000);
  });

  it("reports a zero average rather than dividing by zero on a quiet day", async () => {
    const r = await periodReport("venue_1", new Date(0), new Date());
    expect(r.avgCheckKurus).toBe(0);
    expect(r.settledKurus).toBe(0);
  });

  it("prefers the amount actually handed over to the bill total", async () => {
    visitFindMany.mockResolvedValue([
      { paidAmountKurus: 25000, totalKurus: 24000, paymentMethod: "cash" },
    ]);
    expect((await periodReport("venue_1", new Date(0), new Date())).settledKurus).toBe(25000);
  });

  it("falls back to the bill total when no paid amount was recorded", async () => {
    visitFindMany.mockResolvedValue([
      { paidAmountKurus: null, totalKurus: 18000, paymentMethod: "cash" },
    ]);
    expect((await periodReport("venue_1", new Date(0), new Date())).settledKurus).toBe(18000);
  });
});

describe("periodReport — kitchen volume", () => {
  it("counts orders placed and rejected separately from takings", async () => {
    orderCount.mockResolvedValueOnce(42).mockResolvedValueOnce(3);
    orderItemAggregate.mockResolvedValue({ _sum: { qty: 97 } });
    const r = await periodReport("venue_1", new Date(0), new Date());
    expect(r.ordersPlaced).toBe(42);
    expect(r.ordersRejected).toBe(3);
    expect(r.itemsSold).toBe(97);
    // Orders were placed but nothing was settled: takings must stay zero.
    expect(r.settledKurus).toBe(0);
  });

  it("excludes both refused and withdrawn orders from the item count", async () => {
    await periodReport("venue_1", new Date(0), new Date());
    const where = orderItemAggregate.mock.calls[0][0].where;
    // Staff rejections AND customer cancellations: neither was ever served.
    expect(where.order.status.notIn).toEqual(expect.arrayContaining(["rejected", "cancelled"]));
  });

  it("scopes every query to the venue", async () => {
    await periodReport("venue_7", new Date(0), new Date());
    expect(visitFindMany.mock.calls[0][0].where.venueId).toBe("venue_7");
    expect(orderCount.mock.calls[0][0].where.venueId).toBe("venue_7");
  });
});

describe("openTables", () => {
  it("totals what is still owed, kept apart from the day's takings", async () => {
    visitFindMany.mockResolvedValue([
      { status: "open", orders: [{ totalKurus: 12000 }, { totalKurus: 8000 }] },
      { status: "bill_requested", orders: [{ totalKurus: 30000 }] },
    ]);
    const floor = await openTables("venue_1");
    expect(floor.count).toBe(2);
    expect(floor.runningKurus).toBe(50000);
    expect(floor.billRequested).toBe(1);
  });

  it("ignores refused and withdrawn orders in the running total", async () => {
    visitFindMany.mockResolvedValue([]);
    await openTables("venue_1");
    const where = visitFindMany.mock.calls[0][0].select.orders.where;
    expect(where.status.notIn).toEqual(expect.arrayContaining(["rejected", "cancelled"]));
  });
});

describe("percentChange", () => {
  it("computes a rounded percentage", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
  });

  it("returns null with no baseline, rather than a misleading 0%", () => {
    // The old screen showed "0%" when yesterday had no data, which reads as
    // "flat" when it actually means "nothing to compare".
    expect(percentChange(500, 0)).toBeNull();
  });
});
