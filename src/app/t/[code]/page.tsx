import { getActiveSession } from "@/lib/tableSession";
import { menuForSession } from "@/lib/menu";
import CustomerApp from "@/components/CustomerApp";
import RescanWall from "@/components/RescanWall";

// Table page. Without an active session (minted only by a valid signed-QR
// hit on /scan/[code]) this renders the re-scan wall — the bare URL is dead.
//
// With one, the menu is rendered here rather than fetched by the client after
// hydration: the server already holds the session, so making the phone
// download the bundle, hydrate, and then ask for the menu was a round-trip
// the first paint did not need.
export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ err?: string }>;
}) {
  const { code } = await params;
  const { err } = await searchParams;
  const session = await getActiveSession(code);
  if (!session) {
    return <RescanWall variant={err === "invalid" ? "invalid" : "expired"} />;
  }
  const initialMenu = await menuForSession(session);
  return <CustomerApp code={code} initialMenu={initialMenu} />;
}
