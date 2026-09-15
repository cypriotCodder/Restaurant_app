import { describe, it, expect, vi, beforeEach } from "vitest";

// The desk's open-tables strip is re-read on every SSE event and on a 60s poll,
// so it reads every open visit in one query rather than building a full bill per
// table. These pin the totals that query has to produce, and the fact that it
// stays a single read however many tables are open.

const visitFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { tableVisit: { findMany: (...a: unknown[]) => visitFindMany(...a) } },
}));
vi.mock("@/lib/bus", () => ({ publish: vi.fn() }));

const { buildBillSummaries } = await import("@/lib/visit");

const line = (unitPriceKurus: number, qty: number) => ({ unitPriceKurus, qty });

function visit(id: string, tableName: string, orders: unknown[], status = "open") {
  return {
    id,
    tableId: `table_${id}`,
    status,
    openedAt: new Date("2026-09-15T18:00:00Z"),
    billRequestedAt: null,
    table: { name: tableName },
    orders,
  };
}

beforeEach(() => {
  visitFindMany.mockReset();
});

describe("buildBillSummaries", () => {
  it("totals every unvoided line across a visit's orders", async () => {
    visitFindMany.mockResolvedValue([
      visit("v1", "Masa 1", [
        { sessionId: "s1", items: [line(5000, 2), line(1250, 1)] },
        { sessionId: "s1", items: [line(800, 3)] },
      ]),
    ]);

    const [summary] = await buildBillSummaries("venue_1");

    expect(summary.totalKurus).toBe(5000 * 2 + 1250 + 800 * 3);
    expect(summary.orderCount).toBe(2);
    expect(summary.tableName).toBe("Masa 1");
  });

  it("counts distinct phones, not orders", async () => {
    visitFindMany.mockResolvedValue([
      visit("v1", "Masa 1", [
        { sessionId: "s1", items: [line(1000, 1)] },
        { sessionId: "s2", items: [line(1000, 1)] },
        { sessionId: "s1", items: [line(1000, 1)] },
      ]),
    ]);

    const [summary] = await buildBillSummaries("venue_1");

    expect(summary.phoneCount).toBe(2);
    expect(summary.orderCount).toBe(3);
  });

  it("reports a table nobody has ordered at as zero rather than omitting it", async () => {
    visitFindMany.mockResolvedValue([visit("v1", "Masa 9", [], "bill_requested")]);

    const [summary] = await buildBillSummaries("venue_1");

    expect(summary.totalKurus).toBe(0);
    expect(summary.orderCount).toBe(0);
    expect(summary.phoneCount).toBe(0);
    expect(summary.status).toBe("bill_requested");
  });

  it("reads every open table in one query, not one per table", async () => {
    visitFindMany.mockResolvedValue([
      visit("v1", "Masa 1", [{ sessionId: "s1", items: [line(1000, 1)] }]),
      visit("v2", "Masa 2", [{ sessionId: "s2", items: [line(2000, 1)] }]),
      visit("v3", "Masa 3", [{ sessionId: "s3", items: [line(3000, 1)] }]),
    ]);

    const summaries = await buildBillSummaries("venue_1");

    expect(summaries.map((s) => s.totalKurus)).toEqual([1000, 2000, 3000]);
    expect(visitFindMany).toHaveBeenCalledTimes(1);
  });

  it("scopes to the venue's open and bill-requested visits", async () => {
    visitFindMany.mockResolvedValue([]);

    await buildBillSummaries("venue_1");

    expect(visitFindMany.mock.calls[0][0]).toMatchObject({
      where: { venueId: "venue_1", status: { in: ["open", "bill_requested"] } },
    });
  });
});
