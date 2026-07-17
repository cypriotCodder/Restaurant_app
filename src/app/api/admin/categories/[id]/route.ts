import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { publish } from "@/lib/bus";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await db.category.findFirst({ where: { id, venueId: staff.venueId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  await db.category.update({
    where: { id },
    data: {
      ...(body.nameTr !== undefined && { nameTr: String(body.nameTr) }),
      ...(body.nameEn !== undefined && { nameEn: String(body.nameEn) }),
      ...(body.sortOrder !== undefined && { sortOrder: Number(body.sortOrder) || 0 }),
      ...(body.active !== undefined && { active: Boolean(body.active) }),
    },
  });
  publish({ type: "menu.changed", venueId: staff.venueId });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await db.category.findFirst({
    where: { id, venueId: staff.venueId },
    include: { items: { select: { id: true } } },
  });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (existing.items.length > 0) {
    return NextResponse.json({ error: "category_not_empty" }, { status: 409 });
  }
  await db.category.delete({ where: { id } });
  publish({ type: "menu.changed", venueId: staff.venueId });
  return NextResponse.json({ ok: true });
}
