"use client";

import { FormEvent, KeyboardEvent, UIEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { MarkdownMessage } from "./markdown-message";
import { NexusLogo } from "./nexus-logo";
import {
  CompositionLevel, Conversation, MemoryOffer, Message, NexusProfile, TurnRequest, nexusFetch
} from "@/lib/types";

const COMPOSITIONS: Array<{ value: CompositionLevel; label: string; hint: string }> = [
  { value: "baixo", label: "Baixo", hint: "Rápido e conciso" },
  { value: "medio", label: "Médio", hint: "Equilibrado" },
  { value: "alto", label: "Alto", hint: "Análise aprofundada" },
  { value: "extra_alto", label: "Extra-alto", hint: "Máxima profundidade" }
];

function groupLabel(date?: string) {
  if (!date) return "Anteriores";
  const now = new Date();
  const value = new Date(date);
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(value.toDateString()).getTime()) / 86400000);
  if (days <= 0) return "Hoje";
  if (days <= 7) return "Últimos 7 dias";
  return "Anteriores";
}

function parseSseChunk(buffer: string, onEvent: (name: string, data: unknown) => void) {
  const blocks = buffer.split("\n\n");
  const remainder = blocks.pop() || "";
  for (const block of blocks) {
    let name = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (data.length) {
      try { onEvent(name, JSON.parse(data.join("\n"))); } catch { /* ignora evento incompleto */ }
    }
  }
  return remainder;
}

export function HubShell({ profile, initialConversationId }: {
  profile: NexusProfile; initialConversationId?: string | null;
}) {
  const router = useRouter();
  const [currentProfile, setCurrentProfile] = useState(profile);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(Boolean(initialConversationId));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("Pronto para ajudar");
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [memoryOffer, setMemoryOffer] = useState<MemoryOffer | null>(null);
  const [departmentId, setDepartmentId] = useState(profile.setores[0]?.id || "");
  const [composition, setComposition] = useState<CompositionLevel>("medio");
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const skipNextMessageLoadRef = useRef(false);

  const active = conversations.find((item) => item.id === activeId) || null;
  const selectedDepartment = currentProfile.setores.find((item) => item.id === departmentId);
  const activePermissions = new Set([
    ...(currentProfile.permissoesGlobais || []),
    ...(selectedDepartment?.permissoes || [])
  ]);
  const canAdmin = currentProfile.permissoes.some((code) =>
    ["governanca.administrar", "auditoria.consultar", "custos.consultar.setor", "custos.consultar.global"].includes(code)
  );
  const canHigh = activePermissions.has("ia.composicao.alta") ||
    activePermissions.has("ia.composicao.extra_alta");
  const canExtraHigh = activePermissions.has("ia.composicao.extra_alta");

  function navigateChat(path: string, replace = false) {
    const method = replace ? "replaceState" : "pushState";
    window.history[method](window.history.state, "", path);
  }

  async function refreshConversations(archived = showArchived) {
    try {
      const data = await nexusFetch<Conversation[]>(`conversations${archived ? "?archived=true" : ""}`);
      setConversations(data);
      return data;
    } finally {
      setConversationsLoaded(true);
    }
  }

  useEffect(() => {
    refreshConversations(showArchived).catch((cause) => setError(cause.message));
  }, [showArchived]);

  useEffect(() => {
    nexusFetch<{ items: string[] }>("suggestions").then((result) => setSuggestions(result.items))
      .catch((cause) => setError(cause.message));
    nexusFetch<NexusProfile>("me").then((fresh) => {
      setCurrentProfile(fresh);
      setDepartmentId((current) => current || fresh.setores[0]?.id || "");
    }).catch((cause) => setError(cause.message));
  }, []);

  useEffect(() => {
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    if (!activeId) { setMessages([]); setMemoryOffer(null); setMessagesLoading(false); return; }
    if (skipNextMessageLoadRef.current) {
      skipNextMessageLoadRef.current = false;
      setMessagesLoading(false);
      return;
    }
    setMessagesLoading(true);
    nexusFetch<Message[]>(`conversations/${activeId}/messages`)
      .then(setMessages).catch((cause) => setError(cause.message))
      .finally(() => setMessagesLoading(false));
  }, [activeId]);

  useEffect(() => {
    const syncFromHistory = () => {
      const match = window.location.pathname.match(/^\/chat\/([^/]+)$/);
      setActiveId(match ? decodeURIComponent(match[1]) : null);
    };
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  useEffect(() => {
    if (active) {
      setDepartmentId(active.department.id);
      setComposition(active.compositionLevel);
    }
  }, [active?.id]);

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const area = messagesAreaRef.current;
    if (!area) return;
    area.scrollTo({ top: area.scrollHeight, behavior });
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
  }

  function handleMessagesScroll(event: UIEvent<HTMLDivElement>) {
    const area = event.currentTarget;
    const nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 120;
    stickToBottomRef.current = nearBottom;
    setShowJumpToBottom(!nearBottom);
  }

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const frame = window.requestAnimationFrame(() => scrollToBottom("smooth"));
    return () => window.cancelAnimationFrame(frame);
  }, [messages, stage, loading]);

  const grouped = useMemo(() => {
    const result: Record<string, Conversation[]> = { "Fixados": [], "Hoje": [], "Últimos 7 dias": [], "Anteriores": [] };
    for (const item of conversations) {
      if (item.pinnedAt) result["Fixados"].push(item);
      else result[groupLabel(item.updatedAt)].push(item);
    }
    return result;
  }, [conversations]);

  function newChat(nextDepartment = departmentId) {
    setShowArchived(false);
    setActiveId(null); setMessages([]); setMemoryOffer(null); setInput("");
    setDepartmentId(nextDepartment); setComposition("medio"); setSidebarOpen(false);
    navigateChat("/");
  }

  async function chooseDepartment(next: string) {
    if (activeId && next !== active?.department.id) {
      if (!window.confirm("O setor faz parte do contexto do chat. Iniciar uma nova conversa neste setor?")) return;
      newChat(next);
      return;
    }
    setDepartmentId(next);
  }

  async function chooseComposition(next: CompositionLevel) {
    setComposition(next);
    if (activeId) {
      await nexusFetch(`conversations/${activeId}`, {
        method: "PATCH", body: JSON.stringify({ compositionLevel: next })
      });
      refreshConversations();
    }
  }

  async function ensureConversation() {
    if (activeId) return activeId;
    if (!departmentId) throw new Error("Selecione um setor antes de iniciar a conversa.");
    const created = await nexusFetch<Conversation>("conversations", {
      method: "POST", body: JSON.stringify({ departmentId, compositionLevel: composition })
    });
    skipNextMessageLoadRef.current = true;
    setActiveId(created.id);
    setConversations((items) => [created, ...items]);
    // Atualiza o endereco sem provocar uma navegacao do Next. Uma navegacao
    // aqui desmontaria o componente no exato momento em que ele abre o SSE,
    // apagando o loading e a mensagem otimista do primeiro turno.
    navigateChat(`/chat/${created.id}`, true);
    return created.id;
  }

  async function recoverTurn(conversationId: string, requestId: string) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const request = await nexusFetch<TurnRequest>(
        `conversations/${conversationId}/turns/${requestId}`
      );
      if (request.status === "success") {
        const persisted = await nexusFetch<Message[]>(`conversations/${conversationId}/messages`);
        setMessages(persisted);
        return true;
      }
      if (request.status === "error" || request.status === "interrupted") {
        throw new Error("A resposta foi interrompida antes de ser concluída.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    return false;
  }

  async function sendMessage(value = input) {
    const text = value.trim();
    if (!text || loading) return;
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    setInput(""); setError(null); setLoading(true); setStage("Interpretando sua solicitação");
    setMessages((items) => [...items, { role: "user", content: text, optimistic: true }]);
    try {
      const conversationId = await ensureConversation();
      const response = await fetch(`/api/nexus/conversations/${conversationId}/turns`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, compositionLevel: composition,
          clientRequestId: crypto.randomUUID() })
      });
      if (!response.ok || !response.body) throw new Error("Não foi possível iniciar a resposta.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      let acceptedRequestId: string | null = null;
      const receive = (name: string, raw: unknown) => {
        const data = raw as Record<string, any>;
        if (name === "turn.accepted" && data.requestId) acceptedRequestId = String(data.requestId);
        if (name === "stage.changed") setStage(String(data.label || "Pensando"));
        if (name === "memory.offer") setMemoryOffer(data as MemoryOffer);
        if (name === "turn.failed") {
          setError(String(data.message || "Não foi possível concluir a resposta.")); completed = true;
        }
        if (name === "turn.completed" && data.message) {
          setMessages((items) => [...items, data.message as Message]); completed = true;
        }
      };
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        buffer = parseSseChunk(buffer, receive);
      }
      if (!completed && acceptedRequestId) completed = await recoverTurn(conversationId, acceptedRequestId);
      if (!completed) await nexusFetch<Message[]>(`conversations/${conversationId}/messages`).then(setMessages);
      await refreshConversations();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha inesperada.");
    } finally {
      setLoading(false); setStage("Pronto para ajudar");
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  async function renameConversation(item: Conversation) {
    const title = window.prompt("Novo título", item.title || "");
    if (!title) return;
    await nexusFetch(`conversations/${item.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
    refreshConversations();
  }

  async function togglePinned(item: Conversation) {
    await nexusFetch(`conversations/${item.id}`, {
      method: "PATCH", body: JSON.stringify({ pinned: !item.pinnedAt })
    });
    refreshConversations();
  }

  async function toggleArchived(item: Conversation) {
    await nexusFetch(`conversations/${item.id}`, {
      method: "PATCH", body: JSON.stringify({ archived: !item.archivedAt })
    });
    if (activeId === item.id) newChat();
    else await refreshConversations(showArchived);
  }

  async function deleteConversation(item: Conversation) {
    if (!window.confirm("Excluir esta conversa e sua memória associada?")) return;
    await nexusFetch(`conversations/${item.id}`, { method: "DELETE" });
    if (activeId === item.id) newChat();
    refreshConversations();
  }

  async function respondMemory(action: "confirmar" | "descartar") {
    if (!memoryOffer || !activeId) return;
    await nexusFetch(`memory-offers/${memoryOffer.id}/respond`, {
      method: "POST", body: JSON.stringify({ conversationId: activeId, action })
    });
    setMemoryOffer(null);
  }

  return <main className="hub-layout">
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="sidebar-top"><NexusLogo />
        <button className="icon-button mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu">×</button>
      </div>
      <button className="new-chat-button" onClick={() => newChat()}><span>＋</span> Nova conversa</button>
      <button className={`archive-filter ${showArchived ? "active" : ""}`} onClick={() => {
        setShowArchived((value) => !value); setActiveId(null); setMessages([]); navigateChat("/");
      }}>▱ {showArchived ? "Voltar às conversas" : "Arquivados"}</button>
      <nav className="conversation-list" aria-label="Conversas">
        {!conversationsLoaded && <div className="conversation-skeleton" aria-label="Carregando conversas">
          <i /><i /><i /><i />
        </div>}
        {Object.entries(grouped).map(([group, items]) => items.length > 0 && <section key={group}>
          <h2>{group}</h2>
          {items.map((item) => <div className={`conversation-row ${item.id === activeId ? "active" : ""}`} key={item.id}>
            <button className="conversation-link" onClick={() => {
              setActiveId(item.id); setSidebarOpen(false); navigateChat(`/chat/${item.id}`);
            }}><span>{item.title || "Nova conversa"}</span><small>{item.department?.name || item.department?.nome}</small></button>
            <details className="conversation-menu"><summary aria-label="Opções">•••</summary><div>
              <button onClick={() => togglePinned(item)}>{item.pinnedAt ? "Desafixar" : "Fixar"}</button>
              <button onClick={() => renameConversation(item)}>Renomear</button>
              <button onClick={() => toggleArchived(item)}>{item.archivedAt ? "Desarquivar" : "Arquivar"}</button>
              <button className="danger" onClick={() => deleteConversation(item)}>Excluir</button>
            </div></details>
          </div>)}
        </section>)}
      </nav>
      <div className="profile-card">
        <span className="avatar">{currentProfile.nome.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase()}</span>
        <div><strong>{currentProfile.nome}</strong><small>{currentProfile.papeisGlobais[0] || currentProfile.setores[0]?.papeis?.[0] || "Usuário"}</small></div>
        <details><summary aria-label="Perfil">•••</summary><div className="profile-menu">
          {canAdmin && <button onClick={() => router.push("/admin")}>Painel administrativo</button>}
          <button onClick={() => signOut({ callbackUrl: "/login" })}>Sair</button>
        </div></details>
      </div>
    </aside>

    <section className="chat-panel">
      <header className="chat-header">
        <button className="icon-button mobile-only" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu">☰</button>
        <div className="context-selectors">
          <label><span>Setor</span><select value={departmentId} onChange={(e) => chooseDepartment(e.target.value)}>
            {currentProfile.setores.map((item) => <option value={item.id} key={item.id}>{item.nome}</option>)}
          </select></label>
          <label><span>Composição</span><select value={composition} onChange={(e) => chooseComposition(e.target.value as CompositionLevel)}>
            {COMPOSITIONS.map((item) => <option key={item.value} value={item.value}
              disabled={(item.value === "alto" && !canHigh) || (item.value === "extra_alto" && !canExtraHigh)}>
              {item.label} — {item.hint}
            </option>)}
          </select></label>
        </div>
        <div className="status-dot"><i /> Protegido pela governança</div>
      </header>

      <div className="messages-area" ref={messagesAreaRef} onScroll={handleMessagesScroll}>
        {messagesLoading ? <section className="chat-loading-shell" aria-label="Carregando conversa">
          <div className="message-placeholder wide" /><div className="message-placeholder" />
          <div className="message-placeholder short" />
        </section> : !messages.length && !loading ? <section className="empty-state">
          <NexusLogo size="large" compact />
          <p className="eyebrow">INTELIGÊNCIA FID</p>
          <h1>Como posso ajudar sua operação?</h1>
          <p>Converse, consulte dados internos e transforme informação em decisão.</p>
          <div className="suggestion-grid">{suggestions.slice(0, 4).map((item) =>
            <button key={item} onClick={() => sendMessage(item)}>{item}<span>↗</span></button>)}</div>
        </section> : <div className="message-stream">
          {messages.map((message, index) => <article className={`message ${message.role}`} key={message.id || index}>
            {message.role === "assistant" && <div className="assistant-mark"><NexusLogo compact /></div>}
            <div className="message-body">
              {message.role === "assistant" ? <MarkdownMessage content={message.content} /> : <p>{message.content}</p>}
              {message.role === "assistant" && message.provenance && <footer>
                <span className="source-chip">{message.provenance === "dados_nexus" ? "◆ Dados internos Nexus" : "◇ Conhecimento geral"}</span>
                {message.traceId && <span title={message.traceId}>Trace {message.traceId.slice(0, 8)}</span>}
              </footer>}
            </div>
          </article>)}
          {loading && <article className="message assistant thinking"><div className="assistant-mark"><NexusLogo compact /></div>
            <div className="thinking-state"><span className="thinking-orbit"><i /><i /><i /></span><div><strong>{stage}</strong>
              <small>O Nexus pode consultar diferentes fontes antes de responder.</small></div></div></article>}
          {memoryOffer && <aside className="memory-offer"><span>✦</span><div><strong>Aprendizado reutilizável identificado</strong>
            <p>{memoryOffer.statement}</p><div><button onClick={() => respondMemory("confirmar")}>Enviar para aprovação</button>
              <button onClick={() => respondMemory("descartar")}>Descartar</button></div></div></aside>}
          {error && <div className="error-banner">{error}</div>}
        </div>}
      </div>

      {showJumpToBottom && <button className="jump-to-bottom" onClick={() => scrollToBottom()}>
        ↓ Voltar ao final
      </button>}

      <footer className="composer-zone"><form className="composer" onSubmit={(event: FormEvent) => { event.preventDefault(); sendMessage(); }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={keyDown}
          placeholder="Pergunte ao Nexus..." rows={1} disabled={loading} aria-label="Mensagem" />
        <button className="send-button" type="submit" disabled={loading || !input.trim()} aria-label="Enviar">↑</button>
      </form><small>O Nexus pode cometer erros. Respostas corporativas são validadas pelas fontes autorizadas.</small></footer>
    </section>
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" />}
  </main>;
}
