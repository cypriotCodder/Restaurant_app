"use client";

import Image from "next/image";
import { useState } from "react";
import useSWR from "swr";
import { swrDefaults } from "@/lib/swr";
import { useMoney } from "../MoneyContext";
import Dialog, { ConfirmDialog } from "../Dialog";
import ItemEditor from "./ItemEditor";
import type { AdminCategory, AdminItem } from "./types";

export default function MenuTab() {
  const money = useMoney();
  const { data, error: loadError, mutate } = useSWR<{ categories: AdminCategory[] }>("/api/admin/categories", swrDefaults);
  const categories = data?.categories ?? [];
  const [editing, setEditing] = useState<AdminItem | "new" | null>(null);
  const [newCat, setNewCat] = useState("");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");
  const [editingCat, setEditingCat] = useState<AdminCategory | null>(null);
  const [deletingItem, setDeletingItem] = useState<AdminItem | null>(null);
  const [deletingCat, setDeletingCat] = useState<AdminCategory | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(url: string, init: RequestInit, failMessage: string): Promise<boolean> {
    setBusy(true);
    setError("");
    const res = await fetch(url, init).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const b = (await res?.json().catch(() => ({}))) ?? {};
      setError(b.error === "category_not_empty" ? "Kategori boş değil — önce ürünleri taşıyın veya silin. / Category is not empty; move or delete its items first." : failMessage);
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

  async function addCategory() {
    if (!newCat.trim()) return;
    if (await call("/api/admin/categories", json("POST", { nameTr: newCat.trim(), sortOrder: categories.length }), "Kategori eklenemedi / Could not add category")) {
      setNewCat("");
    }
  }

  async function toggleAvailable(item: AdminItem) {
    // The 86 switch flips immediately and rolls back if the PATCH fails; the
    // revalidate afterwards keeps the cache honest.
    const next = !item.available;
    setError("");
    await mutate(
      async (current) => {
        const res = await fetch(`/api/admin/items/${item.id}`, json("PATCH", { available: next })).catch(() => null);
        if (!res?.ok) {
          setError("Güncellenemedi / Could not update");
          throw new Error("toggle failed");
        }
        return current;
      },
      {
        optimisticData: (current) => ({
          categories: (current?.categories ?? []).map((c) => ({
            ...c,
            items: c.items.map((i) => (i.id === item.id ? { ...i, available: next } : i)),
          })),
        }),
        rollbackOnError: true,
        revalidate: true,
      }
    ).catch(() => {});
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
            aria-label="Ara / Search"
            className="input"
            style={{ width: 200 }}
          />
          <button onClick={() => setEditing("new")} disabled={categories.length === 0} className="btn btn-primary">
            + Yeni Ürün / New Item
          </button>
        </div>
      </div>

      {loadError && (
        <p className="text-sm" role="alert" style={{ color: "var(--color-heaven-orange)" }}>
          Menü yüklenemedi — sayfayı yenileyin. / Could not load the menu; reload the page.
        </p>
      )}
      {error && (
        <p className="text-sm" role="alert" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>
      )}

      {/* Category filter pills */}
      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Kategori filtresi">
        <button onClick={() => setFilterCat("")} className={`tag ${!filterCat ? "tag-accent" : "tag-neutral"}`} aria-pressed={!filterCat}>
          Tümü
        </button>
        {categories.map(c => (
          <button key={c.id} onClick={() => setFilterCat(c.id)} className={`tag ${filterCat === c.id ? "tag-accent" : "tag-neutral"}`} aria-pressed={filterCat === c.id}>
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
          aria-label="Yeni kategori adı / New category name"
          className="input flex-1"
          onKeyDown={(e) => e.key === "Enter" && addCategory()}
        />
        <button onClick={addCategory} disabled={busy} className="btn btn-secondary">
          Kategori Ekle
        </button>
      </div>

      {/* Category management */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {categories.map(c => (
            <span key={c.id} className="flex items-center gap-2">
              <span className="font-medium">{c.nameTr}</span>
              <button onClick={() => setEditingCat(c)} className="btn-ghost text-xs">
                Düzenle
              </button>
              <button
                onClick={() => call(`/api/admin/categories/${c.id}`, json("PATCH", { active: !c.active }), "Güncellenemedi / Could not update")}
                disabled={busy}
                className="btn-ghost text-xs"
              >
                {c.active ? "Gizle" : "Göster"}
              </button>
              <button
                onClick={() => setDeletingCat(c)}
                disabled={busy}
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
              <th style={{ width: 50 }}><span className="sr-only">Fotoğraf</span></th>
              <th>ÜRÜN / ITEM</th>
              <th>FİYAT / PRICE</th>
              <th>KATEGORİ</th>
              <th>UYGUNLUK / AVAILABILITY</th>
              <th><span className="sr-only">İşlemler</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((i) => (
              <tr key={i.id} style={!i.available ? { opacity: 0.5 } : undefined}>
                <td>
                  <div
                    className="relative h-10 w-10 flex items-center justify-center"
                    style={{ background: "var(--color-neutral-100)", border: "1px solid var(--color-divider)" }}
                  >
                    {i.photoUrl ? (
                      <Image src={i.photoUrl} alt="" fill sizes="40px" className="object-cover" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4" aria-hidden>
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
                    <input type="checkbox" checked={i.available} onChange={() => toggleAvailable(i)} aria-label={`${i.nameTr} uygun / available`} />
                    <span className="toggle-track" />
                  </label>
                </td>
                <td>
                  <button onClick={() => setEditing(i)} className="font-bold text-sm" style={{ color: "var(--color-accent-700)" }}>
                    Düzenle / Edit
                  </button>
                  <button
                    onClick={() => setDeletingItem(i)}
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
                  {data === undefined ? "Yükleniyor… / Loading…" : search ? "Sonuç bulunamadı / No results" : "Henüz ürün yok / No items yet"}
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
          onSaved={() => { setEditing(null); mutate(); }}
        />
      )}

      {editingCat && (
        <CategoryDialog
          category={editingCat}
          onClose={() => setEditingCat(null)}
          onSave={async (values) => {
            const ok = await call(`/api/admin/categories/${editingCat.id}`, json("PATCH", values), "Kategori kaydedilemedi / Could not save category");
            if (ok) setEditingCat(null);
            return ok;
          }}
        />
      )}

      {deletingItem && (
        <ConfirmDialog
          title="Ürün silinsin mi? / Delete item?"
          body={
            <>
              <strong>{deletingItem.nameTr}</strong> menüden kaldırılır. Geçmiş siparişlerde adı geçiyorsa
              silinmek yerine gizlenir.
              <br />
              Removed from the menu; hidden instead if it appears in past orders.
            </>
          }
          confirmLabel="Sil / Delete"
          danger
          busy={busy}
          onConfirm={async () => {
            await call(`/api/admin/items/${deletingItem.id}`, { method: "DELETE" }, "Silinemedi / Could not delete");
            setDeletingItem(null);
          }}
          onCancel={() => setDeletingItem(null)}
        />
      )}

      {deletingCat && (
        <ConfirmDialog
          title="Kategori silinsin mi? / Delete category?"
          body={<><strong>{deletingCat.nameTr}</strong> — yalnızca boş bir kategori silinebilir. / Only an empty category can be deleted.</>}
          confirmLabel="Sil / Delete"
          danger
          busy={busy}
          onConfirm={async () => {
            await call(`/api/admin/categories/${deletingCat.id}`, { method: "DELETE" }, "Silinemedi / Could not delete");
            setDeletingCat(null);
          }}
          onCancel={() => setDeletingCat(null)}
        />
      )}
    </div>
  );
}

/** Rename a category, give it an English name, or reorder it. */
function CategoryDialog({
  category,
  onClose,
  onSave,
}: {
  category: AdminCategory;
  onClose: () => void;
  onSave: (values: { nameTr: string; nameEn: string; sortOrder: number }) => Promise<boolean>;
}) {
  const [nameTr, setNameTr] = useState(category.nameTr);
  const [nameEn, setNameEn] = useState(category.nameEn);
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameTr.trim()) {
      setError("İsim gerekli / Name required");
      return;
    }
    setBusy(true);
    setError("");
    const ok = await onSave({
      nameTr: nameTr.trim(),
      nameEn: nameEn.trim() || nameTr.trim(),
      sortOrder: Number(sortOrder) || 0,
    });
    setBusy(false);
    if (!ok) setError("Kaydedilemedi / Could not save");
  }

  return (
    <Dialog title="Kategoriyi Düzenle / Edit Category" onClose={onClose} busy={busy} width="max-w-sm">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          İsim (TR)
          <input value={nameTr} onChange={(e) => setNameTr(e.target.value)} className="input" required data-autofocus />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Name (EN)
          <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Sıra / Order
          <input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="input" />
        </label>
        {error && <p className="text-sm" role="alert" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>}
        <div className="flex gap-2 justify-end mt-1">
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-secondary">Vazgeç</button>
          <button disabled={busy} className="btn btn-primary">{busy ? "..." : "Kaydet / Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
