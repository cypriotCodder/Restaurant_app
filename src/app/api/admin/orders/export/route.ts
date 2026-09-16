import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";

// CSV export of the order log (one row per order item).
export async function GET(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Same ceiling as the order log: a year is the most anyone reconciles, and
  // an unbounded range would pull the whole table into one response.
  const requested = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 365) : 30;

  const orders = await db.order.findMany({
    where: { venueId: staff.venueId, createdAt: { gt: new Date(Date.now() - days * 86400000) } },
    orderBy: { createdAt: "asc" },
    include: { items: true, table: true, visit: { select: { paymentMethod: true, closedReason: true } } },
  });

  // Quoted, and a leading formula trigger is neutralised: item names and
  // notes come from the menu and from customers' phones, and Excel would
  // otherwise evaluate a note beginning with "=" or "@" on the owner's PC.
  const esc = (v: string | number) => {
    const s = String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = [
    ["order_number", "created_at", "table", "status", "reject_reason", "item", "qty", "unit_price_try", "line_total_try", "note", "modifiers", "order_total_try", "payment_status", "payment_method", "visit_outcome"].join(","),
  ];
  for (const o of orders) {
    for (const i of o.items) {
      rows.push(
        [
          o.number,
          o.createdAt.toISOString(),
          esc(o.table.name),
          o.status,
          esc(o.rejectReason ?? ""),
          esc(i.nameSnapshot),
          i.qty,
          (i.unitPriceKurus / 100).toFixed(2),
          ((i.unitPriceKurus * i.qty) / 100).toFixed(2),
          esc(i.note),
          esc((JSON.parse(i.modifiersJson) as { name: string }[]).map((m) => m.name).join("; ")),
          (o.totalKurus / 100).toFixed(2),
          o.paymentStatus,
          o.visit?.paymentMethod ?? "",
          // "abandoned" marks a table that left without settling — a walkout,
          // or one staff forgot to close. Worth seeing in the export.
          o.visit?.closedReason ?? "",
        ].join(",")
      );
    }
  }
  return new NextResponse(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-${days}d.csv"`,
    },
  });
}
