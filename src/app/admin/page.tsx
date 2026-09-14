import { redirect } from "next/navigation";
import { getStaff } from "@/lib/staffAuth";
import { db } from "@/lib/db";
import AdminApp from "@/components/AdminApp";

export default async function AdminPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "admin") redirect("/desk");
  const venue = await db.venue.findUnique({
    where: { id: staff.venueId },
    select: { currency: true },
  });
  return <AdminApp staffName={staff.name} currency={venue?.currency ?? "TRY"} />;
}
