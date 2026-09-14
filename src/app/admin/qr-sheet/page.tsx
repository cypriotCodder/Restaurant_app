import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getStaff } from "@/lib/staffAuth";
import { db } from "@/lib/db";
import { tableQrUrl } from "@/lib/qr";
import QrSheet from "@/components/QrSheet";
import { baseUrl } from "@/lib/env";

// Printable table cards for every table at once.
//
// Installing a venue previously meant opening /api/admin/tables/<id>/qr forty
// times and printing each PNG by hand. This renders the whole set as cut-out
// cards on A4, which is what actually happens at install and after a QR
// rotation.
//
// Rendered server-side: the QR payloads are signed with the venue's secret,
// which must never reach the browser.

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ size?: string; include?: string }>;

const SIZES = {
  large: { perRow: 2, qrPx: 640, label: "Büyük / Large — 4 per page" },
  medium: { perRow: 3, qrPx: 480, label: "Orta / Medium — 9 per page" },
  small: { perRow: 4, qrPx: 360, label: "Küçük / Small — 16 per page" },
} as const;

export type CardSize = keyof typeof SIZES;

export default async function QrSheetPage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "admin") redirect("/desk");

  const { size: rawSize, include } = await searchParams;
  const size: CardSize = rawSize === "large" || rawSize === "small" ? rawSize : "medium";
  const includeInactive = include === "all";

  const venue = await db.venue.findUniqueOrThrow({ where: { id: staff.venueId } });
  const tables = await db.table.findMany({
    where: { venueId: staff.venueId, ...(includeInactive ? {} : { active: true }) },
    orderBy: { createdAt: "asc" },
  });

  const origin = baseUrl();

  const cards = await Promise.all(
    tables.map(async (t) => {
      const url = tableQrUrl(origin, venue.qrSecret, t.code, t.qrVersion);
      return {
        id: t.id,
        name: t.name,
        active: t.active,
        qrVersion: t.qrVersion,
        // Inlined as a data URI so printing never depends on a second request
        // — a browser that skips images at print time would otherwise produce
        // a sheet of blank cards.
        dataUrl: await QRCode.toDataURL(url, {
          width: SIZES[size].qrPx,
          margin: 1,
          // High recovery: these live on café tables and will get wet, smudged
          // and scratched. Denser, but readable with up to 30% damage.
          errorCorrectionLevel: "H",
        }),
      };
    })
  );

  return (
    <QrSheet
      venueName={venue.name}
      baseUrl={origin}
      cards={cards}
      size={size}
      perRow={SIZES[size].perRow}
      includeInactive={includeInactive}
      sizeOptions={Object.entries(SIZES).map(([k, v]) => ({ key: k as CardSize, label: v.label }))}
    />
  );
}
