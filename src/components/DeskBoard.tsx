"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CurrencyProvider, useMoney } from "./MoneyContext";
import PasswordChangeDialog from "./PasswordChangeDialog";

type DeskBill = {
  visitId: string;
  tableId: string;
  tableName: string;
  status: string;
  openedAt: string;
  billRequestedAt: string | null;
  totalKurus: number;
  orderCount: number;
  phoneCount: number;
};

type BillDetail = {
  visitId: string;
  tableName: string;
  totalKurus: number;
  lines: { name: string; qty: number; lineTotalKurus: number; note: string; modifiers: string[] }[];
  phones: { sessionId: string; label: string; totalKurus: number }[];
};

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
  items: { id: string; name: string; qty: number; note: string; modifiers: string[] }[];
  edits: { staffName: string; afterPrint: boolean; changes: { name: string; fromQty: number; toQty: number }[] }[];
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

export default function DeskBoard({ staffName, currency }: { staffName: string; currency: string }) {
  const money = useMoney();
  const [orders, setOrders] = useState<DeskOrder[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [customReason, setCustomReason] = useState("");
  // The clock the elapsed-time badges read from. Held in state and advanced by
  // the 30s interval below so cards never call Date.now() during render.
  const [now, setNow] = useState(() => Date.now());
  const [bills, setBills] = useState<DeskBill[]>([]);
  const [settling, setSettling] = useState<BillDetail | null>(null);
  const [showSplit, setShowSplit] = useState(false);
  const [settleBusy, setSettleBusy] = useState(false);
  const [settleError, setSettleError] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [editing, setEditing] = useState<DeskOrder | null>(null);
  const [amendmentNotice, setAmendmentNotice] = useState(false);
  const router = useRouter();

  const load = useCallback(async () => {
    const res = await fetch(`/api/desk/orders${showAll ? "?all=1" : ""}`);
    // The session expired or was revoked from the admin panel mid-shift.
    if (res.status === 401) return router.push("/login");
    if (res.ok) setOrders((await res.json()).orders);
  }, [showAll, router]);

  const loadBills = useCallback(async () => {
    const res = await fetch("/api/desk/bills");
    if (res.ok) setBills((await res.json()).bills);
  }, []);

  useEffect(() => {
    // Wrapped so the state update lands after the await rather than
    // synchronously inside the effect body.
    (async () => { await Promise.all([load(), loadBills()]); })();
  }, [load, loadBills]);

  // SSE push + elapsed-time repaint every 30s + 60s polling safety net.
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const es = new EventSource("/api/desk/stream");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "order.created" || msg.type === "bill.requested") beep(audioRef);
        if (msg.type === "order.created" || msg.type === "order.updated") { load(); loadBills(); }
        if (msg.type === "bill.requested" || msg.type === "bill.updated" || msg.type === "visit.closed") {
          loadBills();
        }
      } catch {}
    };
    const tick = setInterval(() => setNow(Date.now()), 30000);
    const poll = setInterval(() => { void load(); void loadBills(); }, 60000);
    return () => {
      es.close();
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [load, loadBills]);

  async function openBill(visitId: string) {
    setSettleError("");
    setShowSplit(false);
    const res = await fetch(`/api/desk/bills/${visitId}`);
    if (res.ok) setSettling((await res.json()).bill);
  }

  async function settle(method: "cash" | "card", force = false) {
    if (!settling) return;
    setSettleBusy(true);
    setSettleError("");
    const res = await fetch(`/api/desk/bills/${settling.visitId}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentMethod: method, force }),
    });
    setSettleBusy(false);
    if (res.ok) {
      setSettling(null);
      await Promise.all([load(), loadBills()]);
      return;
    }
    const body = await res.json().catch(() => ({}));
    // The common one: staff hit settle while food is still being cooked.
    setSettleError(
      body.error === "orders_in_flight"
        ? "Mutfakta bekleyen sipariş var / Orders still in the kitchen"
        : "Hesap kapatılamadı / Could not settle"
    );
  }

  async function saveEdit(orderId: string, lines: { itemId: string; qty: number }[]) {
    const res = await fetch(`/api/desk/orders/${orderId}/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      // The ticket on screen is stale in both cases; pull the current one so
      // the next attempt is computed against what is actually there.
      if (b.error === "conflict" || b.error === "not_editable") void load();
      return (
        {
          not_editable: "Bu sipariş artık düzenlenemez / No longer editable",
          conflict: "Sipariş az önce değişti — yeniden açın / Order just changed elsewhere; reopen it",
          empties_order: "Tüm kalemler silinemez — siparişi reddedin / Cannot empty an order; reject it instead",
          no_change: "Değişiklik yok / Nothing changed",
          unknown_line: "Geçersiz kalem / Invalid line",
        }[b.error as string] ?? "Kaydedilemedi / Could not save"
      );
    }
    const body = await res.json();
    setEditing(null);
    await Promise.all([load(), loadBills()]);
    if (body.amendmentPrinted) {
      // The kitchen already had paper for this order; tell staff a correction
      // ticket is on its way so they can go and say so if it matters.
      setSettleError("");
      alertAmendment();
    }
    return null;
  }

  function alertAmendment() {
    setAmendmentNotice(true);
    setTimeout(() => setAmendmentNotice(false), 6000);
  }

  async function dismissBillRequest(visitId: string) {
    await fetch(`/api/desk/bills/${visitId}`, { method: "PATCH" });
    await loadBills();
  }

  async function transition(id: string, status: string, rejectReason?: string) {
    const res = await fetch(`/api/desk/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, rejectReason }),
    });
    if (res.ok) load();
  }

  const active = orders.filter((o) => !["served", "rejected", "cancelled"].includes(o.status));
  const done = orders.filter((o) => ["served", "rejected", "cancelled"].includes(o.status));

  const finalReason = reason === "Diğer / Other" ? customReason.trim() : reason;

  return (
    <CurrencyProvider currency={currency}>
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
          <button onClick={() => setChangingPassword(true)} className="btn-ghost">
            Şifre
          </button>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              // A hard navigation on purpose: the desk is a shared kitchen
              // terminal, and a soft nav would leave the previous user's orders
              // sitting in React state. Reloading discards all of it.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.href = "/login";
            }}
            className="btn-ghost"
          >
            Çıkış
          </button>
        </div>
      </header>

      {changingPassword && <PasswordChangeDialog onClose={() => setChangingPassword(false)} />}

      {amendmentNotice && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-3 text-sm"
          style={{ background: "var(--color-heaven-orange)", color: "#fff", border: "2px solid var(--color-text)" }}
        >
          Mutfağa DÜZELTME fişi gönderildi — sözlü olarak da bilgi verin.
          <br />
          An AMENDED ticket was sent to the kitchen — tell them verbally too.
        </div>
      )}

      {editing && <EditOrderDialog order={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}

      {/* Open tables. Bill requests sort first — this is the queue staff work
          through, so it sits above the kitchen board. */}
      {bills.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-wide mb-2">
            Açık Masalar / Open Tables
          </h2>
          <div className="flex flex-wrap gap-2">
            {bills.map((b) => {
              const requested = b.status === "bill_requested";
              const waitingMin = b.billRequestedAt
                ? Math.floor((now - new Date(b.billRequestedAt).getTime()) / 60000)
                : 0;
              return (
                <div
                  key={b.visitId}
                  className="card"
                  style={{
                    minWidth: 190,
                    ...(requested
                      ? { borderColor: "var(--color-heaven-orange)", borderWidth: 2 }
                      : {}),
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="font-bold">{b.tableName}</p>
                    {requested && (
                      <span
                        className="tag"
                        style={{ background: "var(--color-heaven-orange)", color: "#fff" }}
                      >
                        HESAP {waitingMin > 0 ? `${waitingMin}dk` : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-lg font-bold">{money(b.totalKurus)}</p>
                  <p className="text-xs mb-2" style={{ color: "var(--color-neutral-900)" }}>
                    {b.orderCount} sipariş
                    {b.phoneCount > 1 ? ` · ${b.phoneCount} telefon` : ""}
                  </p>
                  <div className="flex gap-2">
                    <button onClick={() => openBill(b.visitId)} className="btn btn-primary">
                      Hesap / Bill
                    </button>
                    {requested && (
                      <button
                        onClick={() => dismissBillRequest(b.visitId)}
                        className="btn btn-ghost"
                        title="Müşteri vazgeçti / Customer changed their mind"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Settle dialog */}
      {settling && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => !settleBusy && setSettling(null)}
        >
          <div
            className="bg-white p-5 w-full max-w-md max-h-[85vh] overflow-auto"
            style={{ border: "2px solid var(--color-text)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="wordmark text-xl mb-3">{settling.tableName} — HESAP</h2>

            <ul className="text-sm flex flex-col gap-1.5">
              {settling.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    {l.qty} × {l.name}
                    {l.modifiers.length > 0 && (
                      <span style={{ color: "var(--color-neutral-900)" }}>
                        {" "}({l.modifiers.join(", ")})
                      </span>
                    )}
                  </span>
                  <span className="shrink-0">{money(l.lineTotalKurus)}</span>
                </li>
              ))}
            </ul>

            <div
              className="flex justify-between font-bold text-xl mt-3 pt-3"
              style={{ borderTop: "2px solid var(--color-text)" }}
            >
              <span>TOPLAM</span>
              <span>{money(settling.totalKurus)}</span>
            </div>

            {/* "We're paying separately" — a view, not separate settlements. */}
            {settling.phones.length > 1 && (
              <div className="mt-3">
                <button onClick={() => setShowSplit((v) => !v)} className="btn-ghost text-sm">
                  {showSplit ? "▾" : "▸"} Telefona göre / By phone ({settling.phones.length})
                </button>
                {showSplit && (
                  <ul className="text-sm mt-2 flex flex-col gap-1 pl-3">
                    {settling.phones.map((p) => (
                      <li key={p.sessionId} className="flex justify-between">
                        <span style={{ color: "var(--color-neutral-900)" }}>{p.label}</span>
                        <span>{money(p.totalKurus)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {settleError && (
              <div className="mt-3">
                <p className="text-sm" style={{ color: "var(--color-heaven-orange)" }}>
                  {settleError}
                </p>
                {settleError.startsWith("Mutfakta") && (
                  <button
                    onClick={() => settle("cash", true)}
                    disabled={settleBusy}
                    className="btn btn-ghost mt-1 text-sm"
                  >
                    Yine de kapat / Close anyway (nakit)
                  </button>
                )}
              </div>
            )}

            <p className="text-xs mt-4 mb-2" style={{ color: "var(--color-neutral-900)" }}>
              Ödeme alındıktan sonra kapatın. Masa boşalır ve telefonlar kapanır.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => settle("cash")}
                disabled={settleBusy}
                className="btn btn-primary flex-1 justify-center py-3"
              >
                NAKİT / CASH
              </button>
              <button
                onClick={() => settle("card")}
                disabled={settleBusy}
                className="btn btn-secondary flex-1 justify-center py-3"
              >
                KART / CARD
              </button>
            </div>
            <button
              onClick={() => setSettling(null)}
              disabled={settleBusy}
              className="btn btn-ghost w-full justify-center mt-2"
            >
              Vazgeç / Cancel
            </button>
          </div>
        </div>
      )}


      {active.length === 0 && !showAll && (
        <p className="text-center py-20" style={{ color: "var(--color-neutral-900)" }}>Aktif sipariş yok — yeni siparişler anında burada belirir.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(showAll ? [...active, ...done] : active).map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            now={now}
            onTransition={transition}
            onReject={(id) => { setRejecting(id); setReason(""); setCustomReason(""); }}
            onEdit={setEditing}
          />
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
    </CurrencyProvider>
  );
}

function OrderCard({
  order: o,
  now,
  onTransition,
  onReject,
  onEdit,
}: {
  order: DeskOrder;
  now: number;
  onTransition: (id: string, status: string) => void;
  onReject: (id: string) => void;
  onEdit: (o: DeskOrder) => void;
}) {
  const money = useMoney();
  const ageMin = Math.floor((now - new Date(o.createdAt).getTime()) / 60000);
  const urgent = ageMin >= 10 && ["received", "accepted", "preparing"].includes(o.status);
  const cfg = statusConfig[o.status] ?? { icon: "?", label: o.status, cls: "tag-neutral" };

  return (
    <div className="card" style={["served", "rejected", "cancelled"].includes(o.status) ? { opacity: 0.6 } : undefined}>
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
      <p className="text-right text-sm font-bold mb-2">{money(o.totalKurus)}</p>

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
        {/* Correcting a line used to mean rejecting the whole ticket. */}
        {["received", "accepted", "preparing", "ready"].includes(o.status) && (
          <button onClick={() => onEdit(o)} className="btn btn-ghost">Düzenle</button>
        )}
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

/**
 * Reduce a quantity or remove a line. Quantities only go down: adding is a new
 * order, which gets the kitchen a fresh ticket instead of an amendment.
 */
function EditOrderDialog({
  order,
  onClose,
  onSave,
}: {
  order: DeskOrder;
  onClose: () => void;
  /** Returns an error message, or null on success. */
  onSave: (orderId: string, lines: { itemId: string; qty: number }[]) => Promise<string | null>;
}) {
  const money = useMoney();
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(order.items.map((i) => [i.id, i.qty]))
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The kitchen holds paper once a ticket has gone out, so the warning is shown
  // before the change, not after it.
  const alreadySent = order.status !== "received";
  const changed = order.items.filter((i) => qty[i.id] !== i.qty);

  async function save() {
    if (busy || changed.length === 0) return;
    setBusy(true);
    setError("");
    const err = await onSave(
      order.id,
      order.items.map((i) => ({ itemId: i.id, qty: qty[i.id] }))
    );
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={() => !busy && onClose()}
    >
      <div
        className="bg-white p-5 w-full max-w-md max-h-[85vh] overflow-auto"
        style={{ border: "2px solid var(--color-text)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="wordmark text-lg mb-1">
          #{order.number} · {order.tableName} — DÜZENLE
        </h2>
        {/* The current total. The new one is recomputed server-side from the
            stored line prices, so it is not guessed at here. */}
        <p className="text-sm font-bold">{money(order.totalKurus)}</p>
        <p className="text-xs mb-3" style={{ color: "var(--color-neutral-900)" }}>
          Adet azaltılabilir veya kalem silinebilir. Ekleme için yeni sipariş alın.
        </p>

        {alreadySent && (
          <p
            className="text-sm mb-3 p-2"
            style={{ border: "2px solid var(--color-heaven-orange)", color: "var(--color-heaven-orange)" }}
          >
            Bu siparişin fişi mutfağa gitti. Değişiklik sonrası DÜZELTME fişi basılır —
            mutfağa sözlü olarak da haber verin.
            <br />
            <span style={{ color: "var(--color-neutral-900)" }}>
              The kitchen already has a ticket for this order. An amended ticket will print;
              tell them verbally as well.
            </span>
          </p>
        )}

        <ul className="flex flex-col gap-2">
          {order.items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
              <span style={qty[i.id] === 0 ? { textDecoration: "line-through", opacity: 0.5 } : undefined}>
                {i.name}
                {i.modifiers.length > 0 && (
                  <span style={{ color: "var(--color-neutral-900)" }}> ({i.modifiers.join(", ")})</span>
                )}
                {i.note && <span style={{ color: "var(--color-accent-700)" }}> — {i.note}</span>}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setQty({ ...qty, [i.id]: Math.max(0, qty[i.id] - 1) })}
                  disabled={qty[i.id] === 0}
                  className="btn btn-ghost"
                  aria-label={`${i.name} azalt`}
                >
                  −
                </button>
                <span className="font-bold w-6 text-center">{qty[i.id]}</span>
                <button
                  onClick={() => setQty({ ...qty, [i.id]: Math.min(i.qty, qty[i.id] + 1) })}
                  disabled={qty[i.id] >= i.qty}
                  className="btn btn-ghost"
                  title="Artırmak için yeni sipariş alın"
                  aria-label={`${i.name} artır`}
                >
                  +
                </button>
              </span>
            </li>
          ))}
        </ul>

        {order.edits.length > 0 && (
          <div className="mt-3 pt-3 text-xs" style={{ borderTop: "1px solid var(--color-divider)", color: "var(--color-neutral-900)" }}>
            {order.edits.map((e, n) => (
              <p key={n}>
                {e.staffName}: {e.changes.map((c) => `${c.name} ${c.fromQty}→${c.toQty}`).join(", ")}
                {e.afterPrint ? " (fiş sonrası)" : ""}
              </p>
            ))}
          </div>
        )}

        {error && <p className="text-sm mt-3" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={save}
            disabled={busy || changed.length === 0}
            className="btn btn-primary flex-1 justify-center py-3"
          >
            {busy ? "..." : changed.length === 0 ? "Değişiklik yok" : "Kaydet / Save"}
          </button>
          <button onClick={onClose} disabled={busy} className="btn btn-ghost">
            Vazgeç
          </button>
        </div>
      </div>
    </div>
  );
}
