import { ThemeIcon } from "../../components/ThemeIcon";
import { renderMarkdown } from "../../components/Markdown";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactPortal } from "react";
import { desktopApi } from "../../bridge";
import { notifyDesktop } from "../../components/Notifications";
import { useI18n } from "../../i18n";
import { storedWidth } from "../../storage";
import { isBuiltinTemplateId, type ImEvent, type ImJob, type ImKnowledgeItem, type ImMember, type ImMessage, type ImProject, type ImQuotedMessage, type ImRoleTemplate, type ImRoom, type ImSelectionAction } from "../../../shared/imTypes";

const SIDEBAR_COLLAPSED_KEY = "im-sidebar-collapsed";
const SIDEBAR_WIDTH_KEY = "im-sidebar-width";
const SELECTED_PROJECT_KEY = "im-selected-project";

function storageBoolean(key: string): boolean {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

const BUILTIN_ROLE_KEYS = {
  role_product_manager: "productManager",
  role_project_manager: "projectManager",
  role_ui_designer: "uiDesigner",
  role_developer: "developer",
  role_tester: "tester"
} as const;

type Translate = (key: string, ...args: Array<string | number>) => string;

function builtinRoleLabel(templateId: string, fallback: string, t: Translate): string {
  if (!isBuiltinTemplateId(templateId)) return fallback;
  return t(`desktop.im.role.${BUILTIN_ROLE_KEYS[templateId]}`);
}

function roleLabel(member: ImMember, t: Translate): string {
  return builtinRoleLabel(member.templateId, member.name, t);
}

function agentTag(agent: string, t: Translate): JSX.Element {
  return (
    <span className="s-provider-tag" data-provider={agent}>
      {t(`desktop.im.agent.${agent}`)}
    </span>
  );
}

export function ImPanel(): ReactPortal | null {
  const host = document.getElementById("react-im");
  const { t } = useI18n();
  const [active, setActive] = useState(false);
  const [projects, setProjects] = useState<ImProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    try { return localStorage.getItem(SELECTED_PROJECT_KEY) || ""; } catch { return ""; }
  });
  const [room, setRoom] = useState<ImRoom | null>(null);
  const [draft, setDraft] = useState("");
  const [quotes, setQuotes] = useState<ImQuotedMessage[]>([]);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionListRef = useRef<HTMLDivElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => storageBoolean(SIDEBAR_COLLAPSED_KEY));
  const [sidebarWidth, setSidebarWidth] = useState(() => storedWidth(SIDEBAR_WIDTH_KEY, 240, 160, 360));
  const [sending, setSending] = useState(false);
  const [selectionActions, setSelectionActions] = useState<ImSelectionAction[]>([]);
  const [selectionMenu, setSelectionMenu] = useState<{
    x: number;
    y: number;
    text: string;
    message: ImMessage;
  } | null>(null);
  const [selectionResult, setSelectionResult] = useState<{
    x: number;
    y: number;
    title: string;
    text: string;
    loading: boolean;
  } | null>(null);
  const [templates, setTemplates] = useState<ImRoleTemplate[]>([]);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeBody, setKnowledgeBody] = useState("");
  const [knowledgeUrl, setKnowledgeUrl] = useState("");
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const setError = useCallback((error: unknown) => {
    notifyDesktop({
      text: error instanceof Error ? error.message : String(error),
      kind: "error"
    });
  }, []);

  const selectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    try { localStorage.setItem(SELECTED_PROJECT_KEY, projectId); } catch { /* ignore */ }
  }, []);

  const loadProjects = useCallback(async () => {
    const [list, nextTemplates, nextActions] = await Promise.all([
      desktopApi().imListProjects(),
      desktopApi().imListTemplates(),
      desktopApi().imListSelectionActions()
    ]);
    setTemplates(nextTemplates);
    setSelectionActions(nextActions.filter((item) => item.enabled));
    setProjects(list);
    setSelectedProjectId((current) => {
      if (current && list.some((project) => project.projectId === current)) return current;
      const next = list[0]?.projectId || "";
      try { localStorage.setItem(SELECTED_PROJECT_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const loadRoom = useCallback(async (projectId: string) => {
    if (!projectId) {
      setRoom(null);
      return;
    }
    const next = await desktopApi().imGetRoom({ projectId });
    setRoom(next);
  }, []);

  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "im";
      setActive(show);
      if (show) void loadProjects();
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    return () => window.removeEventListener("agent-resume:tab-change", onTab);
  }, [loadProjects]);

  useEffect(() => {
    if (!active || !selectedProjectId) {
      if (!selectedProjectId) setRoom(null);
      return;
    }
    void loadRoom(selectedProjectId).catch(setError);
  }, [active, loadRoom, selectedProjectId, setError]);

  useEffect(() => {
    const stop = desktopApi().onImEvent((event: ImEvent) => {
      if (event.type === "room") {
        if (event.room.project.projectId === selectedProjectId) setRoom(event.room);
        return;
      }
      if (event.projectId !== selectedProjectId) return;
      setRoom((current) => {
        if (!current) return current;
        if (event.type === "message") {
          if (current.messages.some((item) => item.messageId === event.message.messageId)) return current;
          return { ...current, messages: [...current.messages, event.message] };
        }
        if (event.type === "job") {
          const jobs = current.jobs.some((item) => item.jobId === event.job.jobId)
            ? current.jobs.map((item) => item.jobId === event.job.jobId ? event.job : item)
            : [event.job, ...current.jobs];
          return { ...current, jobs };
        }
        if (event.type === "member") {
          return {
            ...current,
            members: current.members.map((item) => item.memberId === event.member.memberId ? event.member : item)
          };
        }
        return current;
      });
    });
    return () => stop();
  }, [selectedProjectId]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [room?.messages.length]);

  const members = room?.members.filter((member) => member.enabled) ?? [];
  const mentionQuery = (() => {
    const at = draft.lastIndexOf("@");
    if (at < 0) return "";
    const after = draft.slice(at + 1);
    if (/\s/.test(after)) return "";
    return after.trim().toLowerCase();
  })();
  const mentionOptions = (mentionQuery
    ? members.filter((member) => roleLabel(member, t).toLowerCase().includes(mentionQuery) || member.agent.includes(mentionQuery))
    : members
  ).filter((member) => !mentionIds.includes(member.memberId));
  const activeJob = room?.jobs.find((job) =>
    job.status === "queued" || job.status === "connecting" || job.status === "running" || job.status === "awaiting_user"
  ) ?? null;
  const permissionOwner = activeJob
    ? members.find((member) => member.memberId === activeJob.memberId)
    : undefined;
  const canDispatch = Boolean(room?.project.localPath);
  const mentioned = mentionIds
    .map((id) => members.find((member) => member.memberId === id))
    .filter((member): member is ImMember => Boolean(member));
  const visibleMessages = (room?.messages ?? []).filter((message) => {
    if (message.kind !== "job.card") return true;
    const job = room?.jobs.find((item) => item.jobId === message.jobId);
    return job?.status === "failed";
  });

  const quoteSelection = useCallback((message: ImMessage, body: string, extraDraft?: string) => {
    const clipped = body.length > 4000 ? `${body.slice(0, 3999)}…` : body;
    setQuotes((current) => {
      if (current.some((item) => item.messageId === message.messageId && item.body === clipped)) return current;
      return [...current, {
        messageId: message.messageId,
        authorLabel: message.authorLabel,
        body: clipped,
        createdAtMs: message.createdAtMs,
        truncated: clipped !== body
      }];
    });
    if (extraDraft?.trim()) {
      setDraft((current) => current.trim() ? `${current.trim()}\n${extraDraft.trim()}` : extraDraft.trim());
    }
    textareaRef.current?.focus();
  }, []);

  const quoteMessage = useCallback((message: ImMessage) => {
    quoteSelection(message, message.body);
  }, [quoteSelection]);

  const selectedTextIn = useCallback((root: HTMLElement): string => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return "";
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return "";
    return selection.toString().trim();
  }, []);

  const openSelectionMenu = useCallback((event: ReactMouseEvent<HTMLElement>, message: ImMessage) => {
    // Prefer the highlighted text when the right-click happens over a selection
    // inside the message; otherwise run on the whole message body.
    const text = selectedTextIn(event.currentTarget) || message.body.trim();
    if (!text) return;
    event.preventDefault();
    setSelectionResult(null);
    setSelectionMenu({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 160),
      text,
      message
    });
  }, [selectedTextIn]);

  const runSelectionAction = useCallback(async (action: ImSelectionAction) => {
    if (!selectionMenu) return;
    const { text, message, x, y } = selectionMenu;
    setSelectionMenu(null);
    if (action.kind === "context") {
      const extra = action.actionId === "quote" ? "" : action.prompt.replaceAll("{selection}", text).trim();
      quoteSelection(message, text, extra);
      return;
    }
    setSelectionResult({ x, y, title: action.name, text: "", loading: true });
    try {
      const result = await desktopApi().imRunSelectionAction({ actionId: action.actionId, text });
      setSelectionResult({ x, y, title: action.name, text: result.text, loading: false });
    } catch (error) {
      setSelectionResult(null);
      setError(error);
    }
  }, [quoteSelection, selectionMenu, setError]);

  const actionLabel = useCallback((action: ImSelectionAction) => {
    if (action.actionId === "quote") return t("desktop.im.quote");
    if (action.actionId === "translate") return t("desktop.im.translate");
    if (action.actionId === "explain") return t("desktop.im.explain");
    return action.name;
  }, [t]);

  useEffect(() => {
    if (!selectionMenu && !selectionResult) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".im-selection-menu, .im-selection-result")) return;
      setSelectionMenu(null);
      if (!selectionResult?.loading) setSelectionResult(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectionMenu(null);
        if (!selectionResult?.loading) setSelectionResult(null);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [selectionMenu, selectionResult]);

  const createProject = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    try {
      const project = await desktopApi().imCreateProject({ name: newName });
      setNewName("");
      setCreating(false);
      await loadProjects();
      selectProject(project.projectId);
    } catch (error) {
      setError(error);
    }
  }, [loadProjects, newName, selectProject, setError]);

  const associateFolder = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const picked = await desktopApi().imPickLocalPath({ title: t("desktop.im.associateFolderTitle") });
      if (!picked.ok) return;
      const project = await desktopApi().imSetLocalPath({ projectId: selectedProjectId, localPath: picked.path });
      setProjects((current) => current.map((item) => item.projectId === project.projectId ? project : item));
      setRoom((current) => current ? { ...current, project } : current);
    } catch (error) {
      setError(error);
    }
  }, [selectedProjectId, setError, t]);

  const send = useCallback(async () => {
    if (!selectedProjectId || sending) return;
    const body = draft.trim();
    if (!body && !quotes.length) return;
    if (mentionIds.length && !canDispatch) {
      setError(new Error(t("desktop.im.needFolder")));
      return;
    }
    setSending(true);
    try {
      await desktopApi().imPostMessage({
        projectId: selectedProjectId,
        body,
        quoteIds: quotes.map((quote) => quote.messageId),
        mentionRoleIds: mentionIds
      });
      setDraft("");
      setQuotes([]);
      setMentionIds([]);
      setMentionOpen(false);
      setMentionIndex(0);
    } catch (error) {
      setError(error);
    } finally {
      setSending(false);
    }
  }, [canDispatch, draft, mentionIds, quotes, selectedProjectId, sending, setError, t]);

  const pickMention = useCallback((member: ImMember) => {
    const at = draft.lastIndexOf("@");
    const nextDraft = at >= 0 ? `${draft.slice(0, at).trimEnd()} ` : draft;
    setDraft(nextDraft.trimStart());
    setMentionIds((current) => current.includes(member.memberId) ? current : [...current, member.memberId]);
    setMentionOpen(false);
    setMentionIndex(0);
    textareaRef.current?.focus();
  }, [draft]);

  const onComposerKey = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "@") {
      setMentionOpen(true);
      setMentionIndex(0);
    }
    if (mentionOpen && mentionOptions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((current) => (current + 1) % mentionOptions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((current) => (current - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const selected = mentionOptions[mentionIndex] ?? mentionOptions[0];
        if (selected) pickMention(selected);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const selected = mentionOptions[mentionIndex] ?? mentionOptions[0];
        if (selected) pickMention(selected);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
    if (event.key === "Backspace" && !draft && !mentionOpen && mentionIds.length) {
      event.preventDefault();
      setMentionIds((current) => current.slice(0, -1));
      return;
    }
    if (event.key === "Escape") {
      setMentionOpen(false);
      setMentionIndex(0);
    }
  }, [draft, mentionIds.length, mentionIndex, mentionOpen, mentionOptions, pickMention, send]);

  const respondPermission = useCallback(async (job: ImJob, optionId?: string, cancelled?: boolean) => {
    if (!job.permission) return;
    try {
      await desktopApi().acpRespondPermission({
        requestId: job.permission.requestId,
        optionId,
        cancelled
      });
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const memberLabel = useCallback((member: ImMember) => roleLabel(member, t), [t]);

  useEffect(() => {
    if (!mentionOpen) return;
    setMentionIndex((current) => {
      if (!mentionOptions.length) return 0;
      return Math.min(current, mentionOptions.length - 1);
    });
  }, [mentionOpen, mentionOptions.length]);

  useEffect(() => {
    if (!mentionOpen) return;
    const list = mentionListRef.current;
    const option = mentionOptions[mentionIndex];
    if (!list || !option) return;
    const row = document.getElementById(option.memberId);
    if (row && list.contains(row) && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [mentionIndex, mentionOpen, mentionOptions]);


  const addKnowledgeText = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProjectId) return;
    try {
      const item = await desktopApi().imAddKnowledgeText({
        projectId: selectedProjectId,
        title: knowledgeTitle,
        body: knowledgeBody
      });
      setRoom((current) => current ? { ...current, knowledge: [...current.knowledge, item] } : current);
      setKnowledgeTitle("");
      setKnowledgeBody("");
    } catch (error) {
      setError(error);
    }
  }, [knowledgeBody, knowledgeTitle, selectedProjectId, setError]);

  const addKnowledgeLink = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProjectId) return;
    try {
      const item = await desktopApi().imAddKnowledgeLink({
        projectId: selectedProjectId,
        url: knowledgeUrl,
        title: knowledgeTitle
      });
      setRoom((current) => current ? { ...current, knowledge: [...current.knowledge, item] } : current);
      setKnowledgeUrl("");
      setKnowledgeTitle("");
    } catch (error) {
      setError(error);
    }
  }, [knowledgeTitle, knowledgeUrl, selectedProjectId, setError]);

  const addKnowledgeImage = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const result = await desktopApi().imAddKnowledgeImage({ projectId: selectedProjectId });
      if (!result.ok) return;
      setRoom((current) => current ? { ...current, knowledge: [...current.knowledge, result.item] } : current);
    } catch (error) {
      setError(error);
    }
  }, [selectedProjectId, setError]);

  const removeKnowledge = useCallback(async (item: ImKnowledgeItem) => {
    try {
      await desktopApi().imRemoveKnowledge({ itemId: item.itemId });
      setRoom((current) => current
        ? { ...current, knowledge: current.knowledge.filter((entry) => entry.itemId !== item.itemId) }
        : current);
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const toggleTemplate = useCallback(async (template: ImRoleTemplate, enabled: boolean) => {
    if (!selectedProjectId) return;
    try {
      if (enabled) {
        const member = await desktopApi().imAddMember({ projectId: selectedProjectId, templateId: template.templateId });
        setRoom((current) => current && !current.members.some((item) => item.memberId === member.memberId)
          ? { ...current, members: [...current.members, member] }
          : current);
        return;
      }
      const member = room?.members.find((item) => item.templateId === template.templateId);
      if (!member) return;
      await desktopApi().imRemoveMember({ memberId: member.memberId });
      setRoom((current) => current
        ? { ...current, members: current.members.filter((item) => item.memberId !== member.memberId) }
        : current);
      setMentionIds((current) => current.filter((id) => id !== member.memberId));
    } catch (error) {
      setError(error);
    }
  }, [room?.members, selectedProjectId, setError]);

  if (!host) return null;
  const headerSlot = document.getElementById("app-header-slot");
  const toolbar = (
    <div className="im-toolbar">
      <div className="im-toolbar-controls">
        <button
          type="button"
          className="tool-btn ghost-btn"
          onClick={() => {
            setSidebarCollapsed((current) => {
              const next = !current;
              try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
              return next;
            });
          }}
          aria-label={t(sidebarCollapsed ? "desktop.common.showSidebar" : "desktop.common.hideSidebar")}
          title={t(sidebarCollapsed ? "desktop.common.showSidebar" : "desktop.common.hideSidebar")}
          aria-expanded={!sidebarCollapsed}
        >
          <ThemeIcon name="panel-right" size={16} />
        </button>
        <strong>{t("desktop.im.title")}</strong>
      </div>
    </div>
  );

  return createPortal(
    <section className="react-im-panel panel" hidden={!active} aria-label={t("desktop.im.title")}>
      {active && headerSlot ? createPortal(toolbar, headerSlot) : null}
      <div className="im-split">
        <aside
          className={`sidebar-folders-pane im-folders-pane${sidebarCollapsed ? " is-collapsed" : ""}`}
          style={sidebarCollapsed ? undefined : { width: sidebarWidth }}
          aria-label={t("desktop.im.projects")}
        >
          {!sidebarCollapsed && (
            <div className="im-folders">
              {creating ? (
                <form className="im-new-project" onSubmit={(event) => void createProject(event)}>
                  <input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder={t("desktop.im.projectName")}
                    aria-label={t("desktop.im.projectName")}
                    autoFocus
                  />
                  <button type="submit" className="tool-btn">{t("desktop.common.confirm")}</button>
                  <button type="button" className="tool-btn ghost-btn" onClick={() => setCreating(false)}>
                    {t("desktop.common.cancel")}
                  </button>
                </form>
              ) : (
                <button type="button" className="im-new-project-btn" onClick={() => setCreating(true)}>
                  <ThemeIcon name="plus" size={14} aria-hidden="true" />
                  {t("desktop.im.newProject")}
                </button>
              )}
              {projects.length ? projects.map((project) => (
                <button
                  key={project.projectId}
                  type="button"
                  className={`im-folder-row${selectedProjectId === project.projectId ? " active" : ""}`}
                  onClick={() => selectProject(project.projectId)}
                >
                  <span className="im-folder-label">{project.name}</span>
                  <span className="im-folder-path">{project.localPath ? basename(project.localPath) : t("desktop.im.noFolder")}</span>
                </button>
              )) : (
                <p className="im-empty">{t("desktop.im.noProjects")}</p>
              )}
            </div>
          )}
        </aside>
        {!sidebarCollapsed && (
          <div
            className="sidebar-folders-resizer"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={(event) => {
              const origin = event.clientX;
              const start = sidebarWidth;
              const move = (next: PointerEvent) => {
                const width = Math.min(360, Math.max(160, Math.round(start + (next.clientX - origin))));
                setSidebarWidth(width);
                try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width)); } catch { /* ignore */ }
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
        )}
        <div className="im-main">
          {room ? (
            <>
              <div className="im-room-head">
                <div>
                  <h2>{room.project.name}</h2>
                  <p>{room.project.localPath || t("desktop.im.needFolder")}</p>
                </div>
                <div className="im-room-head-actions">
                  <button type="button" className="tool-btn ghost-btn" onClick={() => setKnowledgeOpen((open) => !open)}>
                    {t("desktop.im.knowledge")} ({room.knowledge.length})
                  </button>
                  <button type="button" className="tool-btn" onClick={() => void associateFolder()}>
                    {t("desktop.im.associateFolder")}
                  </button>
                </div>
              </div>
              {knowledgeOpen && (
                <div className="im-knowledge" aria-label={t("desktop.im.knowledge")}>
                  {room.knowledge.length ? room.knowledge.map((item) => (
                    <div key={item.itemId} className="im-knowledge-item">
                      <strong>{item.title || item.fileName || item.url}</strong>
                      <span className="im-folder-path">{item.kind === "link" ? item.url : item.kind === "image" ? item.fileName : item.body.slice(0, 80)}</span>
                      <button type="button" className="tool-btn ghost-btn" onClick={() => void removeKnowledge(item)} aria-label={t("desktop.im.removeKnowledge")}>
                        <ThemeIcon name="close" size={12} />
                      </button>
                    </div>
                  )) : <p className="im-empty">{t("desktop.im.knowledgeEmpty")}</p>}
                  <form className="im-knowledge-form" onSubmit={(event) => void addKnowledgeText(event)}>
                    <input value={knowledgeTitle} onChange={(event) => setKnowledgeTitle(event.target.value)} placeholder={t("desktop.im.knowledgeTitle")} aria-label={t("desktop.im.knowledgeTitle")} />
                    <textarea value={knowledgeBody} onChange={(event) => setKnowledgeBody(event.target.value)} placeholder={t("desktop.im.knowledgeText")} aria-label={t("desktop.im.knowledgeText")} rows={2} />
                    <button type="submit" className="tool-btn">{t("desktop.im.addText")}</button>
                  </form>
                  <form className="im-knowledge-form" onSubmit={(event) => void addKnowledgeLink(event)}>
                    <input value={knowledgeUrl} onChange={(event) => setKnowledgeUrl(event.target.value)} placeholder={t("desktop.im.knowledgeUrl")} aria-label={t("desktop.im.knowledgeUrl")} />
                    <button type="submit" className="tool-btn">{t("desktop.im.addLink")}</button>
                    <button type="button" className="tool-btn ghost-btn" onClick={() => void addKnowledgeImage()}>{t("desktop.im.addImage")}</button>
                  </form>
                </div>
              )}
              <div ref={transcriptRef} className="im-transcript" aria-label={t("desktop.im.transcript")}>
                {visibleMessages.length ? visibleMessages.map((message) => {
                  const speaker = members.find((member) => member.memberId === message.authorMemberId);
                  return (
                    <article key={message.messageId} className={`im-message is-${message.kind.replace(".", "-")}`} onContextMenu={(event) => openSelectionMenu(event, message)}>
                      {message.kind !== "system" && (
                        <header>
                          <strong>
                            {speaker ? memberLabel(speaker) : message.authorLabel}
                            {speaker ? <> {agentTag(speaker.agent, t)}</> : null}
                          </strong>
                          <button type="button" className="im-quote-btn" onClick={() => quoteMessage(message)}>
                            {t("desktop.im.quote")}
                          </button>
                        </header>
                      )}
                      {message.quotes.length > 0 && (
                        <div className="im-quote-list">
                          {message.quotes.map((quote) => (
                            <blockquote key={quote.messageId}>
                              <span>{quote.authorLabel}</span>
                              {quote.body}
                            </blockquote>
                          ))}
                        </div>
                      )}
                      {message.mentionRoleIds.length > 0 && (
                        <div className="im-message-mentions" aria-label={t("desktop.im.mentions")}>
                          {message.mentionRoleIds.map((mentionId) => {
                            const mentionMember = room?.members.find((item) => item.memberId === mentionId);
                            return (
                              <span key={mentionId} className="im-message-mention">
                                @{mentionMember ? memberLabel(mentionMember) : mentionId}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <div
                        className="markdown-body"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.body) }}
                      />
                    </article>
                  );
                }) : (
                  <p className="im-empty">{t("desktop.im.emptyRoom")}</p>
                )}
              </div>
              {activeJob?.permission && (
                <div className="im-permission" role="alertdialog" aria-label={t("desktop.im.permissionTitle")}>
                  <strong>{permissionOwner ? `${memberLabel(permissionOwner)} · ` : ""}{activeJob.permission.title}</strong>
                  <div className="im-permission-actions">
                    {activeJob.permission.options.map((option) => (
                      <button
                        key={option.optionId}
                        type="button"
                        className="tool-btn"
                        onClick={() => void respondPermission(activeJob, option.optionId)}
                      >
                        {option.name}
                      </button>
                    ))}
                    <button type="button" className="tool-btn ghost-btn" onClick={() => void respondPermission(activeJob, undefined, true)}>
                      {t("desktop.common.cancel")}
                    </button>
                  </div>
                </div>
              )}
              <div className="im-composer">
                {quotes.length > 0 && (
                  <div className="im-quote-chips">
                    {quotes.map((quote) => (
                      <button
                        key={quote.messageId}
                        type="button"
                        className="im-quote-chip"
                        onClick={() => setQuotes((current) => current.filter((item) => item.messageId !== quote.messageId))}
                        aria-label={t("desktop.im.removeQuote")}
                      >
                        {quote.authorLabel}: {quote.body.slice(0, 40)}
                        <ThemeIcon name="close" size={12} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
                {mentionOpen && mentionOptions.length > 0 && (
                  <div ref={mentionListRef} className="im-mention-menu" role="listbox" aria-label={t("desktop.im.mention")} aria-activedescendant={mentionOptions[mentionIndex]?.memberId}>
                    {mentionOptions.map((member, index) => (
                      <button
                        key={member.memberId}
                        id={member.memberId}
                        type="button"
                        role="option"
                        aria-selected={index === mentionIndex}
                        className={index === mentionIndex ? "active" : undefined}
                        onMouseEnter={() => setMentionIndex(index)}
                        onClick={() => pickMention(member)}
                      >
                        @{memberLabel(member)} {agentTag(member.agent, t)}
                      </button>
                    ))}
                  </div>
                )}
                {mentioned.length > 0 && (
                  <div className="im-quote-chips">
                    {mentioned.map((member) => (
                      <button
                        key={member.memberId}
                        type="button"
                        className="im-mention-chip"
                        onClick={() => setMentionIds((current) => current.filter((id) => id !== member.memberId))}
                        aria-label={t("desktop.im.removeMention")}
                      >
                        @{memberLabel(member)}
                        <ThemeIcon name="close" size={12} />
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onComposerKey}
                  placeholder={t("desktop.im.placeholder")}
                  aria-label={t("desktop.im.placeholder")}
                  rows={3}
                />
                <div className="im-composer-actions">
                  <button type="button" className="tool-btn ghost-btn" onClick={() => {
                    setMentionOpen((open) => !open);
                    setMentionIndex(0);
                    textareaRef.current?.focus();
                  }}>
                    @
                  </button>
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => void send()}
                    disabled={sending || (!draft.trim() && !quotes.length)}
                  >
                    {t("desktop.common.send")}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="im-empty">{t("desktop.im.selectProject")}</p>
          )}
        </div>
        <aside className="im-members" aria-label={t("desktop.im.members")}>
          <h3>{t("desktop.im.members")}</h3>
          {templates.length ? templates.map((template) => {
            const enabledMember = members.find((item) => item.templateId === template.templateId);
            const label = enabledMember
              ? memberLabel(enabledMember)
              : builtinRoleLabel(template.templateId, template.name, t);
            return (
              <label key={template.templateId} className="im-member-row">
                <span className="im-member-head">
                  <input
                    type="checkbox"
                    checked={Boolean(enabledMember)}
                    onChange={(event) => void toggleTemplate(template, event.target.checked)}
                  />
                  <strong>{label}</strong>
                </span>
                {agentTag(template.agent, t)}
              </label>
            );
          }) : <p className="im-empty">{t("desktop.im.noMembers")}</p>}
          {room?.jobs.some((job) => job.status === "queued" || job.status === "connecting" || job.status === "running" || job.status === "awaiting_user") && (
            <div className="im-job-status">
              <h3>{t("desktop.im.currentJob")}</h3>
              {room.jobs.filter((job) => job.status === "queued" || job.status === "connecting" || job.status === "running" || job.status === "awaiting_user").map((job) => {
                const owner = members.find((member) => member.memberId === job.memberId);
                return (
                  <p key={job.jobId}>{owner ? memberLabel(owner) : job.memberId} · {t(`desktop.im.job.${job.status}`)}</p>
                );
              })}
            </div>
          )}
        </aside>
      </div>
      {selectionMenu ? createPortal(
        <div
          className="im-selection-menu chat-context-menu"
          role="menu"
          style={{ left: selectionMenu.x, top: selectionMenu.y }}
        >
          {selectionActions.map((action) => (
            <button key={action.actionId} type="button" role="menuitem" onClick={() => void runSelectionAction(action)}>
              {actionLabel(action)}
            </button>
          ))}
        </div>,
        document.body
      ) : null}
      {selectionResult ? createPortal(
        <div
          className="im-selection-result"
          role="dialog"
          aria-label={selectionResult.title}
          style={{ left: Math.min(selectionResult.x, window.innerWidth - 320), top: Math.min(selectionResult.y, window.innerHeight - 220) }}
        >
          <header>
            <strong>{selectionResult.title}</strong>
            <button type="button" className="tool-btn ghost-btn" onClick={() => setSelectionResult(null)} aria-label={t("desktop.common.cancel")}>
              <ThemeIcon name="close" size={12} />
            </button>
          </header>
          {selectionResult.loading
            ? <p className="im-empty">{t("desktop.im.actionRunning")}</p>
            : <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(selectionResult.text) }} />}
        </div>,
        document.body
      ) : null}
    </section>,
    host
  );
}
