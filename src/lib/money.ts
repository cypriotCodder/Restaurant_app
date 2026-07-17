export function formatKurus(kurus: number, currency = "TRY"): string {
  const symbol = currency === "TRY" ? "₺" : currency + " ";
  const lira = kurus / 100;
  return (
    symbol +
    lira.toLocaleString("tr-TR", {
      minimumFractionDigits: kurus % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}
