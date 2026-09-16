"use client";

import { t, type Locale } from "@/lib/i18n";

export default function CartBar({
  cartCount,
  cartTotal,
  money,
  locale,
  setCartOpen,
}: {
  cartCount: number;
  cartTotal: number;
  money: (kurus: number) => string;
  locale: Locale;
  setCartOpen: (open: boolean) => void;
}) {
  return (
    <button
      onClick={() => setCartOpen(true)}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100%-2rem)] max-w-md py-4 px-5 flex items-center justify-between shadow-xl"
      style={{ background: "var(--color-text)", color: "var(--color-bg)" }}
    >
      <span className="font-medium">
        {cartCount} {t(locale, "items")} · {money(cartTotal)}
      </span>
      <span className="font-bold flex items-center gap-1" style={{ color: "var(--color-accent-200)" }}>
        {t(locale, "viewCart")} →
      </span>
    </button>
  );
}
