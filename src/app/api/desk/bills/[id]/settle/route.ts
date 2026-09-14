import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/staffAuth";
import { settleVisit } from "@/lib/visit";

// Staff took payment at the till: close the table, record what was taken, mark
// the orders paid and revoke the party's phones.
//
// This is the only endpoint in the app that records money, and it is staff-only
// by design — a customer can ask for the bill, never close one.

const settleSchema = z.object({
  paymentMethod: z.enum(["cash", "card"]),
  // Defaults to the bill total. Present so a venue can record what was actually
  // handed over, which is what makes the till reconcile.
  paidAmountKurus: z.number().int().min(0).optional(),
  // Deliberate override for closing a table whose kitchen orders are still open.
  force: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("desk");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = settleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await settleVisit(id, staff.venueId, {
    paymentMethod: parsed.data.paymentMethod,
    paidAmountKurus: parsed.data.paidAmountKurus,
    staffId: staff.sub,
    force: parsed.data.force,
  });

  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, totalKurus: result.totalKurus });
}
