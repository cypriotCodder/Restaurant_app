"use client";

import { t, type Locale } from "@/lib/i18n";
import type { CustomerBill } from "./types";

export default function BillPanel({
  bill,
  locale,
  money,
  askForBill,
  requestingBill,
}: {
  bill: CustomerBill | null;
  locale: Locale;
  money: (kurus: number) => string;
  askForBill: () => void;
  requestingBill: boolean;
}) {
  return (
    <div className="px-4 pt-4 flex flex-col gap-3 pb-28">
      {(!bill || bill.lines.length === 0) && (
        <p className="text-center pt-10" style={{ color: "var(--color-neutral-900)" }}>
          {t(locale, "empty")}
        </p>
      )}

      {bill && bill.lines.length > 0 && (
        <>
          <div className="card">
            <h2 className="wordmark text-base mb-3">{t(locale, "tableTotal")}</h2>
            <ul className="text-sm flex flex-col gap-2">
              {bill.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>
                    {l.qty} × {l.name}
                    {l.modifiers.length > 0 && (
                      <span style={{ color: "var(--color-neutral-900)" }}> ({l.modifiers.join(", ")})</span>
                    )}
                    {l.note && <span style={{ color: "var(--color-accent-700)" }}> — {l.note}</span>}
                  </span>
                  <span className="shrink-0">{money(l.lineTotalKurus)}</span>
                </li>
              ))}
            </ul>
            <div
              className="flex justify-between font-bold text-lg mt-3 pt-3"
              style={{ borderTop: "2px solid var(--color-text)" }}
            >
              <span>{t(locale, "total")}</span>
              <span>{money(bill.totalKurus)}</span>
            </div>

            {/* Only worth showing when the table actually is shared. */}
            {bill.phoneCount > 1 && (
              <div className="mt-3 pt-3 text-sm" style={{ borderTop: "1px solid var(--color-divider)" }}>
                <div className="flex justify-between">
                  <span style={{ color: "var(--color-neutral-900)" }}>{t(locale, "yourShare")}</span>
                  <span className="font-bold">{money(bill.yourTotalKurus)}</span>
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--color-neutral-900)" }}>
                  {t(locale, "sharedTable").replace("{n}", String(bill.phoneCount))}
                </p>
              </div>
            )}
          </div>

          <p className="text-xs text-center px-4" style={{ color: "var(--color-neutral-900)" }}>
            {t(locale, "billNote")}
          </p>

          {bill.billRequested ? (
            <p
              className="text-center text-sm font-bold py-4"
              style={{ color: "var(--color-accent-700)" }}
            >
              {t(locale, "billRequestedShort")}
            </p>
          ) : (
            <button
              onClick={askForBill}
              disabled={requestingBill}
              className="btn btn-primary w-full justify-center py-4 text-sm"
            >
              {requestingBill ? "..." : t(locale, "requestBill")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
