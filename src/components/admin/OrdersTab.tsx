"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { jsonFetcher, swrDefaults } from "@/lib/swr";
import { useMoney } from "../MoneyContext";
import type { LogOrder, Stats } from "./types";

type OrdersPage = { orders: LogOrder[]; nextCursor: string | null };
export default function OrdersTab() {
  const money = useMoney();
  const [days, setDays] = useState(7);
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "cancelled">("all");

  const { data: stats, mutate: mutateStats } = useSWR<Stats>("/api/admin/stats", swrDefaults);

  // Paged rather than a flat 500-row dump: the first screenful is what the
  // manager actually reads, and older pages are fetched only if they scroll.
  const {
    data: pages,
    size,
    setSize,
    mutate: mutateOrders,
    isValidating,
  } = useSWRInfinite<OrdersPage>(
    (index, previous) => {
      if (index > 0 && !previous?.nextCursor) return null; // reached the end
      const cursor = index === 0 ? "" : `&cursor=${previous!.nextCursor}`;
      return `/api/admin/orders?days=${days}${cursor}`;
    },
    jsonFetcher,
    { ...swrDefaults, revalidateFirstPage: false }
  );

  const orders = pages?.flatMap((p) => p.orders) ?? [];
  const hasMore = Boolean(pages?.[pages.length - 1]?.nextCursor);

  const refresh = useCallback(() => {
    void mutateOrders();
    void mutateStats();
  }, [mutateOrders, mutateStats]);

  // The screen used to fetch once on mount and then silently go stale for the
  // rest of the shift. Live push, with a poll as the safety net.
  useEffect(() => {
    const es = new EventSource("/api/desk/stream");
    es.onmessage = () => { refresh(); };
    const poll = setInterval(refresh, 60000);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [refresh]);

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

      {hasMore && (
        <button
          onClick={() => setSize(size + 1)}
          disabled={isValidating}
          className="btn btn-secondary self-center text-xs"
        >
          {isValidating ? "..." : "Daha fazla göster / Load more"}
        </button>
      )}
    </div>
  );
}
