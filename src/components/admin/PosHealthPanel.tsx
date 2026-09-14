"use client";

import { useCallback, useEffect, useState } from "react";
import type { PosHealth } from "./types";
// A bridge agent that dies mid-service is otherwise invisible: orders keep
// reaching the desk while nothing prints in the kitchen. This panel is how
// staff find out before a customer does.
export default function PosHealthPanel() {
  const [health, setHealth] = useState<PosHealth | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The clock the staleness read below uses. Held in state and advanced by the
  // poll interval so nothing calls Date.now() during render.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/pos/health");
    if (res.ok) setHealth(await res.json());
  }, []);

  useEffect(() => {
    // Wrapped so the state update lands after the await rather than
    // synchronously inside the effect body.
    (async () => { await load(); })();
    const t = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 20000);
    return () => clearInterval(t);
  }, [load]);

  if (!health) return null;

  const { counts } = health;
  const queued = counts.pending + counts.claimed;
  const minutesSinceSent = health.lastSentAt
    ? Math.floor((now - new Date(health.lastSentAt).getTime()) / 60000)
    : null;
  // Tickets waiting and nothing printed for a while = the agent is not polling.
  const agentLikelyDown =
    queued > 0 && (minutesSinceSent === null || minutesSinceSent >= 5);
  const alert = counts.failed > 0 || health.stuck.length > 0 || agentLikelyDown;

  async function retry(id: string) {
    setBusy(id);
    await fetch(`/api/admin/pos/${id}/retry`, { method: "POST" });
    await load();
    setBusy(null);
  }

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wide">
          Mutfak Yazıcısı / Kitchen Printer
        </h3>
        <span
          className="tag"
          style={{
            background: alert ? "var(--color-heaven-orange)" : "var(--color-accent)",
            color: "#fff",
          }}
        >
          {alert ? "DİKKAT / ATTENTION" : "ÇALIŞIYOR / HEALTHY"}
        </span>
      </div>

      {agentLikelyDown && (
        <p className="text-sm mb-4" style={{ color: "var(--color-heaven-orange)" }}>
          {queued} fiş bekliyor, son baskı{" "}
          {minutesSinceSent === null ? "hiç yapılmadı" : `${minutesSinceSent} dk önce`}. Köprü
          ajanı çalışmıyor olabilir — mutfak bilgisayarını kontrol edin.
          <br />
          <span style={{ color: "var(--color-neutral-900)" }}>
            {queued} ticket(s) queued, last print{" "}
            {minutesSinceSent === null ? "never" : `${minutesSinceSent} min ago`}. The bridge
            agent may be down — check the kitchen PC.
          </span>
        </p>
      )}

      <div className="flex gap-4 flex-wrap mb-4 text-sm">
        <span>Bekleyen / Pending: <strong>{counts.pending}</strong></span>
        <span>İşlemde / In flight: <strong>{counts.claimed}</strong></span>
        <span style={counts.failed ? { color: "var(--color-heaven-orange)" } : undefined}>
          Başarısız / Failed: <strong>{counts.failed}</strong>
        </span>
        <span>24s basılan / Printed 24h: <strong>{counts.sentToday}</strong></span>
      </div>

      {health.stuck.length > 0 && (
        <div className="flex flex-col gap-2 pt-3" style={{ borderTop: "1px solid var(--color-divider)" }}>
          <p className="text-xs font-bold uppercase tracking-wide">
            Takılan fişler / Stuck tickets
          </p>
          {health.stuck.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                #{d.orderNumber} · {d.tableName}
                <span style={{ color: "var(--color-neutral-900)" }}>
                  {" "}— {d.status}, {d.attempts}/{health.maxAttempts}
                  {d.lastError ? ` · ${d.lastError.slice(0, 60)}` : ""}
                </span>
              </span>
              <button
                className="btn btn-secondary"
                disabled={busy === d.id}
                onClick={() => retry(d.id)}
              >
                {busy === d.id ? "..." : "Tekrar Bas / Retry"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
