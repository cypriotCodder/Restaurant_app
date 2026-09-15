import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveSession } from "@/lib/tableSession";

// Menu is only served to an active table session — the bare URL without a
// fresh scan gets 401 and the client shows the re-scan wall.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const session = await getActiveSession(code);
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  // The venue row does not depend on the menu, and this is the request every
  // customer makes first, over cellular, before they can do anything.
  const [categories, venue] = await Promise.all([
    db.category.findMany({
      where: { venueId: session.venueId, active: true },
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
    }),
    db.venue.findUniqueOrThrow({
      where: { id: session.venueId },
      select: { name: true, currency: true, defaultLocale: true },
    }),
  ]);
  return NextResponse.json({
    venue: { name: venue.name, currency: venue.currency, defaultLocale: venue.defaultLocale },
    table: { name: session.tableName, code: session.tableCode },
    categories: categories.map((c) => ({
      id: c.id,
      nameTr: c.nameTr,
      nameEn: c.nameEn,
      items: c.items.map((i) => ({
        id: i.id,
        nameTr: i.nameTr,
        nameEn: i.nameEn,
        descTr: i.descTr,
        descEn: i.descEn,
        priceKurus: i.priceKurus,
        photoUrl: i.photoUrl,
        tags: i.tags ? i.tags.split(",").filter(Boolean) : [],
        available: i.available,
        modifierGroups: i.modifierGroups.map((g) => ({
          id: g.id,
          nameTr: g.nameTr,
          nameEn: g.nameEn,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          options: g.options.map((o) => ({
            id: o.id,
            nameTr: o.nameTr,
            nameEn: o.nameEn,
            priceDeltaKurus: o.priceDeltaKurus,
          })),
        })),
      })),
    })),
  });
}
