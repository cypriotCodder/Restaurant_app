export type Locale = "tr" | "en";

export const locales: Locale[] = ["tr", "en"];

const dict = {
  tr: {
    menu: "Menü",
    myOrders: "Siparişlerim",
    cart: "Sepet",
    addToCart: "Sepete Ekle",
    total: "Toplam",
    submitOrder: "Siparişi Gönder",
    orderNote: "Not (ör. soğansız)",
    itemNote: "Ürün notu",
    quantity: "Adet",
    empty: "Sepetiniz boş",
    table: "Masa",
    sessionExpiredTitle: "Oturum süresi doldu",
    sessionExpiredBody:
      "Sipariş verebilmek için lütfen masanızdaki QR kodu yeniden okutun.",
    invalidQrTitle: "Geçersiz QR kod",
    invalidQrBody:
      "Bu bağlantı artık geçerli değil. Lütfen masanızdaki güncel QR kodu okutun.",
    orderReceived: "Alındı",
    orderAccepted: "Onaylandı",
    orderPreparing: "Hazırlanıyor",
    orderReady: "Hazır",
    orderServed: "Servis Edildi",
    orderRejected: "Reddedildi",
    unavailable: "Tükendi",
    orderSubmitted: "Siparişiniz alındı!",
    orderNumber: "Sipariş No",
    payAtTill: "Ödeme kasada alınır.",
    close: "Kapat",
    add: "Ekle",
    cancel: "Vazgeç",
    required: "Zorunlu",
    optional: "İsteğe bağlı",
    rateLimited: "Kısa sürede çok fazla sipariş gönderildi. Lütfen biraz bekleyin.",
    orderFailed: "Sipariş gönderilemedi. Lütfen tekrar deneyin.",
    reason: "Sebep",
    each: "adet",
  },
  en: {
    menu: "Menu",
    myOrders: "My Orders",
    cart: "Cart",
    addToCart: "Add to Cart",
    total: "Total",
    submitOrder: "Place Order",
    orderNote: "Note (e.g. no onions)",
    itemNote: "Item note",
    quantity: "Qty",
    empty: "Your cart is empty",
    table: "Table",
    sessionExpiredTitle: "Session expired",
    sessionExpiredBody: "Please re-scan the QR code on your table to order.",
    invalidQrTitle: "Invalid QR code",
    invalidQrBody:
      "This link is no longer valid. Please scan the current QR code on your table.",
    orderReceived: "Received",
    orderAccepted: "Accepted",
    orderPreparing: "Preparing",
    orderReady: "Ready",
    orderServed: "Served",
    orderRejected: "Rejected",
    unavailable: "Out of stock",
    orderSubmitted: "Order received!",
    orderNumber: "Order #",
    payAtTill: "Payment is taken at the till.",
    close: "Close",
    add: "Add",
    cancel: "Cancel",
    required: "Required",
    optional: "Optional",
    rateLimited: "Too many orders in a short time. Please wait a moment.",
    orderFailed: "Could not place the order. Please try again.",
    reason: "Reason",
    each: "each",
  },
} as const;

export type TKey = keyof (typeof dict)["tr"];

export function t(locale: Locale, key: TKey): string {
  return dict[locale][key] ?? dict.tr[key];
}

export function statusLabel(locale: Locale, status: string): string {
  const map: Record<string, TKey> = {
    received: "orderReceived",
    accepted: "orderAccepted",
    preparing: "orderPreparing",
    ready: "orderReady",
    served: "orderServed",
    rejected: "orderRejected",
  };
  const key = map[status];
  return key ? t(locale, key) : status;
}
