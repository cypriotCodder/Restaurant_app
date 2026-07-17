import { redirect } from "next/navigation";
import { getStaff } from "@/lib/staffAuth";
import DeskBoard from "@/components/DeskBoard";

export default async function DeskPage() {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  return <DeskBoard staffName={staff.name} />;
}
