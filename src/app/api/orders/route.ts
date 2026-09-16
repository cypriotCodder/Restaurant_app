import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveSession } from "@/lib/tableSession";
import { logAttempt } from "@/lib/attempts";
import { publish } from "@/lib/bus";
import { clientIp, writeBudget } from "@/lib/rateLimit";

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
  // Optional so an older cached client keeps working; when present it makes
  // the submission replay-safe.
  idempotencyKey: z.string().min(8).max(64).optional(),
});

// Rate limits (per anti-abuse design)
const MAX_ORDERS_PER_SESSION_WINDOW = 5;
const SESSION_WINDOW_MS = 10 * 60 * 1000;
const MAX_OPEN_ORDERS_PER_TABLE = 10;

/**
 * Ledger rows a caller WITHOUT a session may write. Anyone can POST here, and
 * before this every sessionless attempt was an unbounded insert — the same
 * disk-fill the scan route was hardened against. The response is unchanged;
 * only the row is skipped past the cap.
 */
const NO_SESSION_PER_IP = { limit: 20, windowSec: 10 * 60 };
const NO_SESSION_GLOBAL = { limit: 200, windowSec: 10 * 60 };

export async function POST(req: NextRequest) {
  const session = await getActiveSession();
  if (!session) {
    if (writeBudget("order:nosession", clientIp(req), NO_SESSION_PER_IP, NO_SESSION_GLOBAL)) {
      await logAttempt(req, "expired_session");
    }
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  const base = { venueId: session.venueId, tableId: session.tableId, sessionId: session.id };

  const body = await req.json().catch(() => null);
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) {
    await logAttempt(req, "validation_error", { ...base, detail: parsed.error?.message.slice(0, 300) ?? "bad json" });
    return NextResponse.json({ error: "invalid_order" }, { status: 400 });
  }

  // Replay check: a double-tap (or a retry after a timeout the customer never
  // saw succeed) reuses the same key, and the already-created order is returned
  // as if this were the original request.
  const idempotencyKey = parsed.data.idempotencyKey;
  if (idempotencyKey) {
    const existing = await db.order.findFirst({
      where: { sessionId: session.id, idempotencyKey },
      select: { id: true, number: true },
    });
    if (existing) {
      return NextResponse.json({ ok: true, orderId: existing.id, number: existing.number, replayed: true });
    }
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

  const order = await createOrderWithNextNumber({
    venueId: session.venueId,
    tableId: session.tableId,
    sessionId: session.id,
    visitId: session.visitId,
    totalKurus,
    idempotencyKey,
    items: orderItems,
  });
  if (!order) {
    await logAttempt(req, "number_conflict", { ...base, detail: "exhausted ticket-number retries" });
    return NextResponse.json({ error: "order_failed" }, { status: 503 });
  }

  await logAttempt(req, "ok", { ...base, orderId: order.id });
  publish({
    type: "order.created",
    venueId: session.venueId,
    orderId: order.id,
    sessionId: session.id,
    tableId: session.tableId,
  });
  return NextResponse.json({ ok: true, orderId: order.id, number: order.number });
}

// The per-venue ticket number is max(number)+1, and Prisma's interactive
// transactions run at READ COMMITTED — two concurrent orders in the same venue
// read the same max and both try to claim it. The DB now rejects that with a
// unique-constraint violation (P2002 on Order_venueId_number_key), so the
// collision is caught here and retried against a freshly-read max instead of
// silently sending two identical ticket numbers to the kitchen.
const NUMBER_RETRIES = 5;

async function createOrderWithNextNumber(input: {
  venueId: string;
  tableId: string;
  sessionId: string;
  visitId: string | null;
  totalKurus: number;
  idempotencyKey?: string;
  items: {
    itemId: string;
    nameSnapshot: string;
    unitPriceKurus: number;
    qty: number;
    note: string;
    modifiersJson: string;
  }[];
}) {
  for (let attempt = 0; attempt < NUMBER_RETRIES; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const last = await tx.order.findFirst({
          where: { venueId: input.venueId },
          orderBy: { number: "desc" },
          select: { number: true },
        });
        return tx.order.create({
          data: {
            venueId: input.venueId,
            tableId: input.tableId,
            sessionId: input.sessionId,
            visitId: input.visitId,
            number: (last?.number ?? 0) + 1,
            totalKurus: input.totalKurus,
            idempotencyKey: input.idempotencyKey,
            items: { create: input.items },
          },
        });
      });
    } catch (err) {
      // Two in-flight submissions with the same key: the loser reads back the
      // winner's order rather than erroring or creating a duplicate.
      if (isIdempotencyConflict(err) && input.idempotencyKey) {
        return db.order.findFirstOrThrow({
          where: { sessionId: input.sessionId, idempotencyKey: input.idempotencyKey },
        });
      }
      if (!isTicketNumberConflict(err) || attempt === NUMBER_RETRIES - 1) {
        if (isTicketNumberConflict(err)) return null;
        throw err;
      }
      // Brief jittered backoff so simultaneous retries don't collide again.
      await new Promise((r) => setTimeout(r, 15 * (attempt + 1) + Math.random() * 25));
    }
  }
  return null;
}

function conflictFields(err: unknown): string[] | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e.code !== "P2002") return null;
  const target = e.meta?.target;
  return Array.isArray(target) ? target.map(String) : [String(target ?? "")];
}

function isIdempotencyConflict(err: unknown): boolean {
  return conflictFields(err)?.some((f) => f.includes("idempotencyKey")) ?? false;
}

function isTicketNumberConflict(err: unknown): boolean {
  const fields = conflictFields(err);
  if (!fields) return false;
  // Must not match the (sessionId, idempotencyKey) index, which is handled
  // separately and means something entirely different.
  if (fields.some((f) => f.includes("idempotencyKey"))) return false;
  return fields.some((f) => f.includes("number") || f.includes("venueId"));
}

// Everything this party has ordered — a whole-table view, so a group sees each
// other's orders the way staff do.
//
// Scoped to the visit rather than to a wall-clock window: the previous four-hour
// window could show a newly-seated party the orders of the party before them.
export async function GET() {
  const session = await getActiveSession();
  if (!session) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const orders = await db.order.findMany({
    where: session.visitId
      ? { visitId: session.visitId }
      : // Pre-visit sessions (minted before this feature shipped) keep the old
        // behaviour until they expire, rather than showing nothing.
        { tableId: session.tableId, createdAt: { gt: new Date(Date.now() - 4 * 60 * 60 * 1000) } },
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
