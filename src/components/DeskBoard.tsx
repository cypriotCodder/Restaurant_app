"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatKurus } from "@/lib/money";

type DeskOrder = {
  id: string;
  number: number;
  status: string;
  rejectReason: string | null;
  totalKurus: number;
  createdAt: string;
  tableName: string;
  tableId: string;
  newSession: boolean;
  posStatus: string | null;
  items: { name: string; qty: number; note: string; modifiers: string[] }[];
};

const statusConfig: Record<string, { icon: string; label: string; cls: string }> = {
  received: { icon: "●", label: "New / Yeni", cls: "tag-accent" },
  accepted: { icon: "●", label: "Onaylandı", cls: "tag-accent" },
  preparing: { icon: "◑", label: "Preparing / Hazırlanıyor", cls: "tag-accent" },
  ready: { icon: "○", label: "Ready / Hazır", cls: "tag-outline" },
  served: { icon: "✓", label: "Served / Servis Edildi", cls: "tag-neutral" },
  rejected: { icon: "✕", label: "Rejected / Reddedildi", cls: "tag-neutral" },
};

const REJECT_REASONS = [
  { value: "Stokta yok / Item unavailable", label: "Stokta yok / Item unavailable" },
  { value: "Mutfak çok yoğun / Kitchen overloaded", label: "Mutfak çok yoğun / Kitchen overloaded" },
  { value: "Diğer / Other", label: "Diğer / Other" },
];

export default function DeskBoard({ staffName }: { staffName: string }) {
  const [orders, setOrders] = useState<DeskOrder[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  // The clock the elapsed-time badges read from. Held in state and advanced by
  // the 30s interval below so cards never call Date.now() during render.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await fetch(`/api/desk/orders${showAll ? "?all=1" : ""}`);
    if (res.status === 401) window.location.href = "/login";
    if (res.ok) setOrders((await res.json()).orders);
  }, [showAll]);

  useEffect(() => {
    // Wrapped so the state update lands after the await rather than
    // synchronously inside the effect body.
    (async () => { await load(); })();
  }, [load]);

  // SSE push + elapsed-time repaint every 30s + 60s polling safety net.
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const es = new EventSource("/api/desk/stream");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "order.created") beep(audioRef);
        if (msg.type === "order.created" || msg.type === "order.updated") load();
      } catch {}
    };
    const tick = setInterval(() => setNow(Date.now()), 30000);
    const poll = setInterval(load, 60000);
    return () => {
      es.close();
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [load]);

  async function transition(id: string, status: string, rejectReason?: string) {
    const res = await fetch(`/api/desk/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, rejectReason }),
    });
    if (res.ok) load();
  }

  const active = orders.filter((o) => !["served", "rejected"].includes(o.status));
  const done = orders.filter((o) => ["served", "rejected"].includes(o.status));

  const finalReason = reason === "Diğer / Other" ? customReason.trim() : reason;

  return (
    <div className="flex-1 p-4 max-w-6xl w-full mx-auto">
      <header className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--color-accent)" }} />
          <h1 className="wordmark text-lg">SİPARİŞ EKRANI</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Son 24 saat
          </label>
          <span style={{ color: "var(--color-neutral-900)" }}>{staffName}</span>
          <a href="/admin" className="btn-ghost">Admin</a>
          <button
            onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}
            className="btn-ghost"
          >
            Çıkış
          </button>
        </div>
      </header>

      {active.length === 0 && !showAll && (
        <p className="text-center py-20" style={{ color: "var(--color-neutral-900)" }}>Aktif sipariş yok — yeni siparişler anında burada belirir.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(showAll ? [...active, ...done] : active).map((o) => (
          <OrderCard key={o.id} order={o} now={now} onTransition={transition} onReject={(id) => { setRejecting(id); setReason(""); setCustomReason(""); }} />
        ))}
      </div>

      {/* Reject modal with radio options */}
      {rejecting && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/40" onClick={() => setRejecting(null)} aria-label="Kapat" />
          <div className="relative bg-white p-5 w-full max-w-sm" style={{ border: "2px solid var(--color-text)" }}>
            <h2 className="wordmark text-lg mb-4">Siparişi Reddet / Reject Order</h2>
            <div className="flex flex-col gap-3">
              {REJECT_REASONS.map((r) => (
                <label key={r.value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="reject-reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="h-5 w-5"
                  />
                  <span>{r.label}</span>
                </label>
              ))}
              {reason === "Diğer / Other" && (
                <input
                  autoFocus
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Sebep yazın / Enter reason"
                  className="input w-full"
                />
              )}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setRejecting(null)} className="btn btn-secondary">
                Vazgeç / Cancel
              </button>
              <button
                disabled={!finalReason}
                onClick={() => { transition(rejecting, "rejected", finalReason); setRejecting(null); }}
                className="btn btn-danger"
              >
                Reddet / Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order: o,
  now,
  onTransition,
  onReject,
}: {
  order: DeskOrder;
  now: number;
  onTransition: (id: string, status: string) => void;
  onReject: (id: string) => void;
}) {
  const ageMin = Math.floor((now - new Date(o.createdAt).getTime()) / 60000);
  const urgent = ageMin >= 10 && ["received", "accepted", "preparing"].includes(o.status);
  const cfg = statusConfig[o.status] ?? { icon: "?", label: o.status, cls: "tag-neutral" };

  return (
    <div className="card" style={o.status === "served" || o.status === "rejected" ? { opacity: 0.6 } : undefined}>
      <div className="flex items-start justify-between mb-1">
        <div>
          <p className="text-lg font-bold leading-tight">{o.tableName}</p>
          <p className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
            #{o.number} · {new Date(o.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
            <span className="ml-1 font-semibold" style={urgent ? { color: "var(--color-heaven-orange)" } : undefined}>({ageMin} dk)</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`tag ${cfg.cls}`}>{cfg.icon} {cfg.label}</span>
          {o.newSession && <span className="tag tag-outline">YENİ OTURUM</span>}
          {o.posStatus === "failed" && (
            <span className="tag btn-danger" style={{ fontSize: 11, padding: "4px 10px" }}>
              YAZICI HATASI
            </span>
          )}
        </div>
      </div>

      <ul className="text-sm my-2 flex flex-col gap-1">
        {o.items.map((i, idx) => (
          <li key={idx}>
            <span className="font-semibold">{i.qty}×</span> {i.name}
            {i.modifiers.length > 0 && <span style={{ color: "var(--color-neutral-900)" }}> ({i.modifiers.join(", ")})</span>}
            {i.note && <div className="text-xs font-medium pl-5" style={{ color: "var(--color-accent-700)" }}>⚠ {i.note}</div>}
          </li>
        ))}
      </ul>
      {o.rejectReason && <p className="text-xs mb-1" style={{ color: "var(--color-heaven-orange)" }}>Sebep: {o.rejectReason}</p>}
      <p className="text-right text-sm font-bold mb-2">{formatKurus(o.totalKurus)}</p>

      <div className="flex gap-2 flex-wrap">
        {o.status === "received" && (
          <>
            <button onClick={() => onTransition(o.id, "accepted")} className="btn btn-primary">Onayla</button>
            <button onClick={() => onReject(o.id)} className="btn btn-danger">Reddet</button>
          </>
        )}
        {o.status === "accepted" && (
          <>
            <button onClick={() => onTransition(o.id, "preparing")} className="btn btn-primary">Hazırlanıyor</button>
            <button onClick={() => onTransition(o.id, "ready")} className="btn btn-secondary">Hazır</button>
            <button onClick={() => onReject(o.id)} className="btn btn-danger">Reddet</button>
          </>
        )}
        {o.status === "preparing" && (
          <>
            <button onClick={() => onTransition(o.id, "ready")} className="btn btn-primary">Hazır</button>
            <button onClick={() => onReject(o.id)} className="btn btn-danger">Reddet</button>
          </>
        )}
        {o.status === "ready" && <button onClick={() => onTransition(o.id, "served")} className="btn btn-secondary">Servis Edildi</button>}
      </div>
    </div>
  );
}

function beep(ref: React.RefObject<AudioContext | null>) {
  try {
    ref.current = ref.current ?? new AudioContext();
    const ctx = ref.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}
