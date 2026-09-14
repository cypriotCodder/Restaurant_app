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

export function LoadingScreen() {
  return (
    <main className="flex-1 flex items-center justify-center">
      <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: "var(--color-accent)" }} />
    </main>
  );
}
