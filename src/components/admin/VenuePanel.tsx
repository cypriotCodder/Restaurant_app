"use client";

import { useCallback, useEffect, useState } from "react";
import type { VenueForm } from "./types";
// Venue configuration. Every field here used to be a database column with no
// way to change it short of a SQL statement.
export default function VenuePanel() {
  const [form, setForm] = useState<VenueForm | null>(null);
  const [options, setOptions] = useState<{ currencies: string[]; posAdapters: string[] }>({
    currencies: [],
    posAdapters: [],
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/venue");
    if (res.ok) {
      const d = await res.json();
      setForm(d.venue);
      setOptions(d.options);
    }
  }, []);

  useEffect(() => {
    (async () => { await load(); })();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/venue", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      // The currency is read once at page load (server component), so a change
      // only reaches every price on screen after a reload.
      setTimeout(() => window.location.reload(), 400);
      return;
    }
    const b = await res.json().catch(() => ({}));
    setError(b.detail ?? "Kaydedilemedi / Could not save");
  }

  if (!form) return null;

  return (
    <form onSubmit={save} className="card flex flex-col gap-3" style={{ maxWidth: 600 }}>
      <h3 className="text-xs font-bold uppercase tracking-wide">Restoran / Venue</h3>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-wide">İSİM / NAME</span>
        <input
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="input"
        />
        <span className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
          Müşteri menüsünde ve mutfak fişinde görünür.
        </span>
      </label>

      <div className="flex gap-3 flex-wrap">
        <label className="flex flex-col gap-1 flex-1" style={{ minWidth: 160 }}>
          <span className="text-xs font-bold uppercase tracking-wide">PARA BİRİMİ / CURRENCY</span>
          <select
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
            className="input"
          >
            {options.currencies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 flex-1" style={{ minWidth: 160 }}>
          <span className="text-xs font-bold uppercase tracking-wide">VARSAYILAN DİL / LOCALE</span>
          <select
            value={form.defaultLocale}
            onChange={(e) => setForm({ ...form, defaultLocale: e.target.value })}
            className="input"
          >
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      <p className="text-xs" style={{ color: "var(--color-heaven-orange)" }}>
        Para birimi yalnızca görüntülemeyi değiştirir — mevcut fiyatlar çevrilmez.
        <br />
        <span style={{ color: "var(--color-neutral-900)" }}>
          Changing currency changes display only; existing prices are not converted.
        </span>
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-wide">MUTFAK ÇIKTISI / POS ADAPTER</span>
        <select
          value={form.posAdapter}
          onChange={(e) => setForm({ ...form, posAdapter: e.target.value })}
          className="input"
        >
          <option value="escpos_bridge">Mutfak yazıcısı (ESC/POS köprüsü)</option>
          <option value="console">Sunucu günlüğü / Server log (test)</option>
        </select>
        <span className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
          &quot;Server log&quot; seçilirse mutfakta hiçbir şey basılmaz — sadece test içindir.
        </span>
      </label>

      {error && <p className="text-sm" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>}

      <div className="flex items-center gap-3">
        <button disabled={busy} className="btn btn-primary justify-center py-3">
          {busy ? "..." : "Kaydet / Save"}
        </button>
        {saved && (
          <span className="text-sm" style={{ color: "var(--color-accent-700)" }}>
            Kaydedildi / Saved
          </span>
        )}
      </div>
    </form>
  );
}
