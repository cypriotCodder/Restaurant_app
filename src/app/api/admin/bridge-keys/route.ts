import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffAuth";
import { createBridgeKey, deleteBridgeKey } from "@/lib/venueSettings";

// Keys the on-prem bridge agent authenticates with. The plaintext is shown
// exactly once, at creation.
export async function POST(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { label } = await req.json().catch(() => ({}));
  const created = await createBridgeKey(staff.venueId, String(label ?? ""));
  return NextResponse.json({ ok: true, ...created });
}

export async function DELETE(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!(await deleteBridgeKey(staff.venueId, id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
