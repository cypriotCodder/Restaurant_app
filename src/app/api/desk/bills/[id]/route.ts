import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffAuth";
import { buildBill, clearBillRequest } from "@/lib/visit";
import { db } from "@/lib/db";

// One table's itemised bill, including the per-phone split for "we're paying
// separately".
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("desk");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const visit = await db.tableVisit.findFirst({
    where: { id, venueId: staff.venueId },
    select: { id: true },
  });
  if (!visit) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const bill = await buildBill(id);
  if (!bill) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ bill });
}

/** Dismiss a bill request the customer changed their mind about. */
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("desk");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const ok = await clearBillRequest(id, staff.venueId);
  if (!ok) return NextResponse.json({ error: "not_requested" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
