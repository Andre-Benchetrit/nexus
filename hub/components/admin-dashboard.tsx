"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
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
  porAtribuicao: Array<Record<string, string | number | null>>;
  porFaixa: Array<Record<string, string | number | null>> };

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
  const [tab, setTab] = useState(canCost ? "overview" : canAudit ? "audit" : "people");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [people, setPeople] = useState<Principal[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [audit, setAudit] = useState<Array<Record<string, any>>>([]);
  const [lake, setLake] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSector, setSelectedSector] = useState(profile.setores[0]?.slug || "");

  const tabs = useMemo(() => [
    canCost && ["overview", "Visão executiva"],
    isAdmin && ["people", "Pessoas e acessos"],
    isAdmin && ["departments", "Setores"],
    canAudit && ["audit", "Auditoria"],
    canAudit && ["lake", "Lake"]
  ].filter(Boolean) as string[][], [canCost, isAdmin, canAudit]);

  async function load() {
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
      if (tab === "lake") setLake(await nexusFetch("admin/lake"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar painel."); }
  }
  useEffect(() => { load(); }, [tab, selectedSector]);

  async function createPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await nexusFetch("admin/principals", { method: "POST",
      body: JSON.stringify({ name: form.get("name"), email: form.get("email") }) });
    event.currentTarget.reset(); await load();
  }

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await nexusFetch("admin/departments", { method: "POST",
      body: JSON.stringify({ name: form.get("name"), slug: form.get("slug") }) });
    event.currentTarget.reset(); await load();
  }

  async function saveAssignments(person: Principal, form: HTMLFormElement) {
    const data = new FormData(form);
    const departmentIds = data.getAll("departments").map(String);
    const role = String(data.get("role") || "usuario");
    const global = data.get("global") === "on";
    const assignments = global ? [{ role, departmentId: null }]
      : departmentIds.map((departmentId) => ({ role, departmentId }));
    await nexusFetch(`admin/principals/${person.id}/assignments`, {
      method: "PUT", body: JSON.stringify({ departmentIds, assignments })
    });
    await load();
  }

  return <main className="admin-layout">
    <aside className="admin-nav"><NexusLogo /><button className="back-chat" onClick={() => router.push("/")}>← Voltar ao chat</button>
      <p className="nav-label">ADMINISTRAÇÃO</p>{tabs.map(([value, label]) =>
        <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}
      <div className="profile-mini"><span>{profile.nome.slice(0, 1)}</span><div><strong>{profile.nome}</strong><small>{profile.email}</small></div></div>
    </aside>
    <section className="admin-content"><header><div><p className="eyebrow">CONTROLE OPERACIONAL</p>
      <h1>{tabs.find(([value]) => value === tab)?.[1]}</h1></div><button className="secondary-button" onClick={load}>Atualizar</button></header>
      {error && <div className="error-banner">{error}</div>}

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
        <DataTable title="Consumo por setor e usuário" rows={usage.porAtribuicao} />
        <DataTable title="Consumo por nível semântico" rows={usage.porFaixa} />
      </>}

      {tab === "people" && <><form className="inline-form glass-panel" onSubmit={createPerson}>
        <div><h2>Pré-cadastrar colaborador</h2><p>O vínculo Microsoft será feito no primeiro login.</p></div>
        <input name="name" placeholder="Nome completo" required /><input name="email" type="email" placeholder="E-mail corporativo" required />
        <button className="primary-button">Cadastrar</button></form>
        <div className="admin-list">{people.map((person) => <article className="person-card glass-panel" key={person.id}>
          <div className="person-heading"><span className="avatar">{person.nome[0]}</span><div><strong>{person.nome}</strong><small>{person.email}</small></div>
            <button className={person.ativo ? "status-active" : "status-inactive"} onClick={async () => {
              await nexusFetch(`admin/principals/${person.id}`, { method: "PATCH", body: JSON.stringify({ active: !person.ativo }) }); load();
            }}>{person.ativo ? "Ativo" : "Inativo"}</button></div>
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
            <button className="secondary-button">Salvar acessos</button>
          </form></article>)}</div></>}

      {tab === "departments" && <><form className="inline-form glass-panel" onSubmit={createDepartment}>
        <div><h2>Novo setor</h2><p>Setores delimitam contexto, permissões e custos.</p></div>
        <input name="name" placeholder="Nome" required /><input name="slug" placeholder="Identificador opcional" />
        <button className="primary-button">Cadastrar</button></form>
        <div className="department-grid">{departments.map((department) => <article className="glass-panel" key={department.id}>
          <span className="department-icon">◇</span><div><strong>{department.nome}</strong><small>{department.slug}</small></div>
          <button className="secondary-button" onClick={async () => {
            await nexusFetch(`admin/departments/${department.id}`, { method: "PATCH", body: JSON.stringify({ active: false }) }); load();
          }}>Desativar</button></article>)}</div></>}

      {tab === "audit" && <DataTable title="Eventos recentes" rows={audit} />}
      {tab === "lake" && lake && <><div className="metric-grid">
        <Metric label="Estado" value={lake.health?.saudavel ? "Saudável" : "Indisponível"} />
        <Metric label="Bronze" value={lake.health?.camadas?.bronze || 0} />
        <Metric label="Silver" value={lake.health?.camadas?.silver || 0} />
        <Metric label="Gold" value={lake.health?.camadas?.gold || 0} />
      </div><DataTable title="Atualizações recentes" rows={lake.events || []} /></>}
    </section>
  </main>;
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
