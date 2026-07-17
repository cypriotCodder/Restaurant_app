import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { publish } from "@/lib/bus";

// Full menu tree (including inactive/86'd) for the admin editor.
export async function GET() {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const categories = await db.category.findMany({
    where: { venueId: staff.venueId },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        orderBy: { sortOrder: "asc" },
        include: {
          modifierGroups: {
            orderBy: { sortOrder: "asc" },
            include: { options: { orderBy: { sortOrder: "asc" } } },
          },
        },
      },
    },
  });
  return NextResponse.json({ categories });
}

export async function POST(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { nameTr, nameEn, sortOrder } = await req.json().catch(() => ({}));
  if (!nameTr) return NextResponse.json({ error: "name_required" }, { status: 400 });
  const cat = await db.category.create({
    data: {
      venueId: staff.venueId,
      nameTr: String(nameTr),
      nameEn: String(nameEn || nameTr),
      sortOrder: Number(sortOrder) || 0,
    },
  });
  publish({ type: "menu.changed", venueId: staff.venueId });
  return NextResponse.json({ ok: true, id: cat.id });
}
