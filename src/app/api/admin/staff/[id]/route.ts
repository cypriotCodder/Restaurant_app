import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff, invalidateStaffCache } from "@/lib/staffAuth";

// Deactivate an account, or force-sign-out every device it is logged in on.
// Both work by bumping tokenVersion, which invalidates the stateless 12h JWTs
// that would otherwise keep a dismissed employee inside the desk all shift.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const target = await db.staffUser.findFirst({ where: { id, venueId: staff.venueId } });
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Locking yourself out mid-service is not a recoverable mistake from inside
  // the admin panel, so it is refused.
  if (id === staff.sub && body.active === false) {
    return NextResponse.json({ error: "cannot_deactivate_self" }, { status: 409 });
  }

  const data: { active?: boolean; tokenVersion?: { increment: number } } = {};
  if (body.active !== undefined) data.active = Boolean(body.active);
  // Deactivating must also revoke: a deactivated account with a live token
  // would otherwise keep working until the account cache expired.
  if (body.signOutEverywhere || body.active === false) data.tokenVersion = { increment: 1 };
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing_to_do" }, { status: 400 });
  }

  await db.staffUser.update({ where: { id }, data });
  // Skip the 30s cache window for a deliberate revocation on this instance.
  invalidateStaffCache(id);
  return NextResponse.json({ ok: true });
}
