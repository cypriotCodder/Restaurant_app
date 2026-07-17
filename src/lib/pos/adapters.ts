import type { PosAdapter, Ticket } from "./types";
import { renderTicketText, renderEscPos } from "./ticket";

/** Dev/default adapter: the ticket goes to server stdout. */
const consoleAdapter: PosAdapter = {
  name: "console",
  renderPayload: (t: Ticket) => renderTicketText(t),
  async deliver(payload) {
    console.log("\n[POS ticket]\n" + payload + "\n");
    return { done: true };
  },
};

/**
 * ESC/POS bridge adapter — the primary AKINSOFT path. Payload is raw ESC/POS
 * bytes (base64). Delivery is pull-based: the on-prem bridge agent
 * (bridge/agent.mjs) polls /api/bridge/pending with its venue key, prints to
 * the kitchen printer AKINSOFT already uses, and acks. So deliver() here is a
 * no-op that leaves the row pending for the agent.
 */
const escposBridgeAdapter: PosAdapter = {
  name: "escpos_bridge",
  renderPayload: (t: Ticket) => renderEscPos(t),
  async deliver() {
    return { done: false }; // stays "pending" until the bridge agent claims it
  },
};

const adapters: Record<string, PosAdapter> = {
  console: consoleAdapter,
  escpos_bridge: escposBridgeAdapter,
};

export function getAdapter(name: string): PosAdapter {
  return adapters[name] ?? consoleAdapter;
}
