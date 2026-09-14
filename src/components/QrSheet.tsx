"use client";

import { useState } from "react";

// The printable sheet. Everything outside `.sheet` is screen-only chrome, so
// what comes out of the printer is nothing but cards.

type Card = {
  id: string;
  name: string;
  active: boolean;
  qrVersion: number;
  dataUrl: string;
};

export default function QrSheet({
  venueName,
  baseUrl,
  cards,
  size,
  perRow,
  includeInactive,
  sizeOptions,
}: {
  venueName: string;
  baseUrl: string;
  cards: Card[];
  size: string;
  perRow: number;
  includeInactive: boolean;
  sizeOptions: { key: string; label: string }[];
}) {
  const [cutMarks, setCutMarks] = useState(true);

  // Printing QR codes that point at localhost wastes an afternoon and a stack
  // of card. The origin is baked into every signature, so it cannot be fixed
  // after the fact — the cards have to be reprinted.
  const badBaseUrl =
    !baseUrl || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");

  const query = (over: Record<string, string>) => {
    const p = new URLSearchParams({ size, ...(includeInactive ? { include: "all" } : {}), ...over });
    return `/admin/qr-sheet?${p}`;
  };

  return (
    <>
      <style>{`
        /* One card must never be split across two sheets of paper. */
        .qr-card { break-inside: avoid; page-break-inside: avoid; }
        @media print {
          @page { size: A4; margin: 10mm; }
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .sheet { padding: 0 !important; }
          /* Browsers strip backgrounds and borders when printing unless asked
             not to; without this the cut guides vanish. */
          .qr-card { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="no-print" style={{ padding: "16px 24px", borderBottom: "2px solid var(--color-text)" }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="wordmark text-lg">MASA QR KARTLARI</h1>
            <p className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
              {cards.length} kart · {venueName}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <div className="seg w-fit">
              {sizeOptions.map((o) => (
                <a key={o.key} href={query({ size: o.key })} className={`seg-opt ${size === o.key ? "on" : ""}`}>
                  {o.label}
                </a>
              ))}
            </div>
            <a
              href={query({ include: includeInactive ? "active" : "all" })}
              className="btn btn-ghost"
            >
              {includeInactive ? "Sadece aktif masalar" : "Pasif masaları da ekle"}
            </a>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={cutMarks} onChange={(e) => setCutMarks(e.target.checked)} />
              Kesim çizgileri
            </label>
            <a href="/admin" className="btn btn-ghost">← Admin</a>
            <button onClick={() => window.print()} className="btn btn-primary" disabled={badBaseUrl}>
              Yazdır / Print
            </button>
          </div>
        </div>

        {badBaseUrl && (
          <div className="mt-3 p-3" style={{ border: "2px solid var(--color-heaven-orange)" }}>
            <p className="text-sm font-bold" style={{ color: "var(--color-heaven-orange)" }}>
              Yazdırma devre dışı — NEXT_PUBLIC_BASE_URL yerel bir adres
              {baseUrl ? ` (${baseUrl})` : " ve tanımsız"}.
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--color-neutral-900)" }}>
              Bu kartlar müşterinin telefonunda çalışmaz. Sunucunun gerçek adresini ayarlayıp
              yeniden başlatın, sonra tekrar yazdırın.
              <br />
              Printing is disabled: the QR payloads are signed against this origin, so cards
              printed now would be dead on a customer&apos;s phone and would have to be
              reprinted. Set the real origin and restart first.
            </p>
          </div>
        )}

        {cards.length === 0 && (
          <p className="text-sm mt-3" style={{ color: "var(--color-neutral-900)" }}>
            Yazdırılacak masa yok. / No tables to print.
          </p>
        )}
      </div>

      <div
        className="sheet"
        style={{
          padding: "16px",
          display: "grid",
          gridTemplateColumns: `repeat(${perRow}, 1fr)`,
          gap: cutMarks ? "0" : "8mm",
        }}
      >
        {cards.map((c) => (
          <div
            key={c.id}
            className="qr-card"
            style={{
              border: cutMarks ? "1px dashed #999" : "none",
              padding: "6mm 4mm",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "3mm",
              background: "#fff",
              color: "#000",
            }}
          >
            <p style={{ fontSize: "10pt", letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
              {venueName}
            </p>
            <p style={{ fontSize: perRow >= 4 ? "16pt" : "22pt", fontWeight: 800, margin: 0, lineHeight: 1 }}>
              {c.name}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={c.dataUrl}
              alt={`${c.name} QR`}
              style={{ width: "100%", maxWidth: perRow >= 4 ? "34mm" : perRow === 3 ? "46mm" : "66mm", height: "auto" }}
            />
            <p style={{ fontSize: "9pt", margin: 0, lineHeight: 1.3 }}>
              Menü ve sipariş için okutun
              <br />
              <span style={{ opacity: 0.7 }}>Scan for menu &amp; ordering</span>
            </p>
            {!c.active && (
              <p className="no-print" style={{ fontSize: "8pt", color: "#c00", margin: 0 }}>
                pasif / inactive
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
