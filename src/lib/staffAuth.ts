import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";
import { getEnv } from "./env";

const COOKIE = "staff_session";
// No fallback by design: an unset AUTH_SECRET must break signing loudly rather
// than silently sign every staff token with a value an attacker can guess.
const secret = () => new TextEncoder().encode(getEnv().AUTH_SECRET);

export type StaffClaims = {
  sub: string; // StaffUser.id
  venueId: string;
  role: "admin" | "desk";
  name: string;
};

export async function createStaffToken(claims: StaffClaims): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("12h")
    .sign(secret());
}

export async function getStaff(): Promise<StaffClaims | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as StaffClaims;
  } catch {
    return null;
  }
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
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return createStaffToken({
    sub: user.id,
    venueId: user.venueId,
    role: user.role as "admin" | "desk",
    name: user.name,
  });
}

export const STAFF_COOKIE = COOKIE;
