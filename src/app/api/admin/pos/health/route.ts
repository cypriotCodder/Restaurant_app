import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { CLAIM_TIMEOUT_MS, MAX_ATTEMPTS } from "@/lib/pos/outbox";

// POS outbox health for the admin panel. Without this a bridge agent that dies
// mid-service is invisible: orders keep reaching the desk, but nothing prints
// in the kitchen and nobody finds out until a customer asks where their food is.
export async function GET() {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const venueId = staff.venueId;
  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MS);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [pending, claimed, failed, sentToday, stuck, lastSent] = await Promise.all([
    db.posDelivery.count({ where: { venueId, status: "pending" } }),
    db.posDelivery.count({ where: { venueId, status: "claimed" } }),
    db.posDelivery.count({ where: { venueId, status: "failed" } }),
    db.posDelivery.count({ where: { venueId, status: "sent", updatedAt: { gt: dayAgo } } }),
    db.posDelivery.findMany({
      where: {
        venueId,
        OR: [
          { status: "failed" },
          { status: "claimed", claimedAt: { lt: staleBefore } },
          { status: "pending", createdAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      include: { order: { select: { number: true, table: { select: { name: true } } } } },
    }),
    db.posDelivery.findFirst({
      where: { venueId, status: "sent" },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  return NextResponse.json({
    counts: { pending, claimed, failed, sentToday },
    maxAttempts: MAX_ATTEMPTS,
    // Null when nothing has ever printed. The UI reads a long gap here, with
    // tickets queued, as "the bridge agent is probably down".
    lastSentAt: lastSent?.updatedAt ?? null,
    stuck: stuck.map((d) => ({
      id: d.id,
      orderNumber: d.order.number,
      tableName: d.order.table.name,
      status: d.status,
      attempts: d.attempts,
      lastError: d.lastError,
      createdAt: d.createdAt,
    })),
  });
}
