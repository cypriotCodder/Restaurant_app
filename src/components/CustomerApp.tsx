"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Locale, t } from "@/lib/i18n";
import { formatKurus } from "@/lib/money";
import useSWR from "swr";
import { swrDefaults } from "@/lib/swr";
import { CurrencyProvider } from "./MoneyContext";
import { ConfirmDialog } from "./Dialog";
import BillPanel from "./customer/BillPanel";
import CartBar from "./customer/CartBar";
import Header from "./customer/Header";
import MenuSection from "./customer/MenuSection";
import OrdersList from "./customer/OrdersList";
import { ErrorScreen, ExpiredScreen, LoadingScreen, SettledScreen } from "./customer/StateScreens";
import { newIdempotencyKey } from "./customer/shared";
import type { CartLine, CustomerBill, CustomerOrder, Item, Menu } from "./customer/types";

// Both sheets only exist after a tap, and neither is part of the first paint a
// customer sees at the table. Keeping them out of the initial bundle matters
// on the phone-over-cellular path this app actually runs on.
const ItemSheet = dynamic(() => import("./customer/ItemSheet"));
const CartSheet = dynamic(() => import("./customer/CartSheet"));

export default function CustomerApp({ code }: { code: string }) {
  const [locale, setLocale] = useState<Locale>("tr");
  const [expired, setExpired] = useState(false);
  const [tab, setTab] = useState<"menu" | "orders" | "bill">("menu");
  const [requestingBill, setRequestingBill] = useState(false);
  // Set when staff settle the table: the party has paid and their phones are
  // revoked, so the app shows a thank-you rather than a scary "session expired".
  const [settled, setSettled] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [toast, setToast] = useState("");
  const [activeCat, setActiveCat] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const cartKey = `cart_${code}`;
  // One key per cart-load, minted on first submit and only cleared once an
  // order is actually placed. A retry after a timeout the customer never saw
  // land therefore reuses it, and the server returns the original order.
  const idempotencyKeyRef = useRef<string | null>(null);

  // ---------- data loading ----------
  // A 401 on any of these means the table session was revoked or expired. It
  // is the same outcome whichever call notices first.
  const onAuthError = useCallback((err: unknown) => {
    if ((err as { status?: number })?.status === 401) setExpired(true);
  }, []);
  const options = { ...swrDefaults, onError: onAuthError };

  const {
    data: menu,
    error: menuError,
    mutate: loadMenu,
  } = useSWR<Menu>(`/api/menu/${code}`, options);
  const { data: ordersData, mutate: loadOrders } = useSWR<{ orders: CustomerOrder[] }>(
    "/api/orders",
    options
  );
  const { data: bill, mutate: loadBill } = useSWR<CustomerBill>("/api/bill", options);
  const orders = ordersData?.orders ?? [];

  // Seeded from the menu payload, then owned by the customer: the language
  // toggle and the category rail both stay put once they have touched them.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (!menu) return;
    setLocale((prev) => prev ?? (menu.venue.defaultLocale as Locale));
    setActiveCat((c) => c || menu.categories[0]?.id || "");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [menu]);

  // Restore the cart that survived a re-scan. This has to stay a synchronous
  // post-mount effect: localStorage does not exist during SSR, so hydrating it
  // in a useState initializer would make the server and client first renders
  // disagree. set-state-in-effect guards against cascading renders, which a
  // one-shot mount hydration cannot cause.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const saved = localStorage.getItem(cartKey);
      if (saved) setCart(JSON.parse(saved));
      const savedLocale = localStorage.getItem("locale");
      if (savedLocale === "en" || savedLocale === "tr") setLocale(savedLocale);
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [cartKey]);

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
        if (msg.type === "order.updated") { loadOrders(); loadBill(); }
        if (msg.type === "bill.updated") loadBill();
        // Staff closed the table at the till.
        if (msg.type === "visit.closed") setSettled(true);
        // Staff ended this phone's session from the admin screen: show the
        // re-scan wall now rather than on the next failed request.
        if (msg.type === "session.revoked") setExpired(true);
      } catch {}
    };
    return () => es.close();
  }, [loadMenu, loadOrders, loadBill]);

  const [cancelling, setCancelling] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  async function cancelOrder(orderId: string) {
    if (cancelling) return;
    setConfirmCancel(null);
    setCancelling(orderId);
    const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" }).catch(() => null);
    setCancelling(null);
    if (res?.ok) {
      await Promise.all([loadOrders(), loadBill()]);
      return;
    }
    if (res?.status === 401) return setExpired(true);
    // 409 means the desk accepted it between the list rendering and the tap.
    setToast(t(locale, res?.status === 409 ? "cancelTooLate" : "cancelFailed"));
    setTimeout(() => setToast(""), 6000);
    await loadOrders();
  }

  async function askForBill() {
    if (requestingBill || bill?.billRequested) return;
    setRequestingBill(true);
    const res = await fetch("/api/bill", { method: "POST" }).catch(() => null);
    setRequestingBill(false);
    if (res?.ok) {
      await loadBill();
      setToast(t(locale, "billRequested"));
      setTimeout(() => setToast(""), 6000);
    } else if (res?.status === 401) {
      setExpired(true);
    }
  }

  // Prices render in the venue's own currency, which arrives with the menu.
  const money = useCallback(
    (kurus: number) => formatKurus(kurus, menu?.venue.currency ?? "TRY"),
    [menu?.venue.currency]
  );

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
    // Guards the double-tap: on a slow connection the button stays visible
    // long enough to be pressed again before the first request resolves.
    if (submitting) return;
    setSubmitting(true);
    idempotencyKeyRef.current ??= newIdempotencyKey();

    let res: Response;
    try {
      res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map(({ itemId, qty, note, optionIds }) => ({ itemId, qty, note, optionIds })),
          idempotencyKey: idempotencyKeyRef.current,
        }),
      });
    } catch {
      // Network failure: the order may or may not have landed. Keep the key so
      // a retry is resolved as a replay rather than placing a second order.
      setSubmitting(false);
      setToast(t(locale, "orderFailed"));
      setTimeout(() => setToast(""), 5000);
      return;
    }
    setSubmitting(false);

    if (res.ok) {
      const data = await res.json();
      idempotencyKeyRef.current = null;
      setCart([]);
      setCartOpen(false);
      setToast(`${t(locale, "orderSubmitted")} ${t(locale, "orderNumber")}${data.number} — ${t(locale, "payAtTill")}`);
      setTab("orders");
      loadOrders();
      loadBill();
      setTimeout(() => setToast(""), 5000);
    } else if (res.status === 401) {
      setExpired(true); // cart stays in localStorage; survives the re-scan
    } else if (res.status === 429) {
      setToast(t(locale, "rateLimited"));
      setTimeout(() => setToast(""), 5000);
    } else if (res.status === 409) {
      setToast(t(locale, "itemSoldOut"));
      loadMenu();
      setTimeout(() => setToast(""), 5000);
    } else {
      setToast(t(locale, "orderFailed"));
      setTimeout(() => setToast(""), 5000);
    }
  }

  // A settled table is a happy ending, not an error — show it as one.

  if (settled) return <SettledScreen locale={locale} />;
  if (expired) return <ExpiredScreen locale={locale} />;
  // A failed menu fetch that is not a dead session (401 is handled above) must
  // say so: the bare loading dot is indistinguishable from a broken QR code.
  if (!menu && menuError) return <ErrorScreen locale={locale} onRetry={() => void loadMenu()} />;
  if (!menu) return <LoadingScreen locale={locale} />;

  return (
    <CurrencyProvider currency={menu.venue.currency}>
      <div className="flex-1 flex flex-col max-w-lg w-full mx-auto pb-24">
        <Header
          menu={menu}
          locale={locale}
          setLocale={setLocale}
          tab={tab}
          setTab={setTab}
          activeCat={activeCat}
          setActiveCat={setActiveCat}
          loadOrders={loadOrders}
          loadBill={loadBill}
        />

        {toast && (
          <div role="status" className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-3 text-sm shadow-lg max-w-[90vw]" style={{ background: "var(--color-text)", color: "var(--color-bg)" }}>
            {toast}
          </div>
        )}

        {tab === "menu" && (
          <MenuSection menu={menu} locale={locale} money={money} setSelected={setSelected} />
        )}

        {tab === "orders" && (
          <OrdersList
            orders={orders}
            locale={locale}
            money={money}
            cancelOrder={setConfirmCancel}
            cancelling={cancelling}
          />
        )}

        {confirmCancel && (
          <ConfirmDialog
            title={t(locale, "confirmCancelOrder")}
            confirmLabel={t(locale, "cancelOrder")}
            cancelLabel={t(locale, "close")}
            danger
            onConfirm={() => cancelOrder(confirmCancel)}
            onCancel={() => setConfirmCancel(null)}
          />
        )}

        {tab === "bill" && (
          <BillPanel
            bill={bill ?? null}
            locale={locale}
            money={money}
            askForBill={askForBill}
            requestingBill={requestingBill}
          />
        )}

        {cartCount > 0 && tab === "menu" && !cartOpen && (
          <CartBar
            cartCount={cartCount}
            cartTotal={cartTotal}
            money={money}
            locale={locale}
            setCartOpen={setCartOpen}
          />
        )}

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

        {cartOpen && (
          <CartSheet
            cart={cart}
            setCart={setCart}
            setCartOpen={setCartOpen}
            itemById={itemById}
            locale={locale}
            money={money}
            lineTotal={lineTotal}
            cartTotal={cartTotal}
            submitOrder={submitOrder}
            submitting={submitting}
          />
        )}
      </div>
    </CurrencyProvider>
  );
}
