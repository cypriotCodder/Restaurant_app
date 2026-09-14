import { sweepPosDeliveries } from "./pos/outbox";
import { pruneRetainedData } from "./retention";
import { closeAbandonedVisits } from "./visit";

// In-process scheduler.
//
// This is the safety net that stops a crashed bridge agent silently stranding
// kitchen tickets, so it deliberately does not depend on anyone remembering to
// configure a systemd timer or a Task Scheduler entry: the server that serves
// orders is the server that reconciles them.

export const SWEEP_INTERVAL_MS = 60_000;
const RETENTION_INTERVAL_MS = 60 * 60 * 1000;
const VISIT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const globalForScheduler = globalThis as unknown as {
  masadanSchedulerStarted?: boolean;
  masadanSchedulerState?: SchedulerState;
};

export type SchedulerState = {
  startedAt: number;
  lastSweepAt: number | null;
  lastSweepOk: boolean;
  lastRetentionAt: number | null;
};

/** Liveness, for /api/health — a stopped sweep is invisible otherwise. */
export function schedulerState(): SchedulerState | null {
  return globalForScheduler.masadanSchedulerState ?? null;
}

function state(): SchedulerState {
  return (globalForScheduler.masadanSchedulerState ??= {
    startedAt: Date.now(),
    lastSweepAt: null,
    lastSweepOk: true,
    lastRetentionAt: null,
  });
}

async function runSweep(): Promise<void> {
  try {
    const result = await sweepPosDeliveries();
    if (result.reclaimed > 0 || result.exhausted > 0) {
      console.warn("[scheduler] pos sweep recovered stranded deliveries:", result);
    }
    Object.assign(state(), { lastSweepAt: Date.now(), lastSweepOk: true });
  } catch (err) {
    // Never throw out of a timer: an unhandled rejection here would take the
    // whole server down mid-service.
    console.error("[scheduler] pos sweep failed:", err);
    // Still stamped: health reports "ran but failing", which is a different
    // problem from "stopped running".
    Object.assign(state(), { lastSweepAt: Date.now(), lastSweepOk: false });
  }
}

async function runAbandonedVisits(): Promise<void> {
  try {
    const closed = await closeAbandonedVisits();
    if (closed > 0) console.log(`[scheduler] closed ${closed} abandoned visit(s)`);
  } catch (err) {
    console.error("[scheduler] abandoned-visit sweep failed:", err);
  }
}

async function runRetention(): Promise<void> {
  try {
    const result = await pruneRetainedData();
    if (result.anonymised || result.deletedAttempts || result.deletedSessions) {
      console.log("[scheduler] retention prune:", result);
    }
    state().lastRetentionAt = Date.now();
  } catch (err) {
    console.error("[scheduler] retention prune failed:", err);
  }
}

/** Idempotent: a hot reload re-running instrumentation must not double-schedule. */
export function startScheduler(): void {
  if (globalForScheduler.masadanSchedulerStarted) return;
  globalForScheduler.masadanSchedulerStarted = true;
  state();

  // unref() so the timers never hold the process open on shutdown.
  setInterval(() => void runSweep(), SWEEP_INTERVAL_MS).unref();
  // A table left open by a walkout never frees itself otherwise.
  setInterval(() => void runAbandonedVisits(), VISIT_SWEEP_INTERVAL_MS).unref();
  setInterval(() => void runRetention(), RETENTION_INTERVAL_MS).unref();

  // A sweep at boot matters most of all: if the server is starting *because* it
  // crashed, deliveries claimed by the previous process are stranded right now.
  void runSweep();

  console.log("[scheduler] started (pos 60s, visits 10m, retention 1h)");
}
