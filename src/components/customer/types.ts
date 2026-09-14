// Customer-facing payload shapes from /api/menu, /api/orders and /api/bill.

export type Option = { id: string; nameTr: string; nameEn: string; priceDeltaKurus: number };
export type Group = {
  id: string;
  nameTr: string;
  nameEn: string;
  minSelect: number;
  maxSelect: number;
  options: Option[];
};
export type Item = {
  id: string;
  nameTr: string;
  nameEn: string;
  descTr: string;
  descEn: string;
  priceKurus: number;
  photoUrl: string | null;
  tags: string[];
  available: boolean;
  modifierGroups: Group[];
};
export type Category = { id: string; nameTr: string; nameEn: string; items: Item[] };
export type Menu = {
  venue: { name: string; currency: string; defaultLocale: string };
  table: { name: string; code: string };
  categories: Category[];
};
export type CartLine = { key: string; itemId: string; qty: number; note: string; optionIds: string[] };
export type CustomerOrder = {
  id: string;
  number: number;
  status: string;
  rejectReason: string | null;
  totalKurus: number;
  createdAt: string;
  mine: boolean;
  items: { name: string; qty: number; note: string; unitPriceKurus: number; modifiers: { name: string }[] }[];
};

export type CustomerBill = {
  status: string;
  billRequested: boolean;
  totalKurus: number;
  yourTotalKurus: number;
  phoneCount: number;
  lines: { name: string; qty: number; lineTotalKurus: number; note: string; modifiers: string[] }[];
};
