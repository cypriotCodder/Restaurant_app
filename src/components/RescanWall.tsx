// The wall shown when a table URL arrives without a valid session:
// expired/idle/revoked session, invalid or regenerated QR signature.
export default function RescanWall({ variant }: { variant: "expired" | "invalid" }) {
  const isInvalid = variant === "invalid";
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
        <h1 className="wordmark text-lg">
          {isInvalid ? "Geçersiz QR Kod" : "Oturum Süresi Doldu"}
        </h1>
        <p style={{ color: "var(--color-neutral-900)" }}>
          {isInvalid
            ? "Bu bağlantı artık geçerli değil. Lütfen masanızdaki güncel QR kodu okutun."
            : "Sipariş verebilmek için lütfen masanızdaki QR kodu yeniden okutun."}
        </p>
        <p className="text-sm" style={{ color: "var(--color-neutral-900)" }}>
          {isInvalid
            ? "This link is no longer valid. Please scan the current QR code on your table."
            : "Please re-scan the QR code on your table to order."}
        </p>
        {!isInvalid && <span className="tag tag-neutral">Siparişiniz kayıtlı / Your order is saved</span>}
      </div>
    </main>
  );
}
