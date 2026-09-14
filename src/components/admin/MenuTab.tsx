"use client";

import { useCallback, useEffect, useState } from "react";
import { useMoney } from "../MoneyContext";
import ItemEditor from "./ItemEditor";
import type { AdminCategory, AdminItem } from "./types";
export default function MenuTab() {
  const money = useMoney();
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [editing, setEditing] = useState<AdminItem | "new" | null>(null);
  const [newCat, setNewCat] = useState("");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/categories");
    if (res.ok) setCategories((await res.json()).categories);
  }, []);
  useEffect(() => { (async () => { await load(); })(); }, [load]);

  async function addCategory() {
    if (!newCat.trim()) return;
    await fetch("/api/admin/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nameTr: newCat.trim(), sortOrder: categories.length }),
    });
    setNewCat("");
    load();
  }

  async function toggleAvailable(item: AdminItem) {
    await fetch(`/api/admin/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: !item.available }),
    });
    load();
  }

  // Flatten all items + apply search & category filter
  const allItems = categories.flatMap(c => c.items.map(i => ({ ...i, catName: c.nameTr, catNameEn: c.nameEn })));
  const filtered = allItems.filter(i => {
    const q = search.toLowerCase();
    const matchSearch = !q || i.nameTr.toLowerCase().includes(q) || i.nameEn.toLowerCase().includes(q) || i.descTr.toLowerCase().includes(q) || i.descEn.toLowerCase().includes(q);
    const matchCat = !filterCat || i.categoryId === filterCat;
    return matchSearch && matchCat;
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="wordmark text-2xl">Menü Yönetimi / Menu Management</h2>
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ara / Search"
            className="input"
            style={{ width: 200 }}
          />
          <button onClick={() => setEditing("new")} disabled={categories.length === 0} className="btn btn-primary">
            + Yeni Ürün / New Item
          </button>
        </div>
      </div>

      {/* Category filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setFilterCat("")} className={`tag ${!filterCat ? "tag-accent" : "tag-neutral"}`}>
          Tümü
        </button>
        {categories.map(c => (
          <button key={c.id} onClick={() => setFilterCat(c.id)} className={`tag ${filterCat === c.id ? "tag-accent" : "tag-neutral"}`}>
            {c.nameTr}
          </button>
        ))}
      </div>

      {/* Add category row */}
      <div className="flex gap-2">
        <input
          value={newCat}
          onChange={(e) => setNewCat(e.target.value)}
          placeholder="Yeni kategori adı / New category name"
          className="input flex-1"
          onKeyDown={(e) => e.key === "Enter" && addCategory()}
        />
        <button onClick={addCategory} className="btn btn-secondary">
          Kategori Ekle
        </button>
      </div>

      {/* Category management links */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {categories.map(c => (
            <span key={c.id} className="flex items-center gap-2">
              <span className="font-medium">{c.nameTr}</span>
              <button
                onClick={async () => {
                  await fetch(`/api/admin/categories/${c.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ active: !c.active }),
                  });
                  load();
                }}
                className="btn-ghost text-xs"
              >
                {c.active ? "Gizle" : "Göster"}
              </button>
              <button
                onClick={async () => {
                  const res = await fetch(`/api/admin/categories/${c.id}`, { method: "DELETE" });
                  if (!res.ok) alert("Kategori boş değil — önce ürünleri taşıyın/silin.");
                  load();
                }}
                className="text-xs font-medium"
                style={{ color: "var(--color-heaven-orange)" }}
              >
                Sil
              </button>
              {!c.active && <span className="tag tag-neutral text-[10px]">GİZLİ</span>}
            </span>
          ))}
        </div>
      )}

      {/* Items table */}
      <div className="bg-white border overflow-x-auto" style={{ borderColor: "var(--color-divider)" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 50 }}></th>
              <th>ÜRÜN / ITEM</th>
              <th>FİYAT / PRICE</th>
              <th>KATEGORİ</th>
              <th>UYGUNLUK / AVAILABILITY</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => (
              <tr key={i.id} style={!i.available ? { opacity: 0.5 } : undefined}>
                <td>
                  <div
                    className="h-10 w-10 flex items-center justify-center"
                    style={{ background: "var(--color-neutral-100)", border: "1px solid var(--color-divider)" }}
                  >
                    {i.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={i.photoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
                      </svg>
                    )}
                  </div>
                </td>
                <td>
                  <p className="font-bold">{i.nameTr}</p>
                  <p className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
                    {i.nameEn}
                    {!i.available && " · Tükendi / Sold out"}
                  </p>
                </td>
                <td className="font-medium">{money(i.priceKurus)}</td>
                <td>{i.catName}</td>
                <td>
                  <label className="toggle">
                    <input type="checkbox" checked={i.available} onChange={() => toggleAvailable(i)} />
                    <span className="toggle-track" />
                  </label>
                </td>
                <td>
                  <button onClick={() => setEditing(i)} className="font-bold text-sm" style={{ color: "var(--color-accent-700)" }}>
                    Düzenle / Edit
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`"${i.nameTr}" silinsin mi?`)) return;
                      await fetch(`/api/admin/items/${i.id}`, { method: "DELETE" });
                      load();
                    }}
                    className="ml-3 text-sm"
                    style={{ color: "var(--color-heaven-orange)" }}
                  >
                    Sil
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8" style={{ color: "var(--color-neutral-900)" }}>
                  {search ? "Sonuç bulunamadı / No results" : "Henüz ürün yok / No items yet"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <ItemEditor
          item={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
