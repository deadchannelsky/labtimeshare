import { redirect } from "next/navigation";

// Root route — redirect to login. Middleware will forward authenticated
// users onward to /dashboard if they already have a valid session.
export default function Home() {
  redirect("/login");
}
