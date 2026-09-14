import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";

// The order log for the admin screen.
//
// Separate from /api/desk/orders, which is an operational view capped at 24
// hours because that is all a kitchen needs. A manager looking at history needs
// to choose a range.
const MAX_DAYS = 365;
// One screenful at a time. The screen used to take a flat 500 and tell the
// manager to go download a CSV for anything older; it now pages instead, so a
// long range costs a small first render and only fetches more on request.
const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const requested = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_DAYS) : 7;

  const requestedLimit = Number(req.nextUrl.searchParams.get("limit"));
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_PAGE_SIZE)
      : PAGE_SIZE;
  const cursor = req.nextUrl.searchParams.get("cursor");

  const rows = await db.order.findMany({
    where: { venueId: staff.venueId, createdAt: { gt: new Date(Date.now() - days * 86400000) } },
    // id breaks createdAt ties: without a total order, cursor paging can
    // repeat or skip rows that share a timestamp.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // One extra row is the cheapest way to know whether another page exists
    // without a second count query.
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      items: { select: { nameSnapshot: true, qty: true } },
      table: { select: { name: true } },
      visit: { select: { status: true, closedReason: true, paymentMethod: true } },
    },
  });

  const hasMore = rows.length > limit;
  const orders = hasMore ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    days,
    nextCursor: hasMore ? orders[orders.length - 1].id : null,
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.visit?.paymentMethod ?? null,
      totalKurus: o.totalKurus,
      createdAt: o.createdAt,
      tableName: o.table.name,
      items: o.items.map((i) => ({ name: i.nameSnapshot, qty: i.qty })),
    })),
  });
}
