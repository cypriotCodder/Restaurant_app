#!/usr/bin/env node
// TCP-to-USB shim for a Windows venue terminal.
//
// bridge/agent.mjs prints by opening a TCP socket and writing raw ESC/POS
// (src/lib/pos/ticket.ts renders for "network thermal printers, port 9100").
// A printer on the end of a USB cable has no socket to open. This listens on
// 9100 in its place, so the agent is unchanged and still believes it is talking
// to a network printer — PRINTER_HOST=127.0.0.1.
//
// Bytes reach the hardware through a shared Windows printer queue, which is the
// one path that passes ESC/POS through untouched. Printing via a driver would
// render the control codes as text instead of obeying them.
//
// The printer must be shared (Printer properties -> Sharing -> Share this
// printer) and the driver should be "Generic / Text Only", so Windows does not
// try to interpret what it is being handed.
//
// Usage:
//   PRINTER_SHARE="\\\\localhost\\KITCHEN" node bridge/win-usb-print.mjs
//   DRY_RUN=1 node bridge/win-usb-print.mjs      # accept and dump, never print
//
// Run this BEFORE bridge/agent.mjs. Two processes, two terminals.

import net from "net";
import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomBytes } from "crypto";

const LISTEN_HOST = process.env.LISTEN_HOST ?? "127.0.0.1";
const LISTEN_PORT = Number(process.env.LISTEN_PORT ?? 9100);
const PRINTER_SHARE = process.env.PRINTER_SHARE;
const DRY_RUN = process.env.DRY_RUN === "1";

if (!PRINTER_SHARE && !DRY_RUN) {
  console.error(
    'PRINTER_SHARE is required, e.g. PRINTER_SHARE="\\\\localhost\\KITCHEN" (or set DRY_RUN=1).'
  );
  process.exit(1);
}

/**
 * Hands one ticket to the Windows spooler.
 *
 * `copy /b` is used rather than a driver print because it is a byte-for-byte
 * copy: the ESC/POS stays intact all the way to the printer. It needs a file on
 * disk, hence the temp file — the spooler cannot be fed from a pipe.
 */
function copyToPrinter(file) {
  return new Promise((resolve, reject) => {
    // cmd.exe owns `copy`; it is a shell builtin, not an executable.
    const proc = spawn("cmd", ["/c", "copy", "/b", file, PRINTER_SHARE], {
      windowsHide: true,
    });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`copy exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

const server = net.createServer((sock) => {
  const chunks = [];
  sock.on("data", (c) => chunks.push(c));
  sock.on("error", (err) => console.error("connection error:", err.message));

  // The agent calls sock.end(bytes), so end-of-stream is end-of-ticket. There
  // is no length prefix and no framing to parse.
  sock.on("end", async () => {
    const bytes = Buffer.concat(chunks);
    if (bytes.length === 0) {
      console.error("empty ticket ignored");
      sock.end("ERR empty ticket\n");
      return;
    }

    // The outcome goes back on the same socket. The agent (PRINTER_ACK=1)
    // only acks the delivery as printed on "OK"; anything else re-queues it,
    // so a jammed or unplugged printer shows up on the desk as a failed
    // ticket instead of a green row and lost paper.
    const reply = (line) => sock.end(line + "\n");

    if (DRY_RUN) {
      console.log(`[dry run] ${bytes.length} bytes, not printed`);
      console.log(bytes.subarray(0, 64).toString("hex").replace(/(..)/g, "$1 "));
      return reply("OK dry-run");
    }

    const file = path.join(tmpdir(), `ticket-${randomBytes(6).toString("hex")}.bin`);
    try {
      await writeFile(file, bytes);
      await copyToPrinter(file);
      console.log(`printed ${bytes.length} bytes to ${PRINTER_SHARE}`);
      reply("OK");
    } catch (err) {
      console.error(`PRINT FAILED (${bytes.length} bytes):`, err.message);
      reply(`ERR ${err.message}`.replace(/\s+/g, " "));
    } finally {
      await unlink(file).catch(() => {});
    }
  });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `port ${LISTEN_PORT} is already in use — is a second copy of this shim running?`
    );
    process.exit(1);
  }
  console.error("server error:", err.message);
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `usb print shim → ${LISTEN_HOST}:${LISTEN_PORT} → ${DRY_RUN ? "DRY RUN" : PRINTER_SHARE}`
  );
});
