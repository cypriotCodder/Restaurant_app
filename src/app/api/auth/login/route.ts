import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { loginStaff, STAFF_COOKIE } from "@/lib/staffAuth";
import { rateLimit, clientIp } from "@/lib/rateLimit";

// Staff login is the one unauthenticated endpoint the table-session design does
// not cover, and every failed attempt costs a bcrypt compare. Two limits apply:
// a per-IP one that stops a single host hammering the endpoint, and a per-account
// one so a distributed attempt cannot grind a known email address either.
const IP_LIMIT = 10;
const IP_WINDOW_SEC = 10 * 60;
const ACCOUNT_LIMIT = 5;
const ACCOUNT_WINDOW_SEC = 15 * 60;

// The email is hashed into the key so raw staff addresses never sit in Redis.
const accountKey = (email: string) =>
  "login:acct:" + createHash("sha256").update(email).digest("base64url").slice(0, 24);

function tooMany(retryAfterSec: number) {
  return NextResponse.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  );
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const normalized = email.toLowerCase().trim();

  const ip = clientIp(req);
  const byIp = await rateLimit(`login:ip:${ip || "unknown"}`, IP_LIMIT, IP_WINDOW_SEC);
  if (!byIp.allowed) return tooMany(byIp.retryAfterSec);

  const byAccount = await rateLimit(accountKey(normalized), ACCOUNT_LIMIT, ACCOUNT_WINDOW_SEC);
  if (!byAccount.allowed) return tooMany(byAccount.retryAfterSec);

  const token = await loginStaff(normalized, password);
  if (!token) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // The staff cookie must never travel in cleartext; the customer session
    // cookie is set on the same origin and already rides HTTPS in production.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return res;
}
