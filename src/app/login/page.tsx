import { redirect } from "next/navigation";
import { getStaff } from "@/lib/staffAuth";
import LoginForm from "./LoginForm";

// Someone already signed in has no use for the form: send them where their
// role belongs. The form itself is a client component.
export default async function LoginPage() {
  const staff = await getStaff();
  if (staff) redirect(staff.role === "admin" ? "/admin" : "/desk");
  return <LoginForm />;
}
