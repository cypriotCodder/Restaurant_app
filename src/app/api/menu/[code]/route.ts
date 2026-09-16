import { NextRequest, NextResponse } from "next/server";
import { getActiveSession } from "@/lib/tableSession";
import { menuForSession } from "@/lib/menu";

// Menu is only served to an active table session — the bare URL without a
// fresh scan gets 401 and the client shows the re-scan wall.
//
// The page renders the same payload on the server for the first paint; this
// route is what SWR revalidates against afterwards (menu.changed, focus).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const session = await getActiveSession(code);
  if (!session) {
    return NextResponse.json({ error: "no_session" }, { status: 401 });
  }
  return NextResponse.json(await menuForSession(session));
}
