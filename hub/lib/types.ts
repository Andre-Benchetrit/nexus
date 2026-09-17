export type Department = {
  id: string; slug: string; nome?: string; name?: string;
  ativo?: boolean; papeis?: string[]; permissoes?: string[];
};
export type NexusProfile = {
  id: string; slug: string; nome: string; email: string; ativo: boolean;
  setores: Department[]; papeisGlobais: string[];
  permissoesGlobais?: string[]; permissoes: string[];
};
export type NexusSessionPrincipal = Pick<NexusProfile,
  "id" | "slug" | "nome" | "email" | "ativo">;
export type Conversation = {
  id: string; sessionKey: string; title: string | null;
  compositionLevel: CompositionLevel; pinnedAt?: string | null; archivedAt?: string | null;
  updatedAt?: string; createdAt?: string; preview?: string | null; department: Department;
};
export type Message = {
  id?: string; turnId?: string; traceId?: string; role: "user" | "assistant";
  content: string; provenance?: string | null; evidence?: Record<string, unknown> | null;
  createdAt?: string; optimistic?: boolean;
  sourceMode?: SourceMode;
  attachments?: Attachment[];
  artifacts?: Artifact[];
  knowledgeSources?: KnowledgeSource[];
  variantRootId?: string; variantIndex?: number; variantActive?: boolean;
  variants?: MessageVariant[];
  attachmentAnalysis?: { analysisRef: string; cacheHit: boolean; intent?: unknown; manifests?: unknown[] } | null;
};
export type MessageVariant = {
  id: string; turnId?: string; traceId?: string; content: string; provenance?: string | null;
  sourceMode?: SourceMode; artifacts?: Artifact[]; knowledgeSources?: KnowledgeSource[];
  createdAt?: string; variantIndex: number; active: boolean;
};
export type AttachmentStatus = "processing" | "ready" | "error" | "deleting";
export type FileProcessingStage =
  "validando_arquivo" | "extraindo_conteudo" | "indexando_anexo" | "analisando_anexo" |
  "comparando_anexos" | "recuperando_analise" | "interpretando_paginas";
export type Attachment = {
  id: string; mediaType: string; bytes: number; width?: number | null; height?: number | null;
  url: string; name?: string; previewUrl?: string; kind?: "image" | "document";
  format?: string; pages?: number | null; sheets?: number | null; cells?: number | null;
  status?: AttachmentStatus; analysisStatus?: FileProcessingStage | string | null;
  cacheHit?: boolean; errorCode?: string | null; progress?: number | null;
};
export type AttachmentStatusEvent = Partial<Attachment> & { attachmentId?: string };
export type TurnStageEvent = {
  code?: FileProcessingStage | string; label?: string; cacheHit?: boolean;
  attachmentId?: string; attachment?: AttachmentStatusEvent;
  attachments?: AttachmentStatusEvent[];
};
export type Artifact = { id: string; format: "xlsx" | "docx" | "pdf"; mediaType: string;
  name: string; title: string; bytes: number; classification?: string; url: string };
export type KnowledgeSource = { kind: "knowledge-source"; documentId: string; title: string;
  version: number; format?: string | null; size?: number | null; url: string };
export type CompositionLevel = "baixo" | "medio" | "alto" | "extra_alto";
export type SourceMode = "automatico" | "dados" | "documentacao" | "web";
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
