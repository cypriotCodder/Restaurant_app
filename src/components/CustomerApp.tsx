"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t, statusLabel, type Locale } from "@/lib/i18n";
import { formatKurus } from "@/lib/money";

// ---------- types mirrored from the API ----------
type Option = { id: string; nameTr: string; nameEn: string; priceDeltaKurus: number };
type Group = {
  id: string;
  nameTr: string;
  nameEn: string;
  minSelect: number;
  maxSelect: number;
  options: Option[];
};
type Item = {
  id: string;
  nameTr: string;
  nameEn: string;
  descTr: string;
  descEn: string;
  priceKurus: number;
  photoUrl: string | null;
  tags: string[];
  available: boolean;
  modifierGroups: Group[];
};
type Category = { id: string; nameTr: string; nameEn: string; items: Item[] };
type Menu = {
  venue: { name: string; currency: string; defaultLocale: string };
  table: { name: string; code: string };
  categories: Category[];
};
type CartLine = { key: string; itemId: string; qty: number; note: string; optionIds: string[] };
type CustomerOrder = {
  id: string;
  number: number;
  status: string;
  rejectReason: string | null;
  totalKurus: number;
  createdAt: string;
  mine: boolean;
  items: { name: string; qty: number; note: string; unitPriceKurus: number; modifiers: { name: string }[] }[];
};

const name = (o: { nameTr: string; nameEn: string }, l: Locale) => (l === "en" ? o.nameEn : o.nameTr);

const statusTagClass: Record<string, string> = {
  received: "tag-accent",
  accepted: "tag-accent",
  preparing: "tag-accent",
  ready: "tag-outline",
  served: "tag-neutral",
  rejected: "tag-neutral",
};

export default function CustomerApp({ code }: { code: string }) {
  const [locale, setLocale] = useState<Locale>("tr");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [expired, setExpired] = useState(false);
  const [tab, setTab] = useState<"menu" | "orders">("menu");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [toast, setToast] = useState("");
  const [activeCat, setActiveCat] = useState<string>("");
  const cartKey = `cart_${code}`;

  // ---------- data loading ----------
  const loadMenu = useCallback(async () => {
    const res = await fetch(`/api/menu/${code}`);
    if (res.status === 401) return setExpired(true);
    if (res.ok) {
      const data: Menu = await res.json();
      setMenu(data);
      setLocale((prev) => prev ?? (data.venue.defaultLocale as Locale));
      setActiveCat((c) => c || data.categories[0]?.id || "");
    }
  }, [code]);

  const loadOrders = useCallback(async () => {
    const res = await fetch("/api/orders");
    if (res.status === 401) return setExpired(true);
    if (res.ok) setOrders((await res.json()).orders);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(cartKey);
      if (saved) setCart(JSON.parse(saved));
      const savedLocale = localStorage.getItem("locale");
      if (savedLocale === "en" || savedLocale === "tr") setLocale(savedLocale);
    } catch {}
    loadMenu();
    loadOrders();
  }, [cartKey, loadMenu, loadOrders]);

  useEffect(() => {
    try {
      localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {}
  }, [cart, cartKey]);

  // Live channel: order status changes + mid-service 86'ing.
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => {
    const es = new EventSource("/api/session/stream");
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "menu.changed") loadMenu();
        if (msg.type === "order.updated") loadOrders();
      } catch {}
    };
    return () => es.close();
  }, [loadMenu, loadOrders]);

  // ---------- cart math ----------
  const itemById = useMemo(() => {
    const m = new Map<string, Item>();
    menu?.categories.forEach((c) => c.items.forEach((i) => m.set(i.id, i)));
    return m;
  }, [menu]);

  const lineTotal = useCallback(
    (line: CartLine) => {
      const item = itemById.get(line.itemId);
      if (!item) return 0;
      const delta = item.modifierGroups
        .flatMap((g) => g.options)
        .filter((o) => line.optionIds.includes(o.id))
        .reduce((s, o) => s + o.priceDeltaKurus, 0);
      return (item.priceKurus + delta) * line.qty;
    },
    [itemById]
  );
  const cartTotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const cartCount = cart.reduce((s, l) => s + l.qty, 0);

  async function submitOrder() {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.map(({ itemId, qty, note, optionIds }) => ({ itemId, qty, note, optionIds })),
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setCart([]);
      setCartOpen(false);
      setToast(`${t(locale, "orderSubmitted")} ${t(locale, "orderNumber")}${data.number} — ${t(locale, "payAtTill")}`);
      setTab("orders");
      loadOrders();
      setTimeout(() => setToast(""), 5000);
    } else if (res.status === 401) {
      setExpired(true); // cart stays in localStorage; survives the re-scan
    } else if (res.status === 429) {
      setToast(t(locale, "rateLimited"));
      setTimeout(() => setToast(""), 5000);
    } else if (res.status === 409) {
      setToast(locale === "en" ? "An item just sold out — please review your cart." : "Bir ürün tükendi — lütfen sepetinizi kontrol edin.");
      loadMenu();
      setTimeout(() => setToast(""), 5000);
    } else {
      setToast(t(locale, "orderFailed"));
      setTimeout(() => setToast(""), 5000);
    }
  }

  if (expired) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-sm text-center flex flex-col items-center gap-4">
          <div
            className="h-14 w-14 flex items-center justify-center"
            style={{ border: "2px solid var(--color-text)" }}
            aria-hidden
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="4" y="4" width="6" height="6" />
              <rect x="14" y="4" width="6" height="6" />
              <rect x="4" y="14" width="6" height="6" />
              <path d="M14 14h3v3h-3zM20 14v6h-6" />
            </svg>
          </div>
          <h1 className="wordmark text-lg">{t(locale, "sessionExpiredTitle")}</h1>
          <p style={{ color: "var(--color-neutral-900)" }}>{t(locale, "sessionExpiredBody")}</p>
        </div>
      </main>
    );
  }
  if (!menu) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: "var(--color-accent)" }} />
      </main>
    );
  }

  return (
    <div className="flex-1 flex flex-col max-w-lg w-full mx-auto pb-24">
      {/* header */}
      <header className="sticky top-0 z-20 backdrop-blur border-b-2 px-4 py-3" style={{ background: "color-mix(in srgb, var(--color-bg) 95%, transparent)", borderColor: "var(--color-divider)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full shrink-0" style={{ background: "var(--color-accent)" }} />
            <h1 className="wordmark leading-none text-base">{menu.venue.name.toUpperCase()}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="tag tag-accent text-xs">{t(locale, "table")}: {menu.table.name}</span>
            <button
              onClick={() => {
                const next = locale === "tr" ? "en" : "tr";
                setLocale(next);
                try { localStorage.setItem("locale", next); } catch {}
              }}
              className="seg-opt"
              style={{ border: "1.5px solid var(--color-text)" }}
              aria-label="Change language"
            >
              {locale === "tr" ? "EN" : "TR"}
            </button>
          </div>
        </div>
        {/* tabs */}
        <div className="seg mt-3" role="tablist">
          {(["menu", "orders"] as const).map((tb) => (
            <button
              key={tb}
              role="tab"
              aria-selected={tab === tb}
              onClick={() => { setTab(tb); if (tb === "orders") loadOrders(); }}
              className={`seg-opt ${tab === tb ? "on" : ""}`}
            >
              {tb === "menu" ? t(locale, "menu") : t(locale, "myOrders")}
            </button>
          ))}
        </div>
        {tab === "menu" && (
          <nav className="flex gap-2 mt-3 overflow-x-auto pb-1 -mx-4 px-4" aria-label={t(locale, "menu")}>
            {menu.categories.map((c) => (
              <a
                key={c.id}
                href={`#cat-${c.id}`}
                onClick={() => setActiveCat(c.id)}
                className={`tag whitespace-nowrap ${activeCat === c.id ? "tag-accent" : "tag-neutral"}`}
              >
                {name(c, locale)}
              </a>
            ))}
          </nav>
        )}
      </header>

      {toast && (
        <div role="status" className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-3 text-sm shadow-lg max-w-[90vw]" style={{ background: "var(--color-text)", color: "var(--color-bg)" }}>
          {toast}
        </div>
      )}

      {/* menu tab — 2-column grid */}
      {tab === "menu" && (
        <div className="px-4">
          {menu.categories.map((c) => (
            <section key={c.id} id={`cat-${c.id}`} className="pt-5" aria-labelledby={`h-${c.id}`}>
              <h2 id={`h-${c.id}`} className="wordmark text-lg mb-3">{name(c, locale)}</h2>
              {c.items.filter(i => i.available).length === 0 ? (
                <div className="border border-dashed py-6 text-center text-sm" style={{ borderColor: "var(--color-divider)", color: "var(--color-neutral-900)" }}>
                  {locale === "en" ? "Nothing available right now." : "Bu kategoride şu anda ürün yok."}
                </div>
              ) : (
                <div className="menu-grid">
                  {c.items.map((i) => (
                    <button
                      key={i.id}
                      disabled={!i.available}
                      onClick={() => setSelected(i)}
                      className={`menu-card ${!i.available ? "unavailable" : ""}`}
                    >
                      <div className="menu-card-img" aria-hidden>
                        {i.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={i.photoUrl} alt="" />
                        ) : (
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                            <path d="M9 9h.01M15 9h.01" />
                          </svg>
                        )}
                      </div>
                      <div className="menu-card-body">
                        <p className="menu-card-title">{name(i, locale)}</p>
                        {(locale === "en" ? i.nameEn !== i.nameTr && i.nameTr : i.nameTr !== i.nameEn && i.nameEn) && (
                          <p className="menu-card-subtitle">{locale === "en" ? i.nameTr : i.nameEn}</p>
                        )}
                        {!i.available && <span className="tag tag-neutral mt-1 text-[10px]">{t(locale, "unavailable")}</span>}
                      </div>
                      <div className="menu-card-footer">
                        <span className="menu-card-price">{formatKurus(i.priceKurus)}</span>
                        {i.available && (
                          <span className="menu-card-add" aria-label={t(locale, "addToCart")}>+</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {/* orders tab */}
      {tab === "orders" && (
        <div className="px-4 pt-4 flex flex-col gap-3">
          {orders.length === 0 && <p className="text-center pt-10" style={{ color: "var(--color-neutral-900)" }}>—</p>}
          {orders.map((o) => (
            <div key={o.id} className="card">
              <div className="flex items-center justify-between mb-2">
                <p className="font-bold">
                  {t(locale, "orderNumber")}{o.number}
                  {!o.mine && <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-neutral-900)" }}>({t(locale, "table")})</span>}
                </p>
                <span className={`tag ${statusTagClass[o.status] ?? "tag-neutral"}`}>
                  {statusLabel(locale, o.status)}
                </span>
              </div>
              {o.status === "rejected" && o.rejectReason && (
                <p className="text-sm mb-2" style={{ color: "var(--color-heaven-orange)" }}>{t(locale, "reason")}: {o.rejectReason}</p>
              )}
              <ul className="text-sm flex flex-col gap-1" style={{ color: "var(--color-neutral-900)" }}>
                {o.items.map((i, idx) => (
                  <li key={idx}>
                    {i.qty} × {i.name}
                    {i.modifiers.length > 0 && (
                      <span> ({i.modifiers.map((m) => m.name).join(", ")})</span>
                    )}
                    {i.note && <span style={{ color: "var(--color-accent-700)" }}> — {i.note}</span>}
                  </li>
                ))}
              </ul>
              <p className="text-right font-bold mt-2">{formatKurus(o.totalKurus)}</p>
            </div>
          ))}
          <p className="text-center text-xs mt-2" style={{ color: "var(--color-neutral-900)" }}>{t(locale, "payAtTill")}</p>
        </div>
      )}

      {/* cart bar */}
      {cartCount > 0 && tab === "menu" && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-md py-4 px-5 flex items-center justify-between shadow-xl"
          style={{ background: "var(--color-text)", color: "var(--color-bg)" }}
        >
          <span className="font-medium">
            {cartCount} {cartCount === 1 ? "item" : "items"} · {formatKurus(cartTotal)}
          </span>
          <span className="font-bold flex items-center gap-1" style={{ color: "var(--color-accent-200)" }}>
            {locale === "en" ? "View cart" : "Sepeti gör"} →
          </span>
        </button>
      )}

      {/* item sheet */}
      {selected && (
        <ItemSheet
          item={selected}
          locale={locale}
          onClose={() => setSelected(null)}
          onAdd={(line) => {
            setCart((c) => [...c, line]);
            setSelected(null);
          }}
        />
      )}

      {/* cart sheet */}
      {cartOpen && (
        <Sheet onClose={() => setCartOpen(false)} title={locale === "en" ? "Your Order" : "Siparişiniz / Your Order"}>
          {cart.length === 0 ? (
            <p className="text-center py-8" style={{ color: "var(--color-neutral-900)" }}>{t(locale, "empty")}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {cart.map((line) => {
                  const item = itemById.get(line.itemId);
                  if (!item) return null;
                  const opts = item.modifierGroups
                    .flatMap((g) => g.options)
                    .filter((o) => line.optionIds.includes(o.id));
                  return (
                    <li key={line.key} className="flex gap-3 items-start pb-3" style={{ borderBottom: "1px solid var(--color-divider)" }}>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold">{name(item, locale)}</p>
                        {opts.length > 0 && (
                          <p className="text-sm" style={{ color: "var(--color-neutral-900)" }}>{opts.map((o) => name(o, locale)).join(", ")}</p>
                        )}
                        {line.note && <p className="text-sm" style={{ color: "var(--color-accent-700)" }}>{line.note}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          aria-label="−"
                          onClick={() =>
                            setCart((c) =>
                              c
                                .map((l) => (l.key === line.key ? { ...l, qty: l.qty - 1 } : l))
                                .filter((l) => l.qty > 0)
                            )
                          }
                          className="h-9 w-9 flex items-center justify-center font-bold"
                          style={{ border: "1.5px solid var(--color-text)" }}
                        >
                          −
                        </button>
                        <span className="w-5 text-center font-bold">{line.qty}</span>
                        <button
                          aria-label="+"
                          onClick={() =>
                            setCart((c) => c.map((l) => (l.key === line.key ? { ...l, qty: Math.min(20, l.qty + 1) } : l)))
                          }
                          className="h-9 w-9 flex items-center justify-center font-bold"
                          style={{ border: "1.5px solid var(--color-text)" }}
                        >
                          +
                        </button>
                      </div>
                      <p className="font-bold shrink-0">{formatKurus(lineTotal(line))}</p>
                    </li>
                  );
                })}
              </ul>
              {/* pricing breakdown */}
              <div className="mt-4 flex flex-col gap-1 text-sm" style={{ borderTop: "2px solid var(--color-text)", paddingTop: "12px" }}>
                <div className="flex justify-between">
                  <span>{locale === "en" ? "Subtotal" : "Ara Toplam / Subtotal"}</span>
                  <span>{formatKurus(cartTotal)}</span>
                </div>
                <div className="flex justify-between font-bold text-lg mt-2">
                  <span>{locale === "en" ? "Total" : "Toplam / Total"}</span>
                  <span>{formatKurus(cartTotal)}</span>
                </div>
              </div>
              <p className="text-xs mt-3 mb-3" style={{ color: "var(--color-neutral-900)" }}>{t(locale, "payAtTill")}</p>
              <button onClick={submitOrder} className="btn btn-primary w-full justify-center py-4 text-sm">
                {locale === "en" ? "SUBMIT ORDER" : "SİPARİŞİ GÖNDER · SUBMIT ORDER"}
              </button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}

// ---------- bottom sheet primitives ----------
function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg max-h-[85vh] overflow-y-auto p-5" style={{ background: "var(--color-bg)", borderTop: "2px solid var(--color-text)" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="wordmark text-lg">{title}</h2>
          <button onClick={onClose} className="btn-icon" style={{ border: "2px solid var(--color-text)" }} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ItemSheet({
  item,
  locale,
  onClose,
  onAdd,
}: {
  item: Item;
  locale: Locale;
  onClose: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [optionIds, setOptionIds] = useState<string[]>([]);

  const valid = item.modifierGroups.every((g) => {
    const count = g.options.filter((o) => optionIds.includes(o.id)).length;
    return count >= g.minSelect && count <= g.maxSelect;
  });
  const unit =
    item.priceKurus +
    item.modifierGroups
      .flatMap((g) => g.options)
      .filter((o) => optionIds.includes(o.id))
      .reduce((s, o) => s + o.priceDeltaKurus, 0);

  function toggle(group: Group, opt: Option) {
    setOptionIds((ids) => {
      const inGroup = group.options.map((o) => o.id);
      if (group.maxSelect === 1) {
        const cleared = ids.filter((id) => !inGroup.includes(id));
        return ids.includes(opt.id) && group.minSelect === 0 ? cleared : [...cleared, opt.id];
      }
      if (ids.includes(opt.id)) return ids.filter((id) => id !== opt.id);
      const count = ids.filter((id) => inGroup.includes(id)).length;
      return count >= group.maxSelect ? ids : [...ids, opt.id];
    });
  }

  return (
    <Sheet title={name(item, locale)} onClose={onClose}>
      {/* Photo area */}
      <div className="w-full h-40 flex items-center justify-center mb-4" style={{ background: "var(--color-neutral-100)", border: "1px solid var(--color-divider)" }}>
        {item.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        )}
      </div>

      <h3 className="font-bold text-xl">{name(item, locale)}</h3>
      {(locale === "en" ? item.descEn : item.descTr) && (
        <p className="mt-1" style={{ color: "var(--color-neutral-900)" }}>{locale === "en" ? item.descEn : item.descTr}</p>
      )}
      <p className="font-extrabold text-xl mt-2">{formatKurus(item.priceKurus)}</p>
      {item.tags.length > 0 && <p className="text-xs mt-1" style={{ color: "var(--color-neutral-900)" }}>{item.tags.join(" · ")}</p>}

      {item.modifierGroups.map((g) => (
        <fieldset key={g.id} className="mt-5">
          <legend className="font-bold text-sm uppercase tracking-wide mb-2">
            {name(g, locale)}{" "}
            <span className="text-xs font-normal normal-case tracking-normal" style={{ color: "var(--color-neutral-900)" }}>
              ({g.minSelect > 0 ? t(locale, "required") : t(locale, "optional")})
            </span>
          </legend>

          {/* Single select → segmented control */}
          {g.maxSelect === 1 ? (
            <div className="seg">
              {g.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(g, o)}
                  className={`seg-opt ${optionIds.includes(o.id) ? "on" : ""}`}
                >
                  {name(o, locale)}
                  {o.priceDeltaKurus > 0 && ` +${formatKurus(o.priceDeltaKurus)}`}
                </button>
              ))}
            </div>
          ) : (
            /* Multi select → checklist rows */
            <div className="flex flex-col">
              {g.options.map((o) => (
                <label
                  key={o.id}
                  className="flex items-center justify-between py-2.5"
                  style={{ borderBottom: "1px solid var(--color-divider)" }}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={optionIds.includes(o.id)}
                      onChange={() => toggle(g, o)}
                      className="h-5 w-5"
                    />
                    <span>{name(o, locale)}</span>
                  </div>
                  {o.priceDeltaKurus !== 0 && (
                    <span className="text-sm" style={{ color: "var(--color-neutral-900)" }}>+{formatKurus(o.priceDeltaKurus)}</span>
                  )}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ))}

      <div className="mt-5">
        <label className="block">
          <span className="text-sm font-medium" style={{ color: "var(--color-neutral-900)" }}>{t(locale, "itemNote")}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 200))}
            placeholder={t(locale, "orderNote")}
            rows={2}
            className="input w-full mt-1 resize-none"
          />
        </label>
      </div>

      <div className="flex items-center gap-4 mt-5">
        <div className="flex items-center gap-2">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-11 w-11 flex items-center justify-center font-bold" style={{ border: "1.5px solid var(--color-text)" }} aria-label="−">
            −
          </button>
          <span className="w-6 text-center font-bold text-lg">{qty}</span>
          <button onClick={() => setQty((q) => Math.min(20, q + 1))} className="h-11 w-11 flex items-center justify-center font-bold" style={{ border: "1.5px solid var(--color-text)" }} aria-label="+">
            +
          </button>
        </div>
        <button
          disabled={!valid}
          onClick={() =>
            onAdd({ key: `${item.id}-${Date.now()}`, itemId: item.id, qty, note: note.trim(), optionIds })
          }
          className="btn btn-primary flex-1 justify-center py-3.5"
        >
          {locale === "en" ? "ADD TO CART" : "SEPETE EKLE"} · {formatKurus(unit * qty)}
        </button>
      </div>
    </Sheet>
  );
}
