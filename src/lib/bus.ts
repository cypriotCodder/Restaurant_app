import { EventEmitter } from "events";

// In-process pub/sub feeding the SSE endpoints. Single-process deployments
// (local, one Node server) work as-is; for multi-instance production swap
// this for Redis pub/sub behind the same publish/subscribe signatures.

export type BusEvent =
  | { type: "order.created"; venueId: string; orderId: string; sessionId: string }
  | { type: "order.updated"; venueId: string; orderId: string; sessionId: string }
  | { type: "menu.changed"; venueId: string }
  | { type: "session.revoked"; venueId: string; sessionId: string };

const globalForBus = globalThis as unknown as { bus?: EventEmitter };
const emitter = globalForBus.bus ?? new EventEmitter();
emitter.setMaxListeners(500);
if (process.env.NODE_ENV !== "production") globalForBus.bus = emitter;

export function publish(event: BusEvent) {
  emitter.emit("event", event);
}

export function subscribe(handler: (event: BusEvent) => void): () => void {
  emitter.on("event", handler);
  return () => emitter.off("event", handler);
}
