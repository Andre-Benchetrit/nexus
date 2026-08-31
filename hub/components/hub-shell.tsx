"use client";

import {
  ChangeEvent, ClipboardEvent, DragEvent, FormEvent, KeyboardEvent, UIEvent,
  useEffect, useMemo, useRef, useState
} from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { MarkdownMessage } from "./markdown-message";
import { NexusLogo } from "./nexus-logo";
import {
  Attachment, CompositionLevel, Conversation, MemoryOffer, Message, NexusProfile, SourceMode, TurnRequest, nexusFetch
} from "@/lib/types";

const COMPOSITIONS: Array<{ value: CompositionLevel; label: string; hint: string }> = [
  { value: "baixo", label: "Baixo", hint: "Rápido e conciso" },
  { value: "medio", label: "Médio", hint: "Equilibrado" },
  { value: "alto", label: "Alto", hint: "Análise aprofundada" },
  { value: "extra_alto", label: "Extra-alto", hint: "Máxima profundidade" }
];
const SOURCE_MODES: Array<{ value: SourceMode; label: string; hint: string }> = [
  { value: "automatico", label: "Automático", hint: "O Nexus escolhe a fonte" },
  { value: "dados", label: "Consultar dados", hint: "Indicadores e registros internos" },
  { value: "documentacao", label: "Verificar documentação", hint: "Procedimentos, políticas e manuais" },
  { value: "web", label: "Pesquisar na web", hint: "Fontes públicas citadas" }
];
const SOURCE_MODE_ICONS: Record<SourceMode, string> = {
  automatico: "✦", dados: "◆", documentacao: "▤", web: "◇"
};
const NEW_CHAT_TURN_KEY = "__new_chat__";
type PendingFile = { file: File; previewUrl: string };
type SendMessageOptions = {
  sourceMode?: SourceMode;
  files?: PendingFile[];
  preserveComposer?: boolean;
};

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

function visibleMessages(items: Message[]) {
  return items.filter((item) => item.role === "user" || item.content?.trim());
}

export function HubShell({ profile, initialConversationId }: {
  profile: NexusProfile; initialConversationId?: string | null;
}) {
  const router = useRouter();
  const [currentProfile] = useState(profile);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(Boolean(initialConversationId));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [turnProgress, setTurnProgress] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [memoryOffer, setMemoryOffer] = useState<MemoryOffer | null>(null);
  const [openConversationMenuId, setOpenConversationMenuId] = useState<string | null>(null);
  const [departmentId, setDepartmentId] = useState(profile.setores[0]?.id || "");
  const [composition, setComposition] = useState<CompositionLevel>("medio");
  const [sourceMode, setSourceMode] = useState<SourceMode>("automatico");
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [retryingMessageId, setRetryingMessageId] = useState<string | null>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const skipNextMessageLoadRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeIdRef = useRef<string | null>(initialConversationId || null);
  const turnProgressRef = useRef<Record<string, string>>({});

  const active = conversations.find((item) => item.id === activeId) || null;
  const activeTurnKey = activeId || NEW_CHAT_TURN_KEY;
  const activeStage = turnProgress[activeTurnKey] || null;
  const activeLoading = Boolean(activeStage);
  const selectedDepartment = currentProfile.setores.find((item) => item.id === departmentId);
  const activePermissions = new Set([
    ...(currentProfile.permissoesGlobais || []),
    ...(selectedDepartment?.permissoes || [])
  ]);
  const canAdmin = currentProfile.permissoes.some((code) =>
    ["governanca.administrar", "auditoria.consultar", "custos.consultar.setor", "custos.consultar.global",
      "documentacao.criar.setor", "documentacao.editar.setor", "documentacao.publicar.setor",
      "documentacao.administrar.global", "documentacao.auditar"].includes(code)
  );
  const canHigh = activePermissions.has("ia.composicao.alta") ||
    activePermissions.has("ia.composicao.extra_alta");
  const canExtraHigh = activePermissions.has("ia.composicao.extra_alta");

  function navigateChat(path: string, replace = false) {
    const method = replace ? "replaceState" : "pushState";
    window.history[method](window.history.state, "", path);
  }

  function selectConversation(id: string | null) {
    activeIdRef.current = id;
    setActiveId(id);
  }

  function setTurnStage(key: string, label: string) {
    turnProgressRef.current = { ...turnProgressRef.current, [key]: label };
    setTurnProgress(turnProgressRef.current);
  }

  function moveTurnStage(from: string, to: string) {
    const next = { ...turnProgressRef.current };
    const label = next[from];
    delete next[from];
    if (label) next[to] = label;
    turnProgressRef.current = next;
    setTurnProgress(next);
  }

  function clearTurnStage(key: string) {
    const next = { ...turnProgressRef.current };
    delete next[key];
    turnProgressRef.current = next;
    setTurnProgress(next);
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
    function closeMenus(event: MouseEvent) {
      if (!(event.target as Element | null)?.closest(".conversation-menu")) {
        setOpenConversationMenuId(null);
      }
      if (!(event.target as Element | null)?.closest(".composer-actions")) {
        setComposerMenuOpen(false);
      }
    }
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenConversationMenuId(null);
        setComposerMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    nexusFetch<{ items: string[] }>("suggestions").then((result) => setSuggestions(result.items))
      .catch((cause) => setError(cause.message));
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
      .then((items) => setMessages(visibleMessages(items))).catch((cause) => setError(cause.message))
      .finally(() => setMessagesLoading(false));
  }, [activeId]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    const syncFromHistory = () => {
      const match = window.location.pathname.match(/^\/chat\/([^/]+)$/);
      selectConversation(match ? decodeURIComponent(match[1]) : null);
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
  }, [messages, activeStage, activeLoading]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = 160;
    textarea.style.height = `${Math.min(maxHeight, Math.max(28, textarea.scrollHeight))}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);

  const grouped = useMemo(() => {
    const result: Record<string, Conversation[]> = { "Fixados": [], "Hoje": [], "Últimos 7 dias": [], "Anteriores": [] };
    for (const item of conversations) {
      if (item.pinnedAt) result["Fixados"].push(item);
      else result[groupLabel(item.updatedAt)].push(item);
    }
    return result;
  }, [conversations]);

  function newChat(nextDepartment = departmentId) {
    setOpenConversationMenuId(null);
    setShowArchived(false);
    selectConversation(null); setMessages([]); setMemoryOffer(null); setInput("");
    pendingFiles.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setPendingFiles([]); setDepartmentId(nextDepartment); setComposition("medio"); setSidebarOpen(false);
    setSourceMode("automatico"); setComposerMenuOpen(false);
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
    selectConversation(created.id);
    setConversations((items) => [created, ...items]);
    return created.id;
  }

  async function recoverTurn(conversationId: string, requestId: string) {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const request = await nexusFetch<TurnRequest>(
        `conversations/${conversationId}/turns/${requestId}`
      );
      if (request.status === "success") {
        const persisted = await nexusFetch<Message[]>(`conversations/${conversationId}/messages`);
        const visible = visibleMessages(persisted);
        if (!visible.some((item) => item.role === "assistant" && item.turnId === request.turnId)) {
          throw new Error("O Nexus concluiu o turno sem produzir uma resposta válida.");
        }
        if (activeIdRef.current === conversationId) setMessages(visible);
        return true;
      }
      if (request.status === "error" || request.status === "interrupted") {
        throw new Error("A resposta foi interrompida antes de ser concluída.");
      }
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
    }
    return false;
  }

  function addFiles(files: File[]) {
    const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
    const valid = files.filter((file) => allowed.has(file.type) && file.size <= 10 * 1024 * 1024);
    if (valid.length !== files.length) setError("Use até quatro imagens PNG, JPEG ou WebP de no máximo 10 MB cada.");
    setPendingFiles((current) => {
      const available = Math.max(0, 4 - current.length);
      return [...current, ...valid.slice(0, available).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }))];
    });
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  function pasteFiles(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imagens = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((item): item is File => Boolean(item));
    if (!imagens.length) return;
    event.preventDefault();
    addFiles(imagens.map((arquivo, indice) => new File(
      [arquivo], arquivo.name || `imagem-colada-${Date.now()}-${indice + 1}.png`,
      { type: arquivo.type || "image/png", lastModified: Date.now() }
    )));
  }

  function removePending(index: number) {
    setPendingFiles((items) => items.filter((item, itemIndex) => {
      if (itemIndex === index) URL.revokeObjectURL(item.previewUrl);
      return itemIndex !== index;
    }));
  }

  async function uploadFiles(conversationId: string, files: PendingFile[], onStage: (label: string) => void) {
    const uploaded: Attachment[] = [];
    try {
      for (const item of files) {
        onStage(`Enviando imagem ${uploaded.length + 1} de ${files.length}`);
        const form = new FormData(); form.append("file", item.file);
        const response = await fetch(`/api/nexus/conversations/${conversationId}/attachments`, { method: "POST", body: form });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error?.message || "Não foi possível enviar a imagem.");
        }
        const attachment = await response.json() as Attachment;
        uploaded.push({ ...attachment, name: item.file.name, previewUrl: item.previewUrl });
      }
      return uploaded;
    } catch (cause) {
      await Promise.allSettled(uploaded.map((item) => fetch(item.url, { method: "DELETE" })));
      throw cause;
    }
  }

  async function sendMessage(value = input, options: SendMessageOptions = {}) {
    const text = value.trim();
    const initialTurnKey = activeId || NEW_CHAT_TURN_KEY;
    const files = options.files ? [...options.files] : [...pendingFiles];
    if ((!text && !files.length) || turnProgressRef.current[initialTurnKey]) return;
    stickToBottomRef.current = true;
    setShowJumpToBottom(false);
    const prompt = text || "Analise as imagens anexadas.";
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const localAttachments: Attachment[] = files.map((item, index) => ({
      id: `${optimisticId}-${index}`, mediaType: item.file.type, bytes: item.file.size,
      width: 0, height: 0, url: item.previewUrl, name: item.file.name, previewUrl: item.previewUrl
    }));
    const createdFromEmpty = !activeId;
    const turnSourceMode = options.sourceMode || sourceMode;
    let conversationId: string | null = activeId;
    let turnKey = initialTurnKey;
    let turnAccepted = false;
    if (!options.preserveComposer) {
      setInput(""); setPendingFiles([]); setSourceMode("automatico");
    }
    setError(null); setComposerMenuOpen(false);
    setTurnStage(turnKey, files.length ? "Preparando imagens" : "Interpretando sua solicitação");
    setMessages((items) => [...items, {
      id: optimisticId, role: "user", content: prompt, optimistic: true,
      sourceMode: turnSourceMode, attachments: localAttachments
    }]);
    try {
      conversationId = await ensureConversation();
      if (turnKey !== conversationId) {
        moveTurnStage(turnKey, conversationId);
        turnKey = conversationId;
      }
      // Firma a conversa na URL assim que ela existe, sem aguardar upload,
      // OCR ou resposta. history.replaceState preserva o componente e o loading.
      if (createdFromEmpty || window.location.pathname === "/") {
        navigateChat(`/chat/${conversationId}`, true);
      }
      const uploaded = await uploadFiles(conversationId, files, (label) => setTurnStage(turnKey, label));
      if (activeIdRef.current === conversationId) {
        setMessages((items) => items.map((item) => item.id === optimisticId
          ? { ...item, attachments: uploaded } : item));
      }
      const response = await fetch(`/api/nexus/conversations/${conversationId}/turns`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: prompt, attachmentIds: uploaded.map((item) => item.id), compositionLevel: composition,
          sourceMode: turnSourceMode,
          clientRequestId: crypto.randomUUID() })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || "Não foi possível iniciar a resposta.");
      }
      if (!response.body) throw new Error("A resposta foi aceita sem um canal de acompanhamento.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;
      let acceptedRequestId: string | null = null;
      let terminalError: string | null = null;
      const receive = (name: string, raw: unknown) => {
        const data = raw as Record<string, any>;
        if (name === "turn.accepted" && data.requestId) {
          acceptedRequestId = String(data.requestId);
          turnAccepted = true;
        }
        if (name === "stage.changed") setTurnStage(turnKey, String(data.label || "Pensando"));
        if (name === "memory.offer" && activeIdRef.current === conversationId) setMemoryOffer(data as MemoryOffer);
        if (name === "turn.failed") {
          terminalError = String(data.message || "Não foi possível concluir a resposta.");
          completed = true;
        }
        if (name === "turn.completed" && data.message) {
          const message = data.message as Message;
          if (!message.content?.trim()) {
            setError("O Nexus concluiu o turno sem produzir uma resposta válida.");
          } else {
            if (activeIdRef.current === conversationId) setMessages((items) => [...items, message]);
          }
          completed = true;
        }
      };
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        buffer = parseSseChunk(buffer, receive);
      }
      if (terminalError) throw new Error(terminalError);
      if (!completed && acceptedRequestId) completed = await recoverTurn(conversationId, acceptedRequestId);
      if (!completed && activeIdRef.current === conversationId) {
        await nexusFetch<Message[]>(`conversations/${conversationId}/messages`)
          .then((items) => setMessages(visibleMessages(items)));
      }
      await refreshConversations();
    } catch (cause) {
      if (!turnAccepted && activeIdRef.current === conversationId) {
        setMessages((items) => items.filter((item) => item.id !== optimisticId));
        if (!options.preserveComposer) {
          setPendingFiles(files);
          setInput(text);
          setSourceMode(turnSourceMode);
        }
      } else if (conversationId && activeIdRef.current === conversationId) {
        await nexusFetch<Message[]>(`conversations/${conversationId}/messages`)
          .then((items) => setMessages(visibleMessages(items)))
          .catch(() => undefined);
      }
      if (activeIdRef.current === conversationId) {
        setError(cause instanceof Error ? cause.message : "Falha inesperada.");
      }
    } finally {
      clearTurnStage(turnKey);
    }
  }

  async function retryAssistantMessage(message: Message, index: number) {
    if (activeLoading) return;
    const original = [...messages.slice(0, index)].reverse().find((item) => item.role === "user");
    if (!original) return;
    const retryId = message.id || message.traceId || `assistant-${index}`;
    setRetryingMessageId(retryId);
    setError(null);
    try {
      const files: PendingFile[] = [];
      for (const [attachmentIndex, attachment] of (original.attachments || []).entries()) {
        const response = await fetch(attachment.url, { cache: "no-store" });
        if (!response.ok) throw new Error("Não foi possível recuperar uma imagem da mensagem original.");
        const blob = await response.blob();
        const mediaType = attachment.mediaType || blob.type || "image/png";
        const extension = mediaType === "image/jpeg" ? "jpg" : mediaType === "image/webp" ? "webp" : "png";
        const file = new File([blob], attachment.name || `imagem-repetida-${attachmentIndex + 1}.${extension}`, {
          type: mediaType,
          lastModified: Date.now()
        });
        files.push({ file, previewUrl: URL.createObjectURL(file) });
      }
      await sendMessage(original.content, {
        sourceMode: message.sourceMode || original.sourceMode || "automatico",
        files,
        preserveComposer: true
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível tentar novamente.");
    } finally {
      setRetryingMessageId(null);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  async function renameConversation(item: Conversation) {
    setOpenConversationMenuId(null);
    const title = window.prompt("Novo título", item.title || "");
    if (!title) return;
    await nexusFetch(`conversations/${item.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
    refreshConversations();
  }

  async function togglePinned(item: Conversation) {
    setOpenConversationMenuId(null);
    await nexusFetch(`conversations/${item.id}`, {
      method: "PATCH", body: JSON.stringify({ pinned: !item.pinnedAt })
    });
    refreshConversations();
  }

  async function toggleArchived(item: Conversation) {
    setOpenConversationMenuId(null);
    await nexusFetch(`conversations/${item.id}`, {
      method: "PATCH", body: JSON.stringify({ archived: !item.archivedAt })
    });
    if (activeId === item.id) newChat();
    else await refreshConversations(showArchived);
  }

  async function deleteConversation(item: Conversation) {
    if (!window.confirm("Excluir esta conversa e sua memória associada?")) return;
    setOpenConversationMenuId(null);
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
        setShowArchived((value) => !value); selectConversation(null); setMessages([]); navigateChat("/");
      }}>▱ {showArchived ? "Voltar às conversas" : "Arquivados"}</button>
      <nav className="conversation-list" aria-label="Conversas">
        {!conversationsLoaded && <div className="conversation-skeleton" aria-label="Carregando conversas">
          <i /><i /><i /><i />
        </div>}
        {Object.entries(grouped).map(([group, items]) => items.length > 0 && <section key={group}>
          <h2>{group}</h2>
          {items.map((item) => <div className={`conversation-row ${item.id === activeId ? "active" : ""}`} key={item.id}>
            <button className="conversation-link" onClick={() => {
              selectConversation(item.id); setSidebarOpen(false); navigateChat(`/chat/${item.id}`);
            }}><span>{item.title || "Nova conversa"}</span><small>{item.department?.name || item.department?.nome}</small></button>
            <details className="conversation-menu" open={openConversationMenuId === item.id}
              onToggle={(event) => {
                if (event.currentTarget.open) setOpenConversationMenuId(item.id);
                else setOpenConversationMenuId((current) => current === item.id ? null : current);
              }}><summary aria-label="Opções" onClick={(event) => {
                event.preventDefault();
                setOpenConversationMenuId((current) => current === item.id ? null : item.id);
              }}>•••</summary><div>
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
        </section> : !messages.length && !activeLoading ? <section className="empty-state">
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
              {message.attachments?.length ? <div className="message-attachments">{message.attachments.map((item) =>
                <img key={item.id} src={item.previewUrl || item.url} alt={item.name || "Imagem anexada"} />)}</div> : null}
              {message.role === "assistant" ? <MarkdownMessage content={message.content} /> : <p>{message.content}</p>}
              {message.role === "assistant" && <footer className="message-footer">
                <div className="message-meta">
                  {message.provenance && <span className="source-chip">{{ dados_nexus: "◆ Dados internos Nexus", web: "◇ Fontes web",
                    arquivo: "▧ Imagem", misto: "✦ Fontes combinadas", conhecimento_geral: "◇ Conhecimento geral" }[message.provenance] || "◇ Conhecimento geral"}</span>}
                  {message.traceId && <span title={message.traceId}>Trace {message.traceId.slice(0, 8)}</span>}
                </div>
                <button type="button" className="message-retry-button"
                  disabled={activeLoading || retryingMessageId === (message.id || message.traceId || `assistant-${index}`)}
                  onClick={() => retryAssistantMessage(message, index)}
                  aria-label="Tentar responder novamente" title="Tentar responder novamente">
                  {retryingMessageId === (message.id || message.traceId || `assistant-${index}`) ? "…" : "↻"}
                </button>
              </footer>}
            </div>
          </article>)}
          {activeLoading && <article className="message assistant thinking"><div className="assistant-mark"><NexusLogo compact /></div>
            <div className="thinking-state"><span className="thinking-orbit"><i /><i /><i /></span><div><strong>{activeStage}</strong>
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

      <footer className="composer-zone">
        {pendingFiles.length > 0 && <div className="attachment-tray">{pendingFiles.map((item, index) => <figure key={item.previewUrl}>
          <img src={item.previewUrl} alt={item.file.name} /><button type="button" onClick={() => removePending(index)} aria-label="Remover imagem">×</button>
          <figcaption>{item.file.name}</figcaption></figure>)}</div>}
        <form className="composer" onSubmit={(event: FormEvent) => { event.preventDefault(); sendMessage(); }}
          onDragOver={(event: DragEvent) => event.preventDefault()} onDrop={(event: DragEvent) => {
            event.preventDefault(); addFiles(Array.from(event.dataTransfer.files));
          }}>
        <input ref={fileInputRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" onChange={chooseFiles} />
        <details className={`composer-actions ${sourceMode !== "automatico" ? "mode-selected" : ""}`}
          open={composerMenuOpen} onToggle={(event) => setComposerMenuOpen(event.currentTarget.open)}>
          <summary className="attach-button" aria-label={`Mais opções. Função atual: ${SOURCE_MODES.find((item) => item.value === sourceMode)?.label}`}
            aria-disabled={activeLoading} onClick={(event) => {
              if (activeLoading) event.preventDefault();
            }}>＋</summary>
          <div className="composer-actions-menu">
            <button type="button" onClick={() => {
              setComposerMenuOpen(false); fileInputRef.current?.click();
            }} disabled={pendingFiles.length >= 4}>
              <span className="action-icon">▧</span><span><strong>Anexar imagem</strong><small>PNG, JPEG ou WebP</small></span>
            </button>
            <p>Função</p>
            {SOURCE_MODES.map((item) => <button type="button" key={item.value}
              className={sourceMode === item.value ? "active" : ""} onClick={() => {
                setSourceMode(item.value); setComposerMenuOpen(false);
              }}>
              <span className="action-icon">{SOURCE_MODE_ICONS[item.value]}</span>
              <span><strong>{item.label}</strong><small>{item.hint}</small></span>
              {sourceMode === item.value && <i aria-hidden="true">✓</i>}
            </button>)}
          </div>
        </details>
        {sourceMode !== "automatico" && <button type="button" className="source-mode-indicator"
          title={SOURCE_MODES.find((item) => item.value === sourceMode)?.label}
          aria-label={`Função selecionada: ${SOURCE_MODES.find((item) => item.value === sourceMode)?.label}`}
          onClick={() => setComposerMenuOpen(true)}>{SOURCE_MODE_ICONS[sourceMode]}</button>}
        <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={keyDown} onPaste={pasteFiles}
          placeholder="Pergunte ao Nexus..." rows={1} disabled={activeLoading} aria-label="Mensagem" />
        <button className="send-button" type="submit" disabled={activeLoading || (!input.trim() && !pendingFiles.length)} aria-label="Enviar">↑</button>
      </form><small>O Nexus pode cometer erros. Respostas corporativas são validadas pelas fontes autorizadas.</small></footer>
    </section>
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" />}
  </main>;
}
