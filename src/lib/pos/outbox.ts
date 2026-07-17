import { db } from "../db";
import { getAdapter } from "./adapters";
import type { Ticket } from "./types";

const MAX_ATTEMPTS = 5;

/**
 * Called when the desk ACCEPTS an order: writes the outbox row (with the
 * pre-rendered payload) and immediately tries push-based delivery. Failures
 * never propagate — the order already reached the desk dashboard.
 */
export async function enqueuePosDelivery(orderId: string): Promise<void> {
  try {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true, table: true, venue: true },
    });
    const ticket: Ticket = {
      venueName: order.venue.name,
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
    const adapter = getAdapter(order.venue.posAdapter);
    const delivery = await db.posDelivery.create({
      data: {
        venueId: order.venueId,
        orderId: order.id,
        adapter: adapter.name,
        payload: adapter.renderPayload(ticket),
      },
    });
    // Push-based adapters complete inline; pull-based ones stay pending.
    void attemptDelivery(delivery.id, ticket).catch(() => {});
  } catch (err) {
    console.error("POS enqueue failed (order still on desk):", err);
  }
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
        lastError: String(err),
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
      },
    });
    if (attempts < MAX_ATTEMPTS) {
      setTimeout(() => void attemptDelivery(deliveryId, ticket).catch(() => {}), attempts * 5000);
    }
  }
}
