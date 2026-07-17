import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const table = await db.table.findFirst({ where: { id, venueId: staff.venueId } });
  if (!table) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  if (body.regenerateQr) {
    // Bumping qrVersion invalidates every existing print/photo of this
    // table's QR; live sessions are also killed so the reset is total.
    await db.$transaction([
      db.table.update({ where: { id }, data: { qrVersion: { increment: 1 } } }),
      db.tableSession.updateMany({
        where: { tableId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return NextResponse.json({ ok: true });
  }

  await db.table.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: String(body.name) }),
      ...(body.active !== undefined && { active: Boolean(body.active) }),
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const table = await db.table.findFirst({ where: { id, venueId: staff.venueId } });
  if (!table) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const hasOrders = await db.order.count({ where: { tableId: id } });
  if (hasOrders > 0) {
    await db.table.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ ok: true, deactivated: true });
  }
  await db.$transaction([
    db.tableSession.deleteMany({ where: { tableId: id } }),
    db.table.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
