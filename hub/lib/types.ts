export type Department = {
  id: string; slug: string; nome?: string; name?: string;
  ativo?: boolean; papeis?: string[]; permissoes?: string[];
};
export type NexusProfile = {
  id: string; slug: string; nome: string; email: string; ativo: boolean;
  setores: Department[]; papeisGlobais: string[];
  permissoesGlobais?: string[]; permissoes: string[];
};
export type Conversation = {
  id: string; sessionKey: string; title: string | null;
  compositionLevel: CompositionLevel; pinnedAt?: string | null; archivedAt?: string | null;
  updatedAt?: string; createdAt?: string; preview?: string | null; department: Department;
};
export type Message = {
  id?: string; turnId?: string; traceId?: string; role: "user" | "assistant";
  content: string; provenance?: string | null; evidence?: Record<string, unknown> | null;
  createdAt?: string; optimistic?: boolean;
};
export type CompositionLevel = "baixo" | "medio" | "alto" | "extra_alto";
export type MemoryOffer = { id: string; statement: string; expiresAt?: string };
export type TurnRequest = {
  id: string; traceId: string; turnId?: string | null;
  compositionLevel: CompositionLevel;
  status: "accepted" | "running" | "success" | "error" | "interrupted";
  errorCode?: string | null;
};

export async function nexusFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/nexus/${path.replace(/^\//, "")}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || "Não foi possível concluir a operação.");
  }
  return response.json() as Promise<T>;
}
