#!/usr/bin/env node
// On-prem bridge agent — the AKINSOFT-side half of the ESC/POS adapter.
//
// Runs on any machine inside the venue's LAN (the till PC, a Raspberry Pi).
// Polls the cloud backend for accepted orders and prints raw ESC/POS to the
// kitchen printer AKINSOFT already prints to. Outbound HTTP only: no ports
// to open, no firewall changes.
//
// Usage:
//   BASE_URL=https://your-app.example \
//   BRIDGE_KEY=bridge-demo-xxx \
//   PRINTER_HOST=192.168.1.50 [PRINTER_PORT=9100] \
//   [DRY_RUN=1]  node bridge/agent.mjs
//
// DRY_RUN=1 prints the decoded ticket to stdout instead of the printer —
// use it to verify connectivity before pointing at real hardware.

import net from "net";

// Reverse of the PC857 map the server encodes tickets with (src/lib/pos/ticket.ts).
// Node's TextDecoder has no ibm857, so DRY_RUN decodes with this table in order
// to show the same Turkish text the printer will actually produce.
const PC857_DECODE = new Map([
  [0x87, "ç"], [0x80, "Ç"], [0x81, "ü"], [0x9a, "Ü"], [0x94, "ö"], [0x99, "Ö"],
  [0x8d, "ı"], [0x98, "İ"], [0x9f, "ş"], [0x9e, "Ş"], [0xa7, "ğ"], [0xa6, "Ğ"],
  [0x83, "â"], [0xb6, "Â"], [0x8c, "î"], [0xd7, "Î"], [0x96, "û"], [0xea, "Û"],
]);

function decodePc857(bytes) {
  let out = "";
  for (const b of bytes) {
    if (b === 0x0a) { out += "\n"; continue; }
    const mapped = PC857_DECODE.get(b);
    if (mapped) { out += mapped; continue; }
    if (b >= 0x20 && b <= 0x7e) out += String.fromCharCode(b);
    // Control/ESC sequences are dropped from the preview.
  }
  return out;
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const BRIDGE_KEY = process.env.BRIDGE_KEY;
const PRINTER_HOST = process.env.PRINTER_HOST;
const PRINTER_PORT = Number(process.env.PRINTER_PORT ?? 9100);
const DRY_RUN = process.env.DRY_RUN === "1";
const POLL_MS = 3000;

if (!BRIDGE_KEY) {
  console.error("BRIDGE_KEY is required (see admin seed output / BridgeKey table).");
  process.exit(1);
}
if (!PRINTER_HOST && !DRY_RUN) {
  console.error("PRINTER_HOST is required (or set DRY_RUN=1).");
  process.exit(1);
}

function printRaw(bytes) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: PRINTER_HOST, port: PRINTER_PORT }, () => {
      sock.end(bytes, () => resolve());
    });
    sock.setTimeout(10000, () => { sock.destroy(); reject(new Error("printer timeout")); });
    sock.on("error", reject);
  });
}

async function ack(deliveryId, ok, error) {
  await fetch(`${BASE_URL}/api/bridge/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY },
    body: JSON.stringify({ deliveryId, ok, error }),
  }).catch((e) => console.error("ack failed:", e.message));
}

async function tick() {
  const res = await fetch(`${BASE_URL}/api/bridge/pending`, {
    headers: { "x-bridge-key": BRIDGE_KEY },
  });
  if (!res.ok) throw new Error(`pending fetch: HTTP ${res.status}`);
  const { deliveries } = await res.json();
  for (const d of deliveries) {
    const bytes = Buffer.from(d.payloadBase64, "base64");
    try {
      if (DRY_RUN) {
        console.log(`\n--- ticket #${d.orderNumber} (${d.tableName}) ---`);
        console.log(decodePc857(bytes));
      } else {
        await printRaw(bytes);
        console.log(`printed ticket #${d.orderNumber} (${d.tableName})`);
      }
      await ack(d.id, true);
    } catch (err) {
      console.error(`print failed for #${d.orderNumber}:`, err.message);
      await ack(d.id, false, err.message);
    }
  }
}

console.log(`bridge agent → ${BASE_URL} → ${DRY_RUN ? "DRY RUN" : `${PRINTER_HOST}:${PRINTER_PORT}`}`);
setInterval(() => tick().catch((e) => console.error("tick:", e.message)), POLL_MS);
tick().catch((e) => console.error("tick:", e.message));
