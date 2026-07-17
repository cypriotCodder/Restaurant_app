import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { publish } from "@/lib/bus";
import { itemSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = itemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const d = parsed.data;
  const category = await db.category.findFirst({
    where: { id: d.categoryId, venueId: staff.venueId },
  });
  if (!category) return NextResponse.json({ error: "bad_category" }, { status: 400 });

  const item = await db.menuItem.create({
    data: {
      venueId: staff.venueId,
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
  });
  publish({ type: "menu.changed", venueId: staff.venueId });
  return NextResponse.json({ ok: true, id: item.id });
}
