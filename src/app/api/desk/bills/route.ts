import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { notVoid } from "@/lib/orderStatus";

// Open tables, for the desk's bill view. Tables that have asked for the bill
// sort first — that is the queue staff are working through.
//
// One query. This used to load the visits and then build a full itemised bill
// per visit (one nested query each), on every bill event and every 60s poll.
// The list only needs totals and counts, which the orders' stored totals give
// without touching the line items.
export async function GET() {
  const staff = await requireStaff("desk");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const visits = await db.tableVisit.findMany({
    where: { venueId: staff.venueId, status: { in: ["open", "bill_requested"] } },
    orderBy: [{ billRequestedAt: "asc" }, { openedAt: "asc" }],
    select: {
      id: true,
      tableId: true,
      status: true,
      openedAt: true,
      billRequestedAt: true,
      table: { select: { name: true } },
      // Order.totalKurus is kept current by the order-edit path, so summing
      // it matches what the itemised bill would show.
      orders: { where: { status: notVoid() }, select: { totalKurus: true, sessionId: true } },
    },
  });

  return NextResponse.json({
    bills: visits
      .map((v) => ({
        visitId: v.id,
        tableId: v.tableId,
        tableName: v.table.name,
        status: v.status,
        openedAt: v.openedAt,
        billRequestedAt: v.billRequestedAt,
        totalKurus: v.orders.reduce((s, o) => s + o.totalKurus, 0),
        orderCount: v.orders.length,
        phoneCount: new Set(v.orders.map((o) => o.sessionId)).size,
      }))
      // A table nobody has ordered at yet is noise on the bill screen.
      .filter((b) => b.orderCount > 0 || b.status === "bill_requested"),
  });
}
