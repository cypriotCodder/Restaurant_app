import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { publish } from "@/lib/bus";
import { itemSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await db.menuItem.findFirst({ where: { id, venueId: staff.venueId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Fast path for the live 86 toggle.
  if (Object.keys(body).length === 1 && "available" in body) {
    await db.menuItem.update({ where: { id }, data: { available: Boolean(body.available) } });
    publish({ type: "menu.changed", venueId: staff.venueId });
    return NextResponse.json({ ok: true });
  }

  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const d = parsed.data;

  await db.$transaction([
    db.modifierGroup.deleteMany({ where: { itemId: id } }),
    db.menuItem.update({
      where: { id },
      data: {
        categoryId: d.categoryId,
        nameTr: d.nameTr,
        nameEn: d.nameEn || d.nameTr,
        descTr: d.descTr,
        descEn: d.descEn,
        priceKurus: d.priceKurus,
        photoUrl: d.photoUrl,
        tags: d.tags,
        available: d.available,
        sortOrder: d.sortOrder,
        modifierGroups: {
          create: d.modifierGroups.map((g, gi) => ({
            nameTr: g.nameTr,
            nameEn: g.nameEn || g.nameTr,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            sortOrder: gi,
            options: {
              create: g.options.map((o, oi) => ({
                nameTr: o.nameTr,
                nameEn: o.nameEn || o.nameTr,
                priceDeltaKurus: o.priceDeltaKurus,
                sortOrder: oi,
              })),
            },
          })),
        },
      },
    }),
  ]);
  publish({ type: "menu.changed", venueId: staff.venueId });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await db.menuItem.findFirst({ where: { id, venueId: staff.venueId } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const referenced = await db.orderItem.count({ where: { itemId: id } });
  if (referenced > 0) {
    // Keep history intact; hide instead of hard delete.
    await db.menuItem.update({ where: { id }, data: { available: false } });
  } else {
    await db.menuItem.delete({ where: { id } });
  }
  publish({ type: "menu.changed", venueId: staff.venueId });
  return NextResponse.json({ ok: true, softDeleted: referenced > 0 });
}
