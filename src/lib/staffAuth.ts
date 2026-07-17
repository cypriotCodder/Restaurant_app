import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "./db";

const COOKIE = "staff_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-secret");

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
