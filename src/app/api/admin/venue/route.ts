import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import {
  updateVenueSettings,
  venueSettingsSchema,
  listBridgeKeys,
  CURRENCIES,
  POS_ADAPTERS,
} from "@/lib/venueSettings";

export async function GET() {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const venue = await db.venue.findUniqueOrThrow({
    where: { id: staff.venueId },
    // qrSecret is deliberately absent: it never leaves the server.
    select: { name: true, slug: true, currency: true, defaultLocale: true, posAdapter: true },
  });
  const tableCount = await db.table.count({ where: { venueId: staff.venueId } });

  return NextResponse.json({
    venue,
    tableCount,
    bridgeKeys: await listBridgeKeys(staff.venueId),
    options: { currencies: CURRENCIES, posAdapters: POS_ADAPTERS },
  });
}

export async function PATCH(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = venueSettingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", detail: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  const result = await updateVenueSettings(staff.venueId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
