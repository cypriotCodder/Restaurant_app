import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffAuth";
import { dayBounds, periodReport, openTables, percentChange } from "@/lib/reporting";

// Today's figures with a like-for-like comparison against a FULL yesterday.
//
// Computed here rather than in the browser: the old client-side version derived
// yesterday from a 24-hour order list, so it only ever saw part of yesterday and
// the comparison was wrong by a different amount depending on the time of day.
export async function GET() {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const today = dayBounds(0);
  const yesterday = dayBounds(1);

  const [todayReport, yesterdayReport, floor] = await Promise.all([
    periodReport(staff.venueId, today.from, today.to),
    periodReport(staff.venueId, yesterday.from, yesterday.to),
    openTables(staff.venueId),
  ]);

  return NextResponse.json({
    today: todayReport,
    yesterday: yesterdayReport,
    openTables: floor,
    change: {
      settled: percentChange(todayReport.settledKurus, yesterdayReport.settledKurus),
      orders: percentChange(todayReport.ordersPlaced, yesterdayReport.ordersPlaced),
    },
  });
}
