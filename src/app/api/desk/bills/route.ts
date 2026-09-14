import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { buildBill } from "@/lib/visit";

// Open tables, for the desk's bill view. Tables that have asked for the bill
// sort first — that is the queue staff are working through.
export async function GET() {
  const staff = await requireStaff("desk");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const visits = await db.tableVisit.findMany({
    where: { venueId: staff.venueId, status: { in: ["open", "bill_requested"] } },
    orderBy: [{ billRequestedAt: "asc" }, { openedAt: "asc" }],
    select: { id: true },
  });

  const bills = (await Promise.all(visits.map((v) => buildBill(v.id)))).filter(
    (b) => b !== null
  );

  return NextResponse.json({
    bills: bills
      .map((b) => ({
        visitId: b.visitId,
        tableId: b.tableId,
        tableName: b.tableName,
        status: b.status,
        openedAt: b.openedAt,
        billRequestedAt: b.billRequestedAt,
        totalKurus: b.totalKurus,
        orderCount: b.orderCount,
        phoneCount: b.phones.length,
      }))
      // A table nobody has ordered at yet is noise on the bill screen.
      .filter((b) => b.orderCount > 0 || b.status === "bill_requested"),
  });
}
