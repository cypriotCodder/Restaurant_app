import { db } from "./db";
import { notVoid } from "./orderStatus";

// Daily figures for the admin screen.
//
// These are computed on the server, over an explicit date range, because the
// previous client-side version derived "yesterday" from a list that only went
// back 24 hours — so yesterday was always truncated to however long ago the
// manager happened to be looking, and the comparison was wrong by a different
// amount every hour of the day.
//
// Two different things are counted, and they are NOT the same number:
//
//   settled — money actually taken, from visits staff closed at the till.
//             This is what reconciles against the cash drawer.
//   placed  — orders customers sent to the kitchen. Includes tables still
//             sitting there, which have not paid yet and might walk out.
//
// The old screen showed `placed` under the heading "CİRO / REVENUE", which
// overstated takings by whatever was still open.

/**
 * Day boundaries in the server's local timezone.
 *
 * The app runs on a machine inside the venue, so the server clock is the
 * venue's clock — no timezone column is needed. If this is ever hosted
 * elsewhere, set TZ on the process to the venue's zone.
 *
 * Days run midnight to midnight. A venue trading past midnight would want a
 * business-day cutoff (typically 04:00) instead; that is a deliberate
 * simplification, not an oversight.
 */
export function dayBounds(daysAgo = 0): { from: Date; to: Date } {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - daysAgo);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export type PeriodReport = {
  from: Date;
  to: Date;
  /** Money taken: visits closed as settled in this period. */
  settledKurus: number;
  cashKurus: number;
  cardKurus: number;
  settledVisits: number;
  /** Average per settled table — the restaurant's "average check". */
  avgCheckKurus: number;
  /** Kitchen volume: orders created in this period. */
  ordersPlaced: number;
  ordersRejected: number;
  itemsSold: number;
};

export async function periodReport(
  venueId: string,
  from: Date,
  to: Date
): Promise<PeriodReport> {
  const [visits, ordersPlaced, ordersRejected, itemAgg] = await Promise.all([
    db.tableVisit.findMany({
      where: {
        venueId,
        status: "closed",
        // Abandoned visits are walkouts: nobody paid, so they are not takings.
        closedReason: "settled",
        closedAt: { gte: from, lt: to },
      },
      select: { paidAmountKurus: true, totalKurus: true, paymentMethod: true },
    }),
    db.order.count({ where: { venueId, createdAt: { gte: from, lt: to } } }),
    db.order.count({
      where: { venueId, status: "rejected", createdAt: { gte: from, lt: to } },
    }),
    db.orderItem.aggregate({
      _sum: { qty: true },
      where: {
        order: { venueId, status: notVoid(), createdAt: { gte: from, lt: to } },
      },
    }),
  ]);

  // paidAmountKurus is what was actually handed over; totalKurus is the bill.
  // They are the same unless a venue starts recording over- or under-payment.
  const amountOf = (v: { paidAmountKurus: number | null; totalKurus: number | null }) =>
    v.paidAmountKurus ?? v.totalKurus ?? 0;

  const settledKurus = visits.reduce((s, v) => s + amountOf(v), 0);
  const cashKurus = visits
    .filter((v) => v.paymentMethod === "cash")
    .reduce((s, v) => s + amountOf(v), 0);
  const cardKurus = visits
    .filter((v) => v.paymentMethod === "card")
    .reduce((s, v) => s + amountOf(v), 0);

  return {
    from,
    to,
    settledKurus,
    cashKurus,
    cardKurus,
    settledVisits: visits.length,
    avgCheckKurus: visits.length > 0 ? Math.round(settledKurus / visits.length) : 0,
    ordersPlaced,
    ordersRejected,
    itemsSold: itemAgg._sum.qty ?? 0,
  };
}

export type OpenTablesSummary = {
  count: number;
  /** Running total of tables still sitting — owed, not taken. */
  runningKurus: number;
  billRequested: number;
};

/** What is on the floor right now, kept separate from the day's takings. */
export async function openTables(venueId: string): Promise<OpenTablesSummary> {
  const visits = await db.tableVisit.findMany({
    where: { venueId, status: { in: ["open", "bill_requested"] } },
    select: {
      status: true,
      orders: {
        where: { status: notVoid() },
        select: { totalKurus: true },
      },
    },
  });

  return {
    count: visits.length,
    runningKurus: visits.reduce(
      (s, v) => s + v.orders.reduce((t, o) => t + o.totalKurus, 0),
      0
    ),
    billRequested: visits.filter((v) => v.status === "bill_requested").length,
  };
}

/** Percentage change, or null when there is no baseline to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
