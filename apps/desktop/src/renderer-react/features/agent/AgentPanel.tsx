import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactPortal } from "react";
import { Bot, Check, ChevronDown, Copy, FileText, LoaderCircle, MessageSquarePlus, Pencil, Send, Square, Trash2, Wrench } from "lucide-react";
import DOMPurify from "dompurify";
import type { AgentChatMessage, AgentCitation, AgentStreamEvent, AgentThread } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { Status, type StatusKind } from "../../components/Status";
import { renderMarkdown as markdown } from "../../components/Markdown";
import { useI18n } from "../../i18n";

interface Turn extends Pick<AgentChatMessage, "role" | "content" | "citations" | "fallback" | "sortOrder"> { id: string; streaming?: boolean; }
type CitationGroup = "report" | "note";

function isNote(citation: AgentCitation): boolean { return citation.source === "note" || citation.level === "note"; }
function periodFromCitation(citation: AgentCitation): { type: "day" | "week" | "month"; key: string } | null {
  if (!citation.reportId) return null;
  if (citation.level === "daily" && citation.reportId.startsWith("daily:")) return { type: "day", key: citation.reportId.slice(6) };
  if (citation.level === "weekly" && citation.reportId.startsWith("weekly:")) return { type: "week", key: citation.reportId.slice(7) };
  if (citation.level === "monthly" && citation.reportId.startsWith("monthly:")) return { type: "month", key: citation.reportId.slice(8) };
  return null;
}

export function AgentPanel(): ReactPortal | null {
  const host = document.getElementById("react-agent");
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [threads, setThreads] = useState<AgentThread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [tools, setTools] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind?: StatusKind }>({ text: "" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingThread, setEditingThread] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<Awaited<ReturnType<ReturnType<typeof desktopApi>["listAgentNoteAudit"]>>>([]);
  const streamOff = useRef<(() => void) | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const activeThread = useMemo(() => threads.find((thread) => thread.id === threadId), [threadId, threads]);

  const loadMessages = useCallback(async (id: string, append = false) => {
    const result = append && turns.length ? await desktopApi().listOlderAgentChat({ threadId: id, beforeSortOrder: turns[0]?.sortOrder || 0, limit: 40 }) : await desktopApi().listAgentChat({ threadId: id, limit: 40 });
    const mapped = result.messages.map((message) => ({ ...message }));
    setTurns((current) => append ? [...mapped, ...current] : mapped);
    setHasMore(result.hasMore);
  }, [turns]);
  const loadThreads = useCallback(async () => {
    let next = await desktopApi().listAgentThreads();
    if (!next.length) next = [await desktopApi().createAgentThread({ title: t("desktop.agent.newThread") })];
    const saved = localStorage.getItem("activeAgentThreadId");
    const selected = saved && next.some((thread) => thread.id === saved) ? saved : next[0]?.id || "";
    setThreads(next); setThreadId(selected); localStorage.setItem("activeAgentThreadId", selected);
    if (selected) await loadMessages(selected);
  }, [loadMessages, t]);
  const loadAudit = useCallback(async () => {
    try { setAudit(await desktopApi().listAgentNoteAudit({ limit: 80 })); }
    catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
  }, []);

  useEffect(() => {
    const onTab = (event: Event) => { const show = (event as CustomEvent<string>).detail === "agent"; setActive(show); if (show && !threads.length) void loadThreads().catch((error: unknown) => setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" })); };
    window.addEventListener("agent-resume:tab-change", onTab);
    return () => { window.removeEventListener("agent-resume:tab-change", onTab); streamOff.current?.(); };
  }, [loadThreads, threads.length]);
  useEffect(() => { if (auditOpen) void loadAudit(); }, [auditOpen, loadAudit]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [turns]);

  const selectThread = async (id: string) => { if (id === threadId || sending) return; setThreadId(id); localStorage.setItem("activeAgentThreadId", id); setTurns([]); setHasMore(false); await loadMessages(id); };
  const createThread = async () => { try { const thread = await desktopApi().createAgentThread({ title: t("desktop.agent.newThread") }); setThreads((current) => [thread, ...current]); setThreadId(thread.id); localStorage.setItem("activeAgentThreadId", thread.id); setTurns([]); setHasMore(false); } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); } };
  const rename = async () => { const title = titleInput.trim(); if (!title || !threadId) return; try { await desktopApi().renameAgentThread({ id: threadId, title }); setThreads((current) => current.map((thread) => thread.id === threadId ? { ...thread, title } : thread)); setEditingThread(false); } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); } };
  const deleteThread = async (id = threadId) => { const thread = threads.find((item) => item.id === id); if (!thread || !window.confirm(t("desktop.agent.deleteConfirmSimple", thread.title))) return; try { await desktopApi().deleteAgentThread({ id }); const next = threads.filter((item) => item.id !== id); if (!next.length) { const replacement = await desktopApi().createAgentThread({ title: t("desktop.agent.newThread") }); setThreads([replacement]); setThreadId(replacement.id); setTurns([]); setHasMore(false); localStorage.setItem("activeAgentThreadId", replacement.id); return; } setThreads(next); if (id === threadId) await selectThread(next[0]!.id); } catch (error) { setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); } };
  const cancel = async () => { streamOff.current?.(); streamOff.current = null; await desktopApi().cancelAskAgent(); setTurns((current) => current.filter((turn) => !turn.streaming)); setSending(false); };
  const send = async () => {
    const query = input.trim(); if (!query || !threadId || sending) return;
    const pendingId = `pending-${Date.now()}`;
    const history = turns.filter((turn) => !turn.streaming).map((turn) => ({ role: turn.role, content: turn.content }));
    setInput(""); setSending(true); setStatus({ text: t("desktop.agent.searchingReports") });
    setTurns((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: query, sortOrder: Number.MAX_SAFE_INTEGER - 1 }, { id: pendingId, role: "assistant", content: "", citations: [], sortOrder: Number.MAX_SAFE_INTEGER, streaming: true }]);
    if (activeThread?.title === t("desktop.agent.newThread")) { const title = query.slice(0, 30); setThreads((current) => current.map((thread) => thread.id === threadId ? { ...thread, title } : thread)); void desktopApi().renameAgentThread({ id: threadId, title }); }
    streamOff.current = desktopApi().onAskStream((event: AgentStreamEvent) => {
      if (event.phase === "chunk" && event.delta) setTurns((current) => current.map((turn) => turn.id === pendingId ? { ...turn, content: turn.content + event.delta } : turn));
      else if (event.message) setStatus({ text: event.message });
      else if (event.phase === "generating") setStatus({ text: t("desktop.agent.statusGenerating") });
    });
    try {
      const result = await desktopApi().askAgent({ query, history, threadId, enableTools: tools });
      setTurns((current) => current.map((turn) => turn.id === pendingId ? { id: pendingId, role: "assistant", content: result.answer, citations: result.citations, fallback: result.fallback, sortOrder: Number.MAX_SAFE_INTEGER } : turn));
      setStatus(result.persistWarning ? { text: result.persistWarning, kind: "error" } : { text: result.fallback ? t("desktop.agent.completeFallback", result.citations.length) : t("desktop.agent.completeDone", result.citations.length, result.toolCallsExecuted ? t("desktop.agent.completeToolCalls", result.toolCallsExecuted) : ""), kind: "ok" });
    } catch (error) { setTurns((current) => current.filter((turn) => turn.id !== pendingId)); setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" }); }
    finally { streamOff.current?.(); streamOff.current = null; setSending(false); }
  };
  const openCitation = (citation: AgentCitation) => {
    if (isNote(citation)) { if (citation.noteId) { window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" })); window.dispatchEvent(new CustomEvent("agent-resume:open-note", { detail: citation.noteId })); } return; }
    const period = periodFromCitation(citation); if (!period) return;
    window.dispatchEvent(new CustomEvent("agent-resume:report-focus", { detail: period }));
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "report" }));
  };
  if (!host) return null;
  return createPortal(<section className="panel active agent-panel react-agent-panel" hidden={!active}><div className="agent-layout"><aside className="sidebar-folders-pane agent-sidebar-pane"><div className="sidebar-folders-header"><button type="button" className="notes-icon-btn" title={t("desktop.agent.newChat")} aria-label={t("desktop.agent.newChat")} onClick={() => void createThread()}><MessageSquarePlus size={18} /></button></div><div className="agent-sidebar-list">{threads.map((thread) => <div className={`ask-thread-row${thread.id === threadId ? " active" : ""}`} key={thread.id}><button type="button" className="ask-thread-row-select" onClick={() => void selectThread(thread.id)}><span className="ask-thread-row-label">{thread.title}</span></button><button type="button" className="ask-thread-row-delete" title={t("desktop.agent.deleteThreadTitle")} aria-label={t("desktop.agent.deleteThreadTitle")} onClick={() => void deleteThread(thread.id)}><Trash2 size={15} /></button></div>)}</div></aside><main className="ask-main-pane"><div className="toolbar ask-toolbar">{editingThread ? <form className="agent-title-editor" onSubmit={(event) => { event.preventDefault(); void rename(); }}><input value={titleInput} aria-label={t("desktop.agent.renameDialogTitle")} onChange={(event) => setTitleInput(event.target.value)} autoFocus /><button type="submit" className="icon-btn" aria-label={t("desktop.common.confirm")}><Check size={16} /></button></form> : <h2 className="quiet-title">{activeThread?.title || t("desktop.tabs.agent")}</h2>}<div className="agent-toolbar-actions"><button type="button" className="ghost-btn" onClick={() => { setTitleInput(activeThread?.title || ""); setEditingThread(true); }} disabled={!activeThread}>{t("desktop.agent.renameChat")}</button><button type="button" className={`ghost-btn${auditOpen ? " active" : ""}`} onClick={() => setAuditOpen((value) => !value)}>{t("desktop.agent.audit")}</button><button type="button" className="ghost-btn" onClick={() => void deleteThread()} disabled={!activeThread}>{t("desktop.agent.deleteChat")}</button></div></div><div className="ask-chat-shell"><div ref={logRef} className="chat-log">{hasMore ? <button type="button" className="ghost-btn" onClick={() => void loadMessages(threadId, true)}>{t("desktop.agent.loadOlder")}</button> : null}{turns.length ? turns.map((turn) => <TurnView key={turn.id} turn={turn} expanded={expanded} setExpanded={setExpanded} t={t} onCitation={openCitation} />) : <div className="chat-empty-state"><p className="chat-empty-title">{t("desktop.agent.emptyChat")}</p><p className="chat-empty-hint">{t("desktop.agent.emptyHint")}</p></div>}</div><div className="chat-compose"><div className="chat-compose-field"><textarea rows={1} value={input} disabled={sending} placeholder={t("desktop.agent.inputPlaceholder")} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} /></div><button type="button" className={`chat-tools-toggle${tools ? " active" : ""}`} title={tools ? t("desktop.agent.toolsOn") : t("desktop.agent.toolsOffTitle")} aria-pressed={tools} onClick={() => setTools((value) => !value)}><Wrench size={18} /></button>{sending ? <button type="button" className="chat-send-btn" aria-label={t("desktop.common.cancel")} onClick={() => void cancel()}><Square size={17} /></button> : <button type="button" className="chat-send-btn" aria-label={t("desktop.common.send")} disabled={!input.trim()} onClick={() => void send()}><Send size={20} /></button>}</div>{auditOpen ? <Audit items={audit} t={t} onRefresh={() => void loadAudit()} /> : null}<Status kind={status.kind}>{status.text}</Status></div></main></div></section>, host);
}

function TurnView({ turn, expanded, setExpanded, t, onCitation }: { turn: Turn; expanded: Set<string>; setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>; t: (key: string, ...args: Array<string | number>) => string; onCitation: (citation: AgentCitation) => void }) {
  const reports = turn.citations?.filter((citation) => !isNote(citation)) || []; const notes = turn.citations?.filter(isNote) || [];
  const group = (kind: CitationGroup, list: AgentCitation[], label: string) => { const id = `${turn.id}:${kind}`; const open = expanded.has(id); return list.length ? <section className={`citation-section${open ? "" : " collapsed"}`}><button type="button" className="citation-section-head" aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); if (open) next.delete(id); else next.add(id); return next; })}><ChevronDown size={14} /><span>{label} ({list.length})</span></button>{open ? <div className="citation-section-body">{list.map((citation, index) => <button type="button" className="citation-chip" key={`${citation.index}-${index}`} onClick={() => onCitation(citation)}>[{citation.index}] {citation.title || citation.noteId || citation.reportId}</button>)}</div> : null}</section> : null; };
  if (turn.role === "user") return <div className="chat-message chat-message-out"><div className="chat-bubble user">{turn.content}</div></div>;
  return <div className="chat-message chat-message-in"><div className={`chat-bubble assistant${turn.streaming ? " streaming" : ""}`}><div className="chat-sender"><Bot size={14} /> Memory Agent</div><div className="chat-body"><div className="chat-body-text markdown-body" dangerouslySetInnerHTML={{ __html: turn.streaming ? DOMPurify.sanitize(turn.content) : markdown(turn.content) }} />{turn.streaming ? <LoaderCircle className="chat-stream-cursor" size={14} /> : null}</div>{group("report", reports, t("desktop.agent.citationReports"))}{group("note", notes, t("desktop.agent.citationNotes"))}<div className="chat-footer"><span className="chat-footer-meta">{turn.streaming ? t("desktop.agent.typing") : turn.fallback ? t("desktop.agent.recentSummary") : t("desktop.agent.reportRetrieval")}</span>{!turn.streaming && turn.content ? <button type="button" className="chat-copy-btn" onClick={() => void navigator.clipboard.writeText(turn.content)}><Copy size={14} />{t("desktop.common.copy")}</button> : null}</div></div></div>;
}

function Audit({ items, t, onRefresh }: { items: Array<{ id: string; status: string; action: string; noteId?: string | null; error?: string | null }>; t: (key: string) => string; onRefresh: () => void }) { return <section className="agent-audit-panel"><div className="ask-audit-head"><strong>{t("desktop.agent.auditTitle")}</strong><button type="button" className="ghost-btn" onClick={onRefresh}>{t("desktop.common.refresh")}</button></div><div className="agent-audit-list">{items.length ? items.map((item) => <div className="agent-audit-item" data-status={item.status} key={item.id}><div className="agent-audit-item-main"><FileText size={15} /><span>{item.action} · {item.noteId || t("desktop.agent.auditUnspecifiedNote")}</span></div><span className="agent-audit-status">{item.status}</span>{item.error ? <p className="agent-audit-error">{item.error}</p> : null}</div>) : <p className="muted">{t("desktop.agent.auditEmpty")}</p>}</div></section>; }
