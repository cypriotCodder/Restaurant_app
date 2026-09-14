// Order statuses, in one place.
//
// Two of them mean "this order is not owed for", and they are deliberately
// distinct rather than one shared value:
//
//   rejected  — staff refused it (out of stock, table left, suspected abuse)
//   cancelled — the customer withdrew it before the kitchen accepted it
//
// Collapsing them would hide the difference between "we could not serve this"
// and "they changed their mind", which is exactly the distinction a manager
// looking at a spike would want.

export const ORDER_STATUSES = [
  "received",
  "accepted",
  "preparing",
  "ready",
  "served",
  "rejected",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses that never appear on a bill and are not counted as sales. */
export const VOID_STATUSES: OrderStatus[] = ["rejected", "cancelled"];

/** Orders still moving through the kitchen. */
export const IN_FLIGHT_STATUSES: OrderStatus[] = ["received", "accepted", "preparing", "ready"];

/**
 * Prisma filter for "orders that count": excludes both void outcomes.
 * A function rather than a shared object, so no caller can mutate the array
 * Prisma is handed and quietly change every other query's meaning.
 */
export const notVoid = () => ({ notIn: [...VOID_STATUSES] });

/**
 * A customer may withdraw their own order only before the kitchen has taken it.
 * Once staff accept, food may already be on the pass and the cancellation has
 * to go through them.
 */
export const CUSTOMER_CANCELLABLE: OrderStatus = "received";
