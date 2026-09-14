"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminTable } from "./types";
export default function TablesTab() {
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [newName, setNewName] = useState("");
  const [qrFor, setQrFor] = useState<AdminTable | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/tables");
    if (res.ok) setTables((await res.json()).tables);
  }, []);
  useEffect(() => {
    (async () => { await load(); })();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="wordmark text-2xl">Masalar / Tables</h2>
        <div className="flex items-center gap-2">
          {/* Printing 40 cards one PNG at a time is the install-day bottleneck. */}
          <a href="/admin/qr-sheet" className="btn btn-secondary" target="_blank" rel="noopener">
            Tüm QR Kartları Yazdır
          </a>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Masa adı (ör. Masa 9)" className="input" onKeyDown={(e) => e.key === "Enter" && newName.trim() && (async () => {
            await fetch("/api/admin/tables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName.trim() }) });
            setNewName("");
            load();
          })()}  />
          <button
            onClick={async () => {
              if (!newName.trim()) return;
              await fetch("/api/admin/tables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName.trim() }) });
              setNewName("");
              load();
            }}
            className="btn btn-primary"
          >
            + Masa Ekle / Add Table
          </button>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {tables.map((tb) => (
          <div key={tb.id} className="table-card" style={!tb.active ? { opacity: 0.5 } : undefined}>
            <p className="table-card-name">{tb.name}</p>
            <span className={`tag ${tb.activeSessions.length > 0 ? "tag-accent" : "tag-neutral"}`}>
              {tb.activeSessions.length > 0 ? (
                <><span className="status-dot status-dot-active" /> Active</>
              ) : (
                "Empty"
              )}
            </span>
            <div className="table-card-qr">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="4" y="4" width="6" height="6" />
                <rect x="14" y="4" width="6" height="6" />
                <rect x="4" y="14" width="6" height="6" />
                <path d="M14 14h3v3h-3zM20 14v6h-6" />
              </svg>
            </div>
            <div className="flex flex-col gap-1 items-center text-sm mt-1">
              <button onClick={() => setQrFor(tb)} className="font-bold" style={{ color: "var(--color-accent-700)" }}>
                İndir QR
              </button>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!confirm(`${tb.name}: QR yenilensin mi?`)) return;
                    await fetch(`/api/admin/tables/${tb.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ regenerateQr: true }) });
                    load();
                  }}
                  className="text-xs" style={{ color: "var(--color-accent-700)" }}
                >
                  QR Yenile
                </button>
                <button
                  onClick={async () => {
                    await fetch(`/api/admin/tables/${tb.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !tb.active }) });
                    load();
                  }}
                  className="text-xs" style={{ color: "var(--color-neutral-900)" }}
                >
                  {tb.active ? "Kapat" : "Aç"}
                </button>
              </div>
              {tb.activeSessions.length > 0 && (
                <button
                  onClick={async () => {
                    for (const s of tb.activeSessions) {
                      await fetch(`/api/admin/sessions/${s.id}`, { method: "DELETE" });
                    }
                    load();
                  }}
                  className="text-xs" style={{ color: "var(--color-heaven-orange)" }}
                >
                  Oturumları bitir
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {qrFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/40" onClick={() => setQrFor(null)} aria-label="Kapat" />
          <div className="relative bg-white p-6 text-center" style={{ border: "2px solid var(--color-text)" }}>
            <h2 className="wordmark text-lg mb-1">{qrFor.name}</h2>
            <p className="text-xs mb-3" style={{ color: "var(--color-neutral-900)" }}>Yazdırıp masaya sabitleyin</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/admin/tables/${qrFor.id}/qr?v=${qrFor.qrVersion}`} alt={`${qrFor.name} QR`} className="w-64 h-64 mx-auto" />
            <div className="flex gap-2 justify-center mt-4">
              <a href={`/api/admin/tables/${qrFor.id}/qr?v=${qrFor.qrVersion}`} download={`${qrFor.name}-qr.png`} className="btn btn-primary">PNG indir</a>
              <button onClick={() => setQrFor(null)} className="btn btn-secondary">Kapat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
