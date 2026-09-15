import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffAuth";
import { buildBillSummaries } from "@/lib/visit";

// Open tables, for the desk's bill view. Tables that have asked for the bill
// sort first — that is the queue staff are working through.
export async function GET() {
  const staff = await requireStaff("desk");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const bills = await buildBillSummaries(staff.venueId);

  return NextResponse.json({
    // A table nobody has ordered at yet is noise on the bill screen.
    bills: bills.filter((b) => b.orderCount > 0 || b.status === "bill_requested"),
  });
}
