"use client";

import { t, type Locale } from "@/lib/i18n";
import { name } from "./shared";
import type { Item, Menu } from "./types";

export default function MenuSection({
  menu,
  locale,
  money,
  setSelected,
}: {
  menu: Menu;
  locale: Locale;
  money: (kurus: number) => string;
  setSelected: (item: Item) => void;
}) {
  return (
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
                    <span className="menu-card-price">{money(i.priceKurus)}</span>
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
  );
}
