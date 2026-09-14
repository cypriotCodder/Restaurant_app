"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { CurrencyProvider } from "./MoneyContext";
import PasswordChangeDialog from "./PasswordChangeDialog";

// A manager opens one tab per visit. Loading all four up front shipped the
// settings panels — the heaviest of the set — to every session that never
// touched them, so each tab is fetched on first navigation instead.
const TabFallback = () => (
  <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: "var(--color-accent)" }} />
);
const MenuTab = dynamic(() => import("./admin/MenuTab"), { loading: TabFallback });
const TablesTab = dynamic(() => import("./admin/TablesTab"), { loading: TabFallback });
const OrdersTab = dynamic(() => import("./admin/OrdersTab"), { loading: TabFallback });
const SettingsTab = dynamic(() => import("./admin/SettingsTab"), { loading: TabFallback });

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
