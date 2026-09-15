"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Locale, t } from "@/lib/i18n";
import { formatKurus } from "@/lib/money";
import useSWR from "swr";
import { swrDefaults } from "@/lib/swr";
import { CurrencyProvider } from "./MoneyContext";
import BillPanel from "./customer/BillPanel";
import CartBar from "./customer/CartBar";
import Header from "./customer/Header";
import MenuSection from "./customer/MenuSection";
import OrdersList from "./customer/OrdersList";
import { ExpiredScreen, LoadingScreen, SettledScreen } from "./customer/StateScreens";
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
  // Whether this customer has a language of their own — either restored from a
  // previous visit or picked with the toggle. Until they do, the venue's
  // configured default wins.
  const localeChosenRef = useRef(false);
  const chooseLocale = useCallback((next: Locale) => {
    localeChosenRef.current = true;
    setLocale(next);
  }, []);

  // ---------- data loading ----------
  // A 401 on any of these means the table session was revoked or expired. It
  // is the same outcome whichever call notices first.
  const onAuthError = useCallback((err: unknown) => {
    if ((err as { status?: number })?.status === 401) setExpired(true);
  }, []);
  const options = { ...swrDefaults, onError: onAuthError };

  const { data: menu, mutate: loadMenu } = useSWR<Menu>(`/api/menu/${code}`, options);
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
    // `locale` always holds a value, so this cannot be a `prev ?? default`
    // fallback — that never fell through and the venue's setting was ignored.
    if (!localeChosenRef.current) setLocale(menu.venue.defaultLocale as Locale);
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
      if (savedLocale === "en" || savedLocale === "tr") {
        localeChosenRef.current = true;
        setLocale(savedLocale);
      }
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [cartKey]);

  useEffect(() => {
    try {
      localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {}
  }, [cart, cartKey]);

  // One timer for the toast slot. Each message used to schedule its own
  // unclearable timeout, so a second toast arriving behind a first was wiped
  // early by the first one's expiry — and both outlived the component.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, ms = 5000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), ms);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Live channel: order status changes + mid-service 86'ing.
  useEffect(() => {
    const es = new EventSource("/api/session/stream");
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "menu.changed") loadMenu();
        if (msg.type === "order.updated") { loadOrders(); loadBill(); }
        if (msg.type === "bill.updated") loadBill();
        // Staff closed the table at the till.
        if (msg.type === "visit.closed") setSettled(true);
      } catch {}
    };
    return () => es.close();
  }, [loadMenu, loadOrders, loadBill]);

  const [cancelling, setCancelling] = useState<string | null>(null);

  async function cancelOrder(orderId: string) {
    if (cancelling) return;
    if (!confirm(t(locale, "confirmCancelOrder"))) return;
    setCancelling(orderId);
    const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" }).catch(() => null);
    setCancelling(null);
    if (res?.ok) {
      await Promise.all([loadOrders(), loadBill()]);
      return;
    }
    if (res?.status === 401) return setExpired(true);
    // 409 means the desk accepted it between the list rendering and the tap.
    showToast(t(locale, res?.status === 409 ? "cancelTooLate" : "cancelFailed"), 6000);
    await loadOrders();
  }

  async function askForBill() {
    if (requestingBill || bill?.billRequested) return;
    setRequestingBill(true);
    const res = await fetch("/api/bill", { method: "POST" }).catch(() => null);
    setRequestingBill(false);
    if (res?.ok) {
      await loadBill();
      showToast(t(locale, "billRequested"), 6000);
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
      showToast(t(locale, "orderFailed"));
      return;
    }
    setSubmitting(false);

    if (res.ok) {
      const data = await res.json();
      idempotencyKeyRef.current = null;
      setCart([]);
      setCartOpen(false);
      showToast(`${t(locale, "orderSubmitted")} ${t(locale, "orderNumber")}${data.number} — ${t(locale, "payAtTill")}`);
      setTab("orders");
      loadOrders();
      loadBill();
    } else if (res.status === 401) {
      setExpired(true); // cart stays in localStorage; survives the re-scan
    } else if (res.status === 429) {
      showToast(t(locale, "rateLimited"));
    } else if (res.status === 409) {
      showToast(locale === "en" ? "An item just sold out — please review your cart." : "Bir ürün tükendi — lütfen sepetinizi kontrol edin.");
      loadMenu();
    } else {
      showToast(t(locale, "orderFailed"));
    }
  }

  // A settled table is a happy ending, not an error — show it as one.

  if (settled) return <SettledScreen locale={locale} />;
  if (expired) return <ExpiredScreen locale={locale} />;
  if (!menu) return <LoadingScreen />;

  return (
    <CurrencyProvider currency={menu.venue.currency}>
      <div className="flex-1 flex flex-col max-w-lg w-full mx-auto pb-24">
        <Header
          menu={menu}
          locale={locale}
          setLocale={chooseLocale}
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
            cancelOrder={cancelOrder}
            cancelling={cancelling}
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
