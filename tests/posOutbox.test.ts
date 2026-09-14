import { describe, it, expect, vi, beforeEach } from "vitest";

// The outbox sweep is the safety net that keeps a crashed bridge agent from
// silently stranding kitchen tickets, so these cover the recovery rules:
// which rows get released, which get given up on, and which are left alone.

const updateMany = vi.fn();
const findMany = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    posDelivery: {
      updateMany: (...a: unknown[]) => updateMany(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

const { sweepPosDeliveries, CLAIM_TIMEOUT_MS, MAX_ATTEMPTS } = await import("@/lib/pos/outbox");

type Where = Record<string, unknown>;
const callsFor = (pred: (w: Where) => boolean) =>
  updateMany.mock.calls.map((c) => c[0] as { where: Where; data: Where }).filter((c) => pred(c.where));

beforeEach(() => {
  vi.clearAllMocks();
  updateMany.mockResolvedValue({ count: 0 });
  findMany.mockResolvedValue([]);
});

describe("sweepPosDeliveries", () => {
  it("releases claims held past the timeout back to pending", async () => {
    await sweepPosDeliveries();
    const [call] = callsFor((w) => w.status === "claimed" && typeof w.claimedAt === "object" && w.claimedAt !== null);
    expect(call).toBeDefined();
    expect(call.data.status).toBe("pending");
    // The claim identity must be cleared, or a late ack could settle a row
    // that has already been re-served to another agent.
    expect(call.data.claimId).toBeNull();

    const cutoff = (call.where.claimedAt as { lt: Date }).lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(CLAIM_TIMEOUT_MS);
  });

  it("also releases claims that never recorded a claim time", async () => {
    await sweepPosDeliveries();
    const [call] = callsFor((w) => w.status === "claimed" && w.claimedAt === null);
    expect(call).toBeDefined();
    expect(call.data.status).toBe("pending");
  });

  it("gives up on rows past the attempt ceiling", async () => {
    await sweepPosDeliveries();
    const [call] = callsFor((w) => w.status === "pending" && w.attempts !== undefined);
    expect(call).toBeDefined();
    expect(call.where.attempts).toEqual({ gte: MAX_ATTEMPTS });
    expect(call.data.status).toBe("failed");
  });

  it("never retries pull-based rows — those belong to the bridge agent", async () => {
    await sweepPosDeliveries();
    const retryQuery = findMany.mock.calls[0][0] as { where: Where };
    expect(retryQuery.where.adapter).toEqual({ not: "escpos_bridge" });
    expect(retryQuery.where.status).toBe("pending");
    expect(retryQuery.where.attempts).toEqual({ lt: MAX_ATTEMPTS });
  });

  it("reports what it recovered so the cron can log an alert", async () => {
    updateMany.mockResolvedValue({ count: 2 });
    findMany.mockResolvedValue([]);
    const result = await sweepPosDeliveries();
    expect(result.reclaimed).toBe(4); // both reclaim passes
    expect(result.exhausted).toBe(2);
    expect(result.retried).toBe(0);
  });

  it("retries pending push-based deliveries it finds", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findMany.mockResolvedValue([
      {
        id: "d1",
        order: {
          number: 7,
          createdAt: new Date(),
          totalKurus: 1000,
          venue: { name: "V" },
          table: { name: "Masa 1" },
          items: [{ qty: 1, nameSnapshot: "Çay", note: "", unitPriceKurus: 1000, modifiersJson: "[]" }],
        },
      },
    ]);
    // The row is no longer pending by the time delivery is attempted, so the
    // attempt short-circuits — we only care that it was tried.
    findUnique.mockResolvedValue({ id: "d1", status: "sent", adapter: "console", attempts: 0, payload: "x" });

    const result = await sweepPosDeliveries();
    expect(result.retried).toBe(1);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "d1" } });
  });
});
