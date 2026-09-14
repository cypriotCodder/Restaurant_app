"use client";

import type { Dispatch, SetStateAction } from "react";
import { t, type Locale } from "@/lib/i18n";
import Sheet from "./Sheet";
import { name } from "./shared";
import type { CartLine, Item } from "./types";

export default function CartSheet({
  cart,
  setCart,
  setCartOpen,
  itemById,
  locale,
  money,
  lineTotal,
  cartTotal,
  submitOrder,
  submitting,
}: {
  cart: CartLine[];
  setCart: Dispatch<SetStateAction<CartLine[]>>;
  setCartOpen: (open: boolean) => void;
  itemById: Map<string, Item>;
  locale: Locale;
  money: (kurus: number) => string;
  lineTotal: (line: CartLine) => number;
  cartTotal: number;
  submitOrder: () => void;
  submitting: boolean;
}) {
  return (
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
                  <p className="font-bold shrink-0">{money(lineTotal(line))}</p>
                </li>
              );
            })}
          </ul>
          {/* pricing breakdown */}
          <div className="mt-4 flex flex-col gap-1 text-sm" style={{ borderTop: "2px solid var(--color-text)", paddingTop: "12px" }}>
            <div className="flex justify-between">
              <span>{locale === "en" ? "Subtotal" : "Ara Toplam / Subtotal"}</span>
              <span>{money(cartTotal)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg mt-2">
              <span>{locale === "en" ? "Total" : "Toplam / Total"}</span>
              <span>{money(cartTotal)}</span>
            </div>
          </div>
          <p className="text-xs mt-3 mb-3" style={{ color: "var(--color-neutral-900)" }}>{t(locale, "payAtTill")}</p>
          <button
            onClick={submitOrder}
            disabled={submitting}
            className="btn btn-primary w-full justify-center py-4 text-sm"
          >
            {submitting
              ? locale === "en" ? "SENDING..." : "GÖNDERİLİYOR..."
              : locale === "en" ? "SUBMIT ORDER" : "SİPARİŞİ GÖNDER · SUBMIT ORDER"}
          </button>
        </>
      )}
    </Sheet>
  );
}
