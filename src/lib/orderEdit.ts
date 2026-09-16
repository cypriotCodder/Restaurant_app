import { z } from "zod";
import { db } from "./db";
import { publish } from "./bus";
import { IN_FLIGHT_STATUSES } from "./orderStatus";

// Desk-side corrections to an order that has already been placed.
//
// Before this, "one fewer coffee" meant rejecting the whole ticket and asking
// the customer to order again. Staff can now change quantities and remove
// lines; adding items is deliberately not supported, because placing a new
// order already does that and keeps the kitchen's paper trail simpler.
//
// Two things are never trusted from the client: prices, which are recomputed
// from the stored line snapshots, and the resulting total, which is derived
// here rather than sent.
//
// Two staff can open the same ticket at once. Every write is conditional on
// the quantity (and status) the edit was computed against, so the second edit
// to land is refused as a conflict instead of applying stale arithmetic on
// top of the first.

/**
 * Editable through the kitchen states, not after the food has been handed over.
 * A mistake discovered after serving is a bill adjustment, not an order edit,
 * and is a different conversation.
 */
export const EDITABLE_STATUSES = IN_FLIGHT_STATUSES;

export const orderEditSchema = z.object({
  // Only lines already on the order; each may be reduced, or set to 0 to void.
  lines: z
    .array(z.object({ itemId: z.string(), qty: z.number().int().min(0).max(20) }))
    .min(1)
    .max(30),
});

export type OrderEditInput = z.infer<typeof orderEditSchema>;

export type LineChange = { name: string; fromQty: number; toQty: number };

export type EditResult =
  | { ok: true; totalKurus: number; changes: LineChange[]; afterPrint: boolean }
  | {
      ok: false;
      error: "not_found" | "not_editable" | "unknown_line" | "no_change" | "empties_order" | "conflict";
      status?: string;
    };

class EditConflict extends Error {}

export async function editOrder(
  orderId: string,
  venueId: string,
  staff: { id: string; name: string },
  input: OrderEditInput
): Promise<EditResult> {
  const order = await db.order.findFirst({
    where: { id: orderId, venueId },
    include: { items: true, deliveries: true },
  });
  if (!order) return { ok: false, error: "not_found" };
  if (!(EDITABLE_STATUSES as string[]).includes(order.status)) {
    return { ok: false, error: "not_editable", status: order.status };
  }

  const live = order.items.filter((i) => i.voidedAt === null);
  const byId = new Map(live.map((i) => [i.id, i]));

  // Every referenced line must be a live line on this order — no inventing
  // lines, no reviving voided ones.
  for (const l of input.lines) {
    if (!byId.has(l.itemId)) return { ok: false, error: "unknown_line" };
  }

  const changes: LineChange[] = [];
  const edits: { id: string; fromQty: number; toQty: number }[] = [];
  for (const l of input.lines) {
    const item = byId.get(l.itemId)!;
    // Quantities may only go down. Increasing is an addition, which belongs in
    // a new order so the kitchen gets a fresh ticket rather than an amendment.
    if (l.qty > item.qty) return { ok: false, error: "unknown_line" };
    if (l.qty !== item.qty) {
      changes.push({ name: item.nameSnapshot, fromQty: item.qty, toQty: l.qty });
      edits.push({ id: item.id, fromQty: item.qty, toQty: l.qty });
    }
  }
  if (changes.length === 0) return { ok: false, error: "no_change" };

  // Voiding every line would leave an order that exists but contains nothing;
  // that is a rejection or a cancellation, which have their own paths and their
  // own reasons attached.
  const remaining = live.filter((i) => {
    const edit = input.lines.find((l) => l.itemId === i.id);
    return (edit ? edit.qty : i.qty) > 0;
  });
  if (remaining.length === 0) return { ok: false, error: "empties_order" };

  // Recomputed from the stored snapshots, never from anything the client sent.
  const totalKurus = remaining.reduce((sum, i) => {
    const edit = input.lines.find((l) => l.itemId === i.id);
    return sum + i.unitPriceKurus * (edit ? edit.qty : i.qty);
  }, 0);

  // A ticket already in the outbox means the kitchen may hold paper that no
  // longer matches, whether or not it has printed yet.
  const afterPrint = order.deliveries.length > 0;
  const now = new Date();

  try {
    await db.$transaction(async (tx) => {
      for (const e of edits) {
        // Conditional on the quantity this edit was computed from. A zero
        // count means someone else changed the line first.
        const { count } = await tx.orderItem.updateMany({
          where: { id: e.id, qty: e.fromQty, voidedAt: null },
          data: e.toQty === 0 ? { qty: 0, voidedAt: now } : { qty: e.toQty },
        });
        if (count === 0) throw new EditConflict();
      }
      // And on the order still being editable: the desk may have served or
      // rejected it while this dialog was open.
      const { count } = await tx.order.updateMany({
        where: { id: orderId, status: { in: [...EDITABLE_STATUSES] } },
        data: { totalKurus },
      });
      if (count === 0) throw new EditConflict();
      await tx.orderEdit.create({
        data: {
          orderId,
          staffId: staff.id,
          staffName: staff.name,
          changesJson: JSON.stringify(changes),
          afterPrint,
        },
      });
    });
  } catch (err) {
    if (err instanceof EditConflict) return { ok: false, error: "conflict" };
    throw err;
  }

  publish({
    type: "order.updated",
    venueId,
    orderId,
    sessionId: order.sessionId,
    tableId: order.tableId,
  });

  return { ok: true, totalKurus, changes, afterPrint };
}

/** Every correction made to an order, oldest first. */
export async function orderEdits(orderId: string): Promise<
  { staffName: string; changes: LineChange[]; afterPrint: boolean; createdAt: Date }[]
> {
  const rows = await db.orderEdit.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    staffName: r.staffName,
    changes: JSON.parse(r.changesJson) as LineChange[],
    afterPrint: r.afterPrint,
    createdAt: r.createdAt,
  }));
}
