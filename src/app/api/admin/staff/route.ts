import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/staffAuth";
import { createStaff, staffCreateSchema } from "@/lib/staffAdmin";

export async function GET() {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const users = await db.staffUser.findMany({
    where: { venueId: staff.venueId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
  });
  return NextResponse.json({ staff: users, self: staff.sub });
}

// Create a staff account. Restaurant turnover means this has to be doable from
// the admin screen by a manager, not from psql.
export async function POST(req: NextRequest) {
  const staff = await requireStaff("admin");
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = staffCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid", detail: parsed.error.issues[0]?.message },
      { status: 400 }
    );
  }

  const result = await createStaff(staff.venueId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true, id: result.id });
}
