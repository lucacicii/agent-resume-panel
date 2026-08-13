import { ThemeIcon } from "../../components/ThemeIcon";
import { createPortal } from "react-dom";
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode, type ReactPortal } from "react";
import type { AgentChatMessage, AgentCitation, AgentExecutionStep, AgentNoteAuditEvent, AgentStreamEvent, AgentThread, AgentToolCategory, AgentToolDescriptor, ProjectRow, ReportEntry } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { renderMarkdown } from "../../components/Markdown";
import { Sheet } from "../../components/Sheet";
import { useI18n } from "../../i18n";

interface Turn extends Pick<AgentChatMessage, "role" | "content" | "citations" | "fallback" | "sortOrder" | "toolTrace"> {
  id: string;
  streaming?: boolean;
  activityText?: string;
  activityKind?: StatusKind;
  completionText?: string;
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
  turnId: string;
  sortOrder: number;
  content: string;
  left: number;
  top: number;
}

/** Tool selection for a chat thread. */
type AskToolMode = "auto" | "custom" | "off";
interface AskToolPrefs {
  mode: AskToolMode;
  /** Checked tools; only consulted when mode === "custom". */
  enabledTools: string[];
}

const LOCAL_SORT_ORDER_FLOOR = Number.MAX_SAFE_INTEGER - 1000;

const PAGE_SIZE = 40;
const SIDEBAR_WIDTH_KEY = "sidebar-folders-width";
const SIDEBAR_COLLAPSED_KEY = "askSidebarCollapsed";
const SIDEBAR_MIN_WIDTH = 140;
const SIDEBAR_MAX_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 260;
const THREAD_PROJECT_KEY_PREFIX = "agent-thread-project:";
function threadProjectKey(threadId: string): string {
  return `${THREAD_PROJECT_KEY_PREFIX}${threadId}`;
}
function readThreadProject(threadId: string): string {
  return localStorage.getItem(threadProjectKey(threadId)) || "";
}
function writeThreadProject(threadId: string, value: string): void {
  localStorage.setItem(threadProjectKey(threadId), value);
}
const THREAD_TOOLS_KEY_PREFIX = "agent-thread-tools:";
function threadToolsKey(threadId: string): string {
  return `${THREAD_TOOLS_KEY_PREFIX}${threadId}`;
}
function readThreadTools(threadId: string): AskToolPrefs {
  try {
    const raw = localStorage.getItem(threadToolsKey(threadId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AskToolPrefs>;
      if (parsed.mode === "auto" || parsed.mode === "custom" || parsed.mode === "off") {
        return { mode: parsed.mode, enabledTools: Array.isArray(parsed.enabledTools) ? parsed.enabledTools : [] };
      }
    }
  } catch {
    // Corrupt stored value — fall back to the default.
  }
  return { mode: "auto", enabledTools: [] };
}
function writeThreadTools(threadId: string, prefs: AskToolPrefs): void {
  localStorage.setItem(threadToolsKey(threadId), JSON.stringify(prefs));
}
function isNote(citation: AgentCitation): boolean {
  return citation.source === "note" || citation.level === "note";
}

function isSession(citation: AgentCitation): boolean {
  return citation.source === "session" || citation.level === "session";
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
    delete: t("desktop.agent.toolDelete"),
    rename: t("desktop.agent.toolWrite"),
    move: t("desktop.agent.toolWrite"),
    link: t("desktop.agent.toolWrite")
  };
  const source = isNote(citation)
    ? t("desktop.agent.noteLevel")
    : isSession(citation)
      ? t("desktop.agent.sessionLevel")
      : citation.level || "daily";
  const operation = citation.operation ? operations[citation.operation] : "";
  const subject =
    citation.title ||
    citation.noteId ||
    citation.reportId ||
    (citation.session ? `${citation.session.provider}/${citation.session.id.slice(0, 10)}` : "") ||
    t("desktop.agent.citationRef");
  const heading = isNote(citation) && citation.heading ? ` · ${citation.heading}` : "";
  const score = citation.score == null ? "" : ` · ${Number(citation.score).toFixed(3)}`;
  // Report digests may link a related session; session citations already show provider/id in subject.
  const linkedSession =
    !isSession(citation) && citation.session
      ? ` · ${citation.session.provider}/${citation.session.id.slice(0, 10)}...`
      : "";
  const index = isNote(citation) ? `N${citation.index}` : isSession(citation) ? `S${citation.index}` : citation.index;
  return `[${index}] ${operation ? `${operation} · ` : ""}${source} · ${subject}${heading}${score}${linkedSession}`;
}

function citationMarker(citation: AgentCitation): string {
  return `${isNote(citation) ? "N" : isSession(citation) ? "S" : ""}${citation.index}`;
}

function citationForMarker(citations: AgentCitation[], marker: string): AgentCitation | undefined {
  return citations.find((citation) => citationMarker(citation) === marker);
}

const CITATION_MARKER = /\[(?:(N|S)(\d+)|(\d+))\]/g;

function renderAssistantMarkdown(content: string, citations: AgentCitation[]): string {
  if (!citations.length || typeof document === "undefined") return renderMarkdown(content);

  const template = document.createElement("template");
  template.innerHTML = renderMarkdown(content);
  const walker = document.createTreeWalker(template.content, 4);
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (parent && !parent.closest("a, code, pre")) textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const value = textNode.data;
    const matches = [...value.matchAll(CITATION_MARKER)].filter((match) => citationForMarker(citations, `${match[1] || ""}${match[2] || match[3]}`));
    if (!matches.length) continue;

    const replacement = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const marker = `${match[1] || ""}${match[2] || match[3]}`;
      const start = match.index || 0;
      replacement.append(value.slice(offset, start));
      const link = document.createElement("a");
      link.className = "agent-citation-link";
      link.href = `#citation-${marker}`;
      link.dataset.agentCitation = marker;
      link.title = citationForMarker(citations, marker)?.title || `[${marker}]`;
      link.textContent = match[0];
      replacement.append(link);
      offset = start + match[0].length;
    }
    replacement.append(value.slice(offset));
    textNode.replaceWith(replacement);
  }

  return template.innerHTML;
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
  const [toolPrefs, setToolPrefs] = useState<AskToolPrefs>({ mode: "auto", enabledTools: [] });
  const [toolsPopoverOpen, setToolsPopoverOpen] = useState(false);
  const [toolCatalog, setToolCatalog] = useState<AgentToolDescriptor[] | null>(null);
  const toolsPopoverRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectPath, setProjectPath] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [editingThread, setEditingThread] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [audit, setAudit] = useState<AgentNoteAuditEvent[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [indexProgress, setIndexProgress] = useState<IndexProgress | null>(null);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [traceDrawerTurnId, setTraceDrawerTurnId] = useState<string | null>(null);
  const [citationDrawerTurnId, setCitationDrawerTurnId] = useState<string | null>(null);
  const streamOff = useRef<(() => void) | null>(null);
  const cancelled = useRef(false);
  const sendingRef = useRef(false);
  const indexHideTimer = useRef<number | null>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const prependScroll = useRef<{ height: number; top: number } | null>(null);
  const stickToBottom = useRef(true);
  const activeThread = useMemo(() => threads.find((thread) => thread.id === threadId), [threadId, threads]);
  const scopeLabel = useMemo(() => {
    if (!projectPath) return t("desktop.agent.contextProjectAll");
    const match = projects.find((project) => (project.localPath || project.portableKey) === projectPath);
    return match ? (match.alias || match.portableKey) : projectPath;
  }, [projectPath, projects, t]);
  const toolsEffectiveOn = toolPrefs.mode === "auto" || (toolPrefs.mode === "custom" && toolPrefs.enabledTools.length > 0);
  const visibleTools = useMemo(
    () => toolCatalog ? (projectPath ? toolCatalog : toolCatalog.filter((tool) => tool.category !== "link_graph")) : [],
    [toolCatalog, projectPath]
  );
  const pendingApproval = useMemo(() => {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const step = (turns[index].toolTrace || []).find((item) => item.kind === "tool" && item.status === "awaiting_approval");
      if (step) return step;
    }
    return null;
  }, [turns]);

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
      setProjectPath(readThreadProject(selected));
      setToolPrefs(readThreadTools(selected));
      setToolsPopoverOpen(false);
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
    const api = desktopApi();
    if (typeof api.listProjects !== "function") return;
    void api.listProjects().then(setProjects).catch(() => setProjects([]));
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
      if (!sendingRef.current && event.phase === "complete") setStatus({ text: "" });
      else if (!sendingRef.current && event.phase === "error") setStatus({ text: "" });
    });
    return off;
  }, [applyIndexProgress]);
  useEffect(() => () => {
    streamOff.current?.();
    clearIndexHideTimer();
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
  useEffect(() => {
    if (!toolsPopoverOpen || toolCatalog) return;
    let active = true;
    const api = desktopApi();
    if (typeof api.listAgentTools !== "function") return;
    void api.listAgentTools()
      .then((list) => { if (active) setToolCatalog(list); })
      .catch(() => { if (active) setToolCatalog([]); });
    return () => { active = false; };
  }, [toolsPopoverOpen, toolCatalog]);
  useEffect(() => {
    if (!toolsPopoverOpen) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (toolsPopoverRef.current && !toolsPopoverRef.current.contains(event.target as Node)) {
        setToolsPopoverOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolsPopoverOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [toolsPopoverOpen]);

  const selectThread = async (id: string) => {
    if (id === threadId || sending) return;
    setThreadId(id);
    setProjectPath(readThreadProject(id));
    setToolPrefs(readThreadTools(id));
    setToolsPopoverOpen(false);
    localStorage.setItem("activeAgentThreadId", id);
    setTurns([]);
    setHasMore(false);
    setEditingTurnId(null);
    setEditDraft("");
    await loadMessages(id);
  };
  const createThread = async () => {
    try {
      const thread = await desktopApi().createAgentThread({ title: t("desktop.agent.newThread") });
      setThreads((current) => [thread, ...current]);
      setThreadId(thread.id);
      setProjectPath("");
      setToolPrefs({ mode: "auto", enabledTools: [] });
      setToolsPopoverOpen(false);
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
      localStorage.removeItem(threadProjectKey(id));
      localStorage.removeItem(threadToolsKey(id));
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
  const cancelEdit = () => {
    setEditingTurnId(null);
    setEditDraft("");
  };

  const send = async (queryOverride?: string, options?: { fromTurnId?: string }) => {
    const query = (queryOverride ?? input).trim();
    if (!query || !threadId || sending) return;

    let prefix = turns.filter((turn) => !turn.streaming);
    if (options?.fromTurnId) {
      const index = turns.findIndex((turn) => turn.id === options.fromTurnId);
      if (index < 0) {
        setStatus({ text: t("desktop.agent.loadChatFailedPrefix", options.fromTurnId), kind: "error" });
        return;
      }
      const target = turns[index]!;
      prefix = turns.slice(0, index).filter((turn) => !turn.streaming);
      const sortOrder = Number(target.sortOrder || 0);
      const canTruncateDb = Number.isFinite(sortOrder) && sortOrder > 0 && sortOrder < LOCAL_SORT_ORDER_FLOOR;
      if (canTruncateDb) {
        try {
          await desktopApi().truncateAgentChat({ threadId, fromSortOrder: sortOrder });
        } catch (error) {
          setStatus({ text: errorMessage(error), kind: "error" });
          return;
        }
      }
      setTurns(prefix);
      cancelEdit();
    }

    const history = prefix.map((turn) => ({ role: turn.role, content: turn.content }));
    const pendingId = `pending-${Date.now()}`;
    cancelled.current = false;
    sendingRef.current = true;
    setInput("");
    setSending(true);
    setStatus({ text: "" });
    setToolsPopoverOpen(false);
    setTurns([
      ...prefix,
      { id: `local-${Date.now()}`, role: "user", content: query, sortOrder: Number.MAX_SAFE_INTEGER - 1 },
      { id: pendingId, role: "assistant", content: "", citations: [], toolTrace: [], sortOrder: Number.MAX_SAFE_INTEGER, streaming: true, activityText: t("desktop.agent.searchingReports") }
    ]);
    if (activeThread?.title === t("desktop.agent.newThread")) {
      const title = query.slice(0, 30);
      setThreads((current) => current.map((thread) => thread.id === threadId ? { ...thread, title } : thread));
      void desktopApi().renameAgentThread({ id: threadId, title });
    }
    streamOff.current = desktopApi().onAskStream((event: AgentStreamEvent) => {
      const updateActivity = (activityText: string, activityKind?: StatusKind) => {
        setTurns((current) => current.map((turn) => turn.id === pendingId ? { ...turn, activityText, activityKind } : turn));
      };
      if (event.phase === "chunk" && event.delta) {
        setTurns((current) => current.map((turn) => turn.id === pendingId ? { ...turn, content: turn.content + event.delta, activityText: undefined, activityKind: undefined } : turn));
      } else if (event.phase === "retrieving") {
        updateActivity(event.message || t("desktop.agent.searchingReports"));
      } else if (event.phase === "indexing_notes") {
        updateActivity(event.message || t("desktop.agent.indexingNotes"));
      } else if (event.phase === "generating") {
        hideIndexProgress();
        updateActivity(event.message || t("desktop.agent.requestingLlm"));
      } else if (event.phase === "execution" && event.execution) {
        setTurns((current) => current.map((turn) => turn.id === pendingId ? {
          ...turn,
          toolTrace: upsertExecutionStep(turn.toolTrace || [], event.execution!)
        } : turn));
      } else if (event.phase === "tool_calling") {
        updateActivity(t("desktop.agent.callingTool", event.toolName || "..."));
      } else if (event.phase === "tool_approval_required") {
        updateActivity(t("desktop.agent.toolApprovalNeeded", event.toolName || "..."));
        if (event.toolCallId) {
          setTurns((current) => current.map((turn) => turn.id === pendingId ? {
            ...turn,
            toolTrace: (turn.toolTrace || []).map((step) => step.id === event.toolCallId ? { ...step, status: "awaiting_approval" } : step)
          } : turn));
        }
      } else if (event.phase === "tool_executing") {
        const completedStatus = event.toolStatus || "succeeded";
        updateActivity(
          `${event.toolName || "..."} · ${traceStatusLabel(completedStatus, t)}`,
          completedStatus === "failed" || completedStatus === "rejected" ? "error" : completedStatus === "succeeded" ? "ok" : undefined
        );
        if (event.toolCallId) {
          setTurns((current) => current.map((turn) => turn.id === pendingId ? {
            ...turn,
            toolTrace: (turn.toolTrace || []).map((step) => step.id === event.toolCallId ? {
              ...step,
              status: event.toolStatus || "succeeded",
              result: event.toolResult,
              error: event.toolError,
              completedAtMs: Date.now()
            } : step)
          } : turn));
        }
      } else if (event.message) {
        updateActivity(event.message);
      }
    });
    try {
      const result = await desktopApi().askAgent({
        query,
        history,
        threadId,
        enableTools: toolsEffectiveOn,
        enabledTools: toolPrefs.mode === "custom" && toolPrefs.enabledTools.length > 0 ? toolPrefs.enabledTools : undefined,
        projectPath: projectPath || undefined
      });
      const completionText = result.fallback
        ? t("desktop.agent.completeFallback", result.citations.length)
        : t("desktop.agent.completeDone", result.citations.length, result.toolCallsExecuted ? t("desktop.agent.completeToolCalls", result.toolCallsExecuted) : "");
      try {
        const log = await desktopApi().listAgentChat({ threadId, limit: PAGE_SIZE });
        const latestAssistantIndex = log.messages.map((message) => message.role).lastIndexOf("assistant");
        setTurns(log.messages.map((message, index) => ({ ...message, completionText: index === latestAssistantIndex && !result.persistWarning ? completionText : undefined })));
        setHasMore(log.hasMore);
      } catch {
        setTurns((current) => current.map((turn) => turn.id === pendingId ? {
          id: pendingId,
          role: "assistant",
          content: result.answer,
          citations: result.citations,
          fallback: result.fallback,
          toolTrace: result.toolTrace,
          sortOrder: Number.MAX_SAFE_INTEGER,
          completionText: result.persistWarning ? undefined : completionText
        } : turn));
      }
      setStatus(result.persistWarning
        ? { text: result.persistWarning, kind: "error" }
        : { text: "" });
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
      return;
    }
    if (isSession(citation)) {
      const session = citation.session;
      if (!session?.provider || !session.id) {
        setStatus({ text: t("desktop.agent.cannotResolveSession"), kind: "error" });
        return;
      }
      window.dispatchEvent(
        new CustomEvent("agent-resume:sessions-preview", {
          detail: {
            provider: session.provider,
            id: session.id,
            title: citation.title || session.id,
            projectPath: session.projectPath || "",
            updatedAt: citation.periodStartMs || Date.now()
          }
        })
      );
      return;
    }
    const period = periodFromCitation(citation);
    if (!period) {
      setStatus({ text: t("desktop.agent.cannotResolveReport"), kind: "error" });
      return;
    }
    window.dispatchEvent(new CustomEvent("agent-resume:report-focus", { detail: period }));
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "report" }));
  };
  const resumeCitationSession = async (citation: AgentCitation) => {
    const session = citation.session;
    if (!session?.provider || !session.id) {
      setStatus({ text: t("desktop.agent.cannotResolveSession"), kind: "error" });
      return;
    }
    try {
      const result = await desktopApi().workbenchOpenSession({ provider: session.provider, id: session.id });
      if (result.external) {
        // External terminal/editor is opening; report and stay.
        setStatus({ text: t("desktop.agent.resumeStarted", session.provider, session.id), kind: "ok" });
        return;
      }
      // Workbench decides: focus the already-open pane, or open the session fresh.
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-open-session", { detail: session }));
      setStatus({ text: t("desktop.agent.resumeStarted", session.provider, session.id), kind: "ok" });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  };
  const respondToolApproval = (toolCallId: string, approved: boolean) => {
    setTurns((current) => current.map((turn) => ({
      ...turn,
      toolTrace: (turn.toolTrace || []).map((step) => step.id === toolCallId
        ? { ...step, status: approved ? "running" : "rejected" }
        : step)
    })));
    void desktopApi().respondToolApproval({ toolCallId, approved }).catch((error) => {
      setStatus({ text: errorMessage(error), kind: "error" });
    });
  };
  const onLogScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const log = event.currentTarget;
    stickToBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48;
    if (log && log.scrollTop < 72 && hasMore && !loadingOlder && threadId) void loadMessages(threadId, true);
    setContext(null);
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
  // The toolbar and the folders-header buttons live in the app header while Ask is active.
  const headerSlot = document.getElementById("app-header-slot");
  const foldersHeaderButtons = (
    <>
      <button type="button" className="sidebar-collapse-toggle" title={sidebarLabel} aria-label={sidebarLabel} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((current) => !current)}><ThemeIcon name="panel-right" size={17} /></button>
      <button id="btnAgentNewChat" type="button" className="notes-icon-btn" title={t("desktop.agent.newChat")} aria-label={t("desktop.agent.newChat")} onClick={() => void createThread()}><ThemeIcon name="message-square-plus" size={17} /></button>
    </>
  );
  const toolbar = (
    <div className="toolbar ask-toolbar">
      {editingThread ? <form className="agent-title-editor" onSubmit={(event) => { event.preventDefault(); void rename(); }}><input value={titleInput} aria-label={t("desktop.agent.renameDialogTitle")} onChange={(event) => setTitleInput(event.target.value)} autoFocus /><button type="submit" className="icon-btn" aria-label={t("desktop.common.confirm")}><ThemeIcon name="check" size={16} /></button></form> : <h2 className="quiet-title">{activeThread?.title || t("desktop.tabs.agent")}</h2>}
      <div className="agent-toolbar-actions">
        <button type="button" className="ghost-btn" onClick={() => { setTitleInput(activeThread?.title || ""); setEditingThread(true); }} disabled={!activeThread || sending}>{t("desktop.agent.renameChat")}</button>
        <button type="button" className={`ghost-btn${auditOpen ? " active" : ""}`} aria-pressed={auditOpen} onClick={() => setAuditOpen((value) => !value)}>{t("desktop.agent.audit")}</button>
        <button type="button" className="ghost-btn" onClick={() => void clearChat()} disabled={!activeThread || sending}>{t("desktop.agent.deleteChat")}</button>
      </div>
    </div>
  );

return createPortal(
    <section className="panel active agent-panel react-agent-panel" hidden={!active} onClick={() => setContext(null)}>
      {active && headerSlot ? createPortal(foldersHeaderButtons, headerSlot) : null}
      <div className="agent-layout">
        <aside className={`sidebar-folders-pane agent-sidebar-pane${sidebarCollapsed ? " is-collapsed" : ""}`}>
          <div className="agent-sidebar-list">{threads.map((thread) => <div className={`ask-thread-row${thread.id === threadId ? " active" : ""}`} key={thread.id}>
            <button type="button" className="ask-thread-row-select" onClick={() => void selectThread(thread.id)}><span className="ask-thread-row-label" title={thread.title}>{thread.title}</span></button>
            <button type="button" className="ask-thread-row-delete" title={t("desktop.agent.deleteThreadTitle")} aria-label={t("desktop.agent.deleteThreadTitle")} onClick={() => void deleteThread(thread.id)}><ThemeIcon name="trash" size={15} /></button>
          </div>)}</div>
        </aside>
        <div className="pane-resizer" role="separator" aria-orientation="vertical" aria-label={t("desktop.agent.resizeSidebar")} aria-valuemin={SIDEBAR_MIN_WIDTH} aria-valuemax={SIDEBAR_MAX_WIDTH} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={beginResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          if (sidebarCollapsed) setSidebarCollapsed(false);
          resizeSidebar(sidebarWidth + (event.key === "ArrowRight" ? 8 : -8));
        }} />
        <main className="ask-main-pane">
          {active && headerSlot ? createPortal(toolbar, headerSlot) : null}
          <div className="ask-chat-shell">
            {indexProgress || status.text || auditOpen ? <div className="agent-chat-notices">
              {indexProgress ? <IndexProgressView progress={indexProgress} t={t} /> : null}
              <Status kind={status.kind}>{status.text}</Status>
              {auditOpen ? <Audit items={audit} loading={auditLoading} t={t} onRefresh={() => void loadAudit()} /> : null}
            </div> : null}
            <VirtualChatLog ref={logRef} turns={turns} hasMore={hasMore} loadingOlder={loadingOlder} t={t} onOpenTrace={setTraceDrawerTurnId} onOpenCitations={setCitationDrawerTurnId} onOpenCitation={openCitation} onScroll={onLogScroll} editingTurnId={editingTurnId} editDraft={editDraft} sending={sending} onEditDraftChange={setEditDraft} onCancelEdit={cancelEdit} onConfirmEdit={() => { if (editingTurnId) void send(editDraft, { fromTurnId: editingTurnId }); }} onUserContext={(event, turn) => {
              event.preventDefault();
              event.stopPropagation();
              setContext({
                turnId: turn.id,
                sortOrder: turn.sortOrder || 0,
                content: turn.content,
                left: Math.min(event.clientX, window.innerWidth - 160),
                top: Math.min(event.clientY, window.innerHeight - 120)
              });
            }} onCopy={(content) => void copyText(content).then(() => setStatus({ text: t("desktop.agent.copiedAnswer"), kind: "ok" }))} />
            {pendingApproval ? <ToolApprovalBar step={pendingApproval} t={t} onRespond={(approved) => respondToolApproval(pendingApproval.id, approved)} /> : null}
            <div className="chat-compose">
              <div className="chat-compose-frame">
                <div className="chat-compose-field"><textarea rows={1} value={input} disabled={sending} placeholder={t("desktop.agent.inputPlaceholder")} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /></div>
                <div className="chat-compose-toolbar">
                  <span className="chat-compose-context" title={scopeLabel}><ThemeIcon name="folder" size={16} /><select className="chat-compose-context-select" value={projectPath} aria-label={t("desktop.agent.contextProjectTitle")} disabled={sending} onChange={(event) => { const value = event.target.value; setProjectPath(value); if (threadId) writeThreadProject(threadId, value); }}><option value="">{t("desktop.agent.contextProjectAll")}</option>{projects.map((project) => <option key={project.projectId} value={project.localPath || project.portableKey}>{project.alias || project.portableKey}</option>)}</select></span>
                  <span className="chat-compose-toolbar-divider" aria-hidden="true" />
                  <span className="chat-tools-wrap" ref={toolsPopoverRef}>
                    <button type="button" className={`chat-tools-toggle${toolsEffectiveOn ? " active" : ""}`} title={toolsEffectiveOn ? t("desktop.agent.toolsOn") : t("desktop.agent.toolsOffTitle")} aria-label={t("desktop.agent.toolsToggle")} aria-pressed={toolsEffectiveOn} aria-expanded={toolsPopoverOpen} aria-haspopup="dialog" disabled={sending} onClick={() => setToolsPopoverOpen((value) => !value)}><ThemeIcon name="wrench" size={16} /></button>
                    {toolsPopoverOpen ? <ToolSettingsPopover prefs={toolPrefs} tools={visibleTools} onPrefsChange={(next) => { setToolPrefs(next); if (threadId) writeThreadTools(threadId, next); }} onClose={() => setToolsPopoverOpen(false)} t={t} /> : null}
                  </span>
                  <span className="chat-compose-toolbar-spacer" />
                  {sending ? <button type="button" className="chat-send-btn" aria-label={t("desktop.common.cancel")} onClick={() => void cancel()}><ThemeIcon name="square" size={15} /></button> : <button type="button" className="chat-send-btn" aria-label={t("desktop.common.send")} disabled={!input.trim()} onClick={() => void send()}><ThemeIcon name="send" size={18} /></button>}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
      {context ? <div className="chat-context-menu" style={{ left: context.left, top: context.top }} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => void copyText(context.content).then(() => { setStatus({ text: t("desktop.agent.copied"), kind: "ok" }); setContext(null); })}>{t("desktop.common.copy")}</button>
        <button type="button" disabled={sending} onClick={() => { setEditingTurnId(context.turnId); setEditDraft(context.content); setContext(null); }}>{t("desktop.common.edit")}</button>
        <button type="button" disabled={sending} onClick={() => { const turnId = context.turnId; const content = context.content; setContext(null); void send(content, { fromTurnId: turnId }); }}>{t("desktop.common.resend")}</button>
      </div> : null}
      <ToolTraceSheet
        turn={turns.find((turn) => turn.id === traceDrawerTurnId) || null}
        t={t}
        onClose={() => setTraceDrawerTurnId(null)}
      />
      <CitationSheet turn={turns.find((turn) => turn.id === citationDrawerTurnId) || null} t={t} onClose={() => setCitationDrawerTurnId(null)} onOpenCitation={openCitation} onResumeSession={resumeCitationSession} />
    </section>,
    host
  );
}

const TOOL_CATEGORY_ORDER: AgentToolCategory[] = ["notes", "flow", "reports", "sessions", "projects", "link_graph"];

function ToolSettingsPopover({ prefs, tools, onPrefsChange, onClose, t }: {
  prefs: AskToolPrefs;
  tools: AgentToolDescriptor[];
  onPrefsChange: (next: AskToolPrefs) => void;
  onClose: () => void;
  t: Translate;
}): ReactNode {
  const selected = new Set(prefs.enabledTools);
  const toggleTool = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onPrefsChange({ ...prefs, enabledTools: [...next] });
  };
  const modeOptions: Array<{ value: AskToolMode; label: string }> = [
    { value: "auto", label: t("desktop.agent.toolsMode.auto") },
    { value: "custom", label: t("desktop.agent.toolsMode.custom") },
    { value: "off", label: t("desktop.agent.toolsMode.off") }
  ];
  const categoryLabel: Record<AgentToolCategory, string> = {
    notes: t("desktop.agent.toolCategory.notes"),
    flow: t("desktop.agent.toolCategory.flow"),
    reports: t("desktop.agent.toolCategory.reports"),
    sessions: t("desktop.agent.toolCategory.sessions"),
    projects: t("desktop.agent.toolCategory.projects"),
    link_graph: t("desktop.agent.toolCategory.link_graph")
  };
  return (
    <div className="chat-tools-popover" role="dialog" aria-label={t("desktop.agent.toolsDialogTitle")}>
      <div className="chat-tools-popover-head">
        <span className="chat-tools-popover-title">{t("desktop.agent.toolsDialogTitle")}</span>
        <button type="button" className="icon-btn chat-tools-popover-close" aria-label={t("desktop.common.close")} onClick={onClose}><ThemeIcon name="close" size={14} /></button>
      </div>
      <div className="chat-tools-modes" role="tablist" aria-label={t("desktop.agent.toolsModeTitle")}>
        {modeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={prefs.mode === option.value}
            className={`chat-tools-mode${prefs.mode === option.value ? " active" : ""}`}
            onClick={() => onPrefsChange({ ...prefs, mode: option.value })}
          >
            {option.label}
          </button>
        ))}
      </div>
      {prefs.mode === "custom" ? (
        <>
          <div className="chat-tools-quick-actions">
            <button type="button" className="ghost-btn" disabled={tools.length === 0} onClick={() => onPrefsChange({ ...prefs, enabledTools: tools.map((tool) => tool.name) })}>{t("desktop.agent.toolsSelectAll")}</button>
            <button type="button" className="ghost-btn" disabled={tools.length === 0} onClick={() => onPrefsChange({ ...prefs, enabledTools: [] })}>{t("desktop.agent.toolsClearAll")}</button>
          </div>
          <div className="chat-tools-scroll">
            {tools.length === 0 ? <div className="chat-tools-empty-hint">{t("desktop.common.loading")}</div> : TOOL_CATEGORY_ORDER.map((category) => {
              const items = tools.filter((tool) => tool.category === category);
              if (!items.length) return null;
              return (
                <div key={category} className="chat-tools-category">
                  <div className="chat-tools-category-label">{categoryLabel[category]}</div>
                  {items.map((tool) => (
                    <label key={tool.name} className="chat-tools-item" title={tool.description}>
                      <input type="checkbox" checked={selected.has(tool.name)} onChange={() => toggleTool(tool.name)} />
                      <span className="chat-tools-item-name">{tool.name}</span>
                      <span className="chat-tools-item-desc">{tool.description}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          {tools.length > 0 && prefs.enabledTools.length === 0 ? <div className="chat-tools-empty-hint">{t("desktop.agent.toolsCustomEmpty")}</div> : null}
        </>
      ) : null}
      {prefs.mode === "auto" ? <div className="chat-tools-foot">{t("desktop.agent.toolsFoot")}</div> : null}
    </div>
  );
}

const VirtualChatLog = forwardRef<HTMLDivElement, {
  turns: Turn[];
  hasMore: boolean;
  loadingOlder: boolean;
  t: Translate;
  onOpenTrace: (turnId: string) => void;
  onOpenCitations: (turnId: string) => void;
  onOpenCitation: (citation: AgentCitation) => void;
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  editingTurnId: string | null;
  editDraft: string;
  sending: boolean;
  onEditDraftChange: (value: string) => void;
  onCancelEdit: () => void;
  onConfirmEdit: () => void;
  onUserContext: (event: React.MouseEvent, turn: Turn) => void;
  onCopy: (content: string) => void;
}>(({ turns, hasMore, loadingOlder, t, onOpenTrace, onOpenCitations, onOpenCitation, onScroll, editingTurnId, editDraft, sending, onEditDraftChange, onCancelEdit, onConfirmEdit, onUserContext, onCopy }, ref) => {
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
  return <div ref={setLogRef} className="chat-log" onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop); setViewportHeight(event.currentTarget.clientHeight); onScroll(event); }}><div className="chat-virtual-inner" style={{ height: layout.total }}><div className="chat-virtual-window" style={{ transform: `translateY(${layout.offsets[range.start] || 0}px)` }}>{hasMore && range.start === 0 ? <p className="muted chat-load-older">{loadingOlder ? t("desktop.common.loading") : t("desktop.agent.loadOlder")}</p> : null}{turns.slice(range.start, range.end + 1).map((turn) => <MeasuredTurn key={turn.id} turn={turn} onHeight={onRowHeight}><TurnView turn={turn} t={t} onOpenTrace={onOpenTrace} onOpenCitations={onOpenCitations} onOpenCitation={onOpenCitation} editing={editingTurnId === turn.id} editDraft={editDraft} sending={sending} onEditDraftChange={onEditDraftChange} onCancelEdit={onCancelEdit} onConfirmEdit={onConfirmEdit} onUserContext={onUserContext} onCopy={onCopy} /></MeasuredTurn>)}</div></div></div>;
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

function TurnView({ turn, t, onOpenTrace, onOpenCitations, onOpenCitation, editing, editDraft, sending, onEditDraftChange, onCancelEdit, onConfirmEdit, onUserContext, onCopy }: {
  turn: Turn;
  t: Translate;
  onOpenTrace: (turnId: string) => void;
  onOpenCitations: (turnId: string) => void;
  onOpenCitation: (citation: AgentCitation) => void;
  editing: boolean;
  editDraft: string;
  sending: boolean;
  onEditDraftChange: (value: string) => void;
  onCancelEdit: () => void;
  onConfirmEdit: () => void;
  onUserContext: (event: React.MouseEvent, turn: Turn) => void;
  onCopy: (content: string) => void;
}) {
  if (turn.role === "user") {
    if (editing) {
      return <div className="chat-message chat-message-out"><div className="chat-bubble user chat-bubble-edit" onPointerDown={(event) => event.stopPropagation()}>
        <textarea className="chat-bubble-edit-input" value={editDraft} disabled={sending} rows={Math.min(8, Math.max(2, editDraft.split("\n").length))} autoFocus aria-label={t("desktop.common.edit")} onChange={(event) => onEditDraftChange(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onCancelEdit(); return; }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onConfirmEdit(); }
        }} />
        <div className="chat-bubble-edit-actions">
          <button type="button" className="ghost-btn" disabled={sending} onClick={onCancelEdit}>{t("desktop.common.cancel")}</button>
          <button type="button" className="ghost-btn" disabled={sending || !editDraft.trim()} onClick={onConfirmEdit}>{t("desktop.common.send")}</button>
        </div>
      </div></div>;
    }
    return <div className="chat-message chat-message-out"><div className="chat-bubble user" onContextMenu={(event) => onUserContext(event, turn)}>{turn.content}</div></div>;
  }
  const summary = executionSummary(traceForTurn(turn));
  const summaryParts = (["retrieval", "tool", "llm", "skill"] as const).filter((kind) => summary[kind] > 0);
  const citationCount = turn.citations?.length || 0;
  const openInlineCitation = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-agent-citation]") : null;
    if (!target || !event.currentTarget.contains(target)) return;
    const citation = citationForMarker(turn.citations || [], target.dataset.agentCitation || "");
    if (!citation) return;
    event.preventDefault();
    onOpenCitation(citation);
  };
  return <div className="chat-message chat-message-in"><div className={`chat-bubble assistant${turn.streaming ? " streaming" : ""}`}><div className="chat-sender"><ThemeIcon name="bot" size={14} /> Memory Agent</div><div className="chat-body"><div className={`chat-body-text${turn.streaming ? "" : " markdown-body"}`} onClick={openInlineCitation} {...(turn.streaming ? {} : { dangerouslySetInnerHTML: { __html: renderAssistantMarkdown(turn.content, turn.citations || []) } })}>{turn.streaming ? turn.content : null}</div>{turn.streaming && turn.activityText ? <div className={`chat-activity-status${turn.activityKind ? ` is-${turn.activityKind}` : ""}`}><ThemeIcon name="loader" size={14} /><span>{turn.activityText}</span></div> : turn.streaming ? <ThemeIcon name="loader" className="chat-stream-cursor" size={14} /> : null}</div><div className="chat-message-tools"><button type="button" className={`chat-tool-trace-button${summaryParts.length ? "" : " is-empty"}`} onClick={() => onOpenTrace(turn.id)}><ThemeIcon name="activity" size={14} /><span>{t("desktop.agent.executionTraceSummary")}</span>{summaryParts.map((kind) => <span className="chat-execution-count" key={kind}>{t(`desktop.agent.executionSummary.${kind}`, summary[kind])}</span>)}</button>{citationCount ? <button type="button" className="chat-tool-trace-button chat-citations-button" onClick={() => onOpenCitations(turn.id)}><ThemeIcon name="quote" size={14} /><span>{t("desktop.agent.citationRef")}</span><span className="chat-execution-count">{citationCount}</span></button> : null}</div><div className="chat-footer">{turn.completionText ? <span className="chat-footer-completion">{turn.completionText}</span> : null}{!turn.activityText ? <span className="chat-footer-meta">{turn.streaming ? t("desktop.agent.typing") : turn.fallback ? t("desktop.agent.recentSummary") : t("desktop.agent.reportRetrieval")}</span> : null}{!turn.streaming && turn.content ? <button type="button" className="chat-copy-btn" onClick={() => onCopy(turn.content)}><ThemeIcon name="copy" size={14} />{t("desktop.common.copy")}</button> : null}</div></div></div>;
}

function upsertExecutionStep(trace: AgentExecutionStep[], step: AgentExecutionStep): AgentExecutionStep[] {
  const index = trace.findIndex((entry) => entry.id === step.id);
  if (index < 0) return [...trace, step];
  const next = [...trace];
  next[index] = { ...next[index], ...step };
  return next;
}

function traceStatusLabel(status: AgentExecutionStep["status"], t: Translate): string {
  return t(`desktop.agent.toolTraceStatus.${status}`);
}

function traceImpactLabel(impact: NonNullable<AgentExecutionStep["impact"]>, t: Translate): string {
  return t(`desktop.agent.toolTraceImpact.${impact}`);
}

function traceValue(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function executionSummary(trace: AgentExecutionStep[]): Record<AgentExecutionStep["kind"], number> {
  return trace.reduce<Record<AgentExecutionStep["kind"], number>>((summary, step) => {
    summary[step.kind] += 1;
    return summary;
  }, { retrieval: 0, llm: 0, tool: 0, skill: 0 });
}

function executionStepTitle(step: AgentExecutionStep, t: Translate): string {
  if (step.kind === "llm") return t("desktop.agent.toolTraceLlmRound", step.iteration || 1);
  if (step.toolName === "report_context_search") return t("desktop.agent.executionStep.reportRetrieval");
  if (step.toolName === "note_context_search") return t("desktop.agent.executionStep.noteRetrieval");
  if (step.toolName === "session_context_search") return t("desktop.agent.executionStep.sessionRetrieval");
  if (step.title) return step.title;
  return step.toolName || t(`desktop.agent.executionGroup.${step.kind}`);
}

function executionSourceLabel(source: AgentExecutionStep["source"], t: Translate): string {
  if (!source) return "";
  if (source.kind === "system") return t("desktop.agent.executionSource.context");
  if (source.kind === "mcp" && !source.external) return t("desktop.agent.executionSource.builtInMcp");
  return source.name;
}

function traceForTurn(turn: Turn): AgentExecutionStep[] {
  const trace = (turn.toolTrace || []).map((step) => step.kind === "tool" && step.toolName?.endsWith("_context_search")
    ? { ...step, kind: "retrieval" as const, title: undefined, impact: undefined, source: { kind: "system" as const, name: "Ask context" } }
    : step);
  if (trace.some((step) => step.kind === "retrieval")) return trace;

  const citations = turn.citations || [];
  if (!citations.length) return trace;
  const makeStep = (toolName: string, sources: string[]): AgentExecutionStep => ({
    id: `legacy-${turn.id}-${toolName}`,
    kind: "retrieval",
    status: "succeeded",
    startedAtMs: 0,
    completedAtMs: 0,
    source: { kind: "system", name: "Ask context" },
    toolName,
    args: {},
    result: JSON.stringify({ count: sources.length, sources }, null, 2)
  });
  const reports = citations.filter((citation) => !isNote(citation) && !isSession(citation));
  const notes = citations.filter(isNote);
  const sessions = citations.filter(isSession);
  return [
    ...(reports.length ? [makeStep("report_context_search", reports.map((citation) => citation.reportId || citation.title))] : []),
    ...(notes.length ? [makeStep("note_context_search", notes.map((citation) => citation.relMdPath || citation.noteId || citation.title))] : []),
    ...(sessions.length ? [makeStep("session_context_search", sessions.map((citation) => citation.session ? `${citation.session.provider}:${citation.session.id}` : citation.title))] : []),
    ...trace
  ];
}

function ToolTraceSheet({ turn, t, onClose }: {
  turn: Turn | null;
  t: Translate;
  onClose: () => void;
}) {
  const trace = turn ? traceForTurn(turn) : [];
  const summary = executionSummary(trace);
  const groups = (["retrieval", "llm", "tool", "skill"] as const).map((kind) => ({ kind, steps: trace.filter((step) => step.kind === kind) })).filter((group) => group.steps.length);
  const timed = trace.filter((step) => step.startedAtMs > 0);
  const duration = timed.length ? Math.max(...timed.map((step) => step.completedAtMs || Date.now())) - Math.min(...timed.map((step) => step.startedAtMs)) : null;
  return <Sheet open={Boolean(turn)} title={t("desktop.agent.executionTraceTitle")} onClose={onClose} bodyClassName="tool-trace-sheet">
    <p className="muted tool-trace-description">{t("desktop.agent.executionTraceDescription")}</p>
    <div className="execution-trace-overview"><span>{t("desktop.agent.executionSummary.retrieval", summary.retrieval)}</span><span>{t("desktop.agent.executionSummary.tool", summary.tool)}</span><span>{t("desktop.agent.executionSummary.llm", summary.llm)}</span>{summary.skill ? <span>{t("desktop.agent.executionSummary.skill", summary.skill)}</span> : null}{duration !== null ? <span>{t("desktop.agent.toolTraceDuration", duration)}</span> : null}</div>
    <div className="tool-trace-list">
      {groups.length ? groups.map((group) => <section className="execution-trace-group" key={group.kind}><h4>{t(`desktop.agent.executionGroup.${group.kind}`)}</h4>{group.steps.map((step) => {
        const stepDuration = step.completedAtMs ? Math.max(0, step.completedAtMs - step.startedAtMs) : null;
        const meta = [executionSourceLabel(step.source, t), step.capability ? t(`desktop.agent.executionCapability.${step.capability}`) : "", step.impact ? traceImpactLabel(step.impact, t) : "", traceStatusLabel(step.status, t)].filter(Boolean).join(" · ");
        return <article className={`tool-trace-step execution-trace-step is-${step.kind} is-${step.status}${step.parentId ? " has-parent" : ""}`} key={step.id}><div className="tool-trace-step-head"><div><strong>{executionStepTitle(step, t)}</strong><span>{meta}</span></div>{stepDuration !== null ? <small>{t("desktop.agent.toolTraceDuration", stepDuration)}</small> : null}</div>{step.args && Object.keys(step.args).length ? <details><summary>{t("desktop.agent.toolTraceInput")}</summary><pre>{traceValue(step.args)}</pre></details> : null}{step.result !== undefined ? <details><summary>{t("desktop.agent.toolTraceOutput")}</summary><pre>{step.result}</pre></details> : null}{step.error ? <p className="tool-trace-error">{step.error}</p> : null}</article>;
      })}</section>) : <p className="muted tool-trace-empty">{t("desktop.agent.toolTraceEmpty")}</p>}
    </div>
  </Sheet>;
}

function ToolApprovalBar({ step, t, onRespond }: { step: AgentExecutionStep; t: Translate; onRespond: (approved: boolean) => void }) {
  const meta = [
    step.capability ? t(`desktop.agent.executionCapability.${step.capability}`) : "",
    step.impact ? traceImpactLabel(step.impact, t) : ""
  ].filter(Boolean).join(" · ");
  return <section className="agent-tool-approval-bar" aria-label={t("desktop.agent.toolApprovalNeeded", executionStepTitle(step, t))}>
    <div className="agent-tool-approval-copy"><strong>{executionStepTitle(step, t)}</strong><span>{[meta, t("desktop.agent.toolApprovalPrompt")].filter(Boolean).join(" · ")}</span></div>
    <div className="agent-tool-approval-actions"><button type="button" className="tool-btn" onClick={() => onRespond(false)}>{t("desktop.agent.toolApprovalDeny")}</button><button type="button" className="tool-btn primary" onClick={() => onRespond(true)}>{t("desktop.agent.toolApprovalAllow")}</button></div>
  </section>;
}

function IndexProgressView({ progress, t }: { progress: IndexProgress; t: Translate }) {
  const current = Number(progress.current || 0);
  const displayCurrent = progress.phase === "embedding" ? current + 1 : current;
  return <div className={`agent-index-progress${progress.phase === "scanning" ? " is-scanning" : ""}${progress.phase === "error" ? " is-error" : ""}`}><div className="agent-index-progress-head"><span id="agentIndexProgressText">{progress.noteTitle ? `${progress.message || t("desktop.agent.indexingNotes")} · ${progress.noteTitle}` : progress.message || t("desktop.agent.indexingNotes")}</span><span id="agentIndexProgressCount">{progress.total ? `${Math.min(displayCurrent, progress.total)}/${progress.total}` : ""}</span></div><div className="agent-index-progress-track"><div className="agent-index-progress-bar" style={{ width: `${Math.max(0, Math.min(100, progressRatio(progress) * 100))}%` }} /></div></div>;
}

function citationKey(citation: AgentCitation, index: number): string {
  return [citation.source || citation.level, citation.index, citation.reportId || citation.noteId || citation.session?.id || citation.title, index].join(":");
}

function citationTitle(citation: AgentCitation, t: Translate): string {
  return citation.title || citation.noteId || citation.reportId || citation.session?.id || t("desktop.agent.citationRef");
}

function CitationSheet({ turn, t, onClose, onOpenCitation, onResumeSession }: {
  turn: Turn | null;
  t: Translate;
  onClose: () => void;
  onOpenCitation: (citation: AgentCitation) => void;
  onResumeSession: (citation: AgentCitation) => void | Promise<void>;
}) {
  const citations = turn?.citations || [];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [reportEntry, setReportEntry] = useState<Pick<ReportEntry, "title" | "content"> | null>(null);
  const [reportError, setReportError] = useState("");
  const selected = selectedKey === null ? null : citations.map((citation, index) => ({ citation, key: citationKey(citation, index) })).find((item) => item.key === selectedKey) || null;

  useEffect(() => {
    setSelectedKey(null);
    setReportEntry(null);
    setReportError("");
  }, [turn?.id]);

  useEffect(() => {
    if (!selected?.citation.reportId || isNote(selected.citation) || isSession(selected.citation)) {
      setReportEntry(null);
      setReportError("");
      return;
    }
    let active = true;
    setReportEntry(null);
    setReportError("");
    void desktopApi().getReportEntry(selected.citation.reportId).then((entry) => {
      if (active) setReportEntry(entry);
    }).catch((error) => {
      if (active) setReportError(errorMessage(error));
    });
    return () => { active = false; };
  }, [selected?.citation.reportId, selected?.key]);

  const citationItems = citations.map((citation, index) => ({ citation, key: citationKey(citation, index) }));
  const groups: Array<{ id: string; title: string; citations: Array<{ citation: AgentCitation; key: string }> }> = [
    { id: "report", title: t("desktop.agent.citationReports"), citations: citationItems.filter(({ citation }) => !isNote(citation) && !isSession(citation)) },
    { id: "note", title: t("desktop.agent.citationNotes"), citations: citationItems.filter(({ citation }) => isNote(citation)) },
    { id: "session", title: t("desktop.agent.citationSessions"), citations: citationItems.filter(({ citation }) => isSession(citation)) }
  ].filter((group) => group.citations.length);
  const sourceTitle = selected ? (isNote(selected.citation) ? t("desktop.agent.citationNotes") : isSession(selected.citation) ? t("desktop.agent.citationSessions") : t("desktop.agent.citationReports")) : "";
  const openLabel = selected && (isNote(selected.citation)
    ? t("desktop.agent.openInNotes")
    : isSession(selected.citation)
      ? t("desktop.agent.openInSessions")
      : t("desktop.agent.openInReport"));
  const details = selected ? [
    [t("desktop.agent.citationField.source"), sourceTitle],
    [t("desktop.agent.citationField.level"), selected.citation.level],
    [t("desktop.agent.citationField.operation"), selected.citation.operation || ""],
    [t("desktop.agent.citationField.score"), selected.citation.score == null ? "" : String(selected.citation.score)],
    [t("desktop.agent.citationField.reportId"), selected.citation.reportId || ""],
    [t("desktop.agent.citationField.noteId"), selected.citation.noteId || ""],
    [t("desktop.agent.citationField.path"), selected.citation.relMdPath || ""],
    [t("desktop.agent.citationField.scope"), selected.citation.scope || ""],
    [t("desktop.agent.citationField.heading"), selected.citation.heading || ""],
    [t("desktop.agent.citationField.period"), selected.citation.periodStartMs ? new Date(selected.citation.periodStartMs).toLocaleString() : ""],
    [t("desktop.agent.citationField.session"), selected.citation.session ? `${selected.citation.session.provider}:${selected.citation.session.id}${selected.citation.session.projectPath ? ` · ${selected.citation.session.projectPath}` : ""}` : ""]
  ].filter(([, value]) => value) : [];
  const content = reportEntry?.content || selected?.citation.contentPreview || (selected?.citation.session
    ? `**${selected.citation.session.provider}** \`${selected.citation.session.id}\`${selected.citation.session.projectPath ? `\n\n${selected.citation.session.projectPath}` : ""}`
    : "");

  return <Sheet open={Boolean(turn)} title={t("desktop.agent.citationsTitle")} onClose={onClose} bodyClassName="citation-sheet">
    <p className="muted citation-sheet-description">{t("desktop.agent.citationsDescription")}</p>
    {groups.length ? <div className="citation-sheet-groups">{groups.map((group) => <section className="citation-sheet-group" key={group.id}><h4>{group.title} ({group.citations.length})</h4>{group.citations.map(({ citation, key }) => {
      const expanded = selected?.key === key;
      return <article className={`citation-sheet-item${expanded ? " is-expanded" : ""}`} key={key}><button type="button" className="citation-sheet-item-head" aria-expanded={expanded} onClick={() => setSelectedKey(expanded ? null : key)}><ThemeIcon name="chevron-down" size={15} /><span>{citationLabel(citation, t)}</span></button>{expanded ? <div className="citation-sheet-item-body"><h5>{citationTitle(citation, t)}</h5><dl className="citation-sheet-fields">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{reportError ? <p className="tool-trace-error">{t("desktop.agent.previewLoadFailed", reportError)}</p> : null}{content ? <section className="citation-sheet-content"><h5>{t("desktop.agent.citationContent")}</h5><div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} /></section> : <p className="muted">{t("desktop.agent.citationNoPreview", "")}</p>}<div className="citation-sheet-actions"><button type="button" className="ghost-btn" onClick={() => onOpenCitation(citation)}>{openLabel}</button>{isSession(citation) && citation.session ? <button type="button" className="ghost-btn" onClick={() => void onResumeSession(citation)}>{t("desktop.agent.resumeSession")}</button> : null}</div></div> : null}</article>;
    })}</section>)}</div> : <p className="muted tool-trace-empty">{t("desktop.agent.citationsEmpty")}</p>}
  </Sheet>;
}

function Audit({ items, loading, t, onRefresh }: { items: AgentNoteAuditEvent[]; loading: boolean; t: Translate; onRefresh: () => void }) {
  const formatTime = (value: number) => new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(value);
  return <section className="agent-audit-panel"><div className="ask-audit-head"><strong>{t("desktop.agent.auditTitle")}</strong><button type="button" className="ghost-btn" onClick={onRefresh}>{t("desktop.common.refresh")}</button></div><div className="agent-audit-list">{loading ? <p className="muted agent-audit-empty">{t("desktop.agent.auditLoading")}</p> : items.length ? items.map((item) => <article className="ask-audit-item" data-status={item.status} key={item.id}><div className="ask-audit-item-main"><span className="agent-audit-action">{auditActionLabel(item.action, t)}</span><span className="ask-audit-note"><ThemeIcon name="file-text" size={14} /> {item.noteTitle || item.relMdPath || item.noteId || t("desktop.agent.auditUnspecifiedNote")}</span></div><div className="ask-audit-item-meta"><span className="agent-audit-status">{auditStatusLabel(item.status, t)}</span><span>{[formatTime(item.createdAtMs), item.actor || "agent", item.traceId ? `trace ${item.traceId.slice(0, 8)}` : ""].filter(Boolean).join(" · ")}</span></div>{item.error ? <p className="ask-audit-error">{item.error}</p> : null}</article>) : <p className="muted agent-audit-empty">{t("desktop.agent.auditEmpty")}</p>}</div></section>;
}
