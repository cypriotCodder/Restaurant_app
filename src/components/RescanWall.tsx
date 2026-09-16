import { t } from "@/lib/i18n";

// The wall shown when a table URL arrives without a valid session:
// expired/idle/revoked session, invalid or regenerated QR signature.
//
// Rendered on the server before any locale choice exists (the choice lives in
// the browser's localStorage), so both languages are shown, Turkish first.
export default function RescanWall({ variant }: { variant: "expired" | "invalid" }) {
  const titleKey = variant === "invalid" ? "invalidQrTitle" : "sessionExpiredTitle";
  const bodyKey = variant === "invalid" ? "invalidQrBody" : "sessionExpiredBody";
  return (
    <main className="flex-1 flex items-center justify-center p-6" style={{ background: "var(--color-bg)" }}>
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
        <h1 className="wordmark text-lg" lang="tr">{t("tr", titleKey)}</h1>
        <p lang="tr" style={{ color: "var(--color-neutral-900)" }}>{t("tr", bodyKey)}</p>
        <p lang="en" className="text-sm" style={{ color: "var(--color-neutral-900)" }}>
          <strong>{t("en", titleKey)}.</strong> {t("en", bodyKey)}
        </p>
        {variant !== "invalid" && (
          <span className="tag tag-neutral">
            {t("tr", "orderSaved")} / {t("en", "orderSaved")}
          </span>
        )}
      </div>
    </main>
  );
}
