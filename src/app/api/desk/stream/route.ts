import { requireStaff } from "@/lib/staffAuth";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";
// Hold the stream for the platform maximum; EventSource reconnects by itself
// when the function is torn down at the cap.
export const maxDuration = 300;

// Desk live channel: any order event in this venue triggers a refetch hint.
export async function GET() {
  const staff = await requireStaff("desk");
  if (!staff) return new Response("unauthorized", { status: 401 });
  return sseResponse(
    (e) => e.venueId === staff.venueId && (e.type === "order.created" || e.type === "order.updated"),
    (e) => ({ type: e.type })
  );
}
