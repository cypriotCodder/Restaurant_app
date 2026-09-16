import { getActiveSession } from "@/lib/tableSession";
import { sseResponse } from "@/lib/sse";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
// No duration cap: this is a long-lived server, so the stream stays open for
// the whole sitting instead of being torn down and reconnected every 5 minutes.

// Customer live channel: status changes for this table's orders + menu
// availability changes (86'd items disappear mid-browse).
export async function GET() {
  const session = await getActiveSession();
  if (!session) return new Response("no_session", { status: 401 });
  const { id: sessionId, tableId, venueId } = session;

  return sseResponse(
    // Filtering on tableId here — not inside serialize — is what keeps this
    // cheap. Every order event in the venue reaches every connected phone, so
    // deciding relevance from the event itself means one database read per
    // *relevant* event rather than one per connection per event.
    (e) => {
      if (e.venueId !== venueId) return false;
      if (
        e.type === "order.created" ||
        e.type === "order.updated" ||
        e.type === "bill.requested" ||
        e.type === "bill.updated" ||
        e.type === "visit.closed"
      ) {
        return e.tableId === tableId;
      }
      // Staff ended THIS phone's session from the admin screen. Only this
      // phone needs to hear it; the rest of the table carries on.
      if (e.type === "session.revoked") return e.sessionId === sessionId;
      return e.type === "menu.changed";
    },
    async (e) => {
      if (e.type === "menu.changed") return { type: "menu.changed" };
      if (e.type === "session.revoked") return { type: "session.revoked" };
      // The party's table was settled and their sessions revoked: the phone
      // should show the "thanks, re-scan to order again" state immediately
      // rather than discovering it on the next failed request.
      if (e.type === "visit.closed") return { type: "visit.closed" };
      if (e.type === "bill.requested" || e.type === "bill.updated") return { type: "bill.updated" };
      if (e.type === "order.created" || e.type === "order.updated") {
        const order = await db.order.findUnique({
          where: { id: e.orderId },
          select: { id: true, tableId: true, status: true, rejectReason: true },
        });
        // The filter already matched on the event's tableId; this re-check
        // covers the case of an order moved between tables after the event
        // was published.
        if (!order || order.tableId !== tableId) return null;
        return {
          type: "order.updated",
          orderId: order.id,
          status: order.status,
          rejectReason: order.rejectReason,
        };
      }
      return null;
    }
  );
}
