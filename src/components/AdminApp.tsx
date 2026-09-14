"use client";

import { useCallback, useEffect, useState } from "react";
import { CurrencyProvider, useMoney } from "./MoneyContext";
import PasswordChangeDialog from "./PasswordChangeDialog";

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

export default function AdminApp({ staffName, currency }: { staffName: string; currency: string }) {
  const [tab, setTab] = useState<TabKey>("menu");
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <CurrencyProvider currency={currency}>
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
          <button onClick={() => setChangingPassword(true)} className="btn-ghost text-left">
            Şifre Değiştir
          </button>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              // A hard navigation on purpose: this is a shared terminal, and a
              // soft nav would leave the previous user's menu and order data in
              // React state. Reloading discards all of it.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.href = "/login";
            }}
            className="btn-ghost text-left"
          >
            Çıkış / Logout
          </button>
        </div>
      </aside>

      {changingPassword && <PasswordChangeDialog onClose={() => setChangingPassword(false)} />}

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
    </CurrencyProvider>
  );
}

// ================= MENU =================
function MenuTab() {
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

// ================= ORDERS =================
type LogOrder = {
  id: string;
  number: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  totalKurus: number;
  createdAt: string;
  tableName: string;
  items: { name: string; qty: number }[];
};

type Stats = {
  today: PeriodStats;
  yesterday: PeriodStats;
  openTables: { count: number; runningKurus: number; billRequested: number };
  change: { settled: number | null; orders: number | null };
};

type PeriodStats = {
  settledKurus: number;
  cashKurus: number;
  cardKurus: number;
  settledVisits: number;
  avgCheckKurus: number;
  ordersPlaced: number;
  ordersRejected: number;
  itemsSold: number;
};

function OrdersTab() {
  const money = useMoney();
  const [orders, setOrders] = useState<LogOrder[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [days, setDays] = useState(7);
  const [truncated, setTruncated] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "cancelled">("all");

  const load = useCallback(async () => {
    const [ordersRes, statsRes] = await Promise.all([
      fetch(`/api/admin/orders?days=${days}`),
      fetch("/api/admin/stats"),
    ]);
    if (ordersRes.ok) {
      const data = await ordersRes.json();
      setOrders(data.orders);
      setTruncated(data.truncated);
    }
    if (statsRes.ok) setStats(await statsRes.json());
  }, [days]);

  useEffect(() => {
    (async () => { await load(); })();
  }, [load]);

  // The screen used to fetch once on mount and then silently go stale for the
  // rest of the shift. Live push, with a poll as the safety net.
  useEffect(() => {
    const es = new EventSource("/api/desk/stream");
    es.onmessage = () => { void load(); };
    const poll = setInterval(() => void load(), 60000);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [load]);

  const displayOrders = orders.filter((o) => {
    if (statusFilter === "completed") return ["served", "ready"].includes(o.status);
    if (statusFilter === "cancelled") return ["rejected", "cancelled"].includes(o.status);
    return true;
  });

  const statusBadge = (status: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      received: { cls: "tag-accent", label: "Yeni" },
      accepted: { cls: "tag-accent", label: "Onaylandı" },
      preparing: { cls: "tag-accent", label: "Hazırlanıyor" },
      ready: { cls: "tag-outline", label: "Hazır" },
      served: { cls: "tag-neutral", label: "Servis Edildi" },
      rejected: { cls: "tag-danger", label: "Reddedildi / Rejected" },
      cancelled: { cls: "tag-danger", label: "Müşteri İptali / Customer cancelled" },
    };
    const m = map[status] ?? { cls: "tag-neutral", label: status };
    return <span className={`tag ${m.cls}`}>{m.label}</span>;
  };

  const delta = (pct: number | null) =>
    pct === null ? "dün veri yok / no data" : `${pct > 0 ? "+" : ""}${pct}% dün / vs yesterday`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="wordmark text-2xl">Sipariş Geçmişi / Order History</h2>
        <div className="flex gap-2">
          <a href="/api/admin/orders/export?days=7" className="btn btn-secondary text-xs">CSV (7 gün)</a>
          <a href="/api/admin/orders/export?days=30" className="btn btn-secondary text-xs">CSV (30 gün)</a>
        </div>
      </div>

      {/* Takings and kitchen volume are deliberately separate numbers: an order
          placed is not money until staff settle the table at the till. */}
      {stats && (
        <>
          <div className="flex gap-3 flex-wrap">
            <div className="stat-card">
              <p className="stat-card-label">CİRO / TAKINGS</p>
              <p className="stat-card-value">{money(stats.today.settledKurus)}</p>
              <p className="stat-card-sub">{delta(stats.change.settled)}</p>
            </div>
            <div className="stat-card">
              <p className="stat-card-label">NAKİT / KART</p>
              <p className="stat-card-value" style={{ fontSize: "1.1rem" }}>
                {money(stats.today.cashKurus)} / {money(stats.today.cardKurus)}
              </p>
              <p className="stat-card-sub">Kasa mutabakatı / till reconciliation</p>
            </div>
            <div className="stat-card">
              <p className="stat-card-label">ORT. ADİSYON / AVG CHECK</p>
              <p className="stat-card-value">{money(stats.today.avgCheckKurus)}</p>
              <p className="stat-card-sub">
                {stats.today.settledVisits} kapanan masa / settled tables
              </p>
            </div>
            <div className="stat-card">
              <p className="stat-card-label">SİPARİŞ / ORDERS</p>
              <p className="stat-card-value">{stats.today.ordersPlaced}</p>
              <p className="stat-card-sub">{delta(stats.change.orders)}</p>
            </div>
          </div>

          {stats.openTables.count > 0 && (
            <p className="text-sm" style={{ color: "var(--color-neutral-900)" }}>
              Şu an <strong>{stats.openTables.count}</strong> açık masa ·{" "}
              <strong>{money(stats.openTables.runningKurus)}</strong> henüz tahsil edilmedi
              {stats.openTables.billRequested > 0 && (
                <span style={{ color: "var(--color-heaven-orange)" }}>
                  {" "}· {stats.openTables.billRequested} hesap bekliyor
                </span>
              )}
              <br />
              <span style={{ fontSize: "0.75rem" }}>
                {stats.openTables.count} open table(s), {money(stats.openTables.runningKurus)}{" "}
                not yet taken — excluded from takings above.
              </span>
            </p>
          )}
        </>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="seg w-fit">
          {([["all", "Tümü"], ["completed", "Tamamlandı"], ["cancelled", "İptal"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setStatusFilter(k)} className={`seg-opt ${statusFilter === k ? "on" : ""}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="seg w-fit">
          {/* A rolling window, not calendar days — the stat cards above are the
              calendar-day figures. Labelled "son N gün" so the two are not
              confused with each other. */}
          {([1, 7, 30] as const).map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`seg-opt ${days === d ? "on" : ""}`}>
              son {d} gün
            </button>
          ))}
        </div>
      </div>

      {truncated && (
        <p className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
          İlk 500 sipariş gösteriliyor. Tamamı için CSV indirin. / Showing the first 500 — use
          the CSV export for the full range.
        </p>
      )}

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
              <th>ÖDEME / PAID</th>
              <th>SAAT / TIME</th>
            </tr>
          </thead>
          <tbody>
            {displayOrders.map((o) => (
              <tr key={o.id}>
                <td className="font-bold">#{o.number}</td>
                <td>{o.tableName}</td>
                <td style={{ color: "var(--color-neutral-900)" }}>{o.items.length} {o.items.length === 1 ? "item" : "items"}</td>
                <td className="font-medium">{money(o.totalKurus)}</td>
                <td>{statusBadge(o.status)}</td>
                <td style={{ color: "var(--color-neutral-900)" }}>
                  {o.paymentStatus === "paid"
                    ? (o.paymentMethod === "card" ? "Kart" : "Nakit")
                    : "—"}
                </td>
                <td>{new Date(o.createdAt).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ================= SETTINGS =================
type PosHealth = {
  counts: { pending: number; claimed: number; failed: number; sentToday: number };
  maxAttempts: number;
  lastSentAt: string | null;
  stuck: {
    id: string;
    orderNumber: number;
    tableName: string;
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }[];
};

// A bridge agent that dies mid-service is otherwise invisible: orders keep
// reaching the desk while nothing prints in the kitchen. This panel is how
// staff find out before a customer does.
function PosHealthPanel() {
  const [health, setHealth] = useState<PosHealth | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The clock the staleness read below uses. Held in state and advanced by the
  // poll interval so nothing calls Date.now() during render.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/pos/health");
    if (res.ok) setHealth(await res.json());
  }, []);

  useEffect(() => {
    // Wrapped so the state update lands after the await rather than
    // synchronously inside the effect body.
    (async () => { await load(); })();
    const t = setInterval(() => {
      setNow(Date.now());
      void load();
    }, 20000);
    return () => clearInterval(t);
  }, [load]);

  if (!health) return null;

  const { counts } = health;
  const queued = counts.pending + counts.claimed;
  const minutesSinceSent = health.lastSentAt
    ? Math.floor((now - new Date(health.lastSentAt).getTime()) / 60000)
    : null;
  // Tickets waiting and nothing printed for a while = the agent is not polling.
  const agentLikelyDown =
    queued > 0 && (minutesSinceSent === null || minutesSinceSent >= 5);
  const alert = counts.failed > 0 || health.stuck.length > 0 || agentLikelyDown;

  async function retry(id: string) {
    setBusy(id);
    await fetch(`/api/admin/pos/${id}/retry`, { method: "POST" });
    await load();
    setBusy(null);
  }

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wide">
          Mutfak Yazıcısı / Kitchen Printer
        </h3>
        <span
          className="tag"
          style={{
            background: alert ? "var(--color-heaven-orange)" : "var(--color-accent)",
            color: "#fff",
          }}
        >
          {alert ? "DİKKAT / ATTENTION" : "ÇALIŞIYOR / HEALTHY"}
        </span>
      </div>

      {agentLikelyDown && (
        <p className="text-sm mb-4" style={{ color: "var(--color-heaven-orange)" }}>
          {queued} fiş bekliyor, son baskı{" "}
          {minutesSinceSent === null ? "hiç yapılmadı" : `${minutesSinceSent} dk önce`}. Köprü
          ajanı çalışmıyor olabilir — mutfak bilgisayarını kontrol edin.
          <br />
          <span style={{ color: "var(--color-neutral-900)" }}>
            {queued} ticket(s) queued, last print{" "}
            {minutesSinceSent === null ? "never" : `${minutesSinceSent} min ago`}. The bridge
            agent may be down — check the kitchen PC.
          </span>
        </p>
      )}

      <div className="flex gap-4 flex-wrap mb-4 text-sm">
        <span>Bekleyen / Pending: <strong>{counts.pending}</strong></span>
        <span>İşlemde / In flight: <strong>{counts.claimed}</strong></span>
        <span style={counts.failed ? { color: "var(--color-heaven-orange)" } : undefined}>
          Başarısız / Failed: <strong>{counts.failed}</strong>
        </span>
        <span>24s basılan / Printed 24h: <strong>{counts.sentToday}</strong></span>
      </div>

      {health.stuck.length > 0 && (
        <div className="flex flex-col gap-2 pt-3" style={{ borderTop: "1px solid var(--color-divider)" }}>
          <p className="text-xs font-bold uppercase tracking-wide">
            Takılan fişler / Stuck tickets
          </p>
          {health.stuck.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                #{d.orderNumber} · {d.tableName}
                <span style={{ color: "var(--color-neutral-900)" }}>
                  {" "}— {d.status}, {d.attempts}/{health.maxAttempts}
                  {d.lastError ? ` · ${d.lastError.slice(0, 60)}` : ""}
                </span>
              </span>
              <button
                className="btn btn-secondary"
                disabled={busy === d.id}
                onClick={() => retry(d.id)}
              >
                {busy === d.id ? "..." : "Tekrar Bas / Retry"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type StaffRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
};

// Staff tokens are stateless 12h JWTs, so "sign out everywhere" and
// deactivation both work by bumping the account's token version. Revocation
// lands within the 30s account-cache window, not 12 hours.
// Staff accounts are managed here rather than in psql: restaurant turnover is
// constant, and a manager needs to add a new starter on their first shift.
//
// Staff tokens are stateless 12h JWTs, so every change that affects who an
// account is — role, password, deactivation — bumps its token version and takes
// effect within the 30s account-cache window rather than in 12 hours.
function StaffPanel() {
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [self, setSelf] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/staff");
    if (res.ok) {
      const data = await res.json();
      setRows(data.staff);
      setSelf(data.self);
    }
  }, []);

  useEffect(() => {
    (async () => { await load(); })();
  }, [load]);

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(id);
    setError("");
    const res = await fetch(`/api/admin/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(staffErrorText(b.error, b.detail));
      return false;
    }
    await load();
    return true;
  }

  const admins = rows.filter((u) => u.role === "admin" && u.active).length;

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-bold uppercase tracking-wide">Personel / Staff Access</h3>
        <button onClick={() => { setAdding(true); setError(""); }} className="btn btn-primary">
          + Personel Ekle
        </button>
      </div>

      {error && (
        <p className="text-sm mb-3" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((u) => (
          <div
            key={u.id}
            className="flex items-center justify-between gap-3 text-sm"
            style={u.active ? undefined : { opacity: 0.55 }}
          >
            <span>
              <strong>{u.name}</strong>
              <span style={{ color: "var(--color-neutral-900)" }}>
                {" "}· {u.email} · {u.role}
                {u.active ? "" : " · pasif / inactive"}
                {u.id === self ? " · siz / you" : ""}
              </span>
            </span>
            <span className="flex gap-2 shrink-0">
              <button
                className="btn btn-secondary"
                disabled={busy === u.id}
                onClick={() => { setEditing(u); setError(""); }}
              >
                Düzenle / Edit
              </button>
              <button
                className="btn btn-ghost"
                disabled={busy === u.id}
                onClick={() => act(u.id, { signOutEverywhere: true })}
                title="Tüm cihazlardan çıkış / Sign out everywhere"
              >
                Oturumları Kapat
              </button>
              {u.id !== self && (
                <button
                  className="btn btn-ghost"
                  disabled={busy === u.id}
                  onClick={() => act(u.id, { active: !u.active })}
                >
                  {u.active ? "Devre Dışı" : "Etkinleştir"}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      <p
        className="text-xs mt-4 pt-3"
        style={{ color: "var(--color-neutral-900)", borderTop: "1px solid var(--color-divider)" }}
      >
        Değişiklikler 30 saniye içinde tüm cihazlarda geçerli olur.
        {admins === 1 && " Son yönetici hesabı devre dışı bırakılamaz."}
        <br />
        Changes take effect on every device within 30 seconds.
        {admins === 1 && " The last admin account cannot be disabled."}
      </p>

      {adding && (
        <StaffForm
          title="Yeni Personel / New Staff"
          onClose={() => setAdding(false)}
          onSubmit={async (values) => {
            const res = await fetch("/api/admin/staff", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(values),
            });
            if (!res.ok) {
              const b = await res.json().catch(() => ({}));
              return staffErrorText(b.error, b.detail);
            }
            setAdding(false);
            await load();
            return null;
          }}
        />
      )}

      {editing && (
        <StaffForm
          title={`${editing.name} — Düzenle`}
          existing={editing}
          isSelf={editing.id === self}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            // Only send what changed; an unchanged password field must not
            // reset the account's password to an empty string.
            const patch: Record<string, unknown> = { name: values.name, role: values.role };
            if (values.password) patch.password = values.password;
            const res = await fetch(`/api/admin/staff/${editing.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patch),
            });
            if (!res.ok) {
              const b = await res.json().catch(() => ({}));
              return staffErrorText(b.error, b.detail);
            }
            setEditing(null);
            await load();
            return null;
          }}
        />
      )}
    </div>
  );
}

function staffErrorText(code: string | undefined, detail?: string): string {
  switch (code) {
    case "email_taken":
      return "Bu e-posta zaten kayıtlı / That email is already registered";
    case "last_admin":
      return "Son yönetici hesabı devre dışı bırakılamaz veya düşürülemez / Cannot remove the last admin";
    case "cannot_deactivate_self":
      return "Kendi hesabınızı devre dışı bırakamazsınız / You cannot disable your own account";
    case "cannot_demote_self":
      return "Kendi yetkinizi düşüremezsiniz / You cannot demote yourself";
    case "invalid":
      return detail ?? "Geçersiz bilgi / Invalid input";
    case "rate_limited":
      return "Çok fazla deneme. Lütfen bekleyin / Too many attempts, please wait";
    case "wrong_password":
      return "Mevcut şifre hatalı / Current password is incorrect";
    default:
      return "İşlem başarısız / Could not complete";
  }
}

type StaffFormValues = { email: string; name: string; role: "admin" | "desk"; password: string };

function StaffForm({
  title,
  existing,
  isSelf,
  onClose,
  onSubmit,
}: {
  title: string;
  existing?: StaffRow;
  isSelf?: boolean;
  onClose: () => void;
  /** Returns an error message to display, or null on success. */
  onSubmit: (values: StaffFormValues) => Promise<string | null>;
}) {
  const [email, setEmail] = useState(existing?.email ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState<"admin" | "desk">(
    (existing?.role as "admin" | "desk") ?? "desk"
  );
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const err = await onSubmit({ email, name, role, password });
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={() => !busy && onClose()}
    >
      <form
        onSubmit={submit}
        className="bg-white p-5 w-full max-w-sm flex flex-col gap-3"
        style={{ border: "2px solid var(--color-text)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="wordmark text-base">{title}</h2>

        {!existing && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wide">E-POSTA / EMAIL</span>
            <input
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide">İSİM / NAME</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide">YETKİ / ROLE</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "desk")}
            disabled={isSelf}
            className="input"
          >
            <option value="desk">Mutfak / Order desk</option>
            <option value="admin">Yönetici / Admin</option>
          </select>
          {isSelf && (
            <span className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
              Kendi yetkinizi değiştiremezsiniz / You cannot change your own role
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-bold uppercase tracking-wide">
            {existing ? "YENİ ŞİFRE / NEW PASSWORD" : "ŞİFRE / PASSWORD"}
          </span>
          <input
            type="password"
            required={!existing}
            autoComplete="new-password"
            placeholder={existing ? "Değiştirmemek için boş bırakın" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
          <span className="text-xs" style={{ color: "var(--color-neutral-900)" }}>
            {existing
              ? "Şifre değişirse diğer tüm cihazlardan çıkış yapılır."
              : "En az 8 karakter."}
          </span>
        </label>

        {error && <p className="text-sm" style={{ color: "var(--color-heaven-orange)" }}>{error}</p>}

        <div className="flex gap-2 mt-1">
          <button disabled={busy} className="btn btn-primary flex-1 justify-center py-3">
            {busy ? "..." : "Kaydet / Save"}
          </button>
          <button type="button" disabled={busy} onClick={onClose} className="btn btn-ghost">
            Vazgeç
          </button>
        </div>
      </form>
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="wordmark text-2xl">Ayarlar / Settings</h2>
      <VenuePanel />
      <PosHealthPanel />
      <BridgeKeyPanel />
      <StaffPanel />
      <DangerZonePanel />
    </div>
  );
}

type VenueForm = { name: string; currency: string; defaultLocale: string; posAdapter: string };

// Venue configuration. Every field here used to be a database column with no
// way to change it short of a SQL statement.
function VenuePanel() {
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

type BridgeKeyRow = { id: string; label: string; hint: string; createdAt: string };

// The on-prem bridge agent authenticates with one of these. Previously they
// existed only from the seed, so replacing a compromised key meant SQL.
function BridgeKeyPanel() {
  const [keys, setKeys] = useState<BridgeKeyRow[]>([]);
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/venue");
    if (res.ok) setKeys((await res.json()).bridgeKeys);
  }, []);

  useEffect(() => {
    (async () => { await load(); })();
  }, [load]);

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
      await load();
    }
  }

  async function remove(id: string) {
    if (!confirm("Bu anahtar silinsin mi? Kullanan ajan çalışmayı durdurur.")) return;
    await fetch(`/api/admin/bridge-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
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

// Rotating the venue QR secret invalidates every printed table card at once.
// It is the remedy for a leaked secret, not routine maintenance, so it is
// separated from everything else and gated behind typing the venue slug.
function DangerZonePanel() {
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
