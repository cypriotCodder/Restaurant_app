import { redirect } from "next/navigation";
import { getStaff } from "@/lib/staffAuth";
import AdminApp from "@/components/AdminApp";

export default async function AdminPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "admin") redirect("/desk");
  return <AdminApp staffName={staff.name} />;
}
