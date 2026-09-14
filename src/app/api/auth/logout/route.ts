import { NextResponse } from "next/server";
import { STAFF_COOKIE } from "@/lib/staffAuth";
import { isSecureOrigin } from "@/lib/env";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Attributes must match the cookie being cleared, or the browser keeps the
  // original and the staff member stays signed in.
  res.cookies.set(STAFF_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureOrigin(),
    path: "/",
    maxAge: 0,
  });
  return res;
}
