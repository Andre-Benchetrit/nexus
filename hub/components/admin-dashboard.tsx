"use client";

import { Component, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Department, NexusProfile, nexusFetch } from "@/lib/types";
import { createKnowledgeImportController, DEFAULT_MAX_FILE_BYTES } from "@/lib/knowledge-import.cjs";
import { NexusLogo } from "./nexus-logo";

type Principal = {
  id: string; slug: string; nome: string; email: string; ativo: boolean;
  setores: Array<{ id: string; slug: string; nome: string }>;
  atribuicoes: Array<{ papel: string; departmentId: string | null }>;
};
type Role = { id: string; slug: string; nome: string; descricao?: string };
type Usage = { resumo: Record<string, string | number | null>;
  porModelo: Array<Record<string, string | number | null>>;
  porServico: Array<Record<string, string | number | null>>;
  porAtribuicao: Array<Record<string, string | number | null>>;
  porFaixa: Array<Record<string, string | number | null>> };
type MemoryCandidate = {
  id: string; tipo: string; categoria: string; declaracao: string;
  gatilhos: string[]; escopo: string; status: string; confianca?: number | null;
  justificativa?: string | null; riscos?: string[]; criadoEm?: string;
};
type KnowledgeDocument = {
  id: string; titulo: string; tipo: string; escopo: string; status: string;
  setor?: string | null; department_id?: string | null; versao?: number | null;
  atualizado_em?: string; pending_status?: string | null;
};
type KnowledgeEdit = {
  document: KnowledgeDocument;
  version: { id?: string; numero?: number; status?: string; titulo: string; resumo?: string | null;
    texto_extraido?: string; paginas_extraidas?: Array<{ numero: number; texto: string;
      possui_imagem?: boolean; metadados?: Record<string, unknown> }>; conteudo_estruturado?: {
    objetivo?: string; publico?: string; preRequisitos?: string[];
    passos?: Array<{ titulo?: string; descricao?: string }>; alertas?: string[];
  } };
  versions: Array<{ id: string; numero: number; status: string; titulo: string;
    criado_em?: string; publicado_em?: string | null }>;
};
type AuditOverview = {
  period: { from: string; to: string };
  summary: Record<string, string | number | null>;
  users: Array<Record<string, any>>;
  capabilities: Array<Record<string, any>>;
};
type AuditActivity = { items: Array<Record<string, any>>; nextCursor?: string | null };
type AuditGlossary = { version: string; capabilities: Array<Record<string, string>>;
  modes: Array<Record<string, string>>; statuses: Array<Record<string, string>>;
  terms: Array<Record<string, string>> };
type PilotReportItem = {
  id: string; reporter_principal_id?: string | null; reporter_name: string;
  department_id?: string | null; department_name?: string | null;
  conversation_ref: string; conversation_title?: string | null; message_ref?: string | null;
  trace_id: string; category: string; categoryLabel: string; comment: string;
  report_origin?: "user" | "automatic"; request_ref?: string | null;
  error_code?: string | null; error_stage?: string | null;
  status: "new" | "in_review" | "resolved" | "dismissed"; statusLabel: string;
  internal_note?: string | null; created_at: string; updated_at: string; resolved_at?: string | null;
};
type PilotReportList = {
  summary: Record<string, number>;
  items: PilotReportItem[];
  nextCursor?: string | null;
  facets: {
    categories: Array<{ code: string; label: string }>;
    statuses: Array<{ code: string; label: string }>;
    users: Array<{ id: string; name: string }>;
    departments: Array<{ id: string; name: string }>;
  };
};
type PilotReportDetail = PilotReportItem & {
  snapshot: { reportedMessageId: string | null; capturedAt: string; automatic?: boolean;
    contentShared?: boolean; messages: Array<{
    id: string; role: "user" | "assistant"; content: string; reported?: boolean;
    traceId?: string | null; createdAt?: string; attachments?: Array<Record<string, any>>;
    artifacts?: Array<Record<string, any>>;
  }> };
  trace?: { turn?: Record<string, any>; stages?: Array<Record<string, any>> } | null;
};
type McpToolBinding = {
  id: string; remote_tool_name: string; nexus_tool_name: string;
  capability_code: string; permission_code: string; description: string;
  effect: "read"; exposure: "admin_lab" | "assistant"; enabled: boolean;
  status: string; input_schema_hash: string; output_schema_hash?: string | null;
  observed_input_schema_hash?: string | null; observed_output_schema_hash?: string | null;
  timeout_ms: number; max_result_bytes: number; observed_at?: string | null;
};
type McpServer = {
  id: string; server_key: string; nome: string; descricao?: string | null;
  transport: string; network_scope: string; enabled: boolean; status: string;
  manifest_version: string; observed_server_name?: string | null;
  observed_server_version?: string | null; observed_protocol_version?: string | null;
  last_error_code?: string | null; last_checked_at?: string | null;
  tools: McpToolBinding[];
};

function parseKnowledgeSteps(value: FormDataEntryValue | null) {
  const paragraphs = String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return paragraphs.map((line, index) => {
    const numberedHeading = line.match(/^((?:[^\p{L}\p{N}\s]{1,4}\s*)?\d+\.\s+.{1,120}?)(?:\s{2,}|$)/u);
    if (numberedHeading) return {
      titulo: numberedHeading[1].replace(/\s+/g, " ").trim(),
      descricao: line.slice(numberedHeading[0].length).trim()
    };
    const separator = line.indexOf(":");
    if (separator > 0 && separator <= 300) return {
      titulo: line.slice(0, separator).trim(), descricao: line.slice(separator + 1).trim()
    };
    if (line.length <= 300) return { titulo: line, descricao: "" };
    return { titulo: `Passo ${index + 1}`, descricao: line };
  });
}

function money(value: unknown, currency: "USD" | "BRL") {
  if (value == null) return "Não calculado";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency,
    minimumFractionDigits: currency === "USD" ? 4 : 2 }).format(Number(value));
}

class KnowledgeImportBoundary extends Component<{
  children: ReactNode;
  onClose: () => void;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[admin] Falha ao renderizar formulário de importação de conhecimento", error, info);
  }

  render() {
    if (this.state.failed) {
      return <div className="knowledge-import-fallback glass-panel" role="alert">
        <p>Não foi possível abrir o formulário de importação. O painel continua disponível.</p>
        <button type="button" className="secondary-button" onClick={this.props.onClose}>Fechar importação</button>
      </div>;
    }
    return this.props.children;
  }
}

function KnowledgeImportForm({
  canGlobalKnowledge, departments, defaultDepartmentId, scope, onScopeChange, onUpload, onSuccess
}: {
  canGlobalKnowledge: boolean;
  departments: Array<{ id: string; nome: string }>;
  defaultDepartmentId: string;
  scope: string;
  onScopeChange: (scope: string) => void;
  onUpload: (form: HTMLFormElement) => Promise<void>;
  onSuccess: () => void;
}) {
  const [importState, setImportState] = useState({ fileName: "", error: null as string | null, pending: false });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const controllerRef = useRef<ReturnType<typeof createKnowledgeImportController> | null>(null);
  if (!controllerRef.current) {
    const configuredLimit = Number(process.env.NEXT_PUBLIC_NEXUS_KNOWLEDGE_MAX_BYTES || DEFAULT_MAX_FILE_BYTES);
    controllerRef.current = createKnowledgeImportController(setImportState,
      Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : DEFAULT_MAX_FILE_BYTES);
  }
  const controller = controllerRef.current;

  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    const handleCancel = () => controller.cancel(input);
    input.addEventListener("cancel", handleCancel);
    return () => input.removeEventListener("cancel", handleCancel);
  }, [controller]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void controller.submit(fileInputRef.current, event.currentTarget, onUpload, onSuccess);
  }

  return <form className="knowledge-import glass-panel" onSubmit={submit}>
    <div><p className="eyebrow">ONEDRIVE / LEGADO</p><h2>Importar para revisão</h2>
      <p>PDF, DOCX ou DOTX. A versão atual publicada permanece ativa durante a revisão.</p></div>
    <div className="knowledge-file-picker">
      <input ref={fileInputRef} className="knowledge-file-input" id="knowledge-import-file"
        name="file" type="file" accept=".pdf,.docx,.dotx" aria-label="Arquivo para importar"
        onChange={(event) => { controller.select(event.currentTarget.files?.[0] || null, event.currentTarget); }} />
      <button type="button" className="knowledge-file-select" disabled={importState.pending}
        onClick={() => {
          const input = fileInputRef.current;
          if (!input) return;
          controller.cancel(input);
          input.click();
        }}>Selecionar arquivo</button>
      <strong title={importState.fileName || undefined}>
        {importState.fileName || "Nenhum arquivo selecionado"}
      </strong>
    </div>
    {importState.error && <div className="error-banner knowledge-import-error" role="alert">{importState.error}</div>}
    <label>Tipo<select name="tipo"><option value="procedimento">Procedimento</option>
      <option value="politica">Política</option><option value="manual">Manual</option></select></label>
    <label>Escopo<select name="escopo" value={scope} onChange={(event) => onScopeChange(event.target.value)}>
      <option value="setor">Setor</option>{canGlobalKnowledge && <option value="global">Global</option>}
    </select></label>
    <label>Setor<select name="departmentId" defaultValue={defaultDepartmentId} disabled={scope === "global"}>
      {departments.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
    </select></label>
    <button className="secondary-button" disabled={importState.pending}>
      {importState.pending ? "Processando…" : "Importar documento"}</button>
  </form>;
}

export function AdminDashboard({ profile }: { profile: NexusProfile }) {
  const router = useRouter();
  const isAdmin = profile.permissoes.includes("governanca.administrar");
  const canAudit = profile.permissoes.includes("auditoria.consultar") || profile.setores.some((setor) =>
    setor.permissoes?.includes("auditoria.consultar.setor"));
  const canPilot = profile.permissoes.includes("piloto.problemas.administrar");
  const canMcp = profile.permissoes.includes("mcp.administrar");
  const canCost = profile.permissoes.some((item) => item.startsWith("custos.consultar"));
  const canMemory = profile.permissoes.some((item) =>
    item === "memoria.auditar" || item.startsWith("memoria.revisar") || item === "memoria.administrar");
  const canKnowledge = profile.permissoes.some((item) => item.startsWith("documentacao."));
  const canGlobalKnowledge = profile.permissoes.includes("documentacao.administrar.global");
  const [tab, setTab] = useState(canCost ? "overview" : canAudit ? "audit" : canMcp ? "mcp" : "people");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [people, setPeople] = useState<Principal[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [lake, setLake] = useState<Record<string, any> | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpLabCode, setMcpLabCode] = useState("LAB-001");
  const [mcpLabResult, setMcpLabResult] = useState<Record<string, any> | null>(null);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeDocument[]>([]);
  const [knowledgeEdit, setKnowledgeEdit] = useState<KnowledgeEdit | null>(null);
  const [knowledgeView, setKnowledgeView] = useState<"review" | "draft" | "published" | "all">("review");
  const [knowledgeSearch, setKnowledgeSearch] = useState("");
  const [knowledgeSectorId, setKnowledgeSectorId] = useState(profile.setores[0]?.id || "global");
  const [knowledgeCreateOpen, setKnowledgeCreateOpen] = useState(false);
  const [knowledgeImportOpen, setKnowledgeImportOpen] = useState(false);
  const [knowledgeCreateScope, setKnowledgeCreateScope] = useState("setor");
  const [knowledgeImportScope, setKnowledgeImportScope] = useState("setor");
  const [knowledgeDestination, setKnowledgeDestination] = useState({ scope: "setor", departmentId: "" });
  const [knowledgeReviewReasons, setKnowledgeReviewReasons] = useState<Record<string, string>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState(profile.setores[0]?.slug || "");
  const [loading, setLoading] = useState(true);
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const knowledgeEditorRef = useRef<HTMLFormElement | null>(null);

  const knowledgeDepartments = useMemo(() => {
    const source = canGlobalKnowledge && departments.length ? departments : profile.setores;
    return source.map((item) => ({ ...item, nome: item.nome || item.name || item.slug }));
  }, [canGlobalKnowledge, departments, profile.setores]);

  const tabs = useMemo(() => [
    canCost && ["overview", "Visão executiva"],
    isAdmin && ["people", "Pessoas e acessos"],
    isAdmin && ["departments", "Setores"],
    canMemory && ["memory", "Aprendizados"],
    canKnowledge && ["knowledge", "Base de conhecimento"],
    canPilot && ["pilot", "Problemas do piloto"],
    canAudit && ["audit", "Auditoria"],
    canMcp && ["mcp", "Conectores MCP"],
    isAdmin && ["lake", "Lake"]
  ].filter(Boolean) as string[][], [canCost, isAdmin, canAudit, canMemory, canKnowledge, canPilot, canMcp]);

  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      setError(null);
      if (tab === "overview") setUsage(await nexusFetch<Usage>(
        `admin/usage${selectedSector && !profile.permissoes.includes("custos.consultar.global") ? `?setor=${selectedSector}` : ""}`
      ));
      if (tab === "people") {
        const [p, d, r] = await Promise.all([
          nexusFetch<Principal[]>("admin/principals"),
          nexusFetch<Department[]>("admin/departments"),
          nexusFetch<Role[]>("admin/roles")
        ]); setPeople(p); setDepartments(d); setRoles(r);
      }
      if (tab === "departments") setDepartments(await nexusFetch<Department[]>("admin/departments"));
      if (tab === "memory") setMemoryCandidates(await nexusFetch<MemoryCandidate[]>(
        "admin/memory-candidates?status=pending_review"
      ));
      if (tab === "knowledge") {
        const setor = knowledgeSectorId === "global" ? "" : knowledgeSectorId;
        const [documentos, setores] = await Promise.all([
          nexusFetch<KnowledgeDocument[]>(`knowledge?status=all${setor ? `&departmentId=${setor}` : ""}`),
          canGlobalKnowledge && !departments.length
            ? nexusFetch<Department[]>("admin/departments") : Promise.resolve(null)
        ]);
        setKnowledge(documentos);
        if (setores) setDepartments(setores.filter((item) => item.ativo !== false));
      }
      if (tab === "mcp") setMcpServers(await nexusFetch<McpServer[]>("admin/mcp/servers"));
      if (tab === "lake") setLake(await nexusFetch("admin/lake"));
    } catch (cause) {
      if (sequence === loadSequence.current) {
        setError(cause instanceof Error ? cause.message : "Falha ao carregar painel.");
      }
    } finally {
      if (sequence === loadSequence.current) {
        setLoading(false);
        setLoadedTabs((current) => new Set(current).add(tab));
      }
    }
  }
  useEffect(() => { load(); }, [tab, selectedSector, knowledgeSectorId]);

  useEffect(() => {
    if (knowledgeEdit) requestAnimationFrame(() => knowledgeEditorRef.current?.scrollIntoView({
      behavior: "smooth", block: "start"
    }));
  }, [knowledgeEdit]);

  async function runAction(key: string, action: () => Promise<void>) {
    if (pendingAction) return;
    setPendingAction(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação.");
    } finally {
      setPendingAction(null);
    }
  }

  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    await runAction("create-person", async () => {
      await nexusFetch("admin/principals", { method: "POST",
        body: JSON.stringify({ name: form.get("name"), email: form.get("email") }) });
      element.reset();
    });
  }

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    await runAction("create-department", async () => {
      await nexusFetch("admin/departments", { method: "POST",
        body: JSON.stringify({ name: form.get("name"), slug: form.get("slug") }) });
      element.reset();
    });
  }

  async function saveAssignments(person: Principal, form: HTMLFormElement) {
    const data = new FormData(form);
    const departmentIds = data.getAll("departments").map(String);
    const role = String(data.get("role") || "usuario");
    const global = data.get("global") === "on";
    const assignments = global ? [{ role, departmentId: null }]
      : departmentIds.map((departmentId) => ({ role, departmentId }));
    await runAction(`assignments-${person.id}`, async () => {
      await nexusFetch(`admin/principals/${person.id}/assignments`, {
        method: "PUT", body: JSON.stringify({ departmentIds, assignments })
      });
    });
  }

  async function reviewMemory(candidate: MemoryCandidate, decision: "approve" | "reject") {
    const reason = String(reviewReasons[candidate.id] || "").trim();
    if (!reason) {
      setError("Informe o motivo da decisão antes de revisar o aprendizado.");
      return;
    }
    await runAction(`memory-${candidate.id}`, async () => {
      await nexusFetch(`admin/memory-candidates/${candidate.id}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, reason })
      });
      setReviewReasons((current) => ({ ...current, [candidate.id]: "" }));
    });
  }

  async function createKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const departmentId = String(form.get("departmentId") || "");
    const scope = String(form.get("scope") || "setor");
    const lines = (name: string) => String(form.get(name) || "").split("\n").map((item) => item.trim()).filter(Boolean);
    const steps = parseKnowledgeSteps(form.get("steps"));
    await runAction("create-knowledge", async () => {
      await nexusFetch("knowledge", { method: "POST", body: JSON.stringify({
        titulo: form.get("title"), tipo: form.get("type"), escopo: scope,
        departmentId: scope === "setor" ? departmentId : null,
        resumo: form.get("summary"), conteudo: {
          objetivo: form.get("objective"), publico: form.get("audience"),
          preRequisitos: lines("prerequisites"),
          passos: steps,
          alertas: lines("warnings"), referencias: []
        }
      }) });
      element.reset();
      setKnowledgeCreateOpen(false);
    });
  }

  async function knowledgeAction(item: KnowledgeDocument, action: "submit" | "publish" | "request-changes") {
    const reason = String(knowledgeReviewReasons[item.id] || "").trim();
    if (action === "request-changes" && reason.length < 5) {
      setError("Informe o motivo dos ajustes antes de devolver o documento.");
      return;
    }
    const departmentId = item.escopo === "global"
      ? null
      : item.department_id || profile.setores[0]?.id || null;
    await runAction(`knowledge-${action}-${item.id}`, async () => {
      await nexusFetch(`knowledge/${item.id}/${action}`, { method: "POST", body: JSON.stringify({
        departmentId,
        justificativa: action === "publish" ? reason || "Publicacao aprovada pelo responsavel no Hub" : undefined,
        motivo: action === "request-changes" ? reason : undefined
      }) });
      setKnowledgeReviewReasons((current) => ({ ...current, [item.id]: "" }));
    });
  }

  async function openKnowledgeEdit(item: KnowledgeDocument) {
    setPendingAction(`knowledge-open-${item.id}`);
    try {
      const departmentId = item.escopo === "global"
        ? ""
        : item.department_id || profile.setores[0]?.id || "";
      const detail = await nexusFetch<{ documento: KnowledgeDocument; edicao: KnowledgeEdit["version"];
        versoes: KnowledgeEdit["versions"] }>(
        `knowledge/${item.id}${departmentId ? `?departmentId=${departmentId}` : ""}`
      );
      setKnowledgeEdit({ document: item, version: detail.edicao, versions: detail.versoes || [] });
      setKnowledgeDestination({
        scope: detail.documento.escopo === "global" ? "global" : "setor",
        departmentId: detail.documento.department_id || knowledgeDepartments[0]?.id || ""
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível abrir o documento.");
    } finally { setPendingAction(null); }
  }

  async function saveKnowledgeEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!knowledgeEdit) return;
    const form = new FormData(event.currentTarget);
    const lines = (name: string) => String(form.get(name) || "").split("\n").map((item) => item.trim()).filter(Boolean);
    const steps = parseKnowledgeSteps(form.get("steps"));
    await runAction(`knowledge-save-${knowledgeEdit.document.id}`, async () => {
      const departmentId = knowledgeEdit.document.escopo === "global"
        ? null
        : knowledgeEdit.document.department_id || profile.setores[0]?.id || null;
      await nexusFetch(`knowledge/${knowledgeEdit.document.id}`, { method: "PATCH", body: JSON.stringify({
        departmentId,
        titulo: form.get("title"), resumo: form.get("summary"), conteudo: {
          objetivo: form.get("objective"), publico: form.get("audience"),
          preRequisitos: lines("prerequisites"),
          passos: steps,
          alertas: lines("warnings"), referencias: []
        }
      }) });
      setKnowledgeEdit(null);
    });
  }

  async function moveKnowledgeDocument() {
    if (!knowledgeEdit || !canGlobalKnowledge) return;
    if (knowledgeDestination.scope === "setor" && !knowledgeDestination.departmentId) {
      setError("Selecione o setor de destino.");
      return;
    }
    await runAction(`knowledge-move-${knowledgeEdit.document.id}`, async () => {
      await nexusFetch(`knowledge/${knowledgeEdit.document.id}/move`, {
        method: "POST",
        body: JSON.stringify({
          escopo: knowledgeDestination.scope,
          departmentId: knowledgeDestination.scope === "setor" ? knowledgeDestination.departmentId : null
        })
      });
      setKnowledgeEdit(null);
    });
  }

  const knowledgeCounts = useMemo(() => knowledge.reduce((counts, item) => {
    const status = item.pending_status || item.status;
    if (status === "em_revisao") counts.review += 1;
    if (status === "rascunho") counts.draft += 1;
    if (item.status === "publicado") counts.published += 1;
    counts.all += 1;
    return counts;
  }, { review: 0, draft: 0, published: 0, all: 0 }), [knowledge]);

  const visibleKnowledge = useMemo(() => {
    const query = knowledgeSearch.trim().toLocaleLowerCase("pt-BR");
    return knowledge.filter((item) => {
      const status = item.pending_status || item.status;
      const matchesView = knowledgeView === "all" || knowledgeView === "review" && status === "em_revisao" ||
        knowledgeView === "draft" && status === "rascunho" ||
        knowledgeView === "published" && item.status === "publicado";
      const matchesSearch = !query || [item.titulo, item.tipo, item.setor, item.status, item.pending_status]
        .some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(query));
      return matchesView && matchesSearch;
    });
  }, [knowledge, knowledgeSearch, knowledgeView]);

  return <main className="admin-layout">
    <aside className="admin-nav"><NexusLogo /><button className="back-chat" onClick={() => router.push("/")}>← Voltar ao chat</button>
      <p className="nav-label">ADMINISTRAÇÃO</p>{tabs.map(([value, label]) =>
        <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}
      <div className="profile-mini"><span>{profile.nome.slice(0, 1)}</span><div><strong>{profile.nome}</strong><small>{profile.email}</small></div></div>
    </aside>
    <section className="admin-content"><header><div><p className="eyebrow">CONTROLE OPERACIONAL</p>
      <h1>{tabs.find(([value]) => value === tab)?.[1]}</h1></div><button className="secondary-button" onClick={() => runAction("refresh", async () => {})}
        disabled={Boolean(pendingAction)} aria-busy={pendingAction === "refresh"}>
        {pendingAction === "refresh" ? "Atualizando…" : "Atualizar"}</button></header>
      {error && <div className="error-banner">{error}</div>}
      {loading && loadedTabs.has(tab) && <div className="admin-refresh-progress" role="status">
        <i /> Atualizando informações…
      </div>}

      {loading && !loadedTabs.has(tab) ? <AdminLoading /> : <>

      {tab === "overview" && usage && <>
        {!profile.permissoes.includes("custos.consultar.global") && <label className="filter-field">Setor
          <select value={selectedSector} onChange={(e) => setSelectedSector(e.target.value)}>{profile.setores.map((item) =>
            <option key={item.id} value={item.slug}>{item.nome}</option>)}</select></label>}
        <div className="metric-grid">
          <Metric label="Turnos" value={usage.resumo.turnos} />
          <Metric label="Chamadas LLM" value={usage.resumo.chamadas_llm} />
          <Metric label="Custo USD" value={money(usage.resumo.custo_usd, "USD")} />
          <Metric label="Custo BRL" value={money(usage.resumo.custo_brl, "BRL")} />
          <Metric label="Tokens de entrada" value={usage.resumo.input_tokens} />
          <Metric label="Erros" value={usage.resumo.erros} />
        </div>
        <DataTable title="Consumo por modelo" rows={usage.porModelo} />
        <DataTable title="Pesquisa e processamento de imagens" rows={usage.porServico || []} />
        <DataTable title="Consumo por setor e usuário" rows={usage.porAtribuicao} />
        <DataTable title="Consumo por nível semântico" rows={usage.porFaixa} />
      </>}

      {tab === "people" && <><form className="inline-form glass-panel" onSubmit={createPerson}>
        <div><h2>Pré-cadastrar colaborador</h2><p>O vínculo Microsoft será feito no primeiro login.</p></div>
        <input name="name" placeholder="Nome completo" required /><input name="email" type="email" placeholder="E-mail corporativo" required />
        <button className="primary-button" disabled={Boolean(pendingAction)} aria-busy={pendingAction === "create-person"}>
          {pendingAction === "create-person" ? "Cadastrando…" : "Cadastrar"}</button></form>
        <div className="admin-list">{people.map((person) => <article className="person-card glass-panel" key={person.id}>
          <div className="person-heading"><span className="avatar">{person.nome[0]}</span><div><strong>{person.nome}</strong><small>{person.email}</small></div>
            <button className={person.ativo ? "status-active" : "status-inactive"}
              disabled={Boolean(pendingAction)} aria-busy={pendingAction === `status-${person.id}`}
              onClick={() => runAction(`status-${person.id}`, async () => {
                await nexusFetch(`admin/principals/${person.id}`, {
                  method: "PATCH", body: JSON.stringify({ active: !person.ativo })
                });
              })}>{pendingAction === `status-${person.id}`
                ? (person.ativo ? "Desativando…" : "Ativando…")
                : (person.ativo ? "Ativo" : "Inativo")}</button></div>
          <form className="assignment-form" onSubmit={(e) => { e.preventDefault(); saveAssignments(person, e.currentTarget); }}>
            <div className="assignment-departments"><span className="field-label">Setores com acesso</span>
              <div className="department-options">{departments.filter((d) => d.ativo !== false).map((d) =>
                <label className="department-option" key={d.id}>
                  <input type="checkbox" name="departments" value={d.id}
                    defaultChecked={person.setores.some((setor) => setor.id === d.id)} />
                  <span><strong>{d.nome}</strong><small>{d.slug}</small></span>
                </label>)}</div>
            </div>
            <label>Papel<select name="role" defaultValue={person.atribuicoes[0]?.papel || "usuario"}>{roles.map((role) =>
              <option key={role.id} value={role.slug}>{role.nome}</option>)}</select></label>
            <label className="checkbox scope-toggle"><input type="checkbox" name="global" defaultChecked={person.atribuicoes.some((a) => !a.departmentId)} />
              <span><strong>Papel global</strong><small>Permissões válidas em todos os setores associados</small></span></label>
            <button className="secondary-button" disabled={Boolean(pendingAction)}
              aria-busy={pendingAction === `assignments-${person.id}`}>
              {pendingAction === `assignments-${person.id}` ? "Salvando…" : "Salvar acessos"}</button>
          </form></article>)}</div></>}

      {tab === "departments" && <><form className="inline-form glass-panel" onSubmit={createDepartment}>
        <div><h2>Novo setor</h2><p>Setores delimitam contexto, permissões e custos.</p></div>
        <input name="name" placeholder="Nome" required /><input name="slug" placeholder="Identificador opcional" />
        <button className="primary-button" disabled={Boolean(pendingAction)} aria-busy={pendingAction === "create-department"}>
          {pendingAction === "create-department" ? "Cadastrando…" : "Cadastrar"}</button></form>
        <div className="department-grid">{departments.map((department) => <article className="glass-panel" key={department.id}>
          <span className="department-icon">◇</span><div><strong>{department.nome}</strong><small>{department.slug}</small></div>
          <button className="secondary-button" disabled={Boolean(pendingAction)}
            aria-busy={pendingAction === `department-${department.id}`}
            onClick={() => runAction(`department-${department.id}`, async () => {
              await nexusFetch(`admin/departments/${department.id}`, {
                method: "PATCH", body: JSON.stringify({ active: false })
              });
            })}>{pendingAction === `department-${department.id}` ? "Desativando…" : "Desativar"}</button></article>)}</div></>}

      {tab === "memory" && <section className="memory-review-list">
        <div className="memory-review-intro glass-panel"><div><h2>Aprendizados aguardando revisão</h2>
          <p>Nenhuma sugestão altera o comportamento do Nexus antes de uma aprovação autorizada.</p></div>
          <span>{memoryCandidates.length} pendente{memoryCandidates.length === 1 ? "" : "s"}</span></div>
        {memoryCandidates.map((candidate) => <article className="memory-review-card glass-panel" key={candidate.id}>
          <div className="memory-review-meta"><span>{candidate.tipo.replaceAll("_", " ")}</span>
            <span>Escopo: {candidate.escopo}</span>
            {candidate.confianca != null && <span>Confiança: {Math.round(candidate.confianca * 100)}%</span>}</div>
          <h3>{candidate.declaracao}</h3>
          {candidate.justificativa && <p>{candidate.justificativa}</p>}
          {!!candidate.gatilhos?.length && <small>Gatilhos: {candidate.gatilhos.join(", ")}</small>}
          <textarea value={reviewReasons[candidate.id] || ""}
            onChange={(event) => setReviewReasons((current) => ({ ...current, [candidate.id]: event.target.value }))}
            placeholder="Motivo obrigatório da aprovação ou rejeição" rows={2} />
          <div className="memory-review-actions">
            <button className="primary-button" disabled={Boolean(pendingAction)}
              onClick={() => reviewMemory(candidate, "approve")}>Aprovar</button>
            <button className="secondary-button" disabled={Boolean(pendingAction)}
              onClick={() => reviewMemory(candidate, "reject")}>Rejeitar</button>
          </div>
        </article>)}
        {!memoryCandidates.length && !loading && <div className="empty-admin glass-panel">
          Nenhuma candidatura confirmada aguarda revisão.</div>}
      </section>}

      {tab === "knowledge" && <section className="knowledge-admin">
        <div className="knowledge-toolbar glass-panel">
          <div className="knowledge-toolbar-heading"><div><p className="eyebrow">GESTÃO DOCUMENTAL</p>
            <h2>Procedimentos, políticas e manuais</h2>
            <p>Revise primeiro o conteúdo importado. Somente versões publicadas ficam disponíveis no chat.</p></div>
            <div className="knowledge-toolbar-actions">
              <button className={knowledgeCreateOpen ? "primary-button" : "secondary-button"}
                onClick={() => setKnowledgeCreateOpen((value) => !value)}>＋ Novo conteúdo</button>
              <button className={knowledgeImportOpen ? "primary-button" : "secondary-button"}
                onClick={() => setKnowledgeImportOpen((value) => !value)}>Importar arquivo</button>
            </div></div>
          <div className="knowledge-filters">
            <label>Setor administrado<select value={knowledgeSectorId}
              onChange={(event) => { setKnowledgeSectorId(event.target.value); setKnowledgeEdit(null); }}>
              {canGlobalKnowledge && <option value="global">Políticas e manuais globais</option>}
              {knowledgeDepartments.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
            </select></label>
            <label>Localizar documento<input value={knowledgeSearch}
              onChange={(event) => setKnowledgeSearch(event.target.value)}
              placeholder="Digite título, tipo ou setor" /></label>
          </div>
          <div className="knowledge-view-tabs" role="tablist" aria-label="Situação dos documentos">
            {([['review', 'Aguardando aprovação', knowledgeCounts.review], ['draft', 'Rascunhos', knowledgeCounts.draft],
              ['published', 'Publicados', knowledgeCounts.published], ['all', 'Todos', knowledgeCounts.all]] as const)
              .map(([value, label, count]) => <button key={value} role="tab" aria-selected={knowledgeView === value}
                className={knowledgeView === value ? "active" : ""} onClick={() => setKnowledgeView(value)}>
                <span>{label}</span><strong>{count}</strong></button>)}</div>
        </div>

        {knowledgeEdit && <form ref={knowledgeEditorRef} className="knowledge-form knowledge-edit glass-panel" onSubmit={saveKnowledgeEdit}>
          <div className="knowledge-edit-heading"><div><p className="eyebrow">EDIÇÃO VERSIONADA</p>
            <h2>{knowledgeEdit.document.titulo}</h2><div className="knowledge-tags">
              <span>{knowledgeEdit.document.escopo === "global" ? "Global" : knowledgeEdit.document.setor}</span>
              <span>{knowledgeEdit.version.status?.replaceAll("_", " ")}</span>
              {knowledgeEdit.version.numero && <span>Versão {knowledgeEdit.version.numero}</span>}</div>
            <p>A versão publicada continua respondendo até esta edição ser aprovada.</p></div>
            <button type="button" className="secondary-button" onClick={() => setKnowledgeEdit(null)}>Fechar</button></div>
          <div className="knowledge-editor-grid"><div className="knowledge-editor-fields">
            {canGlobalKnowledge && <fieldset className="knowledge-destination">
              <legend>Destino e acesso do documento</legend>
              <div><label>Escopo<select value={knowledgeDestination.scope}
                onChange={(event) => setKnowledgeDestination((current) => ({ ...current, scope: event.target.value }))}>
                <option value="setor">Restrito a um setor</option>
                <option value="global">Global</option>
              </select></label>
              <label>Setor responsável<select value={knowledgeDestination.departmentId}
                disabled={knowledgeDestination.scope === "global"}
                onChange={(event) => setKnowledgeDestination((current) => ({ ...current, departmentId: event.target.value }))}>
                {knowledgeDepartments.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}
              </select></label>
              <button type="button" className="secondary-button" disabled={Boolean(pendingAction) ||
                (knowledgeDestination.scope === knowledgeEdit.document.escopo &&
                  (knowledgeDestination.scope === "global" || knowledgeDestination.departmentId === knowledgeEdit.document.department_id))}
                onClick={moveKnowledgeDocument}>
                {pendingAction?.startsWith("knowledge-move-") ? "Alterando…" : "Alterar destino"}
              </button></div>
              <small>Administradores podem mover o documento sem apagar versões. O acesso muda imediatamente e fica registrado na auditoria.</small>
            </fieldset>}
            <label>Título<input name="title" required defaultValue={knowledgeEdit.version.titulo} /></label>
            <label>Resumo<input name="summary" defaultValue={knowledgeEdit.version.resumo || ""} /></label>
            <label>Objetivo e conteúdo principal<textarea name="objective" rows={8}
              defaultValue={knowledgeEdit.version.conteudo_estruturado?.objetivo || ""} /></label>
            <label>Público<input name="audience" defaultValue={knowledgeEdit.version.conteudo_estruturado?.publico || ""} /></label>
            <label>Pré-requisitos <small>Um por linha</small><textarea name="prerequisites" rows={3}
              defaultValue={(knowledgeEdit.version.conteudo_estruturado?.preRequisitos || []).join("\n")} /></label>
            <label>Passos <small>Cole livremente ou use “Título: descrição”, um passo por linha</small><textarea name="steps" rows={7}
              defaultValue={(knowledgeEdit.version.conteudo_estruturado?.passos || [])
                .map((item) => item.descricao ? `${item.titulo}: ${item.descricao}` : item.titulo || "").join("\n")} /></label>
            <label>Alertas <small>Um por linha</small><textarea name="warnings" rows={3}
              defaultValue={(knowledgeEdit.version.conteudo_estruturado?.alertas || []).join("\n")} /></label>
            {Boolean(knowledgeEdit.version.texto_extraido) && <details className="knowledge-extracted-source">
              <summary>Texto original extraído da fonte</summary>
              <p>Referência somente para revisão. Organize o conteúdo nos campos acima; o texto original não será colocado inteiro no campo Objetivo.</p>
              <div>{(knowledgeEdit.version.paginas_extraidas?.length
                ? knowledgeEdit.version.paginas_extraidas
                : [{ numero: 1, texto: knowledgeEdit.version.texto_extraido || "" }]).map((page) =>
                <section key={page.numero}><strong>Página {page.numero}</strong>
                  <pre>{page.texto}</pre></section>)}</div>
            </details>}
          </div><aside className="knowledge-version-history"><strong>Histórico de versões</strong>
            {knowledgeEdit.versions.map((version) => <div key={version.id}><span>v{version.numero}</span>
              <p>{version.status.replaceAll("_", " ")}</p>
              <small>{version.publicado_em ? new Date(version.publicado_em).toLocaleDateString("pt-BR") : "Não publicada"}</small></div>)}
          </aside></div>
          <div className="knowledge-editor-actions"><button type="button" className="secondary-button"
            onClick={() => setKnowledgeEdit(null)}>Cancelar</button>
            <button className="primary-button" disabled={Boolean(pendingAction)}>
              {pendingAction?.startsWith("knowledge-save-") ? "Salvando…" : "Salvar nova versão"}</button></div>
        </form>}

        <div className="knowledge-list-heading"><div><p className="eyebrow">DOCUMENTOS DO ESCOPO</p>
          <h2>{knowledgeView === "review" ? "Fila de aprovação" : knowledgeView === "draft" ? "Rascunhos em elaboração" :
            knowledgeView === "published" ? "Conteúdo publicado" : "Todos os documentos"}</h2></div>
          <span>{visibleKnowledge.length} exibido{visibleKnowledge.length === 1 ? "" : "s"}</span></div>
        <div className="knowledge-list">{visibleKnowledge.map((item) => {
          const effectiveStatus = item.pending_status || item.status;
          const inReview = effectiveStatus === "em_revisao";
          return <article className={`knowledge-card glass-panel ${inReview ? "review" : ""}`} key={item.id}>
            <div className="knowledge-card-main"><div className="knowledge-tags"><span>{item.tipo}</span>
              <span>{item.escopo === "global" ? "Global" : item.setor || "Setor não informado"}</span>
              <span className={`knowledge-status ${effectiveStatus}`}>{effectiveStatus.replaceAll("_", " ")}</span>
              {item.status === "publicado" && item.pending_status && <span>Publicada + alteração pendente</span>}</div>
              <h3>{item.titulo}</h3><small>{item.versao ? `Versão publicada ${item.versao}` : "Ainda sem versão publicada"}
                {item.atualizado_em ? ` · Atualizado em ${new Date(item.atualizado_em).toLocaleDateString("pt-BR")}` : ""}</small></div>
            {inReview && <label className="knowledge-review-note">Comentário da revisão
              <textarea rows={2} value={knowledgeReviewReasons[item.id] || ""}
                onChange={(event) => setKnowledgeReviewReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                placeholder="Opcional ao aprovar; obrigatório para pedir ajustes" /></label>}
            <div className="knowledge-actions">
              <button className="secondary-button" disabled={Boolean(pendingAction)}
                onClick={() => openKnowledgeEdit(item)}>{pendingAction === `knowledge-open-${item.id}` ? "Abrindo…" : "Ver e editar"}</button>
              {effectiveStatus === "rascunho" && <button className="secondary-button" disabled={Boolean(pendingAction)}
                onClick={() => knowledgeAction(item, "submit")}>Enviar para aprovação</button>}
              {inReview && <><button className="secondary-button danger-outline" disabled={Boolean(pendingAction)}
                onClick={() => knowledgeAction(item, "request-changes")}>Pedir ajustes</button>
                <button className="primary-button" disabled={Boolean(pendingAction)}
                  onClick={() => knowledgeAction(item, "publish")}>Aprovar e publicar</button></>}
              {item.status === "publicado" && <><a href={`/api/nexus/knowledge/${item.id}/download/pdf?departmentId=${item.department_id || ""}`}>Baixar PDF</a>
                <a href={`/api/nexus/knowledge/${item.id}/download/docx?departmentId=${item.department_id || ""}`}>Baixar DOCX</a></>}
            </div>
          </article>;
        })}</div>
        {!visibleKnowledge.length && !loading && <div className="empty-admin glass-panel">
          Nenhum documento corresponde a este setor, situação e pesquisa.</div>}

        {(knowledgeCreateOpen || knowledgeImportOpen) && <div className="knowledge-compose-grid">
          {knowledgeCreateOpen &&
          <form className="knowledge-form glass-panel" onSubmit={createKnowledge}>
            <div><p className="eyebrow">NOVO CONTEÚDO</p><h2>Criar procedimento estruturado</h2>
              <p>O conteúdo nasce como rascunho e só entra nas respostas depois da publicação.</p></div>
            <label>Título<input name="title" required maxLength={240} /></label>
            <div className="knowledge-form-row"><label>Tipo<select name="type"><option value="procedimento">Procedimento</option>
              <option value="politica">Política</option><option value="manual">Manual</option></select></label>
              <label>Escopo<select name="scope" value={knowledgeCreateScope} onChange={(event) => setKnowledgeCreateScope(event.target.value)}><option value="setor">Setor</option>
                {canGlobalKnowledge && <option value="global">Global</option>}</select></label>
              <label>Setor<select name="departmentId" defaultValue={knowledgeSectorId === "global" ? knowledgeDepartments[0]?.id : knowledgeSectorId}
                disabled={knowledgeCreateScope === "global"}>{knowledgeDepartments.map((item) =>
                <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label></div>
            <label>Resumo<input name="summary" /></label>
            <label>Objetivo<textarea name="objective" rows={3} required /></label>
            <label>Público<input name="audience" placeholder="Quem deve seguir este conteúdo" /></label>
            <label>Pré-requisitos <small>Um por linha</small><textarea name="prerequisites" rows={3} /></label>
            <label>Passos <small>Cole livremente ou use “Título: descrição”, um passo por linha</small><textarea name="steps" rows={6} required /></label>
            <label>Alertas <small>Um por linha</small><textarea name="warnings" rows={3} /></label>
            <button className="primary-button" disabled={Boolean(pendingAction)}>
              {pendingAction === "create-knowledge" ? "Criando…" : "Criar rascunho"}</button>
          </form>}
          {knowledgeImportOpen &&
          <KnowledgeImportBoundary onClose={() => setKnowledgeImportOpen(false)}>
            <KnowledgeImportForm canGlobalKnowledge={canGlobalKnowledge} departments={knowledgeDepartments}
              defaultDepartmentId={knowledgeSectorId === "global" ? knowledgeDepartments[0]?.id || "" : knowledgeSectorId}
              scope={knowledgeImportScope} onScopeChange={setKnowledgeImportScope}
              onUpload={async (form) => {
                setPendingAction("import-knowledge");
                setError(null);
                try {
                  await nexusFetch("admin/knowledge/import", { method: "POST", body: new FormData(form) });
                  await load();
                } finally {
                  setPendingAction(null);
                }
              }}
              onSuccess={() => setKnowledgeImportOpen(false)} />
          </KnowledgeImportBoundary>}
        </div>}
      </section>}

      {tab === "audit" && <AuditPanel />}
      {tab === "pilot" && <PilotReportsPanel />}
      {tab === "mcp" && <section className="mcp-admin">
        <div className="section-heading"><div><h2>Conectores MCP</h2>
          <p>Catálogo governado. Endpoints, tools e permissões vêm da allowlist versionada.</p></div></div>
        {!mcpServers.length && !loading && <div className="glass-panel empty-admin">
          Nenhum servidor do manifesto está configurado neste ambiente.
        </div>}
        <div className="mcp-server-list">{mcpServers.map((server) => <article
          className="glass-panel mcp-server-card" key={server.id}>
          <header><div><h3>{server.nome}</h3><p>{server.descricao}</p></div>
            <span className={`status-pill status-${server.status}`}>{server.status}</span></header>
          <div className="mcp-facts">
            <span><strong>Transporte</strong>{server.transport}</span>
            <span><strong>Rede</strong>{server.network_scope}</span>
            <span><strong>Protocolo</strong>{server.observed_protocol_version || "Não verificado"}</span>
            <span><strong>Versão</strong>{server.observed_server_version || "Não verificada"}</span>
            <span><strong>Última verificação</strong>{server.last_checked_at
              ? new Date(server.last_checked_at).toLocaleString("pt-BR") : "Nunca"}</span>
            <span><strong>Erro</strong>{server.last_error_code || "—"}</span>
          </div>
          <div className="button-row">
            <button className="secondary-button" disabled={Boolean(pendingAction)}
              onClick={() => runAction(`mcp-check-${server.id}`, async () => {
                await nexusFetch(`admin/mcp/servers/${server.id}/check`, { method: "POST" });
              })}>{pendingAction === `mcp-check-${server.id}` ? "Verificando…" : "Verificar"}</button>
            <button className="secondary-button" disabled={Boolean(pendingAction)}
              onClick={() => runAction(`mcp-server-${server.id}`, async () => {
                await nexusFetch(`admin/mcp/servers/${server.id}`, {
                  method: "PATCH", body: JSON.stringify({ enabled: !server.enabled })
                });
              })}>{server.enabled ? "Desabilitar servidor" : "Habilitar servidor"}</button>
          </div>
          <div className="mcp-tool-list">{server.tools.map((tool) => <div className="mcp-tool" key={tool.id}>
            <div><strong>{tool.nexus_tool_name}</strong><small>{tool.description}</small>
              <small>{tool.permission_code} · {tool.exposure} · {tool.status}</small>
              <code title={`Entrada aprovada: ${tool.input_schema_hash}\nEntrada observada: ${tool.observed_input_schema_hash || "—"}\nSaída aprovada: ${tool.output_schema_hash || "—"}\nSaída observada: ${tool.observed_output_schema_hash || "—"}`}>
                entrada {tool.input_schema_hash.slice(0, 12)}… · saída {tool.output_schema_hash?.slice(0, 12) || "—"}…
              </code></div>
            <button className="secondary-button" disabled={Boolean(pendingAction) ||
              (!tool.enabled && tool.status !== "approved")}
              onClick={() => runAction(`mcp-tool-${tool.id}`, async () => {
                await nexusFetch(`admin/mcp/servers/${server.id}/tools/${encodeURIComponent(tool.remote_tool_name)}`, {
                  method: "PATCH", body: JSON.stringify({ enabled: !tool.enabled })
                });
              })}>{tool.enabled ? "Desabilitar" : "Habilitar"}</button>
          </div>)}</div>
        </article>)}</div>
        <article className="glass-panel mcp-lab-panel"><div><h3>Laboratório MCP</h3>
          <p>Consulta determinística, sem banco, arquivos ou internet. O teste percorre autorização e auditoria reais.</p></div>
          <div className="inline-form"><label>Código<select value={mcpLabCode}
            onChange={(event) => setMcpLabCode(event.target.value)}>
            <option>LAB-001</option><option>LAB-002</option><option>LAB-003</option>
          </select></label><button className="primary-button" disabled={Boolean(pendingAction) ||
            !mcpServers.some((server) => server.server_key === "laboratorio" && server.enabled &&
              server.tools.some((tool) => tool.enabled && tool.status === "approved"))}
            onClick={() => runAction("mcp-lab", async () => {
              const result = await nexusFetch<Record<string, any>>("admin/mcp/lab/run", {
                method: "POST", body: JSON.stringify({ codigo: mcpLabCode })
              });
              setMcpLabResult(result);
            })}>{pendingAction === "mcp-lab" ? "Executando…" : "Executar teste"}</button></div>
          {mcpLabResult && <pre className="mcp-lab-result">{JSON.stringify(mcpLabResult, null, 2)}</pre>}
        </article>
      </section>}
      {tab === "lake" && lake && <><div className="metric-grid">
        <Metric label="Estado" value={lake.health?.saudavel ? "Saudável" : "Indisponível"} />
        <Metric label="Bronze" value={lake.health?.camadas?.bronze || 0} />
        <Metric label="Silver" value={lake.health?.camadas?.silver || 0} />
        <Metric label="Gold" value={lake.health?.camadas?.gold || 0} />
      </div><DataTable title="Atualizações recentes" rows={lake.events || []} /></>}
      </>}
    </section>
  </main>;
}

function PilotReportsPanel() {
  const emptyList: PilotReportList = { summary: {}, items: [], nextCursor: null,
    facets: { categories: [], statuses: [], users: [], departments: [] } };
  const [data, setData] = useState<PilotReportList>(emptyList);
  const [detail, setDetail] = useState<PilotReportDetail | null>(null);
  const [filters, setFilters] = useState({ from: "", to: "", departmentId: "",
    principalId: "", category: "", status: "", traceId: "" });
  const [applied, setApplied] = useState(filters);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<PilotReportItem["status"]>("new");
  const [internalNote, setInternalNote] = useState("");

  function query(extra: Record<string, string> = {}) {
    const params = new URLSearchParams();
    Object.entries(applied).forEach(([key, value]) => value && params.set(key, value));
    Object.entries(extra).forEach(([key, value]) => value && params.set(key, value));
    const text = params.toString();
    return text ? `?${text}` : "";
  }

  async function load() {
    setLoading(true); setError(null); setDetail(null);
    try { setData(await nexusFetch<PilotReportList>(`admin/pilot-reports${query()}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar os reportes."); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [applied]);
  useEffect(() => {
    if (!detail) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) setDetail(null); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [detail, saving]);

  async function loadMore() {
    if (!data.nextCursor) return;
    try {
      const next = await nexusFetch<PilotReportList>(`admin/pilot-reports${query({ cursor: data.nextCursor })}`);
      setData((current) => ({ ...current, items: [...current.items, ...next.items], nextCursor: next.nextCursor }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar mais reportes."); }
  }

  async function openReport(id: string) {
    setDetailLoading(id); setError(null);
    try {
      const item = await nexusFetch<PilotReportDetail>(`admin/pilot-reports/${id}`);
      setDetail(item); setReviewStatus(item.status); setInternalNote(item.internal_note || "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao abrir o reporte."); }
    finally { setDetailLoading(null); }
  }

  async function saveReview() {
    if (!detail || saving) return;
    setSaving(true); setError(null);
    try {
      await nexusFetch(`admin/pilot-reports/${detail.id}`, {
        method: "PATCH", body: JSON.stringify({ status: reviewStatus, internalNote })
      });
      setDetail(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar o reporte."); }
    finally { setSaving(false); }
  }

  async function deleteReport() {
    if (!detail || saving || !["resolved", "dismissed"].includes(detail.status)) return;
    if (!window.confirm("Excluir permanentemente este reporte e seu snapshot?")) return;
    setSaving(true); setError(null);
    try {
      await nexusFetch(`admin/pilot-reports/${detail.id}`, { method: "DELETE" });
      setDetail(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao excluir o reporte."); }
    finally { setSaving(false); }
  }

  const summary = data.summary || {};
  const canDelete = detail && ["resolved", "dismissed"].includes(detail.status);
  const allowedReviewStatuses = detail ? ({
    new: ["new", "in_review"],
    in_review: ["in_review", "resolved", "dismissed"],
    resolved: ["resolved", "in_review"],
    dismissed: ["dismissed", "in_review"]
  }[detail.status] || [detail.status]) : [];
  return <section className="pilot-reports-panel">
    <div className="audit-heading"><div><p className="eyebrow">FEEDBACK CONTEXTUAL</p>
      <h2>Problemas do piloto</h2><p>Reportes dos pilotos e falhas automáticas, sempre vinculados ao trace correspondente.</p></div>
      <a className="secondary-button" href={`/api/nexus/admin/pilot-reports/export${query()}`} download>Exportar CSV</a></div>
    <form className="audit-filters glass-panel" onSubmit={(event) => { event.preventDefault(); setApplied({ ...filters }); }}>
      <label>De<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
      <label>Até<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      <label>Setor<select value={filters.departmentId} onChange={(event) => setFilters({ ...filters, departmentId: event.target.value })}>
        <option value="">Todos</option>{data.facets.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Usuário<select value={filters.principalId} onChange={(event) => setFilters({ ...filters, principalId: event.target.value })}>
        <option value="">Todos</option>{data.facets.users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Motivo<select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })}>
        <option value="">Todos</option>{data.facets.categories.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
      <label>Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
        <option value="">Todos</option>{data.facets.statuses.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
      <label>Trace<input value={filters.traceId} placeholder="UUID completo"
        onChange={(event) => setFilters({ ...filters, traceId: event.target.value.trim() })} /></label>
      <button className="primary-button">Aplicar filtros</button>
    </form>
    {error && <p className="admin-error">{error}</p>}
    {loading && <p className="audit-loading">Carregando problemas reportados…</p>}
    {!loading && <>
      <div className="metric-grid"><Metric label="Total" value={summary.total || 0} />
        <Metric label="Novos" value={summary.new || 0} /><Metric label="Em análise" value={summary.in_review || 0} />
        <Metric label="Resolvidos" value={summary.resolved || 0} /><Metric label="Descartados" value={summary.dismissed || 0} /></div>
      <section className="data-section glass-panel"><h2>Reportes recebidos</h2><div className="table-scroll"><table>
        <thead><tr><th>Quando</th><th>Origem</th><th>Usuário</th><th>Setor</th><th>Motivo</th><th>Comentário</th><th>Status</th><th>Trace</th><th>Detalhe</th></tr></thead>
        <tbody>{data.items.map((item) => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString("pt-BR")}</td>
          <td>{item.report_origin === "automatic" ? "Automático" : "Piloto"}</td><td>{item.reporter_name}</td><td>{item.department_name || "Sem setor"}</td><td>{item.categoryLabel}</td>
          <td className="pilot-report-comment-cell">{item.comment}</td><td>{item.statusLabel}</td><td><code>{item.trace_id.slice(0, 8)}</code></td>
          <td><button className="text-button" disabled={Boolean(detailLoading)} aria-busy={detailLoading === item.id}
            onClick={() => openReport(item.id)}>{detailLoading === item.id ? "Abrindo…" : "Analisar"}</button></td></tr>)}
          {!data.items.length && <tr><td colSpan={9}>Nenhum reporte encontrado.</td></tr>}</tbody></table></div>
        {data.nextCursor && <button className="secondary-button" onClick={loadMore}>Carregar mais</button>}
      </section>
    </>}
    {detail && <div className="pilot-detail-backdrop" role="presentation" onMouseDown={() => !saving && setDetail(null)}>
      <section className="pilot-detail glass-panel" role="dialog" aria-modal="true" aria-labelledby="pilot-detail-title"
        onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">REPORTE DO PILOTO</p>
          <h2 id="pilot-detail-title">{detail.categoryLabel}</h2><p>{detail.reporter_name} · {detail.department_name || "Sem setor"} · {new Date(detail.created_at).toLocaleString("pt-BR")}</p></div>
          <button type="button" aria-label="Fechar reporte" disabled={saving} onClick={() => setDetail(null)}>×</button></header>
        <div className="pilot-detail-grid"><section><h3>O que foi percebido</h3><p>{detail.comment}</p>
          {detail.report_origin === "automatic" && <small>Falha: {detail.error_code || "não classificada"} · etapa {detail.error_stage || "não identificada"}</small>}
          <small>Trace {detail.trace_id}</small></section><section className="pilot-review-form"><h3>Triagem</h3>
          <label>Status<select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as PilotReportItem["status"])}>
            {data.facets.statuses.filter((item) => allowedReviewStatuses.includes(item.code))
              .map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          <label>Nota interna<textarea rows={4} maxLength={4000} value={internalNote}
            onChange={(event) => setInternalNote(event.target.value)} /></label>
          <div><button className="primary-button" disabled={saving} onClick={saveReview}>{saving ? "Salvando…" : "Salvar triagem"}</button>
            {canDelete && <button className="danger-outline" disabled={saving} onClick={deleteReport}>Excluir reporte</button>}</div></section></div>
        <section className="pilot-conversation"><h3>{detail.snapshot.contentShared === false ? "Contexto protegido" : "Conversa preservada"}</h3><p className="pilot-snapshot-note">
          {detail.snapshot.contentShared === false
            ? "Reporte automático: nenhum texto da conversa foi copiado. Use o trace técnico para investigar a falha."
            : `Capturada em ${new Date(detail.snapshot.capturedAt).toLocaleString("pt-BR")}. A resposta reportada está destacada.`}</p>
          <div>{detail.snapshot.messages.map((message) => <article key={message.id}
            className={`${message.role} ${message.reported ? "reported" : ""}`}>
            <header><strong>{message.role === "user" ? "Piloto" : "Nexus"}</strong>
              {message.reported && <span>Resposta reportada</span>}</header><p>{message.content}</p>
            {Boolean(message.attachments?.length || message.artifacts?.length) && <small>
              {[...(message.attachments || []), ...(message.artifacts || [])]
                .map((item) => item.name || item.title || item.format || "Arquivo").join(" · ")}</small>}
          </article>)}</div></section>
        <section className="pilot-trace"><h3>Etapas técnicas</h3>{detail.trace?.stages?.length
          ? <ol>{detail.trace.stages.map((stage) => <li key={`${stage.tipo}-${stage.id}`}><strong>{stage.nome || stage.capability || "Processamento do modelo"}</strong>
            <span>{stage.status || "sem estado"}{stage.duracao_ms == null ? "" : ` · ${stage.duracao_ms} ms`}</span>
            {stage.erro_codigo && <small>Erro: {stage.erro_codigo}</small>}</li>)}</ol>
          : <p>Nenhuma etapa técnica foi encontrada para este trace.</p>}</section>
      </section></div>}
  </section>;
}

function AuditPanel() {
  const [overview, setOverview] = useState<AuditOverview | null>(null);
  const [activity, setActivity] = useState<AuditActivity>({ items: [] });
  const [glossary, setGlossary] = useState<AuditGlossary | null>(null);
  const [trace, setTrace] = useState<Record<string, any> | null>(null);
  const [filters, setFilters] = useState({ from: "", to: "", departmentId: "",
    principalId: "", capability: "", status: "", sourceMode: "", onlyProblems: false });
  const [applied, setApplied] = useState(filters);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [traceLoading, setTraceLoading] = useState<string | null>(null);

  function query(extra: Record<string, string> = {}) {
    const params = new URLSearchParams();
    Object.entries(applied).forEach(([key, value]) => {
      if (value !== "" && value !== false) params.set(key, String(value));
    });
    Object.entries(extra).forEach(([key, value]) => value && params.set(key, value));
    const text = params.toString();
    return text ? `?${text}` : "";
  }

  async function loadAudit() {
    setAuditLoading(true); setAuditError(null); setTrace(null);
    try {
      const [resumo, atividades, termos] = await Promise.all([
        nexusFetch<AuditOverview>(`admin/audit/overview${query()}`),
        nexusFetch<AuditActivity>(`admin/audit/activity${query()}`),
        glossary || nexusFetch<AuditGlossary>("admin/audit/glossary")
      ]);
      setOverview(resumo); setActivity(atividades); setGlossary(termos);
    } catch (cause) {
      setAuditError(cause instanceof Error ? cause.message : "Falha ao carregar a auditoria.");
    } finally { setAuditLoading(false); }
  }

  useEffect(() => { loadAudit(); }, [applied]);
  useEffect(() => {
    if (!trace) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setTrace(null); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [trace]);

  async function loadMore() {
    if (!activity.nextCursor) return;
    try {
      const proxima = await nexusFetch<AuditActivity>(`admin/audit/activity${query({ cursor: activity.nextCursor })}`);
      setActivity((current) => ({ items: [...current.items, ...proxima.items], nextCursor: proxima.nextCursor }));
    } catch (cause) { setAuditError(cause instanceof Error ? cause.message : "Falha ao carregar mais atividades."); }
  }

  async function openTrace(traceId: string) {
    setAuditError(null); setTraceLoading(traceId);
    try { setTrace(await nexusFetch(`admin/audit/traces/${traceId}`)); }
    catch (cause) { setAuditError(cause instanceof Error ? cause.message : "Trace não autorizado."); }
    finally { setTraceLoading(null); }
  }

  const summary = overview?.summary || {};
  const nomeCatalogado = (grupo: "modes" | "statuses", codigo: string) =>
    glossary?.[grupo]?.find((item) => item.codigo === codigo)?.nome || codigo;
  const departments = [...new Map(activity.items.filter((item) => item.department_id)
    .map((item) => [item.department_id, item.setor])).entries()];
  return <section className="audit-panel">
    <div className="audit-heading"><div><p className="eyebrow">METADADOS OPERACIONAIS</p>
      <h2>Auditoria do Hub</h2><p>Atividade, autorizações e falhas sem exibir perguntas, respostas ou arquivos.</p></div>
      <small>Período padrão: últimos 7 dias</small></div>
    <form className="audit-filters glass-panel" onSubmit={(event) => { event.preventDefault(); setApplied({ ...filters }); }}>
      <label>De<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
      <label>Até<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      <label>Setor<select value={filters.departmentId} onChange={(event) => setFilters({ ...filters, departmentId: event.target.value })}>
        <option value="">Todos permitidos</option>{departments.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}</select></label>
      <label>Usuário<select value={filters.principalId} onChange={(event) => setFilters({ ...filters, principalId: event.target.value })}>
        <option value="">Todos</option>{(overview?.users || []).map((item) =>
          <option key={item.principal_id} value={item.principal_id}>{item.usuario || "Usuário"}</option>)}</select></label>
      <label>Capability<select value={filters.capability} onChange={(event) => setFilters({ ...filters, capability: event.target.value })}>
        <option value="">Todas</option>{(overview?.capabilities || []).map((item) =>
          <option key={item.capability} value={item.capability}>{item.nome}</option>)}</select></label>
      <label>Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
        <option value="">Todos</option><option value="sucesso">Concluído</option><option value="erro">Erro</option>
        <option value="bloqueada">Acesso bloqueado</option><option value="iniciado">Em andamento</option></select></label>
      <label>Modo<select value={filters.sourceMode} onChange={(event) => setFilters({ ...filters, sourceMode: event.target.value })}>
        <option value="">Todos</option><option value="automatico">Automático</option><option value="geral">Conhecimento geral</option>
        <option value="dados">Consultar dados</option><option value="documentacao">Documentação</option>
        <option value="web">Web</option><option value="imagem">Imagem</option></select></label>
      <label className="audit-checkbox"><input type="checkbox" checked={filters.onlyProblems}
        onChange={(event) => setFilters({ ...filters, onlyProblems: event.target.checked })} />Somente erros ou bloqueios</label>
      <button className="primary-button">Aplicar filtros</button>
    </form>
    {auditError && <p className="admin-error">{auditError}</p>}
    {auditLoading && <p className="audit-loading">Carregando metadados autorizados…</p>}
    {!auditLoading && <>
      <div className="metric-grid">
        <Metric label="Turnos" value={summary.turnos || 0} /><Metric label="Usuários ativos" value={summary.usuarios_ativos || 0} />
        <Metric label="Taxa de sucesso" value={`${summary.taxa_sucesso || 0}%`} /><Metric label="Erros" value={summary.erros || 0} />
        <Metric label="Bloqueios" value={summary.bloqueios || 0} /><Metric label="Duração média" value={`${summary.duracao_media_ms || 0} ms`} />
      </div>
      <div className="audit-grid"><DataTable title="Atividade por usuário" rows={overview?.users || []} />
        <DataTable title="Atividade por capability" rows={overview?.capabilities || []} /></div>
      <section className="data-section glass-panel"><h2>Linha do tempo recente</h2><div className="table-scroll"><table>
        <thead><tr><th>Quando</th><th>Usuário</th><th>Setor</th><th>Modo</th><th>Capabilities</th><th>Estado</th><th>Duração</th><th>Detalhe</th></tr></thead>
        <tbody>{activity.items.map((item) => <tr key={item.id}><td>{new Date(item.criado_em).toLocaleString("pt-BR")}</td>
          <td>{item.usuario || "—"}</td><td>{item.setor || "Sem setor"}</td><td>{nomeCatalogado("modes", item.source_mode)}</td>
          <td>{(item.capabilityLabels || []).join(", ") || "Resposta direta"}</td><td>{item.bloqueios ? "Acesso bloqueado" : nomeCatalogado("statuses", item.status)}</td>
          <td>{item.duracao_ms == null ? "—" : `${item.duracao_ms} ms`}</td><td><button className="text-button"
            aria-haspopup="dialog" aria-busy={traceLoading === item.trace_id}
            disabled={Boolean(traceLoading)} onClick={() => openTrace(item.trace_id)}>
            {traceLoading === item.trace_id ? "Carregando…" : "Ver etapas"}</button></td></tr>)}
          {!activity.items.length && <tr><td colSpan={8}>Nenhuma atividade encontrada.</td></tr>}</tbody></table></div>
        {activity.nextCursor && <button className="secondary-button" onClick={loadMore}>Carregar mais</button>}
      </section>
      {trace && <div className="audit-trace-backdrop" role="presentation" onMouseDown={() => setTrace(null)}>
        <section className="audit-trace glass-panel" role="dialog" aria-modal="true" aria-labelledby="audit-trace-title"
          onMouseDown={(event) => event.stopPropagation()}><header><div><p className="eyebrow">TRACE SANITIZADO</p>
          <h2 id="audit-trace-title">{trace.turn?.trace_id}</h2>
          <p>{trace.turn?.usuario} · {trace.turn?.setor || "Sem setor"} · {nomeCatalogado("statuses", trace.turn?.status)}</p></div>
          <button className="audit-trace-close" type="button" aria-label="Fechar etapas" onClick={() => setTrace(null)}>×</button></header>
          <ol>{(trace.stages || []).map((stage: Record<string, any>) => <li key={`${stage.tipo}-${stage.id}`}>
            <strong>{stage.nome || (stage.tipo === "modelo" ? "Processamento do modelo" : "Modelo alternativo")}</strong>
            <span>{nomeCatalogado("statuses", stage.status)} · {stage.duracao_ms == null ? "duração não registrada" : `${stage.duracao_ms} ms`}</span>
            {stage.finalidade && <small>{stage.finalidade}</small>}
            {stage.erro_codigo && <small>Erro: {stage.erro_codigo}</small>}</li>)}</ol>
          {!(trace.stages || []).length && <p>Nenhuma etapa técnica foi registrada neste turno.</p>}
        </section></div>}
      {glossary && <details className="audit-glossary glass-panel"><summary>Glossário da Auditoria · versão {glossary.version}</summary>
        <div className="audit-glossary-grid">{[...glossary.capabilities, ...glossary.modes, ...glossary.statuses, ...glossary.terms]
          .map((item) => <article key={`${item.codigo}-${item.nome}`}><strong>{item.nome}</strong><code>{item.codigo}</code><p>{item.descricao || item.finalidade}</p></article>)}</div></details>}
    </>}
  </section>;
}

function AdminLoading() {
  return <section className="admin-loading" role="status" aria-label="Carregando painel">
    <div className="admin-loading-heading"><i /><div><span /><span /></div></div>
    <div className="admin-loading-metrics">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div>
    <div className="admin-loading-table"><span /><span /><span /><span /></div>
    <p>Carregando informações autorizadas…</p>
  </section>;
}

function Metric({ label, value }: { label: string; value: unknown }) {
  return <article className="metric-card glass-panel"><small>{label}</small><strong>{String(value ?? "—")}</strong></article>;
}

function DataTable({ title, rows }: { title: string; rows: Array<Record<string, any>> }) {
  const columns = rows.length ? Object.keys(rows[0]).filter((key) => !["metadados"].includes(key)).slice(0, 8) : [];
  return <section className="data-section glass-panel"><h2>{title}</h2><div className="table-scroll"><table><thead><tr>
    {columns.map((column) => <th key={column}>{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>
    {rows.map((row, index) => <tr key={String(row.id || index)}>{columns.map((column) =>
      <td key={column}>{typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column] ?? "—")}</td>)}</tr>)}
    {!rows.length && <tr><td>Nenhum registro encontrado.</td></tr>}</tbody></table></div></section>;
}
