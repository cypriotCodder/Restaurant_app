"use client";

import { t, type Locale } from "@/lib/i18n";
import { name } from "./shared";
import type { Menu } from "./types";

type Tab = "menu" | "orders" | "bill";

export default function Header({
  menu,
  locale,
  setLocale,
  tab,
  setTab,
  activeCat,
  setActiveCat,
  loadOrders,
  loadBill,
}: {
  menu: Menu;
  locale: Locale;
  setLocale: (l: Locale) => void;
  tab: Tab;
  setTab: (next: Tab) => void;
  activeCat: string;
  setActiveCat: (id: string) => void;
  loadOrders: () => void;
  loadBill: () => void;
}) {
  return (
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
        {(["menu", "orders", "bill"] as const).map((tb) => (
          <button
            key={tb}
            role="tab"
            aria-selected={tab === tb}
            onClick={() => {
              setTab(tb);
              if (tb === "orders") loadOrders();
              if (tb === "bill") loadBill();
            }}
            className={`seg-opt ${tab === tb ? "on" : ""}`}
          >
            {tb === "menu" ? t(locale, "menu") : tb === "orders" ? t(locale, "myOrders") : t(locale, "bill")}
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
  );
}
