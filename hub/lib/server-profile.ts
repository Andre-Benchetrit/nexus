import "server-only";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { signInternalToken } from "@/lib/internal-token";
import type { NexusProfile, NexusSessionPrincipal } from "@/lib/types";

function accessErrorCode(status: number) {
  if (status === 401) return "USUARIO_INATIVO";
  if (status === 403) return "ACESSO_HUB_NAO_CONCEDIDO";
  return "NEXUS_API_INDISPONIVEL";
}

export async function loadNexusProfile(principal: NexusSessionPrincipal): Promise<NexusProfile> {
  const apiUrl = process.env.NEXUS_API_INTERNAL_URL;
  if (!apiUrl) throw new Error("NEXUS_API_INDISPONIVEL");
  const token = signInternalToken({
    sub: principal.slug,
    pid: principal.id,
    typ: "session"
  });
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(accessErrorCode(response.status));
  return response.json() as Promise<NexusProfile>;
}

export async function requireNexusProfile(): Promise<NexusProfile> {
  const session = await auth();
  if (!session?.nexus) redirect("/login");
  try {
    return await loadNexusProfile(session.nexus);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "NEXUS_API_INDISPONIVEL";
    redirect(`/access-denied?reason=${encodeURIComponent(reason)}`);
  }
}
