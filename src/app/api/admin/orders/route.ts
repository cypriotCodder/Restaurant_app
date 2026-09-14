import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pageLimit, splitPage } from "@/lib/pagination";
import { requireStaff } from "@/lib/staffAuth";

// The order log for the admin screen.
//
// Separate from /api/desk/orders, which is an operational view capped at 24
// hours because that is all a kitchen needs. A manager looking at history needs
// to choose a range.
const MAX_DAYS = 365;

export async function GET(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const requested = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_DAYS) : 7;

  const limit = pageLimit(req.nextUrl.searchParams.get("limit"));
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

  const { items: orders, nextCursor } = splitPage(rows, limit);

  return NextResponse.json({
    days,
    nextCursor,
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
