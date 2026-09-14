import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";

// The order log for the admin screen.
//
// Separate from /api/desk/orders, which is an operational view capped at 24
// hours because that is all a kitchen needs. A manager looking at history needs
// to choose a range.
const MAX_DAYS = 365;
const MAX_ROWS = 500;

export async function GET(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const requested = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_DAYS) : 7;

  const orders = await db.order.findMany({
    where: { venueId: staff.venueId, createdAt: { gt: new Date(Date.now() - days * 86400000) } },
    orderBy: { createdAt: "desc" },
    // Bounded so a year-long range cannot try to render tens of thousands of
    // rows into the admin screen.
    take: MAX_ROWS,
    include: {
      items: { select: { nameSnapshot: true, qty: true } },
      table: { select: { name: true } },
      visit: { select: { status: true, closedReason: true, paymentMethod: true } },
    },
  });

  return NextResponse.json({
    days,
    truncated: orders.length === MAX_ROWS,
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
