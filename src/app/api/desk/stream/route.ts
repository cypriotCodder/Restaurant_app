import { requireStaff } from "@/lib/staffAuth";
import { sseResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";

// Desk live channel: any order event in this venue triggers a refetch hint.
export async function GET() {
  const staff = await requireStaff("desk");
  if (!staff) return new Response("unauthorized", { status: 401 });
  return sseResponse(
    (e) => e.venueId === staff.venueId && (e.type === "order.created" || e.type === "order.updated"),
    (e) => ({ type: e.type })
  );
}
