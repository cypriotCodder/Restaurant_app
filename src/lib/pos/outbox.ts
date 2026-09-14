import { db } from "../db";
import { getAdapter } from "./adapters";
import type { Ticket } from "./types";

export const MAX_ATTEMPTS = 5;

/**
 * How long a pull-based claim may be held before it is presumed dead. The
 * bridge agent polls every 3s and prints within a socket timeout of 10s, so a
 * claim outliving this has lost its agent (crash, power cut, network drop).
 */
export const CLAIM_TIMEOUT_MS = 60_000;

/**
 * Called when the desk ACCEPTS an order: writes the outbox row (with the
 * pre-rendered payload) and immediately tries push-based delivery. Failures
 * never propagate — the order already reached the desk dashboard.
 */
export async function enqueuePosDelivery(
  orderId: string,
  amendment?: Ticket["amendment"]
): Promise<void> {
  try {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { where: { voidedAt: null } }, table: true, venue: true },
    });
    const ticket = { ...ticketFor(order), amendment };
    const adapter = getAdapter(order.venue.posAdapter);
    const delivery = await db.posDelivery.create({
      data: {
        venueId: order.venueId,
        orderId: order.id,
        adapter: adapter.name,
        payload: adapter.renderPayload(ticket),
      },
    });
    // Push-based adapters complete inline; pull-based ones stay pending for the
    // bridge agent. Either way a failure here only defers the ticket to the
    // sweep — it never blocks the desk.
    await attemptDelivery(delivery.id, ticket);
  } catch (err) {
    console.error("POS enqueue failed (order still on desk):", err);
  }
}

function ticketFor(order: {
  number: number;
  createdAt: Date;
  totalKurus: number;
  venue: { name: string; currency: string };
  table: { name: string };
  items: {
    qty: number;
    nameSnapshot: string;
    note: string;
    unitPriceKurus: number;
    modifiersJson: string;
  }[];
}): Ticket {
  return {
    venueName: order.venue.name,
    currency: order.venue.currency,
    tableName: order.table.name,
    orderNumber: order.number,
    createdAt: order.createdAt,
    totalKurus: order.totalKurus,
    lines: order.items.map((i) => ({
      qty: i.qty,
      name: i.nameSnapshot,
      note: i.note,
      unitPriceKurus: i.unitPriceKurus,
      modifiers: (JSON.parse(i.modifiersJson) as { name: string }[]).map((m) => m.name),
    })),
  };
}

async function attemptDelivery(deliveryId: string, ticket: Ticket): Promise<void> {
  const delivery = await db.posDelivery.findUnique({ where: { id: deliveryId } });
  if (!delivery || delivery.status !== "pending") return;
  const adapter = getAdapter(delivery.adapter);
  try {
    const result = await adapter.deliver(delivery.payload, ticket);
    if (result.done) {
      await db.posDelivery.update({
        where: { id: deliveryId },
        data: { status: "sent", attempts: { increment: 1 } },
      });
    } else if (result.error) {
      throw new Error(result.error);
    }
    // done:false without error → pull-based, leave pending for the bridge.
  } catch (err) {
    const attempts = delivery.attempts + 1;
    await db.posDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts,
        lastError: String(err).slice(0, 500),
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      },
    });
    // Retries belong to the sweep rather than a timer here, so that a delivery
    // is retried even if the process restarts between attempts.
  }
}

export type SweepResult = {
  reclaimed: number;
  retried: number;
  exhausted: number;
};

/**
 * Periodic reconciliation for the outbox, run by /api/cron/pos-sweep.
 *
 * 1. Releases claims held past CLAIM_TIMEOUT_MS back to "pending".
 * 2. Retries pending push-based deliveries that the inline attempt missed.
 * 3. Marks rows past MAX_ATTEMPTS as "failed" so they stop being served and
 *    start showing up in the admin POS health panel.
 */
export async function sweepPosDeliveries(): Promise<SweepResult> {
  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);

  const { count: reclaimed } = await db.posDelivery.updateMany({
    where: { status: "claimed", claimedAt: { lt: staleBefore } },
    data: { status: "pending", claimId: null, claimedAt: null, lastError: "claim expired — agent did not ack" },
  });

  // A claim row with no claimedAt at all cannot age out; treat it as stale too.
  const { count: reclaimedNullish } = await db.posDelivery.updateMany({
    where: { status: "claimed", claimedAt: null },
    data: { status: "pending", claimId: null, lastError: "claim expired — agent did not ack" },
  });

  const { count: exhausted } = await db.posDelivery.updateMany({
    where: { status: "pending", attempts: { gte: MAX_ATTEMPTS } },
    data: { status: "failed" },
  });

  // Pull-based rows are left for the agent; only push adapters are retried here.
  const retryable = await db.posDelivery.findMany({
    where: { status: "pending", adapter: { not: "escpos_bridge" }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: 50,
    include: { order: { include: { items: true, table: true, venue: true } } },
  });
  for (const row of retryable) {
    await attemptDelivery(row.id, ticketFor(row.order));
  }

  return { reclaimed: reclaimed + reclaimedNullish, retried: retryable.length, exhausted };
}

/**
 * Sends an amendment ticket for an order the kitchen already has paper for.
 * Marked so a cook cannot mistake it for a second order.
 */
export function enqueueAmendmentInBackground(
  orderId: string,
  amendment: NonNullable<Ticket["amendment"]>
): void {
  void enqueuePosDelivery(orderId, amendment).catch((err) =>
    console.error("POS amendment rejected:", err)
  );
}

/**
 * Fire-and-forget: the desk gets its response immediately and the ticket makes
 * its own way to the printer. Safe to leave running here because this is a
 * long-lived server — the process is not torn down when the response returns —
 * and the sweep picks up anything this misses.
 */
export function enqueuePosDeliveryInBackground(orderId: string): void {
  void enqueuePosDelivery(orderId).catch((err) => console.error("POS enqueue rejected:", err));
}
