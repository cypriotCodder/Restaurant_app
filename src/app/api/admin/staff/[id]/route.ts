import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffAuth";
import { updateStaff, staffUpdateSchema } from "@/lib/staffAdmin";

// Rename, change role, reset a password, deactivate, or force-sign-out every
// device an account is logged in on.
//
// Anything that changes who an account is, or who may use it, bumps
// tokenVersion — otherwise the stateless 12h JWT already in someone's browser
// keeps working after they have been dismissed or had their password reset.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = staffUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", detail: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  const result = await updateStaff(staff.venueId, id, staff.sub, parsed.data);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : result.error === "nothing_to_do" ? 400 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
