import { db } from "./db";

// KVKK/GDPR data minimisation for the abuse ledger.
//
// OrderAttempt records an IP and user-agent for every scan and order attempt.
// That is personal data under KVKK, and keeping it indefinitely — as this did
// originally — is not defensible for an anti-abuse purpose that only ever looks
// at recent activity. Two stages:
//
//   1. After IP_RETENTION_DAYS the identifying columns are blanked, leaving the
//      outcome/timing history intact for pattern analysis.
//   2. After ROW_RETENTION_DAYS the row itself goes.

export const IP_RETENTION_DAYS = 30;
export const ROW_RETENTION_DAYS = 180;

// Table sessions are short-lived (2h hard cap) but the rows accumulate forever;
// they are only useful while the orders referencing them are current.
export const SESSION_RETENTION_DAYS = 90;

export type RetentionResult = {
  anonymised: number;
  deletedAttempts: number;
  deletedSessions: number;
};

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

export async function pruneRetainedData(): Promise<RetentionResult> {
  const { count: anonymised } = await db.orderAttempt.updateMany({
    where: {
      createdAt: { lt: daysAgo(IP_RETENTION_DAYS) },
      // Only rows that still carry identifiers, so this does not rewrite the
      // whole table on every run.
      OR: [{ ip: { not: "" } }, { userAgent: { not: "" } }],
    },
    data: { ip: "", userAgent: "" },
  });

  const { count: deletedAttempts } = await db.orderAttempt.deleteMany({
    where: { createdAt: { lt: daysAgo(ROW_RETENTION_DAYS) } },
  });

  // Sessions with orders still inside the attempt-retention window are kept,
  // because Order.sessionId references them.
  const { count: deletedSessions } = await db.tableSession.deleteMany({
    where: {
      createdAt: { lt: daysAgo(SESSION_RETENTION_DAYS) },
      orders: { none: {} },
    },
  });

  return { anonymised, deletedAttempts, deletedSessions };
}
