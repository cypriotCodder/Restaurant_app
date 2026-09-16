import { describe, it, expect, vi, beforeEach } from "vitest";

// Venue settings are small in volume and large in blast radius: the POS adapter
// decides whether the kitchen prints at all, and rotating the QR secret
// invalidates every printed table card in the building.

const venueUpdate = vi.fn();
const tableUpdateMany = vi.fn();
const sessionUpdateMany = vi.fn();
const bridgeFindMany = vi.fn();
const bridgeCreate = vi.fn();
const bridgeDeleteMany = vi.fn();
const publish = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    venue: { update: (...a: unknown[]) => venueUpdate(...a) },
    table: { updateMany: (...a: unknown[]) => tableUpdateMany(...a) },
    tableSession: { updateMany: (...a: unknown[]) => sessionUpdateMany(...a) },
    bridgeKey: {
      findMany: (...a: unknown[]) => bridgeFindMany(...a),
      create: (...a: unknown[]) => bridgeCreate(...a),
      deleteMany: (...a: unknown[]) => bridgeDeleteMany(...a),
    },
    $transaction: async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  },
}));
vi.mock("@/lib/bus", () => ({ publish: (...a: unknown[]) => publish(...a) }));

const {
  updateVenueSettings,
  venueSettingsSchema,
  rotateQrSecret,
  listBridgeKeys,
  createBridgeKey,
  deleteBridgeKey,
  POS_ADAPTERS,
} = await import("@/lib/venueSettings");
const { hashBridgeKey } = await import("@/lib/bridgeKey");

beforeEach(() => {
  vi.clearAllMocks();
  venueUpdate.mockResolvedValue({});
  tableUpdateMany.mockResolvedValue({ count: 0 });
  sessionUpdateMany.mockResolvedValue({ count: 0 });
});

describe("venueSettingsSchema", () => {
  it("accepts only adapters the app actually ships", () => {
    // A typo here would silently stop the kitchen printing.
    for (const a of POS_ADAPTERS) {
      expect(venueSettingsSchema.safeParse({ posAdapter: a }).success).toBe(true);
    }
    expect(venueSettingsSchema.safeParse({ posAdapter: "escpos" }).success).toBe(false);
    expect(venueSettingsSchema.safeParse({ posAdapter: "" }).success).toBe(false);
  });

  it("accepts only locales the dictionary has", () => {
    expect(venueSettingsSchema.safeParse({ defaultLocale: "tr" }).success).toBe(true);
    expect(venueSettingsSchema.safeParse({ defaultLocale: "de" }).success).toBe(false);
  });

  it("accepts only currencies the formatter renders", () => {
    expect(venueSettingsSchema.safeParse({ currency: "TRY" }).success).toBe(true);
    expect(venueSettingsSchema.safeParse({ currency: "XYZ" }).success).toBe(false);
  });

  it("rejects an empty venue name", () => {
    expect(venueSettingsSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("updateVenueSettings", () => {
  it("writes only the fields supplied", async () => {
    await updateVenueSettings("venue_1", { name: "Yeni Ad" });
    expect(venueUpdate.mock.calls[0][0].data).toEqual({ name: "Yeni Ad" });
  });

  it("pushes a menu refresh, since phones cache the venue name and prices", async () => {
    await updateVenueSettings("venue_1", { currency: "EUR" });
    expect(publish).toHaveBeenCalledWith({ type: "menu.changed", venueId: "venue_1" });
  });

  it("rejects an empty update rather than writing nothing and claiming success", async () => {
    expect(await updateVenueSettings("venue_1", {})).toEqual({ ok: false, error: "nothing_to_do" });
    expect(venueUpdate).not.toHaveBeenCalled();
  });
});

describe("rotateQrSecret", () => {
  it("replaces the secret, bumps every table, and signs everyone out", async () => {
    tableUpdateMany.mockResolvedValue({ count: 8 });
    const result = await rotateQrSecret("venue_1");
    expect(result.tablesAffected).toBe(8);

    // A new secret alone would not invalidate old codes, because verification
    // is bound to (tableCode, qrVersion) — the version bump is what does it.
    expect(venueUpdate.mock.calls[0][0].data.qrSecret).toMatch(/^[\w-]{20,}$/);
    expect(tableUpdateMany.mock.calls[0][0].data).toEqual({ qrVersion: { increment: 1 } });
    // Everyone ordering right now was admitted under the old secret.
    expect(sessionUpdateMany.mock.calls[0][0].where).toMatchObject({
      venueId: "venue_1",
      revokedAt: null,
    });
  });

  it("generates a different secret each time", async () => {
    await rotateQrSecret("venue_1");
    await rotateQrSecret("venue_1");
    expect(venueUpdate.mock.calls[0][0].data.qrSecret).not.toBe(
      venueUpdate.mock.calls[1][0].data.qrSecret
    );
  });
});

describe("bridge keys", () => {
  it("never returns a usable key when listing", async () => {
    bridgeFindMany.mockResolvedValue([
      { id: "k1", hint: "abcdef", label: "mutfak", createdAt: new Date() },
    ]);
    const [view] = await listBridgeKeys("venue_1");
    expect(view.hint).toBe("…abcdef");
    // The query itself must not even select a secret column.
    expect(bridgeFindMany.mock.calls[0][0].select).not.toHaveProperty("keyHash");
  });

  it("issues a key with the bridge- prefix the agent expects, storing only its hash", async () => {
    bridgeCreate.mockResolvedValue({ id: "k1" });
    const created = await createBridgeKey("venue_1", "mutfak-pi");
    expect(created.key).toMatch(/^bridge-[0-9a-f]{32}$/);
    const data = bridgeCreate.mock.calls[0][0].data;
    expect(data.label).toBe("mutfak-pi");
    expect(data.keyHash).toBe(hashBridgeKey(created.key));
    expect(data.hint).toBe(created.key.slice(-6));
    // A database dump must not contain the plaintext.
    expect(JSON.stringify(data)).not.toContain(created.key);
  });

  it("falls back to a default label rather than an empty one", async () => {
    bridgeCreate.mockResolvedValue({ id: "k1" });
    await createBridgeKey("venue_1", "   ");
    expect(bridgeCreate.mock.calls[0][0].data.label).toBe("kitchen-bridge");
  });

  it("scopes deletion to the venue", async () => {
    bridgeDeleteMany.mockResolvedValue({ count: 1 });
    expect(await deleteBridgeKey("venue_1", "k1")).toBe(true);
    expect(bridgeDeleteMany.mock.calls[0][0].where).toEqual({ id: "k1", venueId: "venue_1" });
  });

  it("reports a miss rather than a silent success", async () => {
    bridgeDeleteMany.mockResolvedValue({ count: 0 });
    expect(await deleteBridgeKey("venue_1", "someone_elses")).toBe(false);
  });
});
