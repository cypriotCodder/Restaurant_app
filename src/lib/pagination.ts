// Cursor pagination for the admin order log.
//
// The log used to take a flat 500 rows and tell the manager to download a CSV
// for anything older. Paging keeps the first render small on a long range,
// which is the case that was slow.

export const ORDER_PAGE_SIZE = 50;
export const ORDER_MAX_PAGE_SIZE = 200;

/**
 * Clamps a caller-supplied `limit` into the allowed range. Anything absent,
 * non-numeric, or non-positive falls back to the default rather than erroring:
 * the parameter comes off a query string, and a bad one should not fail a read.
 */
export function pageLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return ORDER_PAGE_SIZE;
  return Math.min(Math.floor(n), ORDER_MAX_PAGE_SIZE);
}

/**
 * Splits an over-fetched page. Callers ask the database for `limit + 1` rows;
 * the extra row's existence is what proves another page follows, without the
 * second count query a total would cost.
 */
export function splitPage<T extends { id: string }>(
  rows: T[],
  limit: number
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: items[items.length - 1].id };
}
