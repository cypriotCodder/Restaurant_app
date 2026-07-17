import { getActiveSession } from "@/lib/tableSession";
import CustomerApp from "@/components/CustomerApp";
import RescanWall from "@/components/RescanWall";

// Table page. Without an active session (minted only by a valid signed-QR
// hit on /scan/[code]) this renders the re-scan wall — the bare URL is dead.
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
  return <CustomerApp code={code} />;
}
