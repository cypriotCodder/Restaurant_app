"use client";

import { t, type Locale } from "@/lib/i18n";

// A settled table is a happy ending, not an error — show it as one.
export function SettledScreen({ locale }: { locale: Locale }) {
  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--color-bg)" }}>
      <div className="text-center flex flex-col items-center gap-3">
        <div className="h-3 w-3 rounded-full" style={{ background: "var(--color-accent)" }} />
        <h1 className="wordmark text-2xl">{t(locale, "visitClosedTitle")}</h1>
        <p className="text-sm max-w-xs" style={{ color: "var(--color-neutral-900)" }}>
          {t(locale, "visitClosedBody")}
        </p>
      </div>
    </main>
  );
}

export function ExpiredScreen({ locale }: { locale: Locale }) {
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

/**
 * The menu could not be loaded for a reason other than a dead session. This
 * used to fall through to the loading dot forever, which on a phone looks
 * exactly like a broken QR code — and was mistaken for one more than once.
 */
export function ErrorScreen({ locale, onRetry }: { locale: Locale; onRetry: () => void }) {
  return (
    <main className="flex-1 flex items-center justify-center p-6" role="alert">
      <div className="max-w-sm text-center flex flex-col items-center gap-4">
        <div
          className="h-14 w-14 flex items-center justify-center text-2xl font-bold"
          style={{ border: "2px solid var(--color-heaven-orange)", color: "var(--color-heaven-orange)" }}
          aria-hidden
        >
          !
        </div>
        <h1 className="wordmark text-lg">{t(locale, "loadFailedTitle")}</h1>
        <p style={{ color: "var(--color-neutral-900)" }}>{t(locale, "loadFailedBody")}</p>
        <button onClick={onRetry} className="btn btn-primary">
          {t(locale, "retry")}
        </button>
      </div>
    </main>
  );
}

/**
 * The shape of the menu page, before the menu arrives: a header, a category
 * rail and two columns of cards. Layout lands once instead of jumping from a
 * centred dot to a full grid, and the page reads as "loading a menu" rather
 * than "stuck".
 */
export function LoadingScreen({ locale }: { locale: Locale }) {
  const block = (cls: string) => (
    <div className={`rounded-sm animate-pulse ${cls}`} style={{ background: "var(--color-neutral-200)" }} />
  );
  return (
    <main className="flex-1 flex flex-col max-w-lg w-full mx-auto" aria-busy="true" aria-label={t(locale, "loading")}>
      <div className="px-4 py-3 border-b-2" style={{ borderColor: "var(--color-divider)" }}>
        <div className="flex items-center justify-between">
          {block("h-4 w-32")}
          {block("h-6 w-20")}
        </div>
        <div className="flex gap-2 mt-3">{block("h-8 w-24")}{block("h-8 w-24")}{block("h-8 w-24")}</div>
        <div className="flex gap-2 mt-3">{block("h-6 w-16")}{block("h-6 w-20")}{block("h-6 w-14")}</div>
      </div>
      <div className="px-4 pt-5">
        {block("h-5 w-28 mb-3")}
        <div className="menu-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="menu-card" aria-hidden>
              <div className="menu-card-img" />
              <div className="menu-card-body gap-2">{block("h-3.5 w-3/4")}{block("h-3 w-1/2")}</div>
              <div className="menu-card-footer">{block("h-4 w-12")}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="sr-only" role="status">{t(locale, "loading")}</p>
    </main>
  );
}
