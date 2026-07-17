import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-bridge-key");
  const row = key ? await db.bridgeKey.findUnique({ where: { key } }) : null;
  if (!row) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { deliveryId, ok, error } = await req.json().catch(() => ({}));
  const delivery = await db.posDelivery.findFirst({
    where: { id: String(deliveryId), venueId: row.venueId },
  });
  if (!delivery) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db.posDelivery.update({
    where: { id: delivery.id },
    data: ok
      ? { status: "sent", attempts: { increment: 1 } }
      : {
          status: delivery.attempts + 1 >= 5 ? "failed" : "pending",
          attempts: { increment: 1 },
          lastError: String(error ?? "unknown").slice(0, 500),
        },
  });
  return NextResponse.json({ ok: true });
}
