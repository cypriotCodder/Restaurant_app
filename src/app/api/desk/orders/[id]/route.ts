import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { publish } from "@/lib/bus";
import { enqueuePosDelivery } from "@/lib/pos/outbox";

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

  const updated = await db.order.update({
    where: { id },
    data: { status, rejectReason: status === "rejected" ? String(rejectReason).slice(0, 200) : null },
  });

  // Acceptance is the POS handoff point: ticket goes to the outbox →
  // AKINSOFT bridge (print). Failure there never blocks this response.
  if (status === "accepted") void enqueuePosDelivery(id);

  publish({ type: "order.updated", venueId: staff.venueId, orderId: id, sessionId: updated.sessionId });
  return NextResponse.json({ ok: true, status: updated.status });
}
