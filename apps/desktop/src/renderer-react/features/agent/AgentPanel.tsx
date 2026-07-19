import { createPortal } from "react-dom";
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type PointerEvent, type ReactNode, type ReactPortal, type SetStateAction } from "react";
import { Bot, Check, ChevronDown, Copy, FileText, LoaderCircle, MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Send, Square, Trash2, Wrench } from "lucide-react";
import type { AgentChatMessage, AgentCitation, AgentNoteAuditEvent, AgentStreamEvent, AgentThread, ReportEntry } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { renderMarkdown } from "../../components/Markdown";
import { useI18n } from "../../i18n";

interface Turn extends Pick<AgentChatMessage, "role" | "content" | "citations" | "fallback" | "sortOrder"> {
  id: string;
  streaming?: boolean;
}

interface ProgressEvent {
  phase: string;
  message?: string;
  current?: number;
  total?: number;
  noteTitle?: string;
  chunkCurrent?: number;
  chunkTotal?: number;
}

interface IndexProgress extends ProgressEvent {
  visible: boolean;
}

interface ChatContext {
  content: string;
  left: number;
  top: number;
}

interface CitationPreview {
  citation: AgentCitation;
  anchor: DOMRect;
  entry?: Pick<ReportEntry, "title" | "content"> | null;
  error?: string;
}

type CitationGroup = "report" | "note";

const PAGE_SIZE = 40;
const SIDEBAR_WIDTH_KEY = "sidebar-folders-width";
const SIDEBAR_COLLAPSED_KEY = "askSidebarCollapsed";
const SIDEBAR_MIN_WIDTH = 140;
const SIDEBAR_MAX_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 220;
const NOTE_ACTIONS = new Set(["create", "write", "append"]);

function isNote(citation: AgentCitation): boolean {
  return citation.source === "note" || citation.level === "note";
}

function periodFromCitation(citation: AgentCitation): { type: "day" | "week" | "month"; key: string } | null {
  if (!citation.reportId) return null;
  if (citation.level === "daily" && citation.reportId.startsWith("daily:")) return { type: "day", key: citation.reportId.slice(6) };
  if (citation.level === "weekly" && citation.reportId.startsWith("weekly:")) return { type: "week", key: citation.reportId.slice(7) };
  if (citation.level === "monthly" && citation.reportId.startsWith("monthly:")) return { type: "month", key: citation.reportId.slice(8) };
  return null;
}

function readSidebarWidth(): number {
  const stored = Number.parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || "", 10);
  return Number.isFinite(stored) ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, stored)) : DEFAULT_SIDEBAR_WIDTH;
}

function initialSidebarCollapsed(): boolean {
  const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
  return stored === null ? window.innerWidth < 760 : stored === "1";
}

function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const field = document.createElement("textarea");
  field.value = value;
  document.body.appendChild(field);
  field.select();
  document.execCommand("copy");
  field.remove();
  return Promise.resolve();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function auditStatusLabel(status: string, t: Translate): string {
  const key: Record<string, string> = {
    proposed: "desktop.agent.auditStatusProposed",
    confirmed: "desktop.agent.auditStatusConfirmed",
    applied: "desktop.agent.auditStatusApplied",
    rejected: "desktop.agent.auditStatusRejected",
    failed: "desktop.agent.auditStatusFailed"
  };
  return key[status] ? t(key[status]) : status || t("desktop.agent.auditStatusUnknown");
}

function auditActionLabel(action: string, t: Translate): string {
  const key: Record<string, string> = {
    "note.create": "desktop.agent.auditActionCreate",
    "note.append": "desktop.agent.auditActionAppend",
    "note.write": "desktop.agent.auditActionWrite",
    "note.rename": "desktop.agent.auditActionRename",
    "note.move": "desktop.agent.auditActionMove",
    "note.delete": "desktop.agent.auditActionDelete"
  };
  return key[action] ? t(key[action]) : action || t("desktop.agent.auditActionDefault");
}

function citationLabel(citation: AgentCitation, t: Translate): string {
  const operations: Record<string, string> = {
    search: t("desktop.agent.toolSearch"),
    read: t("desktop.agent.toolRead"),
    create: t("desktop.agent.toolCreate"),
    write: t("desktop.agent.toolWrite"),
    append: t("desktop.agent.toolAppend"),
    delete: t("desktop.agent.toolDelete")
  };
  const source = isNote(citation) ? t("desktop.agent.noteLevel") : citation.level || "daily";
  const operation = citation.operation ? operations[citation.operation] : "";
  const subject = citation.title || citation.noteId || citation.reportId || t("desktop.agent.citationRef");
  const heading = isNote(citation) && citation.heading ? ` · ${citation.heading}` : "";
  const score = citation.score == null ? "" : ` · ${Number(citation.score).toFixed(3)}`;
  const session = citation.session ? ` · ${citation.session.provider}/${citation.session.id.slice(0, 10)}...` : "";
  const index = isNote(citation) ? `N${citation.index}` : citation.index;
  return `[${index}] ${operation ? `${operation} · ` : ""}${source} · ${subject}${heading}${score}${session}`;
}

function progressFromEvent(event: ProgressEvent): IndexProgress {
  return { ...event, visible: true };
}

function progressRatio(progress: IndexProgress): number {
  if (progress.phase === "complete") return 1;
  if (!progress.total) return 0;
  if (progress.phase === "embedding" && progress.chunkTotal) {
    return (Number(progress.current || 0) + Math.min(1, Number(progress.chunkCurrent || 0) / progress.chunkTotal)) / progress.total;
  }
  return Number(progress.current || 0) / progress.total;
}

type Translate = (key: string, ...args: Array<string | number>) => string;

export function AgentPanel(): ReactPortal | null {
  const host = document.getElementById("react-agent");
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [tools, setTools] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingThread, setEditingThread] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [audit, setAudit] = useState<AgentNoteAuditEvent[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [preview, setPreview] = useState<CitationPreview | null>(null);
  const streamOff = useRef<(() => void) | null>(null);
  const cancelled = useRef(false);
  const sendingRef = useRef(false);
  const indexHideTimer = useRef<number | null>(null);
  const previewHideTimer = useRef<number | null>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const prependScroll = useRef<{ height: number; top: number } | null>(null);
  const stickToBottom = useRef(true);
  const activeThread = useMemo(() => threads.find((thread) => thread.id === threadId), [threadId, threads]);

  const clearIndexHideTimer = () => {
    if (indexHideTimer.current !== null) window.clearTimeout(indexHideTimer.current);
    indexHideTimer.current = null;
  };
  const applyIndexProgress = useCallback((event: ProgressEvent) => {
    clearIndexHideTimer();
    setIndexProgress(progressFromEvent(event));
    if (event.phase === "complete" || event.phase === "error") {
      indexHideTimer.current = window.setTimeout(() => setIndexProgress(null), event.phase === "complete" ? 1600 : 5000);
    }
  }, []);
  const hideIndexProgress = useCallback((delay = 0) => {
    clearIndexHideTimer();
    if (delay) indexHideTimer.current = window.setTimeout(() => setIndexProgress(null), delay);
    else setIndexProgress(null);
  }, []);

  const loadMessages = useCallback(async (id: string, append = false) => {
    try {
      if (append) {
        const first = turns[0];
        if (!first || loadingOlder) return;
        setLoadingOlder(true);
        const log = logRef.current;
        if (log) prependScroll.current = { height: log.scrollHeight, top: log.scrollTop };
        const result = await desktopApi().listOlderAgentChat({ threadId: id, beforeSortOrder: first.sortOrder || 0, limit: PAGE_SIZE });
        setTurns((current) => [...result.messages, ...current]);
        setHasMore(result.hasMore);
        return;
      }
      const result = await desktopApi().listAgentChat({ threadId: id, limit: PAGE_SIZE });
      setTurns(result.messages.map((message) => ({ ...message })));
      setHasMore(result.hasMore);
    } catch (error) {
      setStatus({ text: append ? t("desktop.agent.loadOlderFailedPrefix", errorMessage(error)) : t("desktop.agent.loadChatFailedPrefix", errorMessage(error)), kind: "error" });
    } finally {
      if (append) setLoadingOlder(false);
    }
  }, [loadingOlder, t, turns]);

  const loadThreads = useCallback(async () => {
    try {
      let next = await desktopApi().listAgentThreads();
      if (!next.length) next = [await desktopApi().createAgentThread({ title: t("desktop.agent.newThread") })];
      const saved = localStorage.getItem("activeAgentThreadId");
      const selected = saved && next.some((thread) => thread.id === saved) ? saved : next[0]?.id || "";
      setThreads(next);
      setThreadId(selected);
      localStorage.setItem("activeAgentThreadId", selected);
      if (selected) await loadMessages(selected);
    } catch (error) {
      setStatus({ text: t("desktop.agent.loadThreadsFailedPrefix", errorMessage(error)), kind: "error" });
    }
  }, [loadMessages, t]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      setAudit(await desktopApi().listAgentNoteAudit({ limit: 80 }));
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-folders-width", `${sidebarWidth}px`);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);
  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "agent";
      setActive(show);
      if (show && !threads.length) void loadThreads();
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    return () => window.removeEventListener("agent-resume:tab-change", onTab);
  }, [loadThreads, threads.length]);
  useEffect(() => {
    if (auditOpen) void loadAudit();
  }, [auditOpen, loadAudit]);
  useEffect(() => {
    const api = desktopApi();
    if (typeof api.onNotesIndexProgress !== "function") return;
    const off = api.onNotesIndexProgress((event) => {
      applyIndexProgress(event);
      if (!sendingRef.current) {
        setStatus({ text: event.message || t("desktop.agent.indexingNotes"), kind: event.phase === "error" ? "error" : event.phase === "complete" ? "ok" : undefined });
      }
    });
    return off;
  }, [applyIndexProgress, t]);
  useEffect(() => () => {
    streamOff.current?.();
    clearIndexHideTimer();
    if (previewHideTimer.current !== null) window.clearTimeout(previewHideTimer.current);
  }, []);
  useEffect(() => {
    const pending = prependScroll.current;
    if (pending) {
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight - pending.height + pending.top;
        prependScroll.current = null;
        stickToBottom.current = false;
      });
      return;
    }
    if (stickToBottom.current) {
      requestAnimationFrame(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      });
    }
  }, [turns]);
  useEffect(() => {
    const dismiss = () => setContext(null);
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, []);

  const selectThread = async (id: string) => {
    if (id === threadId || sending) return;
    setThreadId(id);
    localStorage.setItem("activeAgentThreadId", id);
    setTurns([]);
    setHasMore(false);
    await loadMessages(id);
  };
  const createThread = async () => {
    try {
      const thread = await desktopApi().createAgentThread({ title: t("desktop.agent.newThread") });
      setThreads((current) => [thread, ...current]);
      setThreadId(thread.id);
      localStorage.setItem("activeAgentThreadId", thread.id);
      setTurns([]);
      setHasMore(false);
      setStatus({ text: "" });
    } catch (error) {
      setStatus({ text: t("desktop.agent.createFailedPrefix", errorMessage(error)), kind: "error" });
    }
  };
  const rename = async () => {
    const title = titleInput.trim();
    if (!title || !threadId) return;
    try {
      await desktopApi().renameAgentThread({ id: threadId, title });
      setThreads((current) => current.map((thread) => thread.id === threadId ? { ...thread, title } : thread));
      setEditingThread(false);
    } catch (error) {
      setStatus({ text: t("desktop.agent.renameFailedPrefix", errorMessage(error)), kind: "error" });
    }
  };
  const deleteThread = async (id = threadId) => {
    const thread = threads.find((item) => item.id === id);
    if (!thread || sending || !window.confirm(t("desktop.agent.deleteConfirmSimple", thread.title))) return;
    try {
      await desktopApi().deleteAgentThread({ id });
      const next = threads.filter((item) => item.id !== id);
      if (!next.length) {
        const replacement = await desktopApi().createAgentThread({ title: t("desktop.agent.newThread") });
        setThreads([replacement]);
        setThreadId(replacement.id);
        setTurns([]);
        setHasMore(false);
        localStorage.setItem("activeAgentThreadId", replacement.id);
        return;
      }
      setThreads(next);
      if (id === threadId) await selectThread(next[0]!.id);
    } catch (error) {
      setStatus({ text: t("desktop.agent.deleteFailedPrefix", errorMessage(error)), kind: "error" });
    }
  };
  const clearChat = async () => {
    if (!threadId || sending) return;
    try {
      await desktopApi().clearAgentChat({ threadId });
      setTurns([]);
      setHasMore(false);
      setExpanded(new Set());
      setStatus({ text: "" });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  };
  const cancel = async () => {
    cancelled.current = true;
    streamOff.current?.();
    streamOff.current = null;
    hideIndexProgress();
    setTurns((current) => current.filter((turn) => !turn.streaming));
    try {
      await desktopApi().cancelAskAgent();
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const send = async (queryOverride?: string) => {
    const query = (queryOverride ?? input).trim();
    if (!query || !threadId || sending) return;
    const pendingId = `pending-${Date.now()}`;
    const history = turns.filter((turn) => !turn.streaming).map((turn) => ({ role: turn.role, content: turn.content }));
    cancelled.current = false;
    sendingRef.current = true;
    setInput("");
    setSending(true);
    setStatus({ text: t("desktop.agent.searchingReports") });
    setTurns((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "user", content: query, sortOrder: Number.MAX_SAFE_INTEGER - 1 },
      { id: pendingId, role: "assistant", content: "", citations: [], sortOrder: Number.MAX_SAFE_INTEGER, streaming: true }
    ]);
    if (activeThread?.title === t("desktop.agent.newThread")) {
      const title = query.slice(0, 30);
      setThreads((current) => current.map((thread) => thread.id === threadId ? { ...thread, title } : thread));
      void desktopApi().renameAgentThread({ id: threadId, title });
    }
    streamOff.current = desktopApi().onAskStream((event: AgentStreamEvent) => {
      if (event.phase === "chunk" && event.delta) {
        setTurns((current) => current.map((turn) => turn.id === pendingId ? { ...turn, content: turn.content + event.delta } : turn));
      } else if (event.phase === "retrieving") {
        setStatus({ text: t("desktop.agent.searchingReports") });
      } else if (event.phase === "indexing_notes") {
        applyIndexProgress(event);
        setStatus({ text: event.message || t("desktop.agent.indexingNotes") });
      } else if (event.phase === "generating") {
        hideIndexProgress();
        setStatus({ text: event.message || t("desktop.agent.statusGenerating") });
      } else if (event.phase === "tool_calling") {
        setStatus({ text: t("desktop.agent.callingTool", event.toolName || "...") });
      } else if (event.phase === "tool_executing") {
        setStatus({ text: t("desktop.agent.executingTool", event.toolName || "...") });
      } else if (event.message) {
        setStatus({ text: event.message });
      }
    });
    try {
      const result = await desktopApi().askAgent({ query, history, threadId, enableTools: tools });
      setTurns((current) => current.map((turn) => turn.id === pendingId ? {
        id: pendingId,
        role: "assistant",
        content: result.answer,
        citations: result.citations,
        fallback: result.fallback,
        sortOrder: Number.MAX_SAFE_INTEGER
      } : turn));
      setStatus(result.persistWarning
        ? { text: result.persistWarning, kind: "error" }
        : {
            text: result.fallback
              ? t("desktop.agent.completeFallback", result.citations.length)
              : t("desktop.agent.completeDone", result.citations.length, result.toolCallsExecuted ? t("desktop.agent.completeToolCalls", result.toolCallsExecuted) : ""),
            kind: "ok"
          });
      if (auditOpen) void loadAudit();
    } catch (error) {
      setTurns((current) => current.filter((turn) => turn.id !== pendingId));
      if (!cancelled.current) setStatus({ text: errorMessage(error), kind: "error" });
    } finally {
      streamOff.current?.();
      streamOff.current = null;
      hideIndexProgress(800);
      sendingRef.current = false;
      setSending(false);
    }
  };
  const openCitation = (citation: AgentCitation) => {
    if (isNote(citation)) {
      if (citation.operation === "delete") {
        setStatus({ text: t("desktop.agent.noteDeleted"), kind: "error" });
      } else if (citation.noteId) {
        window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
        window.dispatchEvent(new CustomEvent("agent-resume:open-note", { detail: citation.noteId }));
      } else {
        setStatus({ text: t("desktop.agent.cannotResolveNote"), kind: "error" });
      }
      setPreview(null);
      return;
    }
    const period = periodFromCitation(citation);
    if (!period) {
      setStatus({ text: t("desktop.agent.cannotResolveReport"), kind: "error" });
      return;
    }
    window.dispatchEvent(new CustomEvent("agent-resume:report-focus", { detail: period }));
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "report" }));
    setPreview(null);
  };
  const showPreview = async (citation: AgentCitation, anchor: HTMLElement) => {
    if (previewHideTimer.current !== null) window.clearTimeout(previewHideTimer.current);
    const anchorRect = anchor.getBoundingClientRect();
    const immediate = citation.contentPreview ? { title: citation.title, content: citation.contentPreview } : undefined;
    setPreview({ citation, anchor: anchorRect, entry: immediate });
    if (immediate || isNote(citation) || !citation.reportId) return;
    try {
      const entry = await desktopApi().getReportEntry(citation.reportId);
      setPreview((current) => current?.citation === citation ? { ...current, entry: entry || null } : current);
    } catch (error) {
      setPreview((current) => current?.citation === citation ? { ...current, error: errorMessage(error) } : current);
    }
  };
  const hidePreviewSoon = () => {
    if (previewHideTimer.current !== null) window.clearTimeout(previewHideTimer.current);
    previewHideTimer.current = window.setTimeout(() => setPreview(null), 450);
  };
  const keepPreview = () => {
    if (previewHideTimer.current !== null) window.clearTimeout(previewHideTimer.current);
  };
  const onLogScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const log = event.currentTarget;
    stickToBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    if (log && log.scrollTop < 72 && hasMore && !loadingOlder && threadId) void loadMessages(threadId, true);
    setContext(null);
    hidePreviewSoon();
  };
  const resizeSidebar = (width: number) => setSidebarWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width))));
  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (sidebarCollapsed) setSidebarCollapsed(false);
    resizeStart.current = { x: event.clientX, width: sidebarWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-pane-resizing");
  };
  const moveResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeStart.current) resizeSidebar(resizeStart.current.width + event.clientX - resizeStart.current.x);
  };
  const endResize = (event: PointerEvent<HTMLDivElement>) => {
    resizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.classList.remove("is-pane-resizing");
  };

  if (!host) return null;
  const sidebarLabel = sidebarCollapsed ? t("desktop.common.showSidebar") : t("desktop.common.hideSidebar");
  return createPortal(
    <section className="panel active agent-panel react-agent-panel" hidden={!active} onClick={() => setContext(null)}>
      <div className="agent-layout">
        <aside className={`sidebar-folders-pane agent-sidebar-pane${sidebarCollapsed ? " is-collapsed" : ""}`}>
          <div className="sidebar-folders-header">
            <button id="btnAgentNewChat" type="button" className="notes-icon-btn" title={t("desktop.agent.newChat")} aria-label={t("desktop.agent.newChat")} onClick={() => void createThread()}><MessageSquarePlus size={18} /></button>
            <button type="button" className="sidebar-collapse-toggle" title={sidebarLabel} aria-label={sidebarLabel} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((current) => !current)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
          </div>
          <div className="agent-sidebar-list">{threads.map((thread) => <div className={`ask-thread-row${thread.id === threadId ? " active" : ""}`} key={thread.id}>
            <button type="button" className="ask-thread-row-select" onClick={() => void selectThread(thread.id)}><span className="ask-thread-row-label" title={thread.title}>{thread.title}</span></button>
            <button type="button" className="ask-thread-row-delete" title={t("desktop.agent.deleteThreadTitle")} aria-label={t("desktop.agent.deleteThreadTitle")} onClick={() => void deleteThread(thread.id)}><Trash2 size={15} /></button>
          </div>)}</div>
        </aside>
        <div className="pane-resizer" role="separator" aria-orientation="vertical" aria-label={t("desktop.agent.resizeSidebar")} aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={beginResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          if (sidebarCollapsed) setSidebarCollapsed(false);
          resizeSidebar(sidebarWidth + (event.key === "ArrowRight" ? 8 : -8));
        }} />
        <main className="ask-main-pane">
          <div className="toolbar ask-toolbar">
            {editingThread ? <form className="agent-title-editor" onSubmit={(event) => { event.preventDefault(); void rename(); }}><input value={titleInput} aria-label={t("desktop.agent.renameDialogTitle")} onChange={(event) => setTitleInput(event.target.value)} autoFocus /><button type="submit" className="icon-btn" aria-label={t("desktop.common.confirm")}><Check size={16} /></button></form> : <h2 className="quiet-title">{activeThread?.title || t("desktop.tabs.agent")}</h2>}
            <div className="agent-toolbar-actions">
              <button type="button" className="ghost-btn" onClick={() => { setTitleInput(activeThread?.title || ""); setEditingThread(true); }} disabled={!activeThread || sending}>{t("desktop.agent.renameChat")}</button>
              <button type="button" className={`ghost-btn${auditOpen ? " active" : ""}`} aria-pressed={auditOpen} onClick={() => setAuditOpen((value) => !value)}>{t("desktop.agent.audit")}</button>
              <button type="button" className="ghost-btn" onClick={() => void clearChat()} disabled={!activeThread || sending}>{t("desktop.agent.deleteChat")}</button>
            </div>
          </div>
          <div className="ask-chat-shell">
            <VirtualChatLog ref={logRef} turns={turns} hasMore={hasMore} loadingOlder={loadingOlder} expanded={expanded} setExpanded={setExpanded} t={t} onScroll={onLogScroll} onCitation={openCitation} onCitationPreview={showPreview} onCitationPreviewLeave={hidePreviewSoon} onUserContext={(event, content) => {
              event.preventDefault();
              event.stopPropagation();
              setContext({ content, left: Math.min(event.clientX, window.innerWidth - 160), top: Math.min(event.clientY, window.innerHeight - 100) });
            }} onCopy={(content) => void copyText(content).then(() => setStatus({ text: t("desktop.agent.copiedAnswer"), kind: "ok" }))} />
            <div className="chat-compose">
              <div className="chat-compose-field"><textarea rows={1} value={input} disabled={sending} placeholder={t("desktop.agent.inputPlaceholder")} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /></div>
              <button type="button" className={`chat-tools-toggle${tools ? " active" : ""}`} title={tools ? t("desktop.agent.toolsOn") : t("desktop.agent.toolsOffTitle")} aria-label={t("desktop.agent.toolsToggle")} aria-pressed={tools} disabled={sending} onClick={() => { setTools((value) => !value); setStatus({ text: tools ? t("desktop.agent.toolsOffStatus") : t("desktop.agent.toolsOnStatus"), kind: "ok" }); }}><Wrench size={18} /></button>
              {sending ? <button type="button" className="chat-send-btn" aria-label={t("desktop.common.cancel")} onClick={() => void cancel()}><Square size={17} /></button> : <button type="button" className="chat-send-btn" aria-label={t("desktop.common.send")} disabled={!input.trim()} onClick={() => void send()}><Send size={20} /></button>}
            </div>
            {indexProgress ? <IndexProgressView progress={indexProgress} t={t} /> : null}
            {auditOpen ? <Audit items={audit} loading={auditLoading} t={t} onRefresh={() => void loadAudit()} /> : null}
            <Status kind={status.kind}>{status.text}</Status>
          </div>
        </main>
      </div>
      {context ? <div className="chat-context-menu" style={{ left: context.left, top: context.top }} onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => void copyText(context.content).then(() => { setStatus({ text: t("desktop.agent.copied"), kind: "ok" }); setContext(null); })}>{t("desktop.common.copy")}</button><button type="button" disabled={sending} onClick={() => { setContext(null); void send(context.content); }}>{t("desktop.common.resend")}</button></div> : null}
      {preview ? <CitationPopover preview={preview} t={t} onKeep={keepPreview} onLeave={hidePreviewSoon} onOpen={() => openCitation(preview.citation)} /> : null}
    </section>,
    host
  );
}

const VirtualChatLog = forwardRef<HTMLDivElement, {
  turns: Turn[];
  hasMore: boolean;
  loadingOlder: boolean;
  expanded: Set<string>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  t: Translate;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  onCitation: (citation: AgentCitation) => void;
  onCitationPreview: (citation: AgentCitation, anchor: HTMLElement) => void;
  onCitationPreviewLeave: () => void;
  onUserContext: (event: React.MouseEvent, content: string) => void;
  onCopy: (content: string) => void;
}>(({ turns, hasMore, loadingOlder, expanded, setExpanded, t, onScroll, onCitation, onCitationPreview, onCitationPreviewLeave, onUserContext, onCopy }, ref) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const heights = useRef(new Map<string, number>());
  const [layoutVersion, forceLayout] = useState(0);
  const layout = useMemo(() => {
    const offsets: number[] = [];
    let total = 0;
    for (const turn of turns) {
      offsets.push(total);
      total += heights.current.get(turn.id) || (turn.role === "user" ? 52 : 160);
      total += 6;
    }
    return { offsets, total };
  }, [layoutVersion, turns, scrollTop, viewportHeight]);
  const range = useMemo(() => {
    const top = Math.max(0, scrollTop - 360);
    const bottom = scrollTop + viewportHeight + 360;
    let start = 0;
    while (start < turns.length - 1 && layout.offsets[start + 1]! < top) start += 1;
    let end = start;
    while (end < turns.length - 1 && layout.offsets[end]! < bottom) end += 1;
    return { start, end };
  }, [layout, scrollTop, turns.length, viewportHeight]);
  const setLogRef = useCallback((node: HTMLDivElement | null) => {
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
    if (node) setViewportHeight(node.clientHeight);
  }, [ref]);
  const onRowHeight = useCallback((id: string, height: number) => {
    if (heights.current.get(id) === height) return;
    heights.current.set(id, height);
    forceLayout((value) => value + 1);
  }, []);
  if (!turns.length) return <div ref={setLogRef} className="chat-log" onScroll={onScroll}><div className="chat-empty-state"><p className="chat-empty-title">{t("desktop.agent.emptyChat")}</p><p className="chat-empty-hint">{t("desktop.agent.emptyHint")}</p></div></div>;
  return <div ref={setLogRef} className="chat-log" onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop); setViewportHeight(event.currentTarget.clientHeight); onScroll(event); }}><div className="chat-virtual-inner" style={{ height: layout.total }}><div className="chat-virtual-window" style={{ transform: `translateY(${layout.offsets[range.start] || 0}px)` }}>{hasMore && range.start === 0 ? <p className="muted chat-load-older">{loadingOlder ? t("desktop.common.loading") : t("desktop.agent.loadOlder")}</p> : null}{turns.slice(range.start, range.end + 1).map((turn) => <MeasuredTurn key={turn.id} turn={turn} onHeight={onRowHeight}><TurnView turn={turn} expanded={expanded} setExpanded={setExpanded} t={t} onCitation={onCitation} onCitationPreview={onCitationPreview} onCitationPreviewLeave={onCitationPreviewLeave} onUserContext={onUserContext} onCopy={onCopy} /></MeasuredTurn>)}</div></div></div>;
});

function MeasuredTurn({ turn, onHeight, children }: { turn: Turn; onHeight: (id: string, height: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") {
      onHeight(turn.id, node.offsetHeight);
      return;
    }
    const observer = new ResizeObserver(() => onHeight(turn.id, node.offsetHeight));
    observer.observe(node);
    onHeight(turn.id, node.offsetHeight);
    return () => observer.disconnect();
  }, [onHeight, turn.id]);
  return <div ref={ref}>{children}</div>;
}

function TurnView({ turn, expanded, setExpanded, t, onCitation, onCitationPreview, onCitationPreviewLeave, onUserContext, onCopy }: {
  turn: Turn;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  t: Translate;
  onCitation: (citation: AgentCitation) => void;
  onCitationPreview: (citation: AgentCitation, anchor: HTMLElement) => void;
  onCitationPreviewLeave: () => void;
  onUserContext: (event: React.MouseEvent, content: string) => void;
  onCopy: (content: string) => void;
}) {
  const reports = turn.citations?.filter((citation) => !isNote(citation)) || [];
  const notes = turn.citations?.filter(isNote) || [];
  const actions = (turn.citations || []).filter((citation) => isNote(citation) && citation.operation && NOTE_ACTIONS.has(citation.operation));
  const group = (kind: CitationGroup, list: AgentCitation[], label: string) => {
    const id = `${turn.id}:${kind}`;
    const open = expanded.has(id);
    return list.length ? <section className={`citation-section${open ? "" : " collapsed"}`}><button type="button" className="citation-section-head" aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); if (open) next.delete(id); else next.add(id); return next; })}><ChevronDown size={14} /><span>{label} ({list.length})</span></button>{open ? <div className="citation-section-body">{list.map((citation, index) => <button type="button" className="citation-chip" key={`${citation.index}-${index}`} title={t("desktop.agent.citationHover")} onMouseEnter={(event) => void onCitationPreview(citation, event.currentTarget)} onFocus={(event) => void onCitationPreview(citation, event.currentTarget)} onMouseLeave={onCitationPreviewLeave} onBlur={onCitationPreviewLeave} onClick={() => onCitation(citation)}>{citationLabel(citation, t)}</button>)}</div> : null}</section> : null;
  };
  if (turn.role === "user") return <div className="chat-message chat-message-out"><div className="chat-bubble user" onContextMenu={(event) => onUserContext(event, turn.content)}>{turn.content}</div></div>;
  return <div className="chat-message chat-message-in"><div className={`chat-bubble assistant${turn.streaming ? " streaming" : ""}`}><div className="chat-sender"><Bot size={14} /> Memory Agent</div><div className="chat-body"><div className={`chat-body-text${turn.streaming ? "" : " markdown-body"}`} {...(turn.streaming ? {} : { dangerouslySetInnerHTML: { __html: renderMarkdown(turn.content) } })}>{turn.streaming ? turn.content : null}</div>{turn.streaming ? <LoaderCircle className="chat-stream-cursor" size={14} /> : null}</div>{!turn.streaming && actions.length ? <div className="note-action-bubbles">{actions.map((citation, index) => <button type="button" className="note-action-bubble" key={`${citation.noteId}-${index}`} title={t("desktop.agent.openInNotesTitle", citation.title || citation.noteId || t("desktop.agent.citationUnnamedNote"))} onClick={() => onCitation(citation)}>{citation.operation} · {citation.title || citation.noteId || t("desktop.agent.citationUnnamedNote")}</button>)}</div> : null}{group("report", reports, t("desktop.agent.citationReports"))}{group("note", notes, t("desktop.agent.citationNotes"))}<div className="chat-footer"><span className="chat-footer-meta">{turn.streaming ? t("desktop.agent.typing") : turn.fallback ? t("desktop.agent.recentSummary") : t("desktop.agent.reportRetrieval")}</span>{!turn.streaming && turn.content ? <button type="button" className="chat-copy-btn" onClick={() => onCopy(turn.content)}><Copy size={14} />{t("desktop.common.copy")}</button> : null}</div></div></div>;
}

function IndexProgressView({ progress, t }: { progress: IndexProgress; t: Translate }) {
  const current = Number(progress.current || 0);
  const displayCurrent = progress.phase === "embedding" ? current + 1 : current;
  return <div className={`agent-index-progress${progress.phase === "scanning" ? " is-scanning" : ""}${progress.phase === "error" ? " is-error" : ""}`}><div className="agent-index-progress-head"><span id="agentIndexProgressText">{progress.noteTitle ? `${progress.message || t("desktop.agent.indexingNotes")} · ${progress.noteTitle}` : progress.message || t("desktop.agent.indexingNotes")}</span><span id="agentIndexProgressCount">{progress.total ? `${Math.min(displayCurrent, progress.total)}/${progress.total}` : ""}</span></div><div className="agent-index-progress-track"><div className="agent-index-progress-bar" style={{ width: `${Math.max(0, Math.min(100, progressRatio(progress) * 100))}%` }} /></div></div>;
}

function CitationPopover({ preview, t, onKeep, onLeave, onOpen }: { preview: CitationPreview; t: Translate; onKeep: () => void; onLeave: () => void; onOpen: () => void }) {
  const left = Math.max(8, Math.min(preview.anchor.right + 8, window.innerWidth - 348));
  const top = Math.max(8, Math.min(preview.anchor.top, window.innerHeight - 240));
  const title = preview.entry?.title || preview.citation.title || preview.citation.noteId || preview.citation.reportId || t("desktop.agent.citationRef");
  const content = preview.entry?.content;
  const openLabel = isNote(preview.citation) ? t("desktop.agent.openInNotes") : t("desktop.agent.openInReport");
  return <div className="citation-popover" data-placement="right" style={{ left, top } as CSSProperties} onMouseEnter={onKeep} onMouseLeave={onLeave}><div className="citation-popover-content"><div className="citation-preview-head">{title}</div><div className="citation-preview-body">{preview.error ? <p className="muted">{t("desktop.agent.previewLoadFailed", preview.error)}</p> : content ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(content.slice(0, 900)) }} /> : <p className="muted">{t("desktop.agent.citationNoPreview", preview.citation.noteId || preview.citation.reportId ? ` (${preview.citation.noteId || preview.citation.reportId})` : "")}</p>}</div><button type="button" className="citation-preview-open ghost-btn" onClick={onOpen}>{openLabel}</button></div></div>;
}

function Audit({ items, loading, t, onRefresh }: { items: AgentNoteAuditEvent[]; loading: boolean; t: Translate; onRefresh: () => void }) {
  const formatTime = (value: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(value);
  return <section className="agent-audit-panel"><div className="ask-audit-head"><strong>{t("desktop.agent.auditTitle")}</strong><button type="button" className="ghost-btn" onClick={onRefresh}>{t("desktop.common.refresh")}</button></div><div className="agent-audit-list">{loading ? <p className="muted agent-audit-empty">{t("desktop.agent.auditLoading")}</p> : items.length ? items.map((item) => <article className="ask-audit-item" data-status={item.status} key={item.id}><div className="ask-audit-item-main"><span className="agent-audit-action">{auditActionLabel(item.action, t)}</span><span className="ask-audit-note"><FileText size={14} /> {item.noteTitle || item.relMdPath || item.noteId || t("desktop.agent.auditUnspecifiedNote")}</span></div><div className="ask-audit-item-meta"><span className="agent-audit-status">{auditStatusLabel(item.status, t)}</span><span>{[formatTime(item.createdAtMs), item.actor || "agent", item.traceId ? `trace ${item.traceId.slice(0, 8)}` : ""].filter(Boolean).join(" · ")}</span></div>{item.error ? <p className="ask-audit-error">{item.error}</p> : null}</article>) : <p className="muted agent-audit-empty">{t("desktop.agent.auditEmpty")}</p>}</div></section>;
}
