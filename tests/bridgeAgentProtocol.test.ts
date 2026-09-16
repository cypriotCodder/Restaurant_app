import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

// The shim's reply protocol, end to end against the real script: the agent
// (PRINTER_ACK=1) only treats a ticket as printed on "OK". Run in DRY_RUN so no
// Windows spooler is needed — the reply path is what is under test.

const SHIM = path.resolve(import.meta.dirname, "../bridge/win-usb-print.mjs");
let child: ChildProcess | null = null;

afterEach(() => {
  child?.kill();
  child = null;
});

function startShim(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [SHIM], {
      env: { ...process.env, DRY_RUN: "1", LISTEN_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (d) => {
      if (String(d).includes("usb print shim")) resolve();
    });
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(`shim exited ${code}`)));
  });
}

/** Mirrors printRaw() in bridge/agent.mjs with PRINTER_ACK=1. */
function sendAndReadReply(port: number, bytes: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    let reply = "";
    const sock = net.createConnection({ host: "127.0.0.1", port }, () => sock.end(bytes));
    sock.setTimeout(5000, () => { sock.destroy(); reject(new Error("timeout")); });
    sock.on("data", (d) => { reply += d.toString("utf8"); });
    sock.on("end", () => resolve(reply.trim()));
    sock.on("error", reject);
  });
}

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

describe("win-usb-print shim reply", () => {
  it("answers OK once a ticket has been handled", async () => {
    const port = await freePort();
    await startShim(port);
    const reply = await sendAndReadReply(port, Buffer.from([0x1b, 0x40, 0x41, 0x0a]));
    expect(reply.startsWith("OK")).toBe(true);
  });

  it("answers ERR for an empty ticket", async () => {
    const port = await freePort();
    await startShim(port);
    const reply = await sendAndReadReply(port, Buffer.alloc(0));
    expect(reply.startsWith("ERR")).toBe(true);
  });
});
