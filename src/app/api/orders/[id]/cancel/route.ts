import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveSession } from "@/lib/tableSession";
import { logAttempt } from "@/lib/attempts";
import { publish } from "@/lib/bus";
import { CUSTOMER_CANCELLABLE } from "@/lib/orderStatus";

// A customer withdrawing their own order.
//
// Allowed only while the order is still `received` — once staff accept it the
// kitchen may already have started, and the withdrawal has to go through them.
// There is no extra time limit: an order sitting unaccepted for twenty minutes
// is one the customer is entitled to give up on.
//
// Scoped to the session that placed it. The orders list is a whole-table view,
// so without this check one phone could cancel another diner's food.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getActiveSession();
  if (!session) return NextResponse.json({ error: "no_session" }, { status: 401 });
  const { id } = await params;

  const order = await db.order.findFirst({
    where: { id, sessionId: session.id },
    select: { id: true, status: true, visitId: true },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (order.status !== CUSTOMER_CANCELLABLE) {
    // Most often the desk accepted it a second earlier. Tell the customer what
    // happened rather than just refusing.
    return NextResponse.json({ error: "already_accepted", status: order.status }, { status: 409 });
  }

  // Conditional update: two taps, or a cancel racing the desk's accept, must
  // not both win. Whoever writes first owns the outcome.
  const { count } = await db.order.updateMany({
    where: { id, status: CUSTOMER_CANCELLABLE },
    data: { status: "cancelled" },
  });
  if (count === 0) {
    return NextResponse.json({ error: "already_accepted" }, { status: 409 });
  }

  await logAttempt(req, "customer_cancelled", {
    venueId: session.venueId,
    tableId: session.tableId,
    sessionId: session.id,
    orderId: id,
  });
  publish({
    type: "order.updated",
    venueId: session.venueId,
    orderId: id,
    sessionId: session.id,
    tableId: session.tableId,
  });
  return NextResponse.json({ ok: true });
}
