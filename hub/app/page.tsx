import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { HubShell } from "@/components/hub-shell";

export default async function HomePage() {
  const session = await auth();
  if (!session?.nexus) redirect("/login");
  return <HubShell profile={session.nexus} />;
}
