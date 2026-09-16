import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Deleting a table. Every scan opens a TableVisit that references the table, so
// a table that was scanned but never ordered from used to fail the delete with
// a foreign-key error and a 500 — the admin saw "İşlem başarısız" and no reason.

const tableFindFirst = vi.fn();
const tableDelete = vi.fn();
const tableUpdate = vi.fn();
const orderCount = vi.fn();
const sessionDeleteMany = vi.fn();
const visitDeleteMany = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    table: {
      findFirst: (...a: unknown[]) => tableFindFirst(...a),
      delete: (...a: unknown[]) => tableDelete(...a),
      update: (...a: unknown[]) => tableUpdate(...a),
    },
    order: { count: (...a: unknown[]) => orderCount(...a) },
    tableSession: { deleteMany: (...a: unknown[]) => sessionDeleteMany(...a) },
    tableVisit: { deleteMany: (...a: unknown[]) => visitDeleteMany(...a) },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));
vi.mock("@/lib/staffAuth", () => ({
  requireStaff: async () => ({ sub: "staff_1", venueId: "venue_1", role: "admin", name: "A", ver: 0 }),
}));

const { DELETE } = await import("@/app/api/admin/tables/[id]/route");

const del = (id = "table_1") =>
  DELETE(new NextRequest(`http://localhost/api/admin/tables/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  tableFindFirst.mockResolvedValue({ id: "table_1", venueId: "venue_1" });
  orderCount.mockResolvedValue(0);
  transaction.mockResolvedValue([]);
  sessionDeleteMany.mockReturnValue("sessions");
  visitDeleteMany.mockReturnValue("visits");
  tableDelete.mockReturnValue("table");
});

describe("DELETE /api/admin/tables/[id]", () => {
  it("removes sessions and visits before the table when nothing was ordered", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(visitDeleteMany).toHaveBeenCalledWith({ where: { tableId: "table_1" } });
    // Order matters: sessions reference visits, visits reference the table.
    expect(transaction).toHaveBeenCalledWith(["sessions", "visits", "table"]);
  });

  it("deactivates instead of deleting once orders reference the table", async () => {
    orderCount.mockResolvedValue(3);
    const res = await del();
    expect(await res.json()).toEqual({ ok: true, deactivated: true });
    expect(tableUpdate).toHaveBeenCalledWith({ where: { id: "table_1" }, data: { active: false } });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("404s for a table in another venue", async () => {
    tableFindFirst.mockResolvedValue(null);
    expect((await del("other")).status).toBe(404);
  });
});
