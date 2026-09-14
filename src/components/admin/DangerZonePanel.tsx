"use client";

import { useState } from "react";
// Rotating the venue QR secret invalidates every printed table card at once.
// It is the remedy for a leaked secret, not routine maintenance, so it is
// separated from everything else and gated behind typing the venue slug.
export default function DangerZonePanel() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [expected, setExpected] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function rotate() {
    setBusy(true);
    setResult("");
    const res = await fetch("/api/admin/venue/qr-secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: confirmText }),
    });
    setBusy(false);
    const b = await res.json().catch(() => ({}));
    if (res.ok) {
      setResult(`${b.tablesAffected} masanın QR kodu yenilendi — hepsini yeniden yazdırın.`);
      setConfirmText("");
      return;
    }
    if (b.error === "confirmation_required") {
      setExpected(b.expected ?? "");
      setResult("Onay metni eşleşmiyor / Confirmation text does not match");
      return;
    }
    setResult("İşlem başarısız / Failed");
  }

  return (
    <div className="card" style={{ maxWidth: 600, borderColor: "var(--color-heaven-orange)" }}>
      <h3 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: "var(--color-heaven-orange)" }}>
        Tehlikeli Bölge / Danger Zone
      </h3>

      {!open ? (
        <button onClick={() => setOpen(true)} className="btn btn-ghost">
          Tüm QR kodlarını geçersiz kıl / Invalidate all QR codes
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Bu işlem <strong>tüm masaların basılı QR kodlarını</strong> geçersiz kılar ve
            oturumdaki tüm müşterileri çıkarır. Yalnızca QR imza anahtarı sızdıysa kullanın —
            tek bir masa için Masalar ekranındaki &quot;QR Yenile&quot; yeterlidir.
          </p>
          <p className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
            Invalidates every printed table card and signs out every customer. Use only if the
            signing secret leaked; for one table, use &quot;QR Yenile&quot; on the Tables screen.
          </p>
          <input
            placeholder={expected ? `Onaylamak için yazın: ${expected}` : "Onaylamak için restoran kodunu yazın"}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            className="input"
          />
          {result && (
            <p className="text-sm" style={{ color: "var(--color-heaven-orange)" }}>{result}</p>
          )}
          <div className="flex gap-2">
            <button onClick={rotate} disabled={busy || !confirmText} className="btn btn-primary">
              {busy ? "..." : "Onaylıyorum / Confirm"}
            </button>
            <button onClick={() => { setOpen(false); setResult(""); }} className="btn btn-ghost">
              Vazgeç
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
