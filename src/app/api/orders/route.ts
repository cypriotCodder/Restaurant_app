import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveSession } from "@/lib/tableSession";
import { logAttempt } from "@/lib/attempts";
import { publish } from "@/lib/bus";

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: z.string(),
        qty: z.number().int().min(1).max(20),
        note: z.string().max(200).default(""),
        optionIds: z.array(z.string()).max(20).default([]),
      })
    )
    .min(1)
    .max(30),
});

// Rate limits (per anti-abuse design)
const MAX_ORDERS_PER_SESSION_WINDOW = 5;
const SESSION_WINDOW_MS = 10 * 60 * 1000;
const MAX_OPEN_ORDERS_PER_TABLE = 10;

export async function POST(req: NextRequest) {
  const session = await getActiveSession();
  if (!session) {
    await logAttempt(req, "expired_session");
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  const base = { venueId: session.venueId, tableId: session.tableId, sessionId: session.id };

  const body = await req.json().catch(() => null);
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) {
    await logAttempt(req, "validation_error", { ...base, detail: parsed.error?.message.slice(0, 300) ?? "bad json" });
    return NextResponse.json({ error: "invalid_order" }, { status: 400 });
  }

  const recent = await db.order.count({
    where: { sessionId: session.id, createdAt: { gt: new Date(Date.now() - SESSION_WINDOW_MS) } },
  });
  const open = await db.order.count({
    where: { tableId: session.tableId, status: { in: ["received", "accepted", "preparing", "ready"] } },
  });
  if (recent >= MAX_ORDERS_PER_SESSION_WINDOW || open >= MAX_OPEN_ORDERS_PER_TABLE) {
    await logAttempt(req, "rate_limited", { ...base, detail: `recent=${recent} open=${open}` });
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Re-price everything server-side from the live menu; client prices are UI only.
  const itemIds = parsed.data.items.map((i) => i.itemId);
  const menuItems = await db.menuItem.findMany({
    where: { id: { in: itemIds }, venueId: session.venueId },
    include: { modifierGroups: { include: { options: true } } },
  });
  const byId = new Map(menuItems.map((m) => [m.id, m]));

  let totalKurus = 0;
  const orderItems: {
    itemId: string;
    nameSnapshot: string;
    unitPriceKurus: number;
    qty: number;
    note: string;
    modifiersJson: string;
  }[] = [];

  for (const line of parsed.data.items) {
    const item = byId.get(line.itemId);
    if (!item || !item.available) {
      await logAttempt(req, "validation_error", { ...base, detail: `unavailable item ${line.itemId}` });
      return NextResponse.json(
        { error: "item_unavailable", itemId: line.itemId },
        { status: 409 }
      );
    }
    const allOptions = new Map(
      item.modifierGroups.flatMap((g) => g.options.map((o) => [o.id, { ...o, group: g }] as const))
    );
    const chosen = line.optionIds.map((id) => allOptions.get(id)).filter((o) => o !== undefined);
    if (chosen.length !== line.optionIds.length) {
      await logAttempt(req, "validation_error", { ...base, detail: "unknown modifier option" });
      return NextResponse.json({ error: "invalid_order" }, { status: 400 });
    }
    for (const g of item.modifierGroups) {
      const count = chosen.filter((o) => o.group.id === g.id).length;
      if (count < g.minSelect || count > g.maxSelect) {
        return NextResponse.json({ error: "invalid_modifiers", groupId: g.id }, { status: 400 });
      }
    }
    const unit = item.priceKurus + chosen.reduce((s, o) => s + o.priceDeltaKurus, 0);
    totalKurus += unit * line.qty;
    orderItems.push({
      itemId: item.id,
      nameSnapshot: item.nameTr,
      unitPriceKurus: unit,
      qty: line.qty,
      note: line.note,
      modifiersJson: JSON.stringify(chosen.map((o) => ({ name: o.nameTr, priceDeltaKurus: o.priceDeltaKurus }))),
    });
  }

  const order = await db.$transaction(async (tx) => {
    const last = await tx.order.findFirst({
      where: { venueId: session.venueId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return tx.order.create({
      data: {
        venueId: session.venueId,
        tableId: session.tableId,
        sessionId: session.id,
        number: (last?.number ?? 0) + 1,
        totalKurus,
        items: { create: orderItems },
      },
    });
  });

  await logAttempt(req, "ok", { ...base, orderId: order.id });
  publish({ type: "order.created", venueId: session.venueId, orderId: order.id, sessionId: session.id });
  return NextResponse.json({ ok: true, orderId: order.id, number: order.number });
}

// The customer's own orders for this session's table (whole-table view so a
// group sees everything ordered to the table, matching how staff see it).
export async function GET() {
  const session = await getActiveSession();
  if (!session) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const orders = await db.order.findMany({
    where: { tableId: session.tableId, createdAt: { gt: new Date(Date.now() - 4 * 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });
  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      rejectReason: o.rejectReason,
      totalKurus: o.totalKurus,
      createdAt: o.createdAt,
      mine: o.sessionId === session.id,
      items: o.items.map((i) => ({
        name: i.nameSnapshot,
        qty: i.qty,
        note: i.note,
        unitPriceKurus: i.unitPriceKurus,
        modifiers: JSON.parse(i.modifiersJson) as { name: string }[],
      })),
    })),
  });
}
