"use client";

import { useCallback, useEffect, useState } from "react";
import { formatKurus } from "@/lib/money";

// ---------- types ----------
type AdminOption = { id?: string; nameTr: string; nameEn: string; priceDeltaKurus: number };
type AdminGroup = {
  id?: string;
  nameTr: string;
  nameEn: string;
  minSelect: number;
  maxSelect: number;
  options: AdminOption[];
};
type AdminItem = {
  id: string;
  categoryId: string;
  nameTr: string;
  nameEn: string;
  descTr: string;
  descEn: string;
  priceKurus: number;
  photoUrl: string | null;
  tags: string;
  available: boolean;
  sortOrder: number;
  modifierGroups: AdminGroup[];
};
type AdminCategory = { id: string; nameTr: string; nameEn: string; sortOrder: number; active: boolean; items: AdminItem[] };
type AdminTable = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  qrVersion: number;
  qrUrl: string;
  activeSessions: { id: string; createdAt: string; lastSeenAt: string }[];
};

const NAV_ITEMS = [
  { key: "menu", label: "Menü / Menu" },
  { key: "tables", label: "Masalar / Tables" },
  { key: "orders", label: "Siparişler / Orders" },
  { key: "settings", label: "Ayarlar / Settings" },
] as const;

type TabKey = (typeof NAV_ITEMS)[number]["key"];

const TAB_PATHS: Record<TabKey, string> = {
  menu: "theheaven.app/admin/menu",
  tables: "theheaven.app/admin/tables",
  orders: "theheaven.app/admin/orders",
  settings: "theheaven.app/admin/settings",
};

export default function AdminApp({ staffName }: { staffName: string }) {
  const [tab, setTab] = useState<TabKey>("menu");

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="px-5 mb-6">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--color-accent)" }} />
            <span className="wordmark text-base">THE HEAVEN</span>
          </div>
        </div>
        <nav className="flex flex-col">
          {NAV_ITEMS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`admin-sidebar-item ${tab === key ? "active" : ""}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto px-5 pt-4 flex flex-col gap-2 text-sm">
          <a href="/desk" className="btn-ghost text-left">Sipariş Ekranı</a>
          <button
            onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}
            className="btn-ghost text-left"
          >
            Çıkış / Logout
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="admin-main">
        <div className="admin-topbar">
          <span>{TAB_PATHS[tab]}</span>
          <span className="font-medium" style={{ color: "var(--color-text)" }}>{staffName} — Manager</span>
        </div>
        <div className="admin-content">
          {tab === "menu" && <MenuTab />}
          {tab === "tables" && <TablesTab />}
          {tab === "orders" && <OrdersTab />}
          {tab === "settings" && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}

// ================= MENU =================
function MenuTab() {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [editing, setEditing] = useState<AdminItem | "new" | null>(null);
  const [newCat, setNewCat] = useState("");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/categories");
    if (res.ok) setCategories((await res.json()).categories);
  }, []);
  useEffect(() => { load(); }, [load]);

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
                <td className="font-medium">{formatKurus(i.priceKurus)}</td>
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

function ItemEditor({
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

// ================= TABLES =================
function TablesTab() {
  const [tables, setTables] = useState<AdminTable[]>([]);
  const [newName, setNewName] = useState("");
  const [qrFor, setQrFor] = useState<AdminTable | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/tables");
    if (res.ok) setTables((await res.json()).tables);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="wordmark text-2xl">Masalar / Tables</h2>
        <div className="flex items-center gap-2">
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

// ================= ORDERS =================
type LogOrder = {
  id: string;
  number: number;
  status: string;
  totalKurus: number;
  createdAt: string;
  tableName: string;
  items: { name: string; qty: number }[];
};

function OrdersTab() {
  const [orders, setOrders] = useState<LogOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "cancelled">("all");

  useEffect(() => {
    fetch("/api/desk/orders?all=1").then(async (res) => {
      if (res.ok) setOrders((await res.json()).orders);
    });
  }, []);

  // Stats calculation
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayOrders = orders.filter(o => new Date(o.createdAt) >= today);
  const completedToday = todayOrders.filter(o => !["rejected"].includes(o.status));
  const revenue = completedToday.reduce((s, o) => s + o.totalKurus, 0);
  const avgTicket = completedToday.length > 0 ? Math.round(revenue / completedToday.length) : 0;

  // Yesterday stats for comparison
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayOrders = orders.filter(o => {
    const d = new Date(o.createdAt);
    return d >= yesterday && d < today;
  });
  const yesterdayCompleted = yesterdayOrders.filter(o => !["rejected"].includes(o.status));
  const yesterdayRevenue = yesterdayCompleted.reduce((s, o) => s + o.totalKurus, 0);
  const revenueDelta = yesterdayRevenue > 0 ? Math.round(((revenue - yesterdayRevenue) / yesterdayRevenue) * 100) : 0;

  // Filter orders for display
  const displayOrders = orders.filter(o => {
    if (statusFilter === "completed") return ["served", "ready"].includes(o.status);
    if (statusFilter === "cancelled") return o.status === "rejected";
    return true;
  });

  const statusBadge = (status: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      received: { cls: "tag-accent", label: "Yeni" },
      accepted: { cls: "tag-accent", label: "Onaylandı" },
      preparing: { cls: "tag-accent", label: "Hazırlanıyor" },
      ready: { cls: "tag-outline", label: "Hazır" },
      served: { cls: "tag-neutral", label: "Servis Edildi" },
      rejected: { cls: "tag-danger", label: "İptal / Cancelled" },
    };
    const m = map[status] ?? { cls: "tag-neutral", label: status };
    return <span className={`tag ${m.cls}`}>{m.label}</span>;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="wordmark text-2xl">Sipariş Geçmişi / Order History</h2>
        <div className="flex gap-2">
          <a href="/api/admin/orders/export?days=7" className="btn btn-secondary text-xs">CSV (7 gün)</a>
          <a href="/api/admin/orders/export?days=30" className="btn btn-secondary text-xs">CSV (30 gün)</a>
        </div>
      </div>

      {/* Stat cards */}
      <div className="flex gap-3 flex-wrap">
        <div className="stat-card">
          <p className="stat-card-label">BUGÜN / TODAY</p>
          <p className="stat-card-value">{todayOrders.length}</p>
          <p className="stat-card-sub">Sipariş / Orders</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">CİRO / REVENUE</p>
          <p className="stat-card-value">{formatKurus(revenue)}</p>
          <p className="stat-card-sub">{revenueDelta !== 0 ? `${revenueDelta > 0 ? "+" : ""}${revenueDelta}% dün / vs yesterday` : "—"}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">ORT. FİŞ / AVG TICKET</p>
          <p className="stat-card-value">{formatKurus(avgTicket)}</p>
          <p className="stat-card-sub">{completedToday.length} {completedToday.length === 1 ? "order" : "orders"}</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="seg w-fit">
        {([["all", "Tümü"], ["completed", "Tamamlandı"], ["cancelled", "İptal"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setStatusFilter(k)} className={`seg-opt ${statusFilter === k ? "on" : ""}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Orders table */}
      <div className="bg-white border overflow-x-auto" style={{ borderColor: "var(--color-divider)" }}>
        <table className="table">
          <thead>
            <tr>
              <th>SİPARİŞ / ORDER</th>
              <th>MASA / TABLE</th>
              <th>KALEMLER / ITEMS</th>
              <th>TOPLAM / TOTAL</th>
              <th>DURUM / STATUS</th>
              <th>SAAT / TIME</th>
            </tr>
          </thead>
          <tbody>
            {displayOrders.slice().reverse().map((o) => (
              <tr key={o.id}>
                <td className="font-bold">#{o.number}</td>
                <td>{o.tableName}</td>
                <td style={{ color: "var(--color-neutral-900)" }}>{o.items.length} {o.items.length === 1 ? "item" : "items"}</td>
                <td className="font-medium">{formatKurus(o.totalKurus)}</td>
                <td>{statusBadge(o.status)}</td>
                <td>{new Date(o.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ================= SETTINGS =================
function SettingsTab() {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="wordmark text-2xl">Ayarlar / Settings</h2>
      <div className="card" style={{ maxWidth: 600 }}>
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ color: "var(--color-neutral-900)" }}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <p className="text-lg font-bold">Yakında / Coming Soon</p>
          <p className="text-sm text-center" style={{ color: "var(--color-neutral-900)" }}>
            Restoran ayarları, dil tercihleri, servis ücreti ve<br />
            diğer yapılandırmalar burada yer alacak.
          </p>
          <p className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
            Restaurant settings, language preferences, service charges<br />
            and other configurations will be here.
          </p>
        </div>
      </div>
    </div>
  );
}
