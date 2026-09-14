import { requireStaff } from "@/lib/staffAuth";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";
// No duration cap: this is a long-lived server, so the stream stays open for
// the whole sitting instead of being torn down and reconnected every 5 minutes.

// Desk live channel: order and bill events in this venue trigger a refetch hint.
export async function GET() {
  const staff = await requireStaff("desk");
  if (!staff) return new Response("unauthorized", { status: 401 });
  return sseResponse(
    (e) =>
      e.venueId === staff.venueId &&
      (e.type === "order.created" ||
        e.type === "order.updated" ||
        e.type === "bill.requested" ||
        e.type === "bill.updated" ||
        e.type === "visit.closed"),
    (e) => ({ type: e.type })
  );
}
