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
    (e) => e.venueId === venueId,
    async (e) => {
      if (e.type === "menu.changed") return { type: "menu.changed" };
      if (e.type === "order.created" || e.type === "order.updated") {
        const order = await db.order.findUnique({ where: { id: e.orderId } });
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
