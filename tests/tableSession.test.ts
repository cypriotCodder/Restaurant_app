import { describe, it, expect, vi, beforeEach } from "vitest";

// Table sessions are what stop a leaked QR URL from becoming an open ordering
// endpoint, so every expiry and revocation path is worth pinning down. Prisma
// and next/headers are mocked: the logic under test is the time and ownership
// arithmetic, not the database.

let cookieToken: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "table_session" && cookieToken ? { value: cookieToken } : undefined,
  }),
}));

const findUnique = vi.fn();
const create = vi.fn();
const findMany = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
// Minting a session also joins the table's open visit; the visit rules
// themselves are covered in tests/visit.test.ts.
const visitFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    tableSession: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => update(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
    tableVisit: {
      findFirst: (...a: unknown[]) => visitFindFirst(...a),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const { mintSession, getActiveSession, SESSION_COOKIE } = await import("@/lib/tableSession");

const MIN = 60 * 1000;

/** A session row as Prisma would return it, valid unless overridden. */
function sessionRow(over: Record<string, unknown> = {}) {
  return {
    id: "sess_1",
    venueId: "venue_1",
    tableId: "table_1",
    token: "tok_1",
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 2 * 60 * MIN),
    revokedAt: null,
    table: { id: "table_1", code: "TBL1", name: "Masa 1", active: true },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieToken = "tok_1";
  findMany.mockResolvedValue([]);
  // A table with a party already at it, so mintSession joins rather than opens.
  visitFindFirst.mockResolvedValue({ id: "visit_1" });
  create.mockResolvedValue({});
  update.mockResolvedValue({});
  updateMany.mockResolvedValue({});
});

describe("SESSION_COOKIE", () => {
  it("is the httpOnly cookie name the scan route sets", () => {
    expect(SESSION_COOKIE).toBe("table_session");
  });
});

describe("mintSession", () => {
  it("creates a session bound to the table with a 2h hard cap", async () => {
    const before = Date.now();
    await mintSession("table_1", "venue_1");
    const data = create.mock.calls[0][0].data;
    expect(data.tableId).toBe("table_1");
    expect(data.venueId).toBe("venue_1");
    const ttl = data.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThan(119 * MIN);
    expect(ttl).toBeLessThanOrEqual(120 * MIN + 1000);
  });

  it("returns a high-entropy token rather than anything guessable", async () => {
    const token = await mintSession("table_1", "venue_1");
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token).not.toMatch(/table_1|venue_1/);
    expect(token).not.toBe(await mintSession("table_1", "venue_1"));
  });

  it("leaves sessions alone while at or under the 6-per-table cap", async () => {
    findMany.mockResolvedValue(Array.from({ length: 6 }, (_, i) => ({ id: `s${i}` })));
    await mintSession("table_1", "venue_1");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("revokes the oldest sessions once the cap is exceeded", async () => {
    // findMany is ordered createdAt desc, so the tail is the oldest.
    findMany.mockResolvedValue(Array.from({ length: 9 }, (_, i) => ({ id: `s${i}` })));
    await mintSession("table_1", "venue_1");
    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = updateMany.mock.calls[0][0];
    expect(call.where.id.in).toEqual(["s6", "s7", "s8"]);
    expect(call.data.revokedAt).toBeInstanceOf(Date);
  });
});

describe("getActiveSession", () => {
  it("returns the session for a valid cookie and slides the idle window", async () => {
    findUnique.mockResolvedValue(sessionRow({ lastSeenAt: new Date(Date.now() - 2 * MIN) }));
    const result = await getActiveSession();
    expect(result).toMatchObject({
      id: "sess_1",
      venueId: "venue_1",
      tableId: "table_1",
      tableCode: "TBL1",
      tableName: "Masa 1",
    });
    // lastSeenAt is refreshed so an active table does not time out mid-meal.
    expect(update.mock.calls[0][0].data.lastSeenAt).toBeInstanceOf(Date);
  });

  it("does not write when the session was seen within the last minute", async () => {
    // The first page load validates the session four times in a row; only
    // the first of those should cost an UPDATE.
    findUnique.mockResolvedValue(sessionRow({ lastSeenAt: new Date(Date.now() - 20_000) }));
    expect(await getActiveSession()).not.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("returns null when no cookie is present", async () => {
    cookieToken = undefined;
    expect(await getActiveSession()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns null for a token with no matching row", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getActiveSession()).toBeNull();
  });

  it("rejects a staff-revoked session", async () => {
    findUnique.mockResolvedValue(sessionRow({ revokedAt: new Date() }));
    expect(await getActiveSession()).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a session past its 2h hard cap even if recently seen", async () => {
    findUnique.mockResolvedValue(
      sessionRow({ expiresAt: new Date(Date.now() - MIN), lastSeenAt: new Date() })
    );
    expect(await getActiveSession()).toBeNull();
  });

  it("rejects a session idle beyond 30 minutes even if not yet expired", async () => {
    findUnique.mockResolvedValue(
      sessionRow({
        lastSeenAt: new Date(Date.now() - 31 * MIN),
        expiresAt: new Date(Date.now() + 60 * MIN),
      })
    );
    expect(await getActiveSession()).toBeNull();
  });

  it("still accepts a session idle just under the 30 minute limit", async () => {
    findUnique.mockResolvedValue(sessionRow({ lastSeenAt: new Date(Date.now() - 29 * MIN) }));
    expect(await getActiveSession()).not.toBeNull();
  });

  it("rejects a session belonging to a different table than the URL claims", async () => {
    findUnique.mockResolvedValue(sessionRow());
    expect(await getActiveSession("SOME_OTHER_TABLE")).toBeNull();
    // The matching code still works, proving the check is the discriminator.
    expect(await getActiveSession("TBL1")).not.toBeNull();
  });

  it("rejects a session whose table has been deactivated", async () => {
    findUnique.mockResolvedValue(
      sessionRow({ table: { id: "table_1", code: "TBL1", name: "Masa 1", active: false } })
    );
    expect(await getActiveSession()).toBeNull();
  });
});
