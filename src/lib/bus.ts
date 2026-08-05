import { EventEmitter } from "events";
import Redis from "ioredis";
import { waitUntil } from "@vercel/functions";

// Cross-instance pub/sub feeding the SSE endpoints.
//
// Serverless runs many instances, so an in-process EventEmitter alone would
// only ever reach the clients attached to whichever instance happened to
// serve the write. Events therefore go out over Redis, and every instance —
// *including the publisher* — receives them back through its subscriber and
// fans them out locally to its own open SSE handlers. That round trip is why
// publish() must not emit locally as well: doing both would double-deliver.
//
// With REDIS_URL unset (tests, CI, a bare local run) this degrades to the
// original single-process behaviour instead of failing.

export type BusEvent =
  | { type: "order.created"; venueId: string; orderId: string; sessionId: string }
  | { type: "order.updated"; venueId: string; orderId: string; sessionId: string }
  | { type: "menu.changed"; venueId: string }
  | { type: "session.revoked"; venueId: string; sessionId: string };

const CHANNEL = "masadan:bus";

// Cached on globalThis in every environment, not just dev: a warm serverless
// instance reuses this module across invocations, and reconnecting per request
// would burn through the provider's connection limit.
const globalForBus = globalThis as unknown as {
  busEmitter?: EventEmitter;
  busPublisher?: Redis;
  busSubscriber?: Redis;
};

const emitter = (globalForBus.busEmitter ??= new EventEmitter());
emitter.setMaxListeners(500);

const redisUrl = process.env.REDIS_URL;

function connect(): Redis {
  // A dropped stream must not take the process down; ioredis reconnects on
  // its own and the SSE clients re-sync on their next reconnect anyway.
  const client = new Redis(redisUrl!, { maxRetriesPerRequest: null, lazyConnect: true });
  client.on("error", (err) => console.error("bus redis:", err.message));
  return client;
}

function publisher(): Redis {
  return (globalForBus.busPublisher ??= connect());
}

/** Idempotent: the first subscriber on this instance opens the Redis stream. */
function ensureSubscriber(): void {
  if (globalForBus.busSubscriber) return;
  const sub = connect();
  globalForBus.busSubscriber = sub;
  sub.subscribe(CHANNEL).catch((err) => console.error("bus subscribe:", err.message));
  sub.on("message", (channel, raw) => {
    if (channel !== CHANNEL) return;
    try {
      emitter.emit("event", JSON.parse(raw) as BusEvent);
    } catch {
      // A malformed payload is not worth killing the stream over.
    }
  });
}

export function publish(event: BusEvent) {
  if (!redisUrl) {
    emitter.emit("event", event);
    return;
  }
  // Not awaited, so callers keep their fire-and-forget signature — but the
  // promise is handed to waitUntil, because otherwise the platform is free to
  // freeze the instance the moment the route returns its response. That kills
  // the in-flight PUBLISH (which on a cold instance still has a TLS handshake
  // to finish) and the event is silently lost. Outside Vercel waitUntil is a
  // no-op wrapper, so local and test runs are unaffected.
  const sent = publisher()
    .publish(CHANNEL, JSON.stringify(event))
    .catch((err) => console.error("bus publish:", err.message));
  try {
    waitUntil(sent);
  } catch {
    // No request context (scripts, tests) — the promise still settles there
    // because nothing is freezing the process.
  }
}

export function subscribe(handler: (event: BusEvent) => void): () => void {
  if (redisUrl) ensureSubscriber();
  emitter.on("event", handler);
  return () => emitter.off("event", handler);
}
