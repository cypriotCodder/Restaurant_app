import { getActiveSession } from "@/lib/tableSession";
import { sseResponse } from "@/lib/sse";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
// Hold the stream for the platform maximum; EventSource reconnects by itself
// when the function is torn down at the cap.
export const maxDuration = 300;

// Customer live channel: status changes for this table's orders + menu
// availability changes (86'd items disappear mid-browse).
export async function GET() {
  const session = await getActiveSession();
  if (!session) return new Response("no_session", { status: 401 });
  const { tableId, venueId } = session;

  return sseResponse(
    // Filtering on tableId here — not inside serialize — is what keeps this
    // cheap. Every order event in the venue reaches every connected phone, so
    // deciding relevance from the event itself means one database read per
    // *relevant* event rather than one per connection per event.
    (e) => {
      if (e.venueId !== venueId) return false;
      if (e.type === "order.created" || e.type === "order.updated") return e.tableId === tableId;
      return e.type === "menu.changed";
    },
    async (e) => {
      if (e.type === "menu.changed") return { type: "menu.changed" };
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
