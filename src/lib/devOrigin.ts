import { networkInterfaces } from "node:os";
import { getEnv } from "./env";

// A development-only sanity check on NEXT_PUBLIC_BASE_URL.
//
// The origin is the address a phone dials, and it changes with every network
// the machine joins. When it goes stale nothing looks wrong from the server —
// pages serve, tests pass, the laptop works over localhost — but every QR code
// points at an address that no longer exists. That has been mistaken for a
// broken app more than once, so the server now says so at startup.

/** IPv4 addresses another device on the network could actually reach. */
function localAddresses(): string[] {
  const out: string[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    // VPN and virtual interfaces are routable here but not from a phone.
    if (/^(utun|bridge|llw|awdl)/.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

export function warnIfOriginUnreachable(): void {
  let host: string;
  try {
    host = new URL(getEnv().NEXT_PUBLIC_BASE_URL).hostname;
  } catch {
    return;
  }

  // localhost and hostnames are fine: the former is deliberate, the latter
  // resolves through DNS or mDNS and cannot be checked from here.
  const isIpv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  if (!isIpv4 || host === "127.0.0.1") return;

  const addresses = localAddresses();
  if (addresses.includes(host)) return;

  console.warn(
    [
      "",
      "  ⚠  NEXT_PUBLIC_BASE_URL points at an address this machine does not have.",
      `     configured: ${host}`,
      `     this machine: ${addresses.join(", ") || "(no LAN address)"}`,
      "",
      "     Every QR code generated now will be unreachable from a phone.",
      "     Fix with:  npm run dev:origin   then restart the dev server.",
      "",
    ].join("\n")
  );
}
