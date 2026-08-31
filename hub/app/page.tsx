import { HubShell } from "@/components/hub-shell";
import { requireNexusProfile } from "@/lib/server-profile";

export default async function HomePage() {
  const profile = await requireNexusProfile();
  return <HubShell profile={profile} />;
}
