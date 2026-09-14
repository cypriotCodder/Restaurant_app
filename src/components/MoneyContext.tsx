"use client";

import { createContext, useContext, useMemo } from "react";
import { formatKurus } from "@/lib/money";

// The venue's currency, shared with every staff screen.
//
// `Venue.currency` existed for a long time but every call site ignored it and
// rendered ₺ regardless, so the stored value did nothing. Money is formatted in
// eight different subcomponents across the admin and desk screens; a context
// keeps the currency in one place instead of threading a prop through all of
// them.

const CurrencyContext = createContext<string>("TRY");

export function CurrencyProvider({
  currency,
  children,
}: {
  currency: string;
  children: React.ReactNode;
}) {
  return <CurrencyContext.Provider value={currency}>{children}</CurrencyContext.Provider>;
}

/** `money(kurus)` — formats in the venue's currency. */
export function useMoney(): (kurus: number) => string {
  const currency = useContext(CurrencyContext);
  return useMemo(() => (kurus: number) => formatKurus(kurus, currency), [currency]);
}

export function useCurrency(): string {
  return useContext(CurrencyContext);
}
