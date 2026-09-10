import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";
import { getEnv } from "./env";

const COOKIE = "staff_session";
// No fallback by design: an unset AUTH_SECRET must break signing loudly rather
// than silently sign every staff token with a value an attacker can guess.
const secret = () => new TextEncoder().encode(getEnv().AUTH_SECRET);

/**
 * How long a validated account state may be reused before it is re-read.
 * Staff tokens are stateless JWTs, so revocation is only as fast as this
 * window — 30s, versus the 12h token life it replaces. The trade is one DB
 * read per staff member per 30s instead of one on every request, which
 * matters because the desk polls and holds an SSE stream open all service.
 */
const ACCOUNT_CACHE_MS = 30_000;

export type StaffClaims = {
  sub: string; // StaffUser.id
  venueId: string;
  role: "admin" | "desk";
  name: string;
  /** Must match StaffUser.tokenVersion or the token is treated as revoked. */
  ver: number;
};

const globalForStaff = globalThis as unknown as {
  staffAccountCache?: Map<string, { checkedAt: number; active: boolean; tokenVersion: number; role: string; name: string }>;
};
const accountCache = (globalForStaff.staffAccountCache ??= new Map());

export async function createStaffToken(claims: StaffClaims): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("12h")
    .sign(secret());
}

/** Drops the cached state for one account so a revocation takes effect at once. */
export function invalidateStaffCache(staffId: string): void {
  accountCache.delete(staffId);
}

async function accountState(staffId: string) {
  const cached = accountCache.get(staffId);
  if (cached && Date.now() - cached.checkedAt < ACCOUNT_CACHE_MS) return cached;
  const user = await db.staffUser.findUnique({
    where: { id: staffId },
    select: { active: true, tokenVersion: true, role: true, name: true },
  });
  if (!user) {
    accountCache.delete(staffId);
    return null;
  }
  const state = { ...user, checkedAt: Date.now() };
  accountCache.set(staffId, state);
  return state;
}

export async function getStaff(): Promise<StaffClaims | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let claims: StaffClaims;
  try {
    const { payload } = await jwtVerify(token, secret());
    claims = payload as unknown as StaffClaims;
  } catch {
    return null;
  }
  if (!claims.sub) return null;

  // A valid signature is no longer sufficient: the account must still exist,
  // still be active, and still be on the token version the token was cut at.
  const account = await accountState(claims.sub);
  if (!account || !account.active) return null;
  if ((claims.ver ?? -1) !== account.tokenVersion) return null;

  // Role and name come from the account rather than the token, so a demotion
  // takes effect on the same 30s window as a revocation.
  return {
    sub: claims.sub,
    venueId: claims.venueId,
    role: account.role as "admin" | "desk",
    name: account.name,
    ver: account.tokenVersion,
  };
}

/** Route-handler guard. Admin role implies desk access. */
export async function requireStaff(role: "admin" | "desk" = "desk"): Promise<StaffClaims | null> {
  const staff = await getStaff();
  if (!staff) return null;
  if (role === "admin" && staff.role !== "admin") return null;
  return staff;
}

export async function loginStaff(email: string, password: string): Promise<string | null> {
  const bcrypt = await import("bcryptjs");
  const user = await db.staffUser.findUnique({ where: { email } });
  if (!user) return null;
  // Deactivated accounts still compare the password so login timing does not
  // reveal which addresses have been switched off.
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok || !user.active) return null;
  return createStaffToken({
    sub: user.id,
    venueId: user.venueId,
    role: user.role as "admin" | "desk",
    name: user.name,
    ver: user.tokenVersion,
  });
}

export const STAFF_COOKIE = COOKIE;
