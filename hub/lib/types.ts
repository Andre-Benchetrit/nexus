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
  attachments?: Attachment[];
};
export type Attachment = {
  id: string; mediaType: string; bytes: number; width: number; height: number;
  url: string; name?: string; previewUrl?: string;
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
  const headers = new Headers(init?.headers || {});
  if (init?.body != null && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`/api/nexus/${path.replace(/^\//, "")}`, {
    ...init,
    headers,
    cache: "no-store"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || "Não foi possível concluir a operação.");
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}
