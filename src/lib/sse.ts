import { subscribe, type BusEvent } from "./bus";

/**
 * SSE response streaming bus events that pass `filter`, mapped through
 * `serialize` (return null to skip). Heartbeats every 25s keep proxies from
 * killing idle connections.
 *
 * Every write is guarded: once the client has gone, `controller.enqueue`
 * throws, and the heartbeat runs inside a timer where an uncaught throw would
 * be an unhandled exception in the one Node process serving the whole venue.
 * The first failed write tears the stream down instead.
 */
export const HEARTBEAT_MS = 25_000;

export function sseResponse(
  filter: (e: BusEvent) => boolean,
  serialize: (e: BusEvent) => Promise<object | null> | object | null
): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The consumer is gone (or the controller already closed). Stop
          // everything; nothing further can be delivered on this stream.
          cleanup();
        }
      };
      const send = (data: object) => write(`data: ${JSON.stringify(data)}\n\n`);
      send({ type: "connected" });
      const unsub = subscribe((e) => {
        if (!filter(e)) return;
        Promise.resolve(serialize(e))
          .then((payload) => payload && send(payload))
          .catch(() => {});
      });
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsub();
        clearInterval(heartbeat);
      };
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
