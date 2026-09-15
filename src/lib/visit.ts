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
};

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
export async function buildBill(visitId: string): Promise<Bill | null> {
  const visit = await db.tableVisit.findUnique({
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
  };
}

export type BillSummary = {
  visitId: string;
  tableId: string;
  tableName: string;
  status: string;
  openedAt: Date;
  billRequestedAt: Date | null;
  totalKurus: number;
  orderCount: number;
  phoneCount: number;
};

/**
 * Totals for every open visit at a venue — what the desk's "open tables" strip
 * needs, which is the money and the counts but not the lines.
 *
 * Deliberately not `buildBill` in a loop: that runs a full nested read per
 * table, and the desk re-reads this on every SSE event as well as on a 60s
 * poll, so a busy floor turned one refresh into dozens of round trips.
 */
export async function buildBillSummaries(venueId: string): Promise<BillSummary[]> {
  const visits = await db.tableVisit.findMany({
    where: { venueId, status: { in: ["open", "bill_requested"] } },
    orderBy: [{ billRequestedAt: "asc" }, { openedAt: "asc" }],
    select: {
      id: true,
      tableId: true,
      status: true,
      openedAt: true,
      billRequestedAt: true,
      table: { select: { name: true } },
      orders: {
        where: { status: notVoid() },
        select: {
          sessionId: true,
          items: { where: { voidedAt: null }, select: { unitPriceKurus: true, qty: true } },
        },
      },
    },
  });

  return visits.map((visit) => {
    let totalKurus = 0;
    const phones = new Set<string>();
    for (const order of visit.orders) {
      phones.add(order.sessionId);
      for (const item of order.items) totalKurus += item.unitPriceKurus * item.qty;
    }
    return {
      visitId: visit.id,
      tableId: visit.tableId,
      tableName: visit.table.name,
      status: visit.status,
      openedAt: visit.openedAt,
      billRequestedAt: visit.billRequestedAt,
      totalKurus,
      orderCount: visit.orders.length,
      phoneCount: phones.size,
    };
  });
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
 * marks every order paid, and revokes the party's sessions so the table is free
 * for the next group.
 */
export async function settleVisit(
  visitId: string,
  venueId: string,
  input: { paymentMethod: "cash" | "card"; paidAmountKurus?: number; staffId: string; force?: boolean }
): Promise<SettleResult> {
  const visit = await db.tableVisit.findFirst({ where: { id: visitId, venueId } });
  if (!visit) return { ok: false, error: "not_found" };
  if (visit.status === "closed") return { ok: false, error: "already_closed" };

  // Closing a table whose food is still being cooked is almost always a
  // mis-tap. Staff can override deliberately.
  if (!input.force) {
    const inFlight = await db.order.count({
      where: { visitId, status: { in: IN_FLIGHT_STATUSES } },
    });
    if (inFlight > 0) return { ok: false, error: "orders_in_flight" };
  }

  const bill = await buildBill(visitId);
  const totalKurus = bill?.totalKurus ?? 0;

  await db.$transaction([
    db.tableVisit.update({
      where: { id: visitId },
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
    }),
    db.order.updateMany({
      where: { visitId, status: notVoid() },
      data: { paymentStatus: "paid", paymentProvider: input.paymentMethod },
    }),
    // The party has paid and left; their phones must not keep ordering.
    db.tableSession.updateMany({
      where: { visitId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  publish({ type: "visit.closed", venueId, visitId, tableId: visit.tableId });
  return { ok: true, totalKurus };
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
