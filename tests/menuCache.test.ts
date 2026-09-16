import { describe, it, expect, vi, beforeEach } from "vitest";
import { publish } from "@/lib/bus";

// The menu is identical for every phone in the venue until an admin edits it.
// These pin that repeat reads cost no queries, that an edit drops the cached
// copy, and that a burst of scans after an edit shares one load.

const categoryFindMany = vi.fn();
const venueFindUniqueOrThrow = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    category: { findMany: (...a: unknown[]) => categoryFindMany(...a) },
    venue: { findUniqueOrThrow: (...a: unknown[]) => venueFindUniqueOrThrow(...a) },
  },
}));

const { venueMenu, menuForSession, resetMenuCache } = await import("@/lib/menu");

const category = {
  id: "c1",
  nameTr: "Kahveler",
  nameEn: "Coffee",
  items: [
    {
      id: "i1", nameTr: "Latte", nameEn: "Latte", descTr: "", descEn: "", priceKurus: 12000,
      photoUrl: null, tags: "vegan,gluten", available: true, modifierGroups: [],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  resetMenuCache();
  categoryFindMany.mockResolvedValue([category]);
  venueFindUniqueOrThrow.mockResolvedValue({ name: "The Heaven", currency: "TRY", defaultLocale: "tr" });
});

describe("venueMenu", () => {
  it("shapes the payload the phone expects", async () => {
    const menu = await venueMenu("venue_1");
    expect(menu.venue.name).toBe("The Heaven");
    expect(menu.categories[0].items[0].tags).toEqual(["vegan", "gluten"]);
  });

  it("serves repeat reads from memory", async () => {
    await venueMenu("venue_1");
    await venueMenu("venue_1");
    await venueMenu("venue_1");
    expect(categoryFindMany).toHaveBeenCalledTimes(1);
    expect(venueFindUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it("keeps venues apart", async () => {
    await venueMenu("venue_1");
    await venueMenu("venue_2");
    expect(categoryFindMany).toHaveBeenCalledTimes(2);
  });

  it("reloads after the menu changes, and only for that venue", async () => {
    await venueMenu("venue_1");
    await venueMenu("venue_2");
    publish({ type: "menu.changed", venueId: "venue_1" });
    await venueMenu("venue_1");
    await venueMenu("venue_2");
    expect(categoryFindMany).toHaveBeenCalledTimes(3);
  });

  it("shares one load across a burst of concurrent scans", async () => {
    let release!: () => void;
    categoryFindMany.mockReturnValue(new Promise((r) => { release = () => r([category]); }));
    const burst = Promise.all(Array.from({ length: 40 }, () => venueMenu("venue_1")));
    release();
    await burst;
    expect(categoryFindMany).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load", async () => {
    categoryFindMany.mockRejectedValueOnce(new Error("db down"));
    await expect(venueMenu("venue_1")).rejects.toThrow("db down");
    await venueMenu("venue_1");
    expect(categoryFindMany).toHaveBeenCalledTimes(2);
  });
});

describe("menuForSession", () => {
  it("adds the table without touching the shared copy", async () => {
    const a = await menuForSession({ venueId: "venue_1", tableName: "Masa 1", tableCode: "T1" });
    const b = await menuForSession({ venueId: "venue_1", tableName: "Masa 2", tableCode: "T2" });
    expect(a.table).toEqual({ name: "Masa 1", code: "T1" });
    expect(b.table).toEqual({ name: "Masa 2", code: "T2" });
    expect((await venueMenu("venue_1")) as object).not.toHaveProperty("table");
    expect(categoryFindMany).toHaveBeenCalledTimes(1);
  });
});
