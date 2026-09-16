import { describe, it, expect, vi, beforeEach } from "vitest";

// The open-tables list refetches on every bill event and every 60s poll. It
// used to run one nested query per open table; these pin that it is now one
// query and that the totals it derives match what the itemised bill shows.

const visitFindMany = vi.fn();

vi.mock("@/lib/db", () => ({ db: { tableVisit: { findMany: (...a: unknown[]) => visitFindMany(...a) } } }));
vi.mock("@/lib/staffAuth", () => ({
  requireStaff: async () => ({ sub: "s", venueId: "venue_1", role: "desk", name: "K", ver: 0 }),
}));

const { GET } = await import("@/app/api/desk/bills/route");

const visit = (over: Record<string, unknown> = {}) => ({
  id: "v1",
  tableId: "t1",
  status: "open",
  openedAt: new Date(),
  billRequestedAt: null,
  table: { name: "Masa 1" },
  orders: [
    { totalKurus: 9000, sessionId: "s1" },
    { totalKurus: 24000, sessionId: "s2" },
    { totalKurus: 4500, sessionId: "s1" },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  visitFindMany.mockResolvedValue([visit()]);
});

describe("GET /api/desk/bills", () => {
  it("is a single query that excludes refused and withdrawn orders", async () => {
    await GET();
    expect(visitFindMany).toHaveBeenCalledTimes(1);
    const where = visitFindMany.mock.calls[0][0].select.orders.where;
    expect(where.status.notIn).toEqual(expect.arrayContaining(["rejected", "cancelled"]));
  });

  it("totals the table and counts phones from the orders' stored totals", async () => {
    const { bills } = await (await GET()).json();
    expect(bills[0]).toMatchObject({ visitId: "v1", tableName: "Masa 1", totalKurus: 37500, orderCount: 3, phoneCount: 2 });
  });

  it("hides a table nobody has ordered at unless it asked for the bill", async () => {
    visitFindMany.mockResolvedValue([
      visit({ id: "quiet", orders: [] }),
      visit({ id: "asking", orders: [], status: "bill_requested", billRequestedAt: new Date() }),
    ]);
    const { bills } = await (await GET()).json();
    expect(bills.map((b: { visitId: string }) => b.visitId)).toEqual(["asking"]);
  });
});
