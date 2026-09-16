"use client";

import { statusLabel, t, type Locale } from "@/lib/i18n";
import { statusTagClass } from "./shared";
import type { CustomerOrder } from "./types";

export default function OrdersList({
  orders,
  locale,
  money,
  cancelOrder,
  cancelling,
}: {
  orders: CustomerOrder[];
  locale: Locale;
  money: (kurus: number) => string;
  cancelOrder: (orderId: string) => void;
  cancelling: string | null;
}) {
  return (
    <div className="px-4 pt-4 flex flex-col gap-3">
      {orders.length === 0 && (
        <p className="text-center pt-10" style={{ color: "var(--color-neutral-900)" }}>
          {t(locale, "noOrdersYet")}
        </p>
      )}
      {orders.map((o) => (
        <div key={o.id} className="card">
          <div className="flex items-center justify-between mb-2">
            <p className="font-bold">
              {t(locale, "orderNumber")}{o.number}
              {!o.mine && <span className="ml-2 text-xs font-normal" style={{ color: "var(--color-neutral-900)" }}>({t(locale, "table")})</span>}
            </p>
            <span className={`tag ${statusTagClass[o.status] ?? "tag-neutral"}`}>
              {statusLabel(locale, o.status)}
            </span>
          </div>
          {o.status === "rejected" && o.rejectReason && (
            <p className="text-sm mb-2" style={{ color: "var(--color-heaven-orange)" }}>{t(locale, "reason")}: {o.rejectReason}</p>
          )}
          <ul className="text-sm flex flex-col gap-1" style={{ color: "var(--color-neutral-900)" }}>
            {o.items.map((i, idx) => (
              <li key={idx}>
                {i.qty} × {i.name}
                {i.modifiers.length > 0 && (
                  <span> ({i.modifiers.map((m) => m.name).join(", ")})</span>
                )}
                {i.note && <span style={{ color: "var(--color-accent-700)" }}> — {i.note}</span>}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between mt-2 gap-3">
            {/* Only your own order, and only while the kitchen has not
                taken it — after that it has to go through staff. */}
            {o.mine && o.status === "received" ? (
              <button
                onClick={() => cancelOrder(o.id)}
                disabled={cancelling === o.id}
                className="btn btn-ghost text-sm"
              >
                {cancelling === o.id ? "..." : t(locale, "cancelOrder")}
              </button>
            ) : (
              <span />
            )}
            <p className="text-right font-bold">{money(o.totalKurus)}</p>
          </div>
        </div>
      ))}
      <p className="text-center text-xs mt-2" style={{ color: "var(--color-neutral-900)" }}>{t(locale, "payAtTill")}</p>
    </div>
  );
}
