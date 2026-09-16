import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The bridge endpoints are reachable from the LAN with nothing but a header.
// These pin that the key is verified by hash, that a missing or malformed key
// never hits the database, and that both endpoints share the check.

const bridgeFindUnique = vi.fn();
const deliveryFindMany = vi.fn();
const deliveryFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    bridgeKey: { findUnique: (...a: unknown[]) => bridgeFindUnique(...a) },
    posDelivery: {
      findMany: (...a: unknown[]) => deliveryFindMany(...a),
      findFirst: (...a: unknown[]) => deliveryFindFirst(...a),
      updateMany: async () => ({ count: 0 }),
      update: async () => ({}),
    },
  },
}));

const { GET: pending } = await import("@/app/api/bridge/pending/route");
const { POST: ack } = await import("@/app/api/bridge/ack/route");
const { hashBridgeKey, venueForBridgeKey } = await import("@/lib/bridgeKey");

const KEY = "bridge-00112233445566778899aabbccddeeff";

const withKey = (key?: string) =>
  new NextRequest("http://localhost/api/bridge/pending", {
    headers: key ? { "x-bridge-key": key } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  bridgeFindUnique.mockResolvedValue(null);
  deliveryFindMany.mockResolvedValue([]);
});

describe("venueForBridgeKey", () => {
  it("looks the key up by its hash, never by plaintext", async () => {
    bridgeFindUnique.mockResolvedValue({ venueId: "venue_1" });
    expect(await venueForBridgeKey(KEY)).toBe("venue_1");
    const where = bridgeFindUnique.mock.calls[0][0].where;
    expect(where).toEqual({ keyHash: hashBridgeKey(KEY) });
    expect(JSON.stringify(where)).not.toContain(KEY);
  });

  it("rejects a missing or malformed key without a query", async () => {
    expect(await venueForBridgeKey(null)).toBeNull();
    expect(await venueForBridgeKey("not-a-bridge-key")).toBeNull();
    expect(bridgeFindUnique).not.toHaveBeenCalled();
  });
});

describe("bridge endpoints", () => {
  it("pending: 401 without a valid key", async () => {
    expect((await pending(withKey())).status).toBe(401);
    expect((await pending(withKey(KEY))).status).toBe(401);
  });

  it("pending: serves the venue the key belongs to", async () => {
    bridgeFindUnique.mockResolvedValue({ venueId: "venue_1" });
    const res = await pending(withKey(KEY));
    expect(res.status).toBe(200);
    expect(deliveryFindMany.mock.calls[0][0].where.venueId).toBe("venue_1");
  });

  it("ack: 401 without a valid key", async () => {
    const res = await ack(
      new NextRequest("http://localhost/api/bridge/ack", {
        method: "POST",
        body: JSON.stringify({ deliveryId: "d1", ok: true }),
      })
    );
    expect(res.status).toBe(401);
    expect(deliveryFindFirst).not.toHaveBeenCalled();
  });

  it("ack: scopes the delivery lookup to the key's venue", async () => {
    bridgeFindUnique.mockResolvedValue({ venueId: "venue_1" });
    deliveryFindFirst.mockResolvedValue(null);
    const res = await ack(
      new NextRequest("http://localhost/api/bridge/ack", {
        method: "POST",
        headers: { "x-bridge-key": KEY },
        body: JSON.stringify({ deliveryId: "d1", ok: true }),
      })
    );
    expect(res.status).toBe(404);
    expect(deliveryFindFirst.mock.calls[0][0].where).toEqual({ id: "d1", venueId: "venue_1" });
  });
});
