import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The CSV lands in Excel on the owner's machine, and its cells include text
// customers typed on their phones.

const orderFindMany = vi.fn();

vi.mock("@/lib/db", () => ({ db: { order: { findMany: (...a: unknown[]) => orderFindMany(...a) } } }));
vi.mock("@/lib/staffAuth", () => ({
  requireStaff: async () => ({ sub: "s", venueId: "venue_1", role: "admin", name: "A", ver: 0 }),
}));

const { GET } = await import("@/app/api/admin/orders/export/route");

const order = (note: string, name = "Kahve") => ({
  number: 1,
  createdAt: new Date("2026-09-16T10:00:00Z"),
  table: { name: "Masa 1" },
  status: "served",
  rejectReason: null,
  totalKurus: 9000,
  paymentStatus: "paid",
  visit: { paymentMethod: "cash", closedReason: "settled" },
  items: [{ nameSnapshot: name, qty: 1, unitPriceKurus: 9000, note, modifiersJson: "[]" }],
});

const csv = async (query = "") => {
  const res = await GET(new NextRequest(`http://localhost/api/admin/orders/export${query}`));
  return { res, text: await res.text() };
};

beforeEach(() => {
  vi.clearAllMocks();
  orderFindMany.mockResolvedValue([]);
});

describe("GET /api/admin/orders/export", () => {
  it("neutralises a customer note that would run as a formula", async () => {
    orderFindMany.mockResolvedValue([order("=HYPERLINK(\"http://evil\")")]);
    const { text } = await csv();
    expect(text).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it("neutralises the other formula triggers and leaves ordinary text alone", async () => {
    orderFindMany.mockResolvedValue([order("+1 şekersiz"), order("@x"), order("-acı"), order("soğansız")]);
    const { text } = await csv();
    expect(text).toContain(`"'+1 şekersiz"`);
    expect(text).toContain(`"'@x"`);
    expect(text).toContain(`"'-acı"`);
    expect(text).toContain(`"soğansız"`);
  });

  it("caps the range at a year and defaults to 30 days", async () => {
    await csv("?days=99999");
    const gt = orderFindMany.mock.calls[0][0].where.createdAt.gt.getTime();
    expect(Date.now() - gt).toBeLessThanOrEqual(366 * 86400000);
    await csv("?days=abc");
    const gt2 = orderFindMany.mock.calls[1][0].where.createdAt.gt.getTime();
    expect(Math.round((Date.now() - gt2) / 86400000)).toBe(30);
  });

  it("is served as a download", async () => {
    const { res } = await csv("?days=7");
    expect(res.headers.get("content-disposition")).toContain('orders-7d.csv');
  });
});
