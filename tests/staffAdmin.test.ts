import { describe, it, expect, vi, beforeEach } from "vitest";

// Staff management is the one admin surface that can lock a venue out of its
// own system, so the guards matter more than the happy path: you must not be
// able to remove the last admin, demote yourself, or leave a dismissed
// employee holding a valid 12h token.

const staffCreate = vi.fn();
const staffFindFirst = vi.fn();
const staffFindUnique = vi.fn();
const staffUpdate = vi.fn();
const staffCount = vi.fn();
const invalidateStaffCache = vi.fn();
const bcryptHash = vi.fn();
const bcryptCompare = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    staffUser: {
      create: (...a: unknown[]) => staffCreate(...a),
      findFirst: (...a: unknown[]) => staffFindFirst(...a),
      findUnique: (...a: unknown[]) => staffFindUnique(...a),
      update: (...a: unknown[]) => staffUpdate(...a),
      count: (...a: unknown[]) => staffCount(...a),
    },
  },
}));
vi.mock("@/lib/staffAuth", () => ({
  invalidateStaffCache: (...a: unknown[]) => invalidateStaffCache(...a),
}));
// The code does `const bcrypt = await import("bcryptjs")` and calls
// bcrypt.hash/compare off the namespace, so the mock must expose them as named
// exports as well as on default.
vi.mock("bcryptjs", () => {
  const hash = (...a: unknown[]) => bcryptHash(...a);
  const compare = (...a: unknown[]) => bcryptCompare(...a);
  return { hash, compare, default: { hash, compare } };
});

const { createStaff, updateStaff, changeOwnPassword, staffCreateSchema, PASSWORD_MIN } =
  await import("@/lib/staffAdmin");

const VENUE = "venue_1";
const ACTOR = "staff_admin";

const user = (over: Record<string, unknown> = {}) => ({
  id: "staff_target",
  venueId: VENUE,
  email: "desk@example.com",
  name: "Mutfak",
  role: "desk",
  active: true,
  passwordHash: "hashed",
  tokenVersion: 0,
  ...over,
});

const unique = () => Object.assign(new Error("unique"), { code: "P2002" });

beforeEach(() => {
  vi.clearAllMocks();
  bcryptHash.mockResolvedValue("new-hash");
  bcryptCompare.mockResolvedValue(true);
  staffUpdate.mockResolvedValue({});
  staffCount.mockResolvedValue(1);
});

describe("createStaff", () => {
  it("creates an account with a hashed password", async () => {
    staffCreate.mockResolvedValue({ id: "new_1" });
    const result = await createStaff(VENUE, {
      email: "Yeni@Example.com",
      name: "  Ayşe  ",
      role: "desk",
      password: "correct-horse",
    });
    expect(result).toEqual({ ok: true, id: "new_1" });

    const data = staffCreate.mock.calls[0][0].data;
    // Never the plaintext.
    expect(data.passwordHash).toBe("new-hash");
    expect(data).not.toHaveProperty("password");
    // Normalised, so "Yeni@" and "yeni@" cannot become two accounts.
    expect(data.email).toBe("yeni@example.com");
    expect(data.name).toBe("Ayşe");
    expect(data.venueId).toBe(VENUE);
  });

  it("reports a duplicate email without revealing which venue owns it", async () => {
    // StaffUser.email is globally unique, so this also fires for an address in
    // another venue. A manager must not be able to probe the platform.
    staffCreate.mockRejectedValue(unique());
    expect(await createStaff(VENUE, {
      email: "taken@example.com",
      name: "X",
      role: "desk",
      password: "correct-horse",
    })).toEqual({ ok: false, error: "email_taken" });
  });

  it("rethrows anything that is not a uniqueness conflict", async () => {
    staffCreate.mockRejectedValue(new Error("connection lost"));
    await expect(
      createStaff(VENUE, { email: "a@b.co", name: "X", role: "desk", password: "correct-horse" })
    ).rejects.toThrow("connection lost");
  });
});

describe("staffCreateSchema", () => {
  it("rejects a password shorter than the minimum", () => {
    const short = "x".repeat(PASSWORD_MIN - 1);
    expect(staffCreateSchema.safeParse({
      email: "a@b.co", name: "X", role: "desk", password: short,
    }).success).toBe(false);
  });

  it("rejects a role outside admin/desk, so privileges cannot be invented", () => {
    expect(staffCreateSchema.safeParse({
      email: "a@b.co", name: "X", role: "superuser", password: "correct-horse",
    }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(staffCreateSchema.safeParse({
      email: "not-an-email", name: "X", role: "desk", password: "correct-horse",
    }).success).toBe(false);
  });
});

describe("updateStaff — lockout guards", () => {
  it("refuses to deactivate the last active admin", async () => {
    staffFindFirst.mockResolvedValue(user({ id: "other_admin", role: "admin" }));
    staffCount.mockResolvedValue(0); // no other active admin
    expect(await updateStaff(VENUE, "other_admin", ACTOR, { active: false })).toEqual({
      ok: false,
      error: "last_admin",
    });
    expect(staffUpdate).not.toHaveBeenCalled();
  });

  it("refuses to demote the last active admin to desk", async () => {
    staffFindFirst.mockResolvedValue(user({ id: "other_admin", role: "admin" }));
    staffCount.mockResolvedValue(0);
    expect(await updateStaff(VENUE, "other_admin", ACTOR, { role: "desk" })).toEqual({
      ok: false,
      error: "last_admin",
    });
  });

  it("allows it once a second admin exists", async () => {
    staffFindFirst.mockResolvedValue(user({ id: "other_admin", role: "admin" }));
    staffCount.mockResolvedValue(1);
    expect(await updateStaff(VENUE, "other_admin", ACTOR, { active: false })).toEqual({ ok: true });
  });

  it("refuses to deactivate yourself", async () => {
    staffFindFirst.mockResolvedValue(user({ id: ACTOR, role: "admin" }));
    expect(await updateStaff(VENUE, ACTOR, ACTOR, { active: false })).toEqual({
      ok: false,
      error: "cannot_deactivate_self",
    });
  });

  it("refuses to demote yourself", async () => {
    staffFindFirst.mockResolvedValue(user({ id: ACTOR, role: "admin" }));
    expect(await updateStaff(VENUE, ACTOR, ACTOR, { role: "desk" })).toEqual({
      ok: false,
      error: "cannot_demote_self",
    });
  });

  it("refuses to touch an account belonging to another venue", async () => {
    staffFindFirst.mockResolvedValue(null);
    expect(await updateStaff(VENUE, "someone_else", ACTOR, { name: "X" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(staffFindFirst.mock.calls[0][0].where.venueId).toBe(VENUE);
  });
});

describe("updateStaff — token revocation", () => {
  beforeEach(() => {
    staffFindFirst.mockResolvedValue(user());
    staffCount.mockResolvedValue(2);
  });

  const versionBumped = () => staffUpdate.mock.calls[0][0].data.tokenVersion;

  it("revokes existing tokens when the password is reset", async () => {
    await updateStaff(VENUE, "staff_target", ACTOR, { password: "brand-new-pw" });
    expect(versionBumped()).toEqual({ increment: 1 });
    expect(staffUpdate.mock.calls[0][0].data.passwordHash).toBe("new-hash");
  });

  it("revokes existing tokens when the role changes", async () => {
    // Otherwise a promotion or demotion would not take effect for up to 12h.
    await updateStaff(VENUE, "staff_target", ACTOR, { role: "admin" });
    expect(versionBumped()).toEqual({ increment: 1 });
  });

  it("revokes existing tokens when the account is deactivated", async () => {
    await updateStaff(VENUE, "staff_target", ACTOR, { active: false });
    expect(versionBumped()).toEqual({ increment: 1 });
  });

  it("does NOT revoke for a harmless rename", async () => {
    await updateStaff(VENUE, "staff_target", ACTOR, { name: "Yeni İsim" });
    expect(versionBumped()).toBeUndefined();
  });

  it("drops the account cache so the change lands inside 30 seconds", async () => {
    await updateStaff(VENUE, "staff_target", ACTOR, { active: false });
    expect(invalidateStaffCache).toHaveBeenCalledWith("staff_target");
  });

  it("rejects an empty update rather than bumping the version for nothing", async () => {
    expect(await updateStaff(VENUE, "staff_target", ACTOR, {})).toEqual({
      ok: false,
      error: "nothing_to_do",
    });
  });
});

describe("changeOwnPassword", () => {
  it("requires the current password", async () => {
    staffFindUnique.mockResolvedValue(user({ id: ACTOR }));
    bcryptCompare.mockResolvedValue(false);
    expect(await changeOwnPassword(ACTOR, {
      currentPassword: "wrong",
      newPassword: "brand-new-pw",
    })).toEqual({ ok: false, error: "wrong_password" });
    expect(staffUpdate).not.toHaveBeenCalled();
  });

  it("stores the new hash and signs other devices out", async () => {
    staffFindUnique.mockResolvedValue(user({ id: ACTOR }));
    expect(await changeOwnPassword(ACTOR, {
      currentPassword: "right",
      newPassword: "brand-new-pw",
    })).toEqual({ ok: true });

    const data = staffUpdate.mock.calls[0][0].data;
    expect(data.passwordHash).toBe("new-hash");
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(invalidateStaffCache).toHaveBeenCalledWith(ACTOR);
  });
});
