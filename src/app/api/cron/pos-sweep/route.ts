import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sweepPosDeliveries } from "@/lib/pos/outbox";
import { pruneRetainedData } from "@/lib/retention";
import { getEnv } from "@/lib/env";

// Outbox reconciliation. Vercel Cron calls this on a schedule (see vercel.json)
// with `Authorization: Bearer $CRON_SECRET`. It is the safety net that keeps a
// crashed bridge agent from silently stranding kitchen tickets.
//
// It also carries the retention prune, which is cheap and rides along rather
// than justifying a second schedule — but only on the hourly tick, since it
// only ever has day-scale work to do.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const expected = Buffer.from(`Bearer ${getEnv().CRON_SECRET}`, "utf8");
  const provided = Buffer.from(req.headers.get("authorization") ?? "", "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await sweepPosDeliveries();
    if (result.reclaimed > 0 || result.exhausted > 0) {
      // Surfaces in the Vercel function logs, where an alert can be attached.
      console.warn("pos sweep recovered stranded deliveries:", result);
    }

    // Retention only has day-scale work, so it runs on the first tick of each
    // hour rather than every minute.
    const retention =
      new Date().getUTCMinutes() === 0 ? await pruneRetainedData() : null;

    return NextResponse.json({ ok: true, ...result, retention });
  } catch (err) {
    console.error("pos sweep failed:", err);
    return NextResponse.json({ error: "sweep_failed" }, { status: 500 });
  }
}
