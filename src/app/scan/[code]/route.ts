import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyTableQr } from "@/lib/qr";
import { mintSession, SESSION_COOKIE } from "@/lib/tableSession";
import { logAttempt } from "@/lib/attempts";
import { isSecureOrigin, baseUrl } from "@/lib/env";
import { rateLimit, clearRateLimit, clientIp } from "@/lib/rateLimit";

// The URL inside every table QR. A valid signature (bound to the table's
// CURRENT qrVersion) mints a table session cookie and lands on the menu.
// Invalid/stale signatures — including photos of regenerated QRs — get the
// "scan the code at your table" wall and are logged.
//
// ── Rate limiting ────────────────────────────────────────────────────────────
// Every attempt used to write an OrderAttempt row with no limit, so a script
// looping on this URL would fill the venue's disk. The signature itself is not
// brute-forceable (144 bits), so the limits exist to bound *writes*, not to
// protect the secret.
//
// Limits are applied to FAILED scans, not to scans generally: every customer on
// the venue's wifi shares one NAT'd public IP, so a strict per-IP cap on all
// scans would lock out a full restaurant. Legitimate customers succeed;
// a brute-forcer fails every time.

/** Failed scans (bad signature, unknown/inactive table) per IP per window. */
const FAIL_LIMIT = 20;
const FAIL_WINDOW_SEC = 10 * 60;

/**
 * Successful scans per IP per window. Deliberately generous — one NAT'd wifi
 * carries the whole venue — and present only as a backstop against the session
 * table being flooded.
 */
const OK_LIMIT = 300;
const OK_WINDOW_SEC = 10 * 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const sig = req.nextUrl.searchParams.get("k") ?? "";
  const ip = clientIp(req) || "unknown";

  // Redirects are built against the configured venue origin, not req.url.
  // Next reconstructs req.url from the bind address, so behind `next dev` or a
  // reverse proxy it yields localhost/0.0.0.0 — a Location a customer's phone
  // resolves against ITSELF, which fails with a connection error and looks
  // exactly like a broken QR code.
  const wall = () => NextResponse.redirect(new URL(`/t/${code}?err=invalid`, baseUrl()));

  // Checked before the table lookup, so a flood costs neither a query nor a row.
  if (!rateLimit(`scan:fail:${ip}`, FAIL_LIMIT, FAIL_WINDOW_SEC).allowed) {
    // One ledger entry per window, so the abuse is visible to staff without
    // the ledger itself becoming the flood.
    if (rateLimit(`scan:faillog:${ip}`, 1, FAIL_WINDOW_SEC).allowed) {
      await logAttempt(req, "rate_limited", { detail: `scan flood from ${ip}` });
    }
    return wall();
  }

  const table = await db.table.findUnique({
    where: { code },
    include: { venue: true },
  });

  if (!table || !table.active) {
    await logAttempt(req, "table_inactive", { tableId: table?.id, venueId: table?.venueId, detail: code });
    return wall();
  }
  if (!verifyTableQr(table.venue.qrSecret, table.code, table.qrVersion, sig)) {
    await logAttempt(req, "invalid_qr", { tableId: table.id, venueId: table.venueId });
    return wall();
  }

  // A valid signature refunds the failure budget: a party whose QR was
  // regenerated mid-meal may fail several times before someone reprints the
  // card, and must not then be locked out once they scan the right one.
  clearRateLimit(`scan:fail:${ip}`);

  if (!rateLimit(`scan:ok:${ip}`, OK_LIMIT, OK_WINDOW_SEC).allowed) {
    await logAttempt(req, "rate_limited", { tableId: table.id, venueId: table.venueId, detail: "scan cap" });
    return wall();
  }

  const token = await mintSession(table.id, table.venueId);
  await logAttempt(req, "scan_ok", { tableId: table.id, venueId: table.venueId });

  const res = NextResponse.redirect(new URL(`/t/${code}`, baseUrl()));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureOrigin(),
    path: "/",
    maxAge: 2 * 60 * 60,
  });
  return res;
}
