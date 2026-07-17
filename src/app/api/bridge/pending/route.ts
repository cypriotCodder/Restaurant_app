import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Pull endpoint for the on-prem bridge agent (bridge/agent.mjs). The agent
// authenticates with its venue-scoped key, claims pending ESC/POS payloads,
// prints them on the kitchen printer, then acks via /api/bridge/ack.

async function venueForKey(req: NextRequest): Promise<string | null> {
  const key = req.headers.get("x-bridge-key");
  if (!key) return null;
  const row = await db.bridgeKey.findUnique({ where: { key } });
  return row?.venueId ?? null;
}

export async function GET(req: NextRequest) {
  const venueId = await venueForKey(req);
  if (!venueId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const pending = await db.posDelivery.findMany({
    where: { venueId, adapter: "escpos_bridge", status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 10,
    include: { order: { include: { table: true } } },
  });
  await db.posDelivery.updateMany({
    where: { id: { in: pending.map((p) => p.id) } },
    data: { status: "claimed" },
  });
  return NextResponse.json({
    deliveries: pending.map((p) => ({
      id: p.id,
      orderNumber: p.order.number,
      tableName: p.order.table.name,
      payloadBase64: p.payload,
    })),
  });
}
