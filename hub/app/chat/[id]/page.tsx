import { HubShell } from "@/components/hub-shell";
import { requireNexusProfile } from "@/lib/server-profile";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireNexusProfile();
  const { id } = await params;
  return <HubShell profile={profile} initialConversationId={id} />;
}
