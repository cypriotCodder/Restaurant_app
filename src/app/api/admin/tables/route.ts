import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { tableQrUrl } from "@/lib/qr";
import { baseUrl } from "@/lib/env";

function newTableCode(): string {
  return randomBytes(6).toString("base64url");
}

export async function GET() {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const venue = await db.venue.findUniqueOrThrow({ where: { id: staff.venueId } });
  const origin = baseUrl();
  const tables = await db.table.findMany({
    where: { venueId: staff.venueId },
    orderBy: { createdAt: "asc" },
    include: {
      sessions: {
        where: { revokedAt: null, expiresAt: { gt: new Date() }, lastSeenAt: { gt: new Date(Date.now() - 30 * 60 * 1000) } },
        select: { id: true, createdAt: true, lastSeenAt: true },
      },
    },
  });
  return NextResponse.json({
    tables: tables.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      active: t.active,
      qrVersion: t.qrVersion,
      qrUrl: tableQrUrl(origin, venue.qrSecret, t.code, t.qrVersion),
      activeSessions: t.sessions,
    })),
  });
}

export async function POST(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await req.json().catch(() => ({}));
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  const table = await db.table.create({
    data: { venueId: staff.venueId, name: String(name), code: newTableCode() },
  });
  return NextResponse.json({ ok: true, id: table.id });
}
