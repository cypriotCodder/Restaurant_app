import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { openOrJoinVisit } from "./visit";

// Customer table sessions — the enforcement core of the anti-remote design.
// A session exists only after a valid signed-QR hit, is bound to one table,
// and dies on: 2h hard cap, 30min inactivity, staff revocation, or being
// displaced when the per-table concurrent cap is exceeded.

export const SESSION_COOKIE = "table_session";
const HARD_CAP_MS = 2 * 60 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;
const MAX_ACTIVE_PER_TABLE = 6; // a table of friends may each scan

export type ActiveSession = {
  id: string;
  venueId: string;
  tableId: string;
  tableCode: string;
  tableName: string;
  /** The party this phone belongs to; null only for pre-visit sessions. */
  visitId: string | null;
};

export async function mintSession(tableId: string, venueId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  // Joins the party already at this table, or starts one if the table is idle.
  const visitId = await openOrJoinVisit(tableId, venueId);
  await db.tableSession.create({
    data: {
      tableId,
      venueId,
      token,
      visitId,
      expiresAt: new Date(Date.now() + HARD_CAP_MS),
    },
  });
  // Displace oldest sessions beyond the per-table cap.
  const active = await db.tableSession.findMany({
    where: { tableId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (active.length > MAX_ACTIVE_PER_TABLE) {
    const stale = active.slice(MAX_ACTIVE_PER_TABLE).map((s) => s.id);
    await db.tableSession.updateMany({
      where: { id: { in: stale } },
      data: { revokedAt: new Date() },
    });
  }
  return token;
}

/**
 * Validates the session cookie and slides the inactivity window.
 * Returns null if missing/expired/revoked/idle — callers show the
 * "please re-scan" wall and log the attempt.
 */
export async function getActiveSession(expectedTableCode?: string): Promise<ActiveSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.tableSession.findUnique({
    where: { token },
    include: { table: true },
  });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now) return null;
  if (session.lastSeenAt.getTime() + IDLE_MS < now) return null;
  if (expectedTableCode && session.table.code !== expectedTableCode) return null;
  if (!session.table.active) return null;
  await db.tableSession.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });
  return {
    id: session.id,
    venueId: session.venueId,
    tableId: session.tableId,
    tableCode: session.table.code,
    tableName: session.table.name,
    visitId: session.visitId,
  };
}
