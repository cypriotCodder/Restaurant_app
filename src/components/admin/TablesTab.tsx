"use client";

import { useState } from "react";
import useSWR from "swr";
import { swrDefaults } from "@/lib/swr";
import Dialog, { ConfirmDialog } from "../Dialog";
import type { AdminTable } from "./types";

export default function TablesTab() {
  // Sessions expire on their own, so the list goes stale without a poll.
  const { data, error: loadError, mutate } = useSWR<{ tables: AdminTable[] }>("/api/admin/tables", {
    ...swrDefaults,
    refreshInterval: 30000,
  });
  const tables = data?.tables ?? [];
  const [newName, setNewName] = useState("");
  const [qrFor, setQrFor] = useState<AdminTable | null>(null);
  const [regenFor, setRegenFor] = useState<AdminTable | null>(null);
  const [renaming, setRenaming] = useState<AdminTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function call(url: string, init: RequestInit, failMessage: string): Promise<boolean> {
    setBusy(true);
    setError("");
    const res = await fetch(url, init).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(failMessage);
      return false;
    }
    await mutate();
    return true;
  }

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  async function addTable() {
    if (!newName.trim()) return;
    if (await call("/api/admin/tables", json("POST", { name: newName.trim() }), "Masa eklenemedi / Could not add table")) {
      setNewName("");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="wordmark text-2xl">Masalar / Tables</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Printing 40 cards one PNG at a time is the install-day bottleneck. */}
          <a href="/admin/qr-sheet" className="btn btn-secondary" target="_blank" rel="noopener">
            Tüm QR Kartları Yazdır
          </a>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Masa adı (ör. Masa 9)"
            aria-label="Yeni masa adı / New table name"
            className="input"
            onKeyDown={(e) => e.key === "Enter" && addTable()}
          />
          <button onClick={addTable} disabled={busy} className="btn btn-primary">
            + Masa Ekle / Add Table
          </button>
        </div>
      </div>

      {loadError && (
        <p className="text-sm" role="alert" style={{ color: "var(--color-heaven-orange)" }}>
          Masalar yüklenemedi — sayfayı yenileyin. / Could not load tables; reload the page.
        </p>
      )}
      {error && <p className="text-sm" role="alert" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>}
      {data === undefined && !loadError && (
        <p className="text-sm" style={{ color: "var(--color-neutral-900)" }}>Yükleniyor… / Loading…</p>
      )}
      {data && tables.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-neutral-900)" }}>
          Henüz masa yok — yukarıdan ekleyin. / No tables yet; add one above.
        </p>
      )}

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {tables.map((tb) => (
          <div key={tb.id} className="table-card" style={!tb.active ? { opacity: 0.5 } : undefined}>
            <p className="table-card-name">{tb.name}</p>
            <span className={`tag ${tb.activeSessions.length > 0 ? "tag-accent" : "tag-neutral"}`}>
              {tb.activeSessions.length > 0 ? (
                <><span className="status-dot status-dot-active" aria-hidden /> Active</>
              ) : (
                "Empty"
              )}
            </span>
            <div className="table-card-qr" aria-hidden>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="4" y="4" width="6" height="6" />
                <rect x="14" y="4" width="6" height="6" />
                <rect x="4" y="14" width="6" height="6" />
                <path d="M14 14h3v3h-3zM20 14v6h-6" />
              </svg>
            </div>
            <div className="flex flex-col gap-1 items-center text-sm mt-1">
              <button onClick={() => setQrFor(tb)} className="font-bold px-1.5 py-0.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[var(--color-accent-700)] hover:bg-[var(--color-accent-200)] hover:text-[var(--color-text)]">
                İndir QR
              </button>
              <div className="flex gap-2 flex-wrap justify-center">
                <button onClick={() => setRenaming(tb)} className="text-xs px-1.5 py-0.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[var(--color-accent-700)] hover:bg-[var(--color-accent-200)] hover:text-[var(--color-text)]">
                  Adlandır
                </button>
                <button onClick={() => setRegenFor(tb)} className="text-xs px-1.5 py-0.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[var(--color-accent-700)] hover:bg-[var(--color-accent-200)] hover:text-[var(--color-text)]">
                  QR Yenile
                </button>
                <button
                  onClick={() => call(`/api/admin/tables/${tb.id}`, json("PATCH", { active: !tb.active }), "Güncellenemedi / Could not update")}
                  disabled={busy}
                  className="text-xs px-1.5 py-0.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[var(--color-neutral-900)] enabled:hover:bg-[var(--color-heaven-orange)] enabled:hover:text-white"
                >
                  {tb.active ? "Kapat" : "Aç"}
                </button>
              </div>
              {tb.activeSessions.length > 0 && (
                <button
                  onClick={async () => {
                    setBusy(true);
                    for (const s of tb.activeSessions) {
                      await fetch(`/api/admin/sessions/${s.id}`, { method: "DELETE" }).catch(() => null);
                    }
                    setBusy(false);
                    mutate();
                  }}
                  disabled={busy}
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
        <Dialog title={qrFor.name} onClose={() => setQrFor(null)} width="max-w-sm">
          <p className="text-xs mb-3" style={{ color: "var(--color-neutral-900)" }}>Yazdırıp masaya sabitleyin</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/admin/tables/${qrFor.id}/qr?v=${qrFor.qrVersion}`} alt={`${qrFor.name} QR`} className="w-64 h-64 mx-auto" />
          <div className="flex gap-2 justify-center mt-4">
            <a href={`/api/admin/tables/${qrFor.id}/qr?v=${qrFor.qrVersion}`} download={`${qrFor.name}-qr.png`} className="btn btn-primary" data-autofocus>PNG indir</a>
            <button onClick={() => setQrFor(null)} className="btn btn-secondary">Kapat</button>
          </div>
        </Dialog>
      )}

      {regenFor && (
        <ConfirmDialog
          title={`${regenFor.name}: QR yenilensin mi? / Regenerate QR?`}
          body={
            <>
              Bu masanın basılı QR kartı ve fotoğrafları geçersiz olur; oturumdaki müşteriler
              çıkarılır. Kartı yeniden yazdırmanız gerekir.
              <br />
              The printed card for this table stops working and anyone seated is signed out.
              You will need to reprint the card.
            </>
          }
          confirmLabel="Yenile / Regenerate"
          danger
          busy={busy}
          onConfirm={async () => {
            await call(`/api/admin/tables/${regenFor.id}`, json("PATCH", { regenerateQr: true }), "QR yenilenemedi / Could not regenerate");
            setRegenFor(null);
          }}
          onCancel={() => setRegenFor(null)}
        />
      )}

      {renaming && (
        <RenameDialog
          table={renaming}
          busy={busy}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            const ok = await call(`/api/admin/tables/${renaming.id}`, json("PATCH", { name }), "Yeniden adlandırılamadı / Could not rename");
            if (ok) setRenaming(null);
          }}
        />
      )}
    </div>
  );
}

function RenameDialog({
  table,
  busy,
  onClose,
  onSave,
}: {
  table: AdminTable;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(table.name);
  return (
    <Dialog title="Masayı Adlandır / Rename Table" onClose={onClose} busy={busy} width="max-w-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void onSave(name.trim());
        }}
        className="flex flex-col gap-3"
      >
        <p className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
          Basılı QR kartı değişmez — sadece ekranlarda ve fişte görünen ad değişir.
          <br />
          The printed card keeps working; only the name on screens and tickets changes.
        </p>
        <input value={name} onChange={(e) => setName(e.target.value)} className="input" required aria-label="Masa adı" data-autofocus />
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-secondary">Vazgeç</button>
          <button disabled={busy || !name.trim()} className="btn btn-primary">{busy ? "..." : "Kaydet / Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
