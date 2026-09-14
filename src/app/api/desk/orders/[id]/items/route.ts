import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffAuth";
import { editOrder, orderEditSchema } from "@/lib/orderEdit";
import { enqueueAmendmentInBackground } from "@/lib/pos/outbox";

// Desk corrections: reduce a quantity, or remove a line.
//
// "One fewer coffee" previously meant rejecting the whole ticket and asking the
// customer to order again. Quantities may only go down — adding is a new order,
// which gets the kitchen a fresh ticket instead of an amendment.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("desk");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = orderEditSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", detail: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  const result = await editOrder(id, staff.venueId, { id: staff.sub, name: staff.name }, parsed.data);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.error, status: result.status }, { status });
  }

  // The kitchen already holds paper for this order, so it needs to be told the
  // order changed — not handed an unmarked second ticket.
  if (result.afterPrint) {
    enqueueAmendmentInBackground(id, { changes: result.changes, byStaff: staff.name });
  }

  return NextResponse.json({
    ok: true,
    totalKurus: result.totalKurus,
    changes: result.changes,
    amendmentPrinted: result.afterPrint,
  });
}
