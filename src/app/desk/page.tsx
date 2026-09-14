import { redirect } from "next/navigation";
import { getStaff } from "@/lib/staffAuth";
import { db } from "@/lib/db";
import DeskBoard from "@/components/DeskBoard";

export default async function DeskPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  // Read here rather than in the client: this page is already a server
  // component, so the currency arrives with the first render instead of
  // causing a flash of the wrong symbol.
  const venue = await db.venue.findUnique({
    where: { id: staff.venueId },
    select: { currency: true },
  });
  return <DeskBoard staffName={staff.name} currency={venue?.currency ?? "TRY"} />;
}
