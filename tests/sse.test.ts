import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { publish } from "@/lib/bus";
import { sseResponse, HEARTBEAT_MS } from "@/lib/sse";

// The heartbeat runs in a timer. If it throws after the client has gone, that is
// an uncaught exception in the single process serving the venue. These pin that
// a dead stream is torn down quietly rather than taking the server with it.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const decode = (v: Uint8Array | undefined) => new TextDecoder().decode(v);

describe("sseResponse", () => {
  it("sends the connected frame, then bus events that pass the filter", async () => {
    const res = sseResponse(
      (e) => e.type === "menu.changed",
      (e) => ({ type: e.type })
    );
    const reader = res.body!.getReader();
    expect(decode((await reader.read()).value)).toContain('"connected"');
    publish({ type: "menu.changed", venueId: "v1" });
    await vi.runOnlyPendingTimersAsync();
    expect(decode((await reader.read()).value)).toContain("menu.changed");
    await reader.cancel();
  });

  it("does not throw from the heartbeat after the consumer cancels", async () => {
    const res = sseResponse(() => true, (e) => ({ type: e.type }));
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(() => vi.advanceTimersByTime(HEARTBEAT_MS * 3)).not.toThrow();
  });

  it("survives a write against a closed controller and stops listening", async () => {
    const res = sseResponse(() => true, (e) => ({ type: e.type }));
    const reader = res.body!.getReader();
    await reader.read();
    // The consumer vanishes without cancel() ever running.
    reader.releaseLock();
    await res.body!.cancel();
    expect(() => vi.advanceTimersByTime(HEARTBEAT_MS)).not.toThrow();
    expect(() => publish({ type: "menu.changed", venueId: "v1" })).not.toThrow();
    await vi.runOnlyPendingTimersAsync();
  });
});
