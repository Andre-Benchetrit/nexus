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
  const [tab, setTab] = useState(canCost ? "overview" : canAudit ? "audit" : "people");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [people, setPeople] = useState<Principal[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [audit, setAudit] = useState<Array<Record<string, any>>>([]);
  const [lake, setLake] = useState<Record<string, any> | null>(null);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState(profile.setores[0]?.slug || "");
  const [loading, setLoading] = useState(true);
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => new Set());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const tabs = useMemo(() => [
    canCost && ["overview", "Visão executiva"],
    isAdmin && ["people", "Pessoas e acessos"],
    isAdmin && ["departments", "Setores"],
    canMemory && ["memory", "Aprendizados"],
    canAudit && ["audit", "Auditoria"],
    canAudit && ["lake", "Lake"]
  ].filter(Boolean) as string[][], [canCost, isAdmin, canAudit, canMemory]);

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
  useEffect(() => { load(); }, [tab, selectedSector]);

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
