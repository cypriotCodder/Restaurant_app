import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MAX_ATTEMPTS } from "@/lib/pos/outbox";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-bridge-key");
  const row = key ? await db.bridgeKey.findUnique({ where: { key } }) : null;
  if (!row) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { deliveryId, ok, error } = await req.json().catch(() => ({}));
  const delivery = await db.posDelivery.findFirst({
    where: { id: String(deliveryId), venueId: row.venueId },
  });
  if (!delivery) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A late ack for a claim that has already been swept back to pending (and
  // possibly re-served to another agent) must not resurrect it. Only a row
  // still sitting in the claim we handed out is settled here.
  if (delivery.status !== "claimed") {
    return NextResponse.json({ ok: true, ignored: "claim_no_longer_held" });
  }

  // attempts was already incremented when the row was claimed, so the ack only
  // records the outcome.
  await db.posDelivery.update({
    where: { id: delivery.id },
    data: ok
      ? { status: "sent", claimedAt: null, claimId: null, lastError: null }
      : {
          status: delivery.attempts >= MAX_ATTEMPTS ? "failed" : "pending",
          claimedAt: null,
          claimId: null,
          lastError: String(error ?? "unknown").slice(0, 500),
        },
  });
  return NextResponse.json({ ok: true });
}
