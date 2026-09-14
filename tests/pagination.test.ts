import { describe, expect, it } from "vitest";
import {
  ORDER_MAX_PAGE_SIZE,
  ORDER_PAGE_SIZE,
  pageLimit,
  splitPage,
} from "../src/lib/pagination";

describe("pageLimit", () => {
  it("falls back to the default for anything unusable", () => {
    // These all arrive off a query string, where a bad value should read a
    // default page rather than fail the request.
    for (const raw of [null, "", "abc", "0", "-5", "NaN"]) {
      expect(pageLimit(raw)).toBe(ORDER_PAGE_SIZE);
    }
  });

  it("honours a sane request", () => {
    expect(pageLimit("10")).toBe(10);
    expect(pageLimit("25.9")).toBe(25);
  });

  it("caps the page so one request cannot pull the whole log", () => {
    expect(pageLimit("100000")).toBe(ORDER_MAX_PAGE_SIZE);
  });
});

describe("splitPage", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id${i}` }));

  it("reports no next page when the extra row never came back", () => {
    expect(splitPage(rows(3), 5)).toEqual({ items: rows(3), nextCursor: null });
  });

  it("treats an exactly-full page as the last one", () => {
    // The caller asked for limit + 1 and got exactly limit, so there is
    // nothing after it — paging again would return an empty page.
    expect(splitPage(rows(5), 5)).toEqual({ items: rows(5), nextCursor: null });
  });

  it("drops the probe row and points the cursor at the last kept row", () => {
    const { items, nextCursor } = splitPage(rows(6), 5);
    expect(items).toHaveLength(5);
    expect(nextCursor).toBe("id4");
    // The probe row must not be rendered, or it would appear twice once the
    // next page loads.
    expect(items.map((r) => r.id)).not.toContain("id5");
  });
});
