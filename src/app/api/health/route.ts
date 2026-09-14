import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { schedulerState, SWEEP_INTERVAL_MS } from "@/lib/scheduler";

// Liveness and readiness for the venue's monitoring.
//
// systemd's Restart=always brings back a process that *crashed*; it cannot see
// one that is up but broken — database unreachable, or the POS sweep silently
// stopped. Both of those end with the kitchen not printing and nobody knowing,
// so they are what this checks.
//
// Returns 200 when healthy and 503 when not, so a monitor can alert on the
// status code alone without parsing anything.

export const dynamic = "force-dynamic";

/**
 * The sweep runs every 60s. Three missed cycles is a stopped scheduler rather
 * than a slow one — generous enough not to alarm on a single long query.
 */
const SWEEP_STALE_MS = SWEEP_INTERVAL_MS * 3;

/** Detail is gated: uptime and internals are nobody's business on a LAN. */
function isTrusted(req: NextRequest): boolean {
  const expected = Buffer.from(`Bearer ${getEnv().CRON_SECRET}`, "utf8");
  const provided = Buffer.from(req.headers.get("authorization") ?? "", "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function GET(req: NextRequest) {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // A trivial query, not a connection test: a pooled connection can look alive
  // while the database behind it refuses work.
  const dbStart = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = { ok: true, detail: `${Date.now() - dbStart}ms` };
  } catch (err) {
    checks.database = { ok: false, detail: dbErrorDetail(err) };
  }

  const sched = schedulerState();
  if (!sched) {
    checks.scheduler = { ok: false, detail: "not started" };
  } else if (sched.lastSweepAt === null) {
    // Just booted; the first sweep runs immediately but may not have landed.
    const booting = Date.now() - sched.startedAt < SWEEP_STALE_MS;
    checks.scheduler = { ok: booting, detail: booting ? "starting" : "no sweep recorded" };
  } else {
    const age = Date.now() - sched.lastSweepAt;
    checks.scheduler = {
      ok: age < SWEEP_STALE_MS,
      detail: `last sweep ${Math.round(age / 1000)}s ago${sched.lastSweepOk ? "" : " (failing)"}`,
    };
  }

  const ok = Object.values(checks).every((c) => c.ok);

  // An unauthenticated caller gets the verdict and nothing else.
  if (!isTrusted(req)) {
    return NextResponse.json(
      { status: ok ? "ok" : "degraded" },
      { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      checks,
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: sched ? new Date(sched.startedAt).toISOString() : null,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Prisma errors arrive as several lines beginning with blank ones and a generic
 * "Invalid `prisma.x()` invocation:" header. The line worth paging someone
 * about is the one after it, so skip the noise rather than handing a monitor an
 * empty string.
 */
function dbErrorDetail(err: unknown): string {
  const lines = (err as Error).message
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^Invalid `.*` invocation:?$/.test(l));
  return (lines[0] ?? "unreachable").slice(0, 200);
}
