// Shared admin data shapes, mirroring the /api/admin/* JSON payloads.

export type AdminOption = { id?: string; nameTr: string; nameEn: string; priceDeltaKurus: number };
export type AdminGroup = {
  id?: string;
  nameTr: string;
  nameEn: string;
  minSelect: number;
  maxSelect: number;
  options: AdminOption[];
};
export type AdminItem = {
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
export type AdminCategory = { id: string; nameTr: string; nameEn: string; sortOrder: number; active: boolean; items: AdminItem[] };
export type AdminTable = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  qrVersion: number;
  qrUrl: string;
  activeSessions: { id: string; createdAt: string; lastSeenAt: string }[];
};

// ================= ORDERS =================
export type LogOrder = {
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

export type Stats = {
  today: PeriodStats;
  yesterday: PeriodStats;
  openTables: { count: number; runningKurus: number; billRequested: number };
  change: { settled: number | null; orders: number | null };
};

export type PeriodStats = {
  settledKurus: number;
  cashKurus: number;
  cardKurus: number;
  settledVisits: number;
  avgCheckKurus: number;
  ordersPlaced: number;
  ordersRejected: number;
  itemsSold: number;
};

export type PosHealth = {
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

export type StaffRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
};

export type StaffFormValues = { email: string; name: string; role: "admin" | "desk"; password: string };

export type VenueForm = { name: string; currency: string; defaultLocale: string; posAdapter: string };

export type BridgeKeyRow = { id: string; label: string; hint: string; createdAt: string };
