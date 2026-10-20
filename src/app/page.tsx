import { redirect } from "next/navigation";
import { currentPrincipal } from "@/lib/auth/session";

export default async function Home() {
  const principal = await currentPrincipal();
  redirect(principal ? "/dashboard" : "/login");
}
