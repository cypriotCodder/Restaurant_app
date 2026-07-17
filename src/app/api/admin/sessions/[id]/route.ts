import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { publish } from "@/lib/bus";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const session = await db.tableSession.findFirst({ where: { id, venueId: staff.venueId } });
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await db.tableSession.update({ where: { id }, data: { revokedAt: new Date() } });
  publish({ type: "session.revoked", venueId: staff.venueId, sessionId: id });
  return NextResponse.json({ ok: true });
}
