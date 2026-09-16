import { db } from "./db";
import { subscribe } from "./bus";

// The customer menu payload, in one place.
//
// It is the same for every phone in the venue until an admin changes
// something, yet it was rebuilt from five queries for every request, and the
// page itself rendered a loading dot and let the client fetch it afterwards.
// Now the page renders it on the server and both the page and the API route
// read one per-venue copy that the menu.changed bus event throws away.
//
// In-process, like the bus and the rate limiter: one venue, one server.

export type MenuItemView = {
  id: string;
  nameTr: string;
  nameEn: string;
  descTr: string;
  descEn: string;
  priceKurus: number;
  photoUrl: string | null;
  tags: string[];
  available: boolean;
  modifierGroups: {
    id: string;
    nameTr: string;
    nameEn: string;
    minSelect: number;
    maxSelect: number;
    options: { id: string; nameTr: string; nameEn: string; priceDeltaKurus: number }[];
  }[];
};

export type VenueMenu = {
  venue: { name: string; currency: string; defaultLocale: string };
  categories: { id: string; nameTr: string; nameEn: string; items: MenuItemView[] }[];
};

export type CustomerMenu = VenueMenu & { table: { name: string; code: string } };

const globalForMenu = globalThis as unknown as {
  menuCache?: Map<string, Promise<VenueMenu>>;
  menuCacheSubscribed?: boolean;
};
const cache = (globalForMenu.menuCache ??= new Map());

// Cached on globalThis so a dev hot reload neither loses the subscription nor
// registers a second one.
if (!globalForMenu.menuCacheSubscribed) {
  globalForMenu.menuCacheSubscribed = true;
  subscribe((e) => {
    if (e.type === "menu.changed") cache.delete(e.venueId);
  });
}

async function loadVenueMenu(venueId: string): Promise<VenueMenu> {
  const [categories, venue] = await Promise.all([
    db.category.findMany({
      where: { venueId, active: true },
      orderBy: { sortOrder: "asc" },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            modifierGroups: {
              orderBy: { sortOrder: "asc" },
              include: { options: { orderBy: { sortOrder: "asc" } } },
            },
          },
        },
      },
    }),
    db.venue.findUniqueOrThrow({
      where: { id: venueId },
      select: { name: true, currency: true, defaultLocale: true },
    }),
  ]);
  return {
    venue,
    categories: categories.map((c) => ({
      id: c.id,
      nameTr: c.nameTr,
      nameEn: c.nameEn,
      items: c.items.map((i) => ({
        id: i.id,
        nameTr: i.nameTr,
        nameEn: i.nameEn,
        descTr: i.descTr,
        descEn: i.descEn,
        priceKurus: i.priceKurus,
        photoUrl: i.photoUrl,
        tags: i.tags ? i.tags.split(",").filter(Boolean) : [],
        available: i.available,
        modifierGroups: i.modifierGroups.map((g) => ({
          id: g.id,
          nameTr: g.nameTr,
          nameEn: g.nameEn,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          options: g.options.map((o) => ({
            id: o.id,
            nameTr: o.nameTr,
            nameEn: o.nameEn,
            priceDeltaKurus: o.priceDeltaKurus,
          })),
        })),
      })),
    })),
  };
}

/**
 * The venue's menu, from cache when it has one. The promise is cached rather
 * than the value so forty phones scanning at once after an edit share one
 * database round-trip instead of forty.
 */
export function venueMenu(venueId: string): Promise<VenueMenu> {
  let pending = cache.get(venueId);
  if (!pending) {
    pending = loadVenueMenu(venueId).catch((err) => {
      // A failed load must not be served to the next caller.
      cache.delete(venueId);
      throw err;
    });
    cache.set(venueId, pending);
  }
  return pending;
}

/** The venue menu plus the one thing that differs per phone: which table. */
export async function menuForSession(session: {
  venueId: string;
  tableName: string;
  tableCode: string;
}): Promise<CustomerMenu> {
  const menu = await venueMenu(session.venueId);
  return { ...menu, table: { name: session.tableName, code: session.tableCode } };
}

/** Test seam. */
export function resetMenuCache(): void {
  cache.clear();
}
