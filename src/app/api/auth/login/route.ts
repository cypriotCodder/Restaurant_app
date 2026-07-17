import { NextRequest, NextResponse } from "next/server";
import { loginStaff, STAFF_COOKIE } from "@/lib/staffAuth";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const token = await loginStaff(email.toLowerCase().trim(), password);
  if (!token) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}
