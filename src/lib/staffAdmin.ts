import { z } from "zod";
import { db } from "./db";
import { invalidateStaffCache } from "./staffAuth";

// Staff account management.
//
// Restaurant staff turn over constantly, so this has to be usable by a manager
// on the admin screen, not by someone with psql. Everything here is admin-only;
// the route handlers enforce that before calling in.

/**
 * Staff type this on a shared terminal several times a shift. A long minimum
 * drives them to write it on a sticky note next to the till, which is strictly
 * worse than a short one. The real defence against guessing is the login rate
 * limiter (5 attempts per account per 15 minutes) in src/lib/rateLimit.ts.
 */
export const PASSWORD_MIN = 8;

const password = z
  .string()
  .min(PASSWORD_MIN, `en az ${PASSWORD_MIN} karakter / at least ${PASSWORD_MIN} characters`);

export const staffCreateSchema = z.object({
  email: z.string().email("geçerli bir e-posta girin / enter a valid email"),
  name: z.string().min(1, "isim gerekli / name required").max(80),
  role: z.enum(["admin", "desk"]),
  password,
});

export const staffUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  role: z.enum(["admin", "desk"]).optional(),
  active: z.boolean().optional(),
  /** Admin resetting someone else's password — no current password needed. */
  password: password.optional(),
  signOutEverywhere: z.boolean().optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

export type StaffError =
  | "email_taken"
  | "not_found"
  | "last_admin"
  | "cannot_deactivate_self"
  | "cannot_demote_self"
  | "nothing_to_do"
  | "wrong_password";

async function hash(plain: string): Promise<string> {
  const bcrypt = await import("bcryptjs");
  return bcrypt.hash(plain, 10);
}

/** Active admins other than `exceptId`. Guards the lock-yourself-out cases. */
async function otherActiveAdmins(venueId: string, exceptId: string): Promise<number> {
  return db.staffUser.count({
    where: { venueId, role: "admin", active: true, id: { not: exceptId } },
  });
}

export async function createStaff(
  venueId: string,
  input: z.infer<typeof staffCreateSchema>
): Promise<{ ok: true; id: string } | { ok: false; error: StaffError }> {
  const email = input.email.toLowerCase().trim();
  try {
    const user = await db.staffUser.create({
      data: {
        venueId,
        email,
        name: input.name.trim(),
        role: input.role,
        passwordHash: await hash(input.password),
      },
      select: { id: true },
    });
    return { ok: true, id: user.id };
  } catch (err) {
    // StaffUser.email is globally unique, not per-venue, so this also fires
    // when the address belongs to a different venue. The error is deliberately
    // the same either way: a manager must not be able to probe which addresses
    // exist elsewhere in the platform.
    if ((err as { code?: string }).code === "P2002") return { ok: false, error: "email_taken" };
    throw err;
  }
}

export async function updateStaff(
  venueId: string,
  targetId: string,
  actorId: string,
  input: z.infer<typeof staffUpdateSchema>
): Promise<{ ok: true } | { ok: false; error: StaffError }> {
  const target = await db.staffUser.findFirst({ where: { id: targetId, venueId } });
  if (!target) return { ok: false, error: "not_found" };

  // Locking yourself out mid-service is not recoverable from inside the admin
  // panel, so both routes to it are refused.
  if (targetId === actorId && input.active === false) {
    return { ok: false, error: "cannot_deactivate_self" };
  }
  if (targetId === actorId && input.role === "desk") {
    return { ok: false, error: "cannot_demote_self" };
  }

  // Removing the venue's last admin would leave nobody able to manage the menu,
  // the tables or the staff — recoverable only with database access.
  const losesAdmin =
    target.role === "admin" && target.active && (input.active === false || input.role === "desk");
  if (losesAdmin && (await otherActiveAdmins(venueId, targetId)) === 0) {
    return { ok: false, error: "last_admin" };
  }

  const data: {
    name?: string;
    role?: string;
    active?: boolean;
    passwordHash?: string;
    tokenVersion?: { increment: number };
  } = {};

  if (input.name !== undefined) data.name = input.name.trim();
  if (input.role !== undefined) data.role = input.role;
  if (input.active !== undefined) data.active = input.active;
  if (input.password !== undefined) data.passwordHash = await hash(input.password);

  // Anything that changes who this account is, or who may use it, invalidates
  // the stateless tokens already issued to it. Without this a dismissed
  // employee, or someone whose password was just reset because it leaked,
  // keeps working until the 12h token expires.
  const mustRevoke =
    input.signOutEverywhere === true ||
    input.active === false ||
    input.password !== undefined ||
    input.role !== undefined;
  if (mustRevoke) data.tokenVersion = { increment: 1 };

  if (Object.keys(data).length === 0) return { ok: false, error: "nothing_to_do" };

  await db.staffUser.update({ where: { id: targetId }, data });
  // Skip the 30s account cache for a deliberate change on this instance.
  invalidateStaffCache(targetId);
  return { ok: true };
}

/**
 * Self-service password change. Requires the current password, so a terminal
 * someone walked away from cannot be used to take the account over.
 */
export async function changeOwnPassword(
  staffId: string,
  input: z.infer<typeof passwordChangeSchema>
): Promise<{ ok: true } | { ok: false; error: StaffError }> {
  const bcrypt = await import("bcryptjs");
  const user = await db.staffUser.findUnique({ where: { id: staffId } });
  if (!user) return { ok: false, error: "not_found" };
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    return { ok: false, error: "wrong_password" };
  }

  await db.staffUser.update({
    where: { id: staffId },
    data: {
      passwordHash: await hash(input.newPassword),
      // Signs out every other device. The one doing the changing gets a fresh
      // token from the route so the person changing it is not logged out.
      tokenVersion: { increment: 1 },
    },
  });
  invalidateStaffCache(staffId);
  return { ok: true };
}
