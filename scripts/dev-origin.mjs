#!/usr/bin/env node
// Points NEXT_PUBLIC_BASE_URL at this machine's current LAN address and prints
// the table scan URLs.
//
// The development origin has to change every time the machine moves network —
// hotspot, café, the restaurant — because the address is what a phone dials.
// Doing it by hand has been a repeated source of "the QR code is broken", so
// this does the whole job: detect, rewrite, verify, print.
//
//   node scripts/dev-origin.mjs            # auto-detect the LAN IP
//   node scripts/dev-origin.mjs 10.0.0.5   # or force one

import { networkInterfaces } from "node:os";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const PORT = process.env.PORT ?? "3000";

/** The address a phone on the same network can actually dial. */
function detectLanIp() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      // utun*/bridge* are VPN and virtual interfaces: routable for this machine
      // but not addresses another device can reach.
      if (/^(utun|bridge|llw|awdl)/.test(name)) continue;
      candidates.push({ name, address: a.address });
    }
  }
  // Prefer the iOS personal-hotspot range, then ordinary private ranges.
  const rank = (ip) =>
    ip.startsWith("172.20.10.") ? 0 : ip.startsWith("192.168.") ? 1 : ip.startsWith("10.") ? 2 : 3;
  candidates.sort((a, b) => rank(a.address) - rank(b.address));
  return candidates[0] ?? null;
}

const forced = process.argv[2];
const found = forced ? { name: "(forced)", address: forced } : detectLanIp();
if (!found) {
  console.error("No LAN address found. Connect to a network first.");
  process.exit(1);
}

const origin = `http://${found.address}:${PORT}`;
const envPath = ".env";
if (!existsSync(envPath)) {
  console.error("No .env file. Copy .env.example to .env.local first.");
  process.exit(1);
}

const before = readFileSync(envPath, "utf8");
const line = `NEXT_PUBLIC_BASE_URL="${origin}"`;
const after = /^NEXT_PUBLIC_BASE_URL=.*$/m.test(before)
  ? before.replace(/^NEXT_PUBLIC_BASE_URL=.*$/m, line)
  : before.trimEnd() + "\n" + line + "\n";

if (before === after) {
  console.log(`Already set: ${origin}  (interface ${found.name})`);
} else {
  writeFileSync(envPath, after);
  console.log(`Set NEXT_PUBLIC_BASE_URL=${origin}  (interface ${found.name})`);
  console.log("Restart `npm run dev` for it to take effect.");
}

// Printing the live URLs matters as much as setting the origin: a stale QR
// image is indistinguishable from a broken app when you scan it.
try {
  const { PrismaClient } = await import("@prisma/client");
  const { createHmac } = await import("node:crypto");
  const db = new PrismaClient();
  const venue = await db.venue.findFirst({
    include: { tables: { where: { active: true }, orderBy: { createdAt: "asc" } } },
  });
  if (venue) {
    console.log(`\n${venue.name} — scan URLs (regenerate printed cards from Admin → Masalar):`);
    for (const t of venue.tables) {
      const sig = createHmac("sha256", venue.qrSecret)
        .update(`${t.code}:${t.qrVersion}`)
        .digest("base64url")
        .slice(0, 24);
      console.log(`  ${t.name.padEnd(10)} ${origin}/scan/${t.code}?k=${sig}`);
    }
    console.log(`\n  health check  ${origin}/api/health`);
  }
  await db.$disconnect();
} catch (err) {
  console.log(`\n(Could not read tables: ${err.message.split("\n")[0]})`);
}
