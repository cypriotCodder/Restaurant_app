import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";

// Manual "print again" for a delivery the sweep gave up on. Resets attempts so
// the row re-enters the normal claim cycle — the usual fix after the kitchen
// printer was offline or out of paper and is now back.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const delivery = await db.posDelivery.findFirst({ where: { id, venueId: staff.venueId } });
  if (!delivery) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db.posDelivery.update({
    where: { id },
    data: { status: "pending", attempts: 0, claimedAt: null, claimId: null, lastError: null },
  });
  return NextResponse.json({ ok: true });
}
