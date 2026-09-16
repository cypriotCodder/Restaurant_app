import { db } from "./db";
import type { NextRequest } from "next/server";
import { clientIp } from "./rateLimit";

/** Abuse-analysis ledger: every order/scan attempt, successful or not. */
export async function logAttempt(
  req: NextRequest,
  outcome: string,
  extra: {
    venueId?: string;
    tableId?: string;
    sessionId?: string;
    orderId?: string;
    detail?: string;
  } = {}
): Promise<void> {
  try {
    await db.orderAttempt.create({
      data: {
        outcome,
        // Same attribution rule as the rate limiter, so the ledger records the
        // proxy-written hop when there is one.
        ip: clientIp(req),
        userAgent: req.headers.get("user-agent") ?? "",
        detail: extra.detail ?? "",
        venueId: extra.venueId,
        tableId: extra.tableId,
        sessionId: extra.sessionId,
        orderId: extra.orderId,
      },
    });
  } catch (err) {
    console.error("attempt log failed:", err);
  }
}
