import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { rotateQrSecret } from "@/lib/venueSettings";

// Rotates the venue's QR signing key. This invalidates EVERY printed table card
// at once and signs out every customer — the recovery path for a leaked secret,
// not routine maintenance. Per-table regeneration lives on the Tables screen.
//
// Guarded by typing the venue slug, the same way destructive operations are
// confirmed elsewhere: a mis-click here means reprinting every table in the
// restaurant during service.
export async function POST(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { confirm } = await req.json().catch(() => ({}));
  const venue = await db.venue.findUniqueOrThrow({
    where: { id: staff.venueId },
    select: { slug: true },
  });
  if (confirm !== venue.slug) {
    return NextResponse.json({ error: "confirmation_required", expected: venue.slug }, { status: 409 });
  }

  const { tablesAffected } = await rotateQrSecret(staff.venueId);
  console.warn(`[venue] QR secret rotated by ${staff.sub}; ${tablesAffected} tables must be reprinted`);
  return NextResponse.json({ ok: true, tablesAffected });
}
