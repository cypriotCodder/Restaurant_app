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
    include: {
      items: { where: { voidedAt: null } },
      table: { select: { name: true } },
      deliveries: { select: { status: true } },
      edits: { orderBy: { createdAt: "asc" } },
    },
  });

  // First order of a brand-new session gets a visual "new session" flag on
  // the desk — the human-verification hook in the anti-abuse design.
  //
  // "First" has to be measured against the session's whole history, not against
  // this response: the default view only carries in-flight orders, so deriving
  // it from `orders` tagged a party's second round as a new session as soon as
  // their first one had been served.
  const sessionIds = [...new Set(orders.map((o) => o.sessionId))];
  const sessionOrders = await db.order.findMany({
    where: { sessionId: { in: sessionIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, sessionId: true },
  });
  const sessionFirstOrder = new Map<string, string>();
  for (const o of sessionOrders) {
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
      // The line id is what an edit targets, so the desk needs it.
      items: o.items.map((i) => ({
        id: i.id,
        name: i.nameSnapshot,
        qty: i.qty,
        note: i.note,
        modifiers: (JSON.parse(i.modifiersJson) as { name: string }[]).map((m) => m.name),
      })),
      edits: o.edits.map((e) => ({
        staffName: e.staffName,
        afterPrint: e.afterPrint,
        changes: JSON.parse(e.changesJson) as { name: string; fromQty: number; toQty: number }[],
      })),
    })),
  });
}
