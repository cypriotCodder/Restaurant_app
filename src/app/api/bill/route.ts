import { NextRequest, NextResponse } from "next/server";
import { getActiveSession } from "@/lib/tableSession";
import { buildBill, requestBill } from "@/lib/visit";
import { logAttempt } from "@/lib/attempts";

// The customer's view of their table's bill, and the "hesap istiyorum" button.
// Customers can see and ask; only staff can settle.

export async function GET() {
  const session = await getActiveSession();
  if (!session) return NextResponse.json({ error: "no_session" }, { status: 401 });
  if (!session.visitId) return NextResponse.json({ error: "no_visit" }, { status: 409 });

  const bill = await buildBill(session.visitId);
  if (!bill) return NextResponse.json({ error: "no_visit" }, { status: 409 });

  return NextResponse.json({
    status: bill.status,
    billRequested: bill.billRequestedAt !== null,
    totalKurus: bill.totalKurus,
    lines: bill.lines,
    // Which phone is theirs, so the UI can show "your share" alongside the
    // table total without exposing anyone's session token.
    yourTotalKurus: bill.phones.find((p) => p.sessionId === session.id)?.totalKurus ?? 0,
    phoneCount: bill.phones.length,
  });
}

export async function POST(req: NextRequest) {
  const session = await getActiveSession();
  if (!session) return NextResponse.json({ error: "no_session" }, { status: 401 });
  if (!session.visitId) return NextResponse.json({ error: "no_visit" }, { status: 409 });

  const ok = await requestBill(session.visitId, session.venueId);
  if (!ok) return NextResponse.json({ error: "visit_closed" }, { status: 409 });

  await logAttempt(req, "bill_requested", {
    venueId: session.venueId,
    tableId: session.tableId,
    sessionId: session.id,
  });
  return NextResponse.json({ ok: true });
}
