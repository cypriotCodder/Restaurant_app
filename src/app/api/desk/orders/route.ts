import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";

export async function GET(req: Request) {
  const staff = await requireStaff("desk");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";

  const orders = await db.order.findMany({
    where: {
      venueId: staff.venueId,
      ...(all
        ? { createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        : { status: { in: ["received", "accepted", "preparing", "ready"] } }),
    },
    orderBy: { createdAt: "asc" },
    include: { items: true, table: true, session: true, deliveries: true },
  });

  // First order of a brand-new session gets a visual "new session" flag on
  // the desk — the human-verification hook in the anti-abuse design.
  const sessionFirstOrder = new Map<string, string>();
  for (const o of orders) {
    if (!sessionFirstOrder.has(o.sessionId)) sessionFirstOrder.set(o.sessionId, o.id);
  }

  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      rejectReason: o.rejectReason,
      totalKurus: o.totalKurus,
      createdAt: o.createdAt,
      tableName: o.table.name,
      tableId: o.tableId,
      newSession: sessionFirstOrder.get(o.sessionId) === o.id,
      posStatus: o.deliveries[0]?.status ?? null,
      items: o.items.map((i) => ({
        name: i.nameSnapshot,
        qty: i.qty,
        note: i.note,
        modifiers: (JSON.parse(i.modifiersJson) as { name: string }[]).map((m) => m.name),
      })),
    })),
  });
}
