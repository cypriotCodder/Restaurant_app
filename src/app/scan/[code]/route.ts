import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyTableQr } from "@/lib/qr";
import { mintSession, SESSION_COOKIE } from "@/lib/tableSession";
import { logAttempt } from "@/lib/attempts";

// The URL inside every table QR. A valid signature (bound to the table's
// CURRENT qrVersion) mints a table session cookie and lands on the menu.
// Invalid/stale signatures — including photos of regenerated QRs — get the
// "scan the code at your table" wall and are logged.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const sig = req.nextUrl.searchParams.get("k") ?? "";
  const table = await db.table.findUnique({
    where: { code },
    include: { venue: true },
  });

  if (!table || !table.active) {
    await logAttempt(req, "table_inactive", { tableId: table?.id, venueId: table?.venueId, detail: code });
    return NextResponse.redirect(new URL(`/t/${code}?err=invalid`, req.url));
  }
  if (!verifyTableQr(table.venue.qrSecret, table.code, table.qrVersion, sig)) {
    await logAttempt(req, "invalid_qr", { tableId: table.id, venueId: table.venueId });
    return NextResponse.redirect(new URL(`/t/${code}?err=invalid`, req.url));
  }

  const token = await mintSession(table.id, table.venueId);
  await logAttempt(req, "scan_ok", { tableId: table.id, venueId: table.venueId });

  const res = NextResponse.redirect(new URL(`/t/${code}`, req.url));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 2 * 60 * 60,
  });
  return res;
}
