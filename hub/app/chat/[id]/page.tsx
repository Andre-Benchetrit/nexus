import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { HubShell } from "@/components/hub-shell";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.nexus) redirect("/login");
  const { id } = await params;
  return <HubShell profile={session.nexus} initialConversationId={id} />;
}
