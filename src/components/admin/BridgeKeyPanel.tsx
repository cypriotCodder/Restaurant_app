"use client";

import { useState } from "react";
import useSWR from "swr";
import { swrDefaults } from "@/lib/swr";
import type { BridgeKeyRow } from "./types";
// The on-prem bridge agent authenticates with one of these. Previously they
// existed only from the seed, so replacing a compromised key meant SQL.
export default function BridgeKeyPanel() {
  // Same key as VenuePanel: SWR serves both panels from one request.
  const { data, mutate } = useSWR<{ bridgeKeys: BridgeKeyRow[] }>("/api/admin/venue", swrDefaults);
  const keys = data?.bridgeKeys ?? [];
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);


  async function create() {
    setBusy(true);
    const res = await fetch("/api/admin/bridge-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      setIssued(d.key);
      setLabel("");
      await mutate();
    }
  }

  async function remove(id: string) {
    if (!confirm("Bu anahtar silinsin mi? Kullanan ajan çalışmayı durdurur.")) return;
    await fetch(`/api/admin/bridge-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await mutate();
  }

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <h3 className="text-xs font-bold uppercase tracking-wide mb-3">
        Mutfak Köprüsü Anahtarları / Bridge Keys
      </h3>

      {issued && (
        <div className="mb-3 p-3" style={{ border: "2px solid var(--color-accent)" }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-1">
            Anahtar bir kez gösterilir / Shown once
          </p>
          <code className="text-sm break-all">{issued}</code>
          <p className="text-xs mt-2" style={{ color: "var(--color-neutral-900)" }}>
            Mutfak bilgisayarındaki ajana <code>BRIDGE_KEY</code> olarak girin. Bu pencere
            kapandıktan sonra tekrar görüntülenemez.
          </p>
          <button onClick={() => setIssued(null)} className="btn btn-ghost mt-2">
            Kaydettim / I saved it
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 text-sm">
        {keys.length === 0 && (
          <p style={{ color: "var(--color-neutral-900)" }}>
            Anahtar yok — mutfak yazıcısı çalışmaz. / No keys; the kitchen printer cannot connect.
          </p>
        )}
        {keys.map((k) => (
          <div key={k.id} className="flex items-center justify-between gap-3">
            <span>
              <strong>{k.label}</strong>
              <span style={{ color: "var(--color-neutral-900)" }}>
                {" "}· {k.hint} · {new Date(k.createdAt).toLocaleDateString("tr-TR")}
              </span>
            </span>
            <button onClick={() => remove(k.id)} className="btn btn-ghost">Sil / Delete</button>
          </div>
        ))}
      </div>

      <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--color-divider)" }}>
        <input
          placeholder="Etiket / label (ör. mutfak-pi)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="input flex-1"
        />
        <button onClick={create} disabled={busy} className="btn btn-secondary">
          {busy ? "..." : "Yeni Anahtar"}
        </button>
      </div>
    </div>
  );
}
