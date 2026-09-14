"use client";

import { useState } from "react";
import type { AdminCategory, AdminGroup, AdminItem } from "./types";
export default function ItemEditor({
  item,
  categories,
  onClose,
  onSaved,
}: {
  item: AdminItem | null;
  categories: AdminCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    categoryId: item?.categoryId ?? categories[0]?.id ?? "",
    nameTr: item?.nameTr ?? "",
    nameEn: item?.nameEn ?? "",
    descTr: item?.descTr ?? "",
    descEn: item?.descEn ?? "",
    priceTl: item ? (item.priceKurus / 100).toString() : "",
    tags: item?.tags ?? "",
    photoUrl: item?.photoUrl ?? "",
    available: item?.available ?? true,
  });
  const [groups, setGroups] = useState<AdminGroup[]>(item?.modifierGroups ?? []);
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function uploadPhoto(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    if (res.ok) set("photoUrl", (await res.json()).url);
    else alert("Yükleme başarısız (jpg/png/webp, max 4MB)");
  }

  async function save() {
    const priceKurus = Math.round(parseFloat(form.priceTl.replace(",", ".")) * 100);
    if (!form.nameTr.trim() || !Number.isFinite(priceKurus) || priceKurus < 0) {
      alert("İsim ve geçerli fiyat zorunlu.");
      return;
    }
    setBusy(true);
    const payload = {
      categoryId: form.categoryId,
      nameTr: form.nameTr.trim(),
      nameEn: form.nameEn.trim(),
      descTr: form.descTr.trim(),
      descEn: form.descEn.trim(),
      priceKurus,
      photoUrl: form.photoUrl || null,
      tags: form.tags.trim(),
      available: form.available,
      sortOrder: item?.sortOrder ?? 0,
      modifierGroups: groups
        .filter((g) => g.nameTr.trim() && g.options.some((o) => o.nameTr.trim()))
        .map((g) => ({
          nameTr: g.nameTr.trim(),
          nameEn: g.nameEn.trim(),
          minSelect: g.minSelect,
          maxSelect: Math.max(g.maxSelect, 1),
          options: g.options
            .filter((o) => o.nameTr.trim())
            .map((o) => ({ nameTr: o.nameTr.trim(), nameEn: o.nameEn.trim(), priceDeltaKurus: o.priceDeltaKurus })),
        })),
    };
    const res = await fetch(item ? `/api/admin/items/${item.id}` : "/api/admin/items", {
      method: item ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) onSaved();
    else alert("Kaydedilemedi.");
  }

  const inputCls = "input w-full";

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true">
      <button className="fixed inset-0 bg-black/40" onClick={onClose} aria-label="Kapat" />
      <div className="relative bg-white p-5 w-full max-w-xl my-8" style={{ border: "2px solid var(--color-text)" }}>
        <h2 className="wordmark text-lg mb-4">{item ? "Ürünü Düzenle / Edit Item" : "Yeni Ürün / New Item"}</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-sm">
            Kategori
            <select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)} className={inputCls}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.nameTr}</option>)}
            </select>
          </label>
          <label className="text-sm">İsim (TR)<input value={form.nameTr} onChange={(e) => set("nameTr", e.target.value)} className={inputCls} /></label>
          <label className="text-sm">Name (EN)<input value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} className={inputCls} /></label>
          <label className="text-sm">Açıklama (TR)<input value={form.descTr} onChange={(e) => set("descTr", e.target.value)} className={inputCls} /></label>
          <label className="text-sm">Description (EN)<input value={form.descEn} onChange={(e) => set("descEn", e.target.value)} className={inputCls} /></label>
          <label className="text-sm">Fiyat (TL)<input inputMode="decimal" value={form.priceTl} onChange={(e) => set("priceTl", e.target.value)} className={inputCls} /></label>
          <label className="text-sm">Etiketler (virgülle: vegan,glutensiz)<input value={form.tags} onChange={(e) => set("tags", e.target.value)} className={inputCls} /></label>
          <div className="col-span-2 text-sm">
            Fotoğraf
            <div className="flex items-center gap-3 mt-1">
              {form.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.photoUrl} alt="" className="h-14 w-14 object-cover" style={{ border: "1px solid var(--color-divider)" }} />
              )}
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
              {form.photoUrl && (
                <button onClick={() => set("photoUrl", "")} className="text-xs" style={{ color: "var(--color-heaven-orange)" }}>Kaldır</button>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm">Seçenek Grupları (boyut, ekstralar…)</h3>
            <button
              onClick={() => setGroups((g) => [...g, { nameTr: "", nameEn: "", minSelect: 0, maxSelect: 1, options: [{ nameTr: "", nameEn: "", priceDeltaKurus: 0 }] }])}
              className="btn-ghost text-sm"
            >
              + Grup
            </button>
          </div>
          {groups.map((g, gi) => (
            <div key={gi} className="p-3 mb-2" style={{ border: "1px solid var(--color-divider)" }}>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input placeholder="Grup adı (TR)" value={g.nameTr} onChange={(e) => setGroups((gs) => gs.map((x, i) => i === gi ? { ...x, nameTr: e.target.value } : x))} className={inputCls} />
                <input placeholder="Group name (EN)" value={g.nameEn} onChange={(e) => setGroups((gs) => gs.map((x, i) => i === gi ? { ...x, nameEn: e.target.value } : x))} className={inputCls} />
                <label className="text-xs">Min seçim
                  <input type="number" min={0} value={g.minSelect} onChange={(e) => setGroups((gs) => gs.map((x, i) => i === gi ? { ...x, minSelect: Number(e.target.value) || 0 } : x))} className={inputCls} />
                </label>
                <label className="text-xs">Max seçim
                  <input type="number" min={1} value={g.maxSelect} onChange={(e) => setGroups((gs) => gs.map((x, i) => i === gi ? { ...x, maxSelect: Number(e.target.value) || 1 } : x))} className={inputCls} />
                </label>
              </div>
              {g.options.map((o, oi) => (
                <div key={oi} className="flex gap-2 mb-1.5">
                  <input placeholder="Seçenek (TR)" value={o.nameTr} onChange={(e) => setGroups((gs) => gs.map((x, i) => i === gi ? { ...x, options: x.options.map((y, j) => j === oi ? { ...y, nameTr: e.target.value } : y) } : x))} className={inputCls} />
                  <input placeholder="+TL" inputMode="decimal" value={o.priceDeltaKurus ? (o.priceDeltaKurus / 100).toString() : ""} onChange={(e) => setGroups((gs) => gs.map((x, i) => i === gi ? { ...x, options: x.options.map((y, j) => j === oi ? { ...y, priceDeltaKurus: Math.round((parseFloat(e.target.value.replace(",", ".")) || 0) * 100) } : y) } : x))} className="input w-24" />
                  <button onClick={() => setGroups((gs) => gs.map((x, i) => i === gi ? { ...x, options: x.options.filter((_, j) => j !== oi) } : x))} className="px-2" style={{ color: "var(--color-heaven-orange)" }} aria-label="Seçeneği sil">✕</button>
                </div>
              ))}
              <div className="flex justify-between">
                <button onClick={() => setGroups((gs) => gs.map((x, i) => i === gi ? { ...x, options: [...x.options, { nameTr: "", nameEn: "", priceDeltaKurus: 0 }] } : x))} className="btn-ghost text-sm">+ Seçenek</button>
                <button onClick={() => setGroups((gs) => gs.filter((_, i) => i !== gi))} className="text-sm" style={{ color: "var(--color-heaven-orange)" }}>Grubu sil</button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn btn-secondary">Vazgeç</button>
          <button onClick={save} disabled={busy} className="btn btn-primary">
            {busy ? "..." : "Kaydet / Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
