import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db, type Prisma } from "@/lib/db";
import { CLAIM_TIMEOUT_MS, MAX_ATTEMPTS } from "@/lib/pos/outbox";

// Pull endpoint for the on-prem bridge agent (bridge/agent.mjs). The agent
// authenticates with its venue-scoped key, claims pending ESC/POS payloads,
// prints them on the kitchen printer, then acks via /api/bridge/ack.

const BATCH = 10;

async function venueForKey(req: NextRequest): Promise<string | null> {
  const key = req.headers.get("x-bridge-key");
  if (!key) return null;
  const row = await db.bridgeKey.findUnique({ where: { key } });
  return row?.venueId ?? null;
}

export async function GET(req: NextRequest) {
  const venueId = await venueForKey(req);
  if (!venueId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  // A row is claimable if it is pending, or if a previous agent claimed it and
  // died without acking. Recovering stale claims here (as well as in the cron
  // sweep) means a bridge that restarts picks its own dropped tickets straight
  // back up instead of waiting for the next sweep.
  const claimable = {
    venueId,
    adapter: "escpos_bridge",
    attempts: { lt: MAX_ATTEMPTS },
    OR: [
      { status: "pending" },
      { status: "claimed", claimedAt: { lt: staleBefore } },
      { status: "claimed", claimedAt: null },
    ],
  } satisfies Prisma.PosDeliveryWhereInput;

  const candidates = await db.posDelivery.findMany({
    where: claimable,
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: { id: true },
  });
  if (candidates.length === 0) return NextResponse.json({ deliveries: [] });

  // Claim atomically: the UPDATE re-checks the claimable predicate, so if a
  // second agent raced us to these rows its write lands first and ours matches
  // nothing. Whoever wins owns the batch under their own claimId.
  //
  // attempts is incremented at claim time, not at ack time, so a payload that
  // reliably crashes the agent still walks toward MAX_ATTEMPTS instead of
  // being re-served forever.
  const claimId = randomUUID();
  await db.posDelivery.updateMany({
    where: { id: { in: candidates.map((c) => c.id) }, ...claimable },
    data: { status: "claimed", claimedAt: new Date(), claimId, attempts: { increment: 1 } },
  });

  const claimed = await db.posDelivery.findMany({
    where: { claimId },
    orderBy: { createdAt: "asc" },
    include: { order: { include: { table: true } } },
  });

  return NextResponse.json({
    deliveries: claimed.map((p) => ({
      id: p.id,
      orderNumber: p.order.number,
      tableName: p.order.table.name,
      payloadBase64: p.payload,
    })),
  });
}
