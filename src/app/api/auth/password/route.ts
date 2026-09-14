import { NextRequest, NextResponse } from "next/server";
import { getStaff, createStaffToken, STAFF_COOKIE } from "@/lib/staffAuth";
import { changeOwnPassword, passwordChangeSchema } from "@/lib/staffAdmin";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { db } from "@/lib/db";
import { isSecureOrigin } from "@/lib/env";

// Self-service password change for any signed-in staff member.
//
// Requires the current password: the desk is a shared terminal, and without it
// anyone walking past an unattended screen could take the account over.
export async function POST(req: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // The current-password check is a guessing oracle like the login form, so it
  // gets the same treatment.
  const limit = rateLimit(`pwchange:${staff.sub}:${clientIp(req)}`, 5, 15 * 60);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  const parsed = passwordChangeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", detail: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  const result = await changeOwnPassword(staff.sub, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "wrong_password" ? 403 : 404 });
  }

  // Changing the password bumps tokenVersion, which invalidates every token —
  // including the one in this browser. Re-issue at the new version so the
  // person who just changed it is not signed out of the terminal they are
  // standing at, while every other device is.
  const fresh = await db.staffUser.findUniqueOrThrow({
    where: { id: staff.sub },
    select: { tokenVersion: true, role: true, name: true, venueId: true },
  });
  const token = await createStaffToken({
    sub: staff.sub,
    venueId: fresh.venueId,
    role: fresh.role as "admin" | "desk",
    name: fresh.name,
    ver: fresh.tokenVersion,
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureOrigin(),
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}
