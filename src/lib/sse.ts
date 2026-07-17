import { subscribe, type BusEvent } from "./bus";

/**
 * SSE response streaming bus events that pass `filter`, mapped through
 * `serialize` (return null to skip). Heartbeats every 25s keep proxies from
 * killing idle connections.
 */
export function sseResponse(
  filter: (e: BusEvent) => boolean,
  serialize: (e: BusEvent) => Promise<object | null> | object | null
): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      send({ type: "connected" });
      const unsub = subscribe((e) => {
        if (!filter(e)) return;
        Promise.resolve(serialize(e))
          .then((payload) => payload && send(payload))
          .catch(() => {});
      });
      const heartbeat = setInterval(
        () => controller.enqueue(encoder.encode(": ping\n\n")),
        25000
      );
      cleanup = () => {
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
