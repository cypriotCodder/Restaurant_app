import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { publish } from "@/lib/bus";
import { enqueuePosDeliveryInBackground } from "@/lib/pos/outbox";

// `cancelled` is absent by design: it is the customer's own withdrawal and is
// terminal. Staff refusing an order use `rejected`, which carries a reason.
const transitions: Record<string, string[]> = {
  received: ["accepted", "rejected"],
  accepted: ["preparing", "ready", "rejected"],
  preparing: ["ready", "rejected"],
  ready: ["served"],
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await requireStaff("desk");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const { status, rejectReason } = await req.json().catch(() => ({}));

  const order = await db.order.findFirst({ where: { id, venueId: staff.venueId } });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!transitions[order.status]?.includes(status)) {
    return NextResponse.json({ error: "invalid_transition", from: order.status }, { status: 409 });
  }
  if (status === "rejected" && !rejectReason) {
    return NextResponse.json({ error: "reason_required" }, { status: 400 });
  }

  // Conditional update, for the same reason the customer's cancel is one: two
  // desk devices (or one double-tap on a slow link) must not both win this
  // transition. Accepting twice is the expensive version — each acceptance
  // enqueues a kitchen ticket, and the kitchen cooks what it is handed.
  const { count } = await db.order.updateMany({
    where: { id, status: order.status },
    data: { status, rejectReason: status === "rejected" ? String(rejectReason).slice(0, 200) : null },
  });
  if (count === 0) {
    // Someone else moved it between the read and the write.
    const now = await db.order.findFirst({ where: { id, venueId: staff.venueId }, select: { status: true } });
    return NextResponse.json({ error: "invalid_transition", from: now?.status ?? order.status }, { status: 409 });
  }
  const updated = { ...order, status, sessionId: order.sessionId, tableId: order.tableId };

  // Acceptance is the POS handoff point: ticket goes to the outbox →
  // AKINSOFT bridge (print). Failure there never blocks this response, but the
  // work is registered with waitUntil so the platform cannot freeze the
  // instance out from under the enqueue the moment we return.
  if (status === "accepted") enqueuePosDeliveryInBackground(id);

  publish({
    type: "order.updated",
    venueId: staff.venueId,
    orderId: id,
    sessionId: updated.sessionId,
    tableId: updated.tableId,
  });
  return NextResponse.json({ ok: true, status: updated.status });
}
