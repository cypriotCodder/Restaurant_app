import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { tableQrUrl } from "@/lib/qr";

// PNG of the table's CURRENT QR (for printing table cards).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const table = await db.table.findFirst({
    where: { id, venueId: staff.venueId },
    include: { venue: true },
  });
  if (!table) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const protocol = req.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `${protocol}://${host}`;
  const url = tableQrUrl(baseUrl, table.venue.qrSecret, table.code, table.qrVersion);
  const png = await QRCode.toBuffer(url, { width: 480, margin: 2 });
  return new NextResponse(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
