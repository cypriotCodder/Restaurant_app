import { EventEmitter } from "events";

// In-process event bus feeding the SSE endpoints.
//
// The app runs as a single long-lived server on the venue's own machine, so a
// plain EventEmitter is the whole mechanism: a write and every open SSE stream
// live in the same process. (The earlier serverless deployment needed Redis
// pub/sub here, because a write on one instance could not otherwise reach
// clients attached to another.)
//
// If this ever runs as more than one process behind a load balancer, this is
// the file that has to change — events would stop crossing between them, and
// a desk on process A would go quiet for orders placed on process B.

export type BusEvent =
  // tableId rides on the order events so a customer stream can reject an event
  // for another table from the event itself, without loading the order.
  | { type: "order.created"; venueId: string; orderId: string; sessionId: string; tableId: string }
  | { type: "order.updated"; venueId: string; orderId: string; sessionId: string; tableId: string }
  | { type: "menu.changed"; venueId: string }
  | { type: "session.revoked"; venueId: string; sessionId: string }
  // Bill lifecycle. tableId rides along so the desk can highlight the table
  // and a customer stream can filter without a database read.
  | { type: "bill.requested"; venueId: string; visitId: string; tableId: string }
  | { type: "bill.updated"; venueId: string; visitId: string; tableId: string }
  | { type: "visit.closed"; venueId: string; visitId: string; tableId: string };

// Cached on globalThis so a dev hot reload does not orphan existing listeners.
const globalForBus = globalThis as unknown as { busEmitter?: EventEmitter };

const emitter = (globalForBus.busEmitter ??= new EventEmitter());
// One venue's phones and desk screens can hold a lot of streams open at once;
// the default limit of 10 would log spurious leak warnings.
emitter.setMaxListeners(500);

export function publish(event: BusEvent): void {
  emitter.emit("event", event);
}

export function subscribe(handler: (event: BusEvent) => void): () => void {
  emitter.on("event", handler);
  return () => emitter.off("event", handler);
}
