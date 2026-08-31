"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Department, NexusProfile, nexusFetch } from "@/lib/types";
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
    texto_extraido?: string; conteudo_estruturado?: {
    objetivo?: string; publico?: string; preRequisitos?: string[];
    passos?: Array<{ titulo?: string; descricao?: string }>; alertas?: string[];
  } };
  versions: Array<{ id: string; numero: number; status: string; titulo: string;
    criado_em?: string; publicado_em?: string | null }>;
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

export function AdminDashboard({ profile }: { profile: NexusProfile }) {
  const router = useRouter();
  const isAdmin = profile.permissoes.includes("governanca.administrar");
  const canAudit = profile.permissoes.includes("auditoria.consultar");
  const canCost = profile.permissoes.some((item) => item.startsWith("custos.consultar"));
  const canMemory = profile.permissoes.some((item) =>
    item === "memoria.auditar" || item.startsWith("memoria.revisar") || item === "memoria.administrar");
  const canKnowledge = profile.permissoes.some((item) => item.startsWith("documentacao."));
  const canGlobalKnowledge = profile.permissoes.includes("documentacao.administrar.global");
  const [tab, setTab] = useState(canCost ? "overview" : canAudit ? "audit" : "people");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [people, setPeople] = useState<Principal[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [audit, setAudit] = useState<Array<Record<string, any>>>([]);
  const [lake, setLake] = useState<Record<string, any> | null>(null);
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
  const [knowledgeFileName, setKnowledgeFileName] = useState("");
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
    canAudit && ["audit", "Auditoria"],
    canAudit && ["lake", "Lake"]
  ].filter(Boolean) as string[][], [canCost, isAdmin, canAudit, canMemory, canKnowledge]);

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
      if (tab === "audit") setAudit(await nexusFetch("admin/audit"));
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

  async function importKnowledge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const data = new FormData(element);
    await runAction("import-knowledge", async () => {
      await nexusFetch("admin/knowledge/import", { method: "POST", body: data });
      element.reset();
      setKnowledgeFileName("");
      setKnowledgeImportOpen(false);
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
              defaultValue={knowledgeEdit.version.conteudo_estruturado?.objetivo || knowledgeEdit.version.texto_extraido || ""} /></label>
            <label>Público<input name="audience" defaultValue={knowledgeEdit.version.conteudo_estruturado?.publico || ""} /></label>
            <label>Pré-requisitos <small>Um por linha</small><textarea name="prerequisites" rows={3}
              defaultValue={(knowledgeEdit.version.conteudo_estruturado?.preRequisitos || []).join("\n")} /></label>
            <label>Passos <small>Cole livremente ou use “Título: descrição”, um passo por linha</small><textarea name="steps" rows={7}
              defaultValue={(knowledgeEdit.version.conteudo_estruturado?.passos || [])
                .map((item) => item.descricao ? `${item.titulo}: ${item.descricao}` : item.titulo || "").join("\n")} /></label>
            <label>Alertas <small>Um por linha</small><textarea name="warnings" rows={3}
              defaultValue={(knowledgeEdit.version.conteudo_estruturado?.alertas || []).join("\n")} /></label>
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
          <form className="knowledge-import glass-panel" onSubmit={importKnowledge}>
            <div><p className="eyebrow">ONEDRIVE / LEGADO</p><h2>Importar para revisão</h2>
              <p>PDF, DOCX ou DOTX. A versão atual publicada permanece ativa durante a revisão.</p></div>
            <label className="knowledge-file-picker"><input name="file" type="file" accept=".pdf,.docx,.dotx" required
              onChange={(event) => setKnowledgeFileName(event.target.files?.[0]?.name || "")} />
              <span>Selecionar arquivo</span><strong>{knowledgeFileName || "Nenhum arquivo selecionado"}</strong></label>
            <label>Tipo<select name="tipo"><option value="procedimento">Procedimento</option>
              <option value="politica">Política</option><option value="manual">Manual</option></select></label>
            <label>Escopo<select name="escopo" value={knowledgeImportScope} onChange={(event) => setKnowledgeImportScope(event.target.value)}><option value="setor">Setor</option>
              {canGlobalKnowledge && <option value="global">Global</option>}</select></label>
            <label>Setor<select name="departmentId" defaultValue={knowledgeSectorId === "global" ? knowledgeDepartments[0]?.id : knowledgeSectorId}
              disabled={knowledgeImportScope === "global"}>{knowledgeDepartments.map((item) =>
              <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
            <button className="secondary-button" disabled={Boolean(pendingAction)}>
              {pendingAction === "import-knowledge" ? "Processando…" : "Importar documento"}</button>
          </form>}
        </div>}
      </section>}

      {tab === "audit" && <DataTable title="Eventos recentes" rows={audit} />}
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
