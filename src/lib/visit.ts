import { db } from "./db";
import { publish } from "./bus";
import { notVoid, IN_FLIGHT_STATUSES } from "./orderStatus";

// The lifecycle of one party's stay at a table.
//
//   open            first phone scans at an idle table
//   bill_requested  a customer tapped "hesap istiyorum"
//   closed          staff settled it at the till, or the sweep found it
//                   abandoned (every session dead, nothing settled)
//
// Money is only ever recorded by staff: customers can ask for the bill, they
// cannot close one.

/**
 * How long a visit with no live session and no recent order may sit open before
 * the sweep closes it as abandoned. Generous, because a party can legitimately
 * let every phone go idle (30 min) while still sitting at the table waiting for
 * food — closing on them mid-meal would revoke their ability to order.
 */
export const ABANDON_AFTER_MS = 3 * 60 * 60 * 1000;

export type BillLine = {
  name: string;
  qty: number;
  unitPriceKurus: number;
  lineTotalKurus: number;
  note: string;
  modifiers: string[];
};

export type BillPhone = {
  sessionId: string;
  label: string;
  totalKurus: number;
};

export type Bill = {
  visitId: string;
  tableId: string;
  tableName: string;
  status: string;
  openedAt: Date;
  billRequestedAt: Date | null;
  lines: BillLine[];
  totalKurus: number;
  /** Per-phone breakdown, for "we're paying separately". */
  phones: BillPhone[];
  orderCount: number;
  /** Exactly the orders the total covers; settlement marks these paid. */
  orderIds: string[];
};

/** Either the shared client or an interactive-transaction client. */
type Client = Pick<typeof db, "tableVisit" | "order" | "tableSession">;

/**
 * The open visit for a table, creating one if the table is idle.
 *
 * Called from the scan path, so two phones scanning simultaneously at an idle
 * table race here. The unique partial index cannot express "one open visit per
 * table" in Prisma, so the loser of the race is detected by re-reading rather
 * than by a constraint — worst case both find the same row on the second pass.
 */
export async function openOrJoinVisit(tableId: string, venueId: string): Promise<string> {
  const existing = await db.tableVisit.findFirst({
    where: { tableId, status: { in: ["open", "bill_requested"] } },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await db.tableVisit.create({
    data: { tableId, venueId },
    select: { id: true, openedAt: true },
  });

  // If another scan created one at the same moment, keep the older row and
  // discard ours, so a table never ends up with two open visits.
  const open = await db.tableVisit.findMany({
    where: { tableId, status: { in: ["open", "bill_requested"] } },
    orderBy: { openedAt: "asc" },
    select: { id: true },
  });
  if (open.length > 1 && open[0].id !== created.id) {
    await db.tableVisit.delete({ where: { id: created.id } }).catch(() => {});
    return open[0].id;
  }
  return created.id;
}

/** Itemised bill for a visit, with the per-phone split. */
export async function buildBill(visitId: string, client: Client = db): Promise<Bill | null> {
  const visit = await client.tableVisit.findUnique({
    where: { id: visitId },
    include: {
      table: { select: { id: true, name: true } },
      orders: {
        // Neither a refused nor a withdrawn order is owed for.
        where: { status: notVoid() },
        orderBy: { createdAt: "asc" },
        // Lines staff voided during a correction are kept for history but are
        // not owed for.
        include: { items: { where: { voidedAt: null } } },
      },
    },
  });
  if (!visit) return null;

  const lines: BillLine[] = [];
  const perPhone = new Map<string, number>();

  for (const order of visit.orders) {
    let orderTotal = 0;
    for (const item of order.items) {
      const lineTotal = item.unitPriceKurus * item.qty;
      orderTotal += lineTotal;
      lines.push({
        name: item.nameSnapshot,
        qty: item.qty,
        unitPriceKurus: item.unitPriceKurus,
        lineTotalKurus: lineTotal,
        note: item.note,
        modifiers: (JSON.parse(item.modifiersJson) as { name: string }[]).map((m) => m.name),
      });
    }
    perPhone.set(order.sessionId, (perPhone.get(order.sessionId) ?? 0) + orderTotal);
  }

  // Phones are labelled by the order they first appeared, not by session id:
  // "Telefon 1" means something to staff, a cuid does not.
  const phones: BillPhone[] = [...perPhone.entries()].map(([sessionId, totalKurus], i) => ({
    sessionId,
    label: `Telefon ${i + 1}`,
    totalKurus,
  }));

  return {
    visitId: visit.id,
    tableId: visit.tableId,
    tableName: visit.table.name,
    status: visit.status,
    openedAt: visit.openedAt,
    billRequestedAt: visit.billRequestedAt,
    lines,
    totalKurus: lines.reduce((s, l) => s + l.lineTotalKurus, 0),
    phones,
    orderCount: visit.orders.length,
    orderIds: visit.orders.map((o) => o.id),
  };
}

/** Customer asked for the bill. Idempotent — tapping twice is not an error. */
export async function requestBill(visitId: string, venueId: string): Promise<boolean> {
  const visit = await db.tableVisit.findFirst({ where: { id: visitId, venueId } });
  if (!visit || visit.status === "closed") return false;
  if (visit.status !== "bill_requested") {
    await db.tableVisit.update({
      where: { id: visitId },
      data: { status: "bill_requested", billRequestedAt: new Date() },
    });
  }
  publish({ type: "bill.requested", venueId, visitId, tableId: visit.tableId });
  return true;
}

/** Staff dismissed the request without settling (customer changed their mind). */
export async function clearBillRequest(visitId: string, venueId: string): Promise<boolean> {
  const visit = await db.tableVisit.findFirst({ where: { id: visitId, venueId } });
  if (!visit || visit.status !== "bill_requested") return false;
  await db.tableVisit.update({
    where: { id: visitId },
    data: { status: "open", billRequestedAt: null },
  });
  publish({ type: "bill.updated", venueId, visitId, tableId: visit.tableId });
  return true;
}

export type SettleResult =
  | { ok: true; totalKurus: number }
  | { ok: false; error: "not_found" | "already_closed" | "orders_in_flight" };

/**
 * Staff took payment at the till. Closes the visit, records what was taken,
 * marks the billed orders paid, and revokes the party's sessions so the table
 * is free for the next group.
 *
 * Everything runs in one transaction, and the close itself is conditional on
 * the visit still being open: two tills settling the same table, or an order
 * arriving between the bill being totalled and the visit closing, cannot
 * produce a second settlement or an order marked paid that no one paid for.
 */
export async function settleVisit(
  visitId: string,
  venueId: string,
  input: { paymentMethod: "cash" | "card"; paidAmountKurus?: number; staffId: string; force?: boolean }
): Promise<SettleResult> {
  const outcome = await db.$transaction(async (tx) => {
    const visit = await tx.tableVisit.findFirst({ where: { id: visitId, venueId } });
    if (!visit) return { ok: false, error: "not_found" } as const;
    if (visit.status === "closed") return { ok: false, error: "already_closed" } as const;

    // Closing a table whose food is still being cooked is almost always a
    // mis-tap. Staff can override deliberately.
    if (!input.force) {
      const inFlight = await tx.order.count({
        where: { visitId, status: { in: IN_FLIGHT_STATUSES } },
      });
      if (inFlight > 0) return { ok: false, error: "orders_in_flight" } as const;
    }

    const bill = await buildBill(visitId, tx);
    const totalKurus = bill?.totalKurus ?? 0;

    const { count } = await tx.tableVisit.updateMany({
      where: { id: visitId, status: { not: "closed" } },
      data: {
        status: "closed",
        closedAt: new Date(),
        closedReason: "settled",
        // Snapshotted so a later menu edit cannot rewrite what the till took.
        totalKurus,
        paymentMethod: input.paymentMethod,
        paidAmountKurus: input.paidAmountKurus ?? totalKurus,
        closedByStaffId: input.staffId,
        billRequestedAt: null,
      },
    });
    if (count === 0) return { ok: false, error: "already_closed" } as const;

    // Only the orders the total actually covered. One that landed after the
    // bill was built stays unpaid and visible on the desk.
    await tx.order.updateMany({
      where: { id: { in: bill?.orderIds ?? [] } },
      data: { paymentStatus: "paid", paymentProvider: input.paymentMethod },
    });
    // The party has paid and left; their phones must not keep ordering.
    await tx.tableSession.updateMany({
      where: { visitId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true, totalKurus, tableId: visit.tableId } as const;
  });

  if (!outcome.ok) return outcome;
  publish({ type: "visit.closed", venueId, visitId, tableId: outcome.tableId });
  return { ok: true, totalKurus: outcome.totalKurus };
}

/**
 * Closes visits abandoned without settlement — a walkout, or staff forgetting.
 * Run from the scheduler; without it a table never becomes free again.
 */
export async function closeAbandonedVisits(): Promise<number> {
  const cutoff = new Date(Date.now() - ABANDON_AFTER_MS);
  const stale = await db.tableVisit.findMany({
    where: {
      status: { in: ["open", "bill_requested"] },
      openedAt: { lt: cutoff },
      // No session still alive.
      sessions: { none: { revokedAt: null, expiresAt: { gt: new Date() } } },
      // And nothing ordered recently, so a long meal is never cut short.
      orders: { none: { createdAt: { gt: cutoff } } },
    },
    select: { id: true, venueId: true, tableId: true },
  });

  for (const visit of stale) {
    const bill = await buildBill(visit.id);
    await db.tableVisit.update({
      where: { id: visit.id },
      data: {
        status: "closed",
        closedAt: new Date(),
        closedReason: "abandoned",
        totalKurus: bill?.totalKurus ?? 0,
      },
    });
    publish({ type: "visit.closed", venueId: visit.venueId, visitId: visit.id, tableId: visit.tableId });
  }
  return stale.length;
}
