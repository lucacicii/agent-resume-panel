import { ThemeIcon } from "../../components/ThemeIcon";
import { renderMarkdown } from "../../components/Markdown";
import { ImTimeline } from "./ImTimeline";
import { buildTimelineNodes } from "./timelineModel";
import { createPortal } from "react-dom";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type JSX, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactPortal } from "react";
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

// Stable brand colors for built-in roles; custom templates hash to a hue.
const BUILTIN_ROLE_COLORS: Record<string, string> = {
  role_product_manager: "hsl(265 70% 58%)",
  role_project_manager: "hsl(199 92% 52%)",
  role_ui_designer: "hsl(330 72% 58%)",
  role_developer: "hsl(152 76% 42%)",
  role_tester: "hsl(35 92% 52%)"
};

function roleColor(templateId: string): string {
  const builtin = BUILTIN_ROLE_COLORS[templateId];
  if (builtin) return builtin;
  let hash = 0;
  for (let i = 0; i < templateId.length; i++) {
    hash = (hash << 5) - hash + templateId.charCodeAt(i);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360} 65% 50%)`;
}

function roleInitial(label: string): string {
  return label.trim().charAt(0).toUpperCase() || "?";
}

function dayKey(millis: number): string {
  const date = new Date(millis);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDay(millis: number, t: Translate): string {
  const date = new Date(millis);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startToday - startTarget) / 86_400_000);
  if (diffDays === 0) return t("desktop.im.today");
  if (diffDays === 1) return t("desktop.im.yesterday");
  return date.toLocaleDateString();
}

function formatTime(millis: number): string {
  return new Date(millis).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const ACTIVE_JOB_STATUSES = ["queued", "connecting", "running", "awaiting_user"] as const;

function isActiveJobStatus(status: string): boolean {
  return (ACTIVE_JOB_STATUSES as readonly string[]).includes(status);
}

type Translate = (key: string, ...args: Array<string | number>) => string;

function builtinRoleLabel(templateId: string, fallback: string, t: Translate): string {
  if (!isBuiltinTemplateId(templateId)) return fallback;
  return t(`desktop.im.role.${BUILTIN_ROLE_KEYS[templateId]}`);
}

function roleLabel(member: ImMember, t: Translate): string {
  return builtinRoleLabel(member.templateId, member.name, t);
}

function agentTag(agent: string, model: string | undefined, t: Translate): JSX.Element {
  return (
    <span className="s-provider-tag" data-provider={agent}>
      {t(`desktop.im.agent.${agent}`)}{model ? ` · ${model}` : ""}
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
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(() => new Set());
  const [templates, setTemplates] = useState<ImRoleTemplate[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"members" | "knowledge">("members");
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeBody, setKnowledgeBody] = useState("");
  const [knowledgeUrl, setKnowledgeUrl] = useState("");
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const [activeTimelineMessageId, setActiveTimelineMessageId] = useState<string | undefined>();
  const [flashingMessageId, setFlashingMessageId] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const prevMsgCount = useRef(0);

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
    setPinnedToBottom(true);
    setHasNewBelow(false);
    prevMsgCount.current = 0;
  }, [selectedProjectId]);

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
          if (current.messages.some((item) => item.messageId === event.message.messageId)) {
            return {
              ...current,
              messages: current.messages.map((item) => item.messageId === event.message.messageId ? event.message : item)
            };
          }
          return { ...current, messages: [...current.messages, event.message] };
        }
        if (event.type === "messageUpdate") {
          const messages = current.messages.some((item) => item.messageId === event.message.messageId)
            ? current.messages.map((item) => item.messageId === event.message.messageId ? event.message : item)
            : [...current.messages, event.message];
          return { ...current, messages };
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
    const count = room?.messages.length ?? 0;
    const grew = count > prevMsgCount.current;
    prevMsgCount.current = count;
    if (pinnedToBottom) {
      node.scrollTop = node.scrollHeight;
    } else if (grew) {
      setHasNewBelow(true);
    }
  }, [pinnedToBottom, room?.messages.length]);

  const copyText = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch { /* fall through to legacy path */ }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }, []);

  const memberLabel = useCallback((member: ImMember) => roleLabel(member, t), [t]);

  const visibleMessages = (room?.messages ?? []).filter((message) => {
    if (message.kind !== "job.card") return true;
    const job = room?.jobs.find((item) => item.jobId === message.jobId);
    return job?.status === "failed";
  });

  const scrollToBottom = useCallback(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    setPinnedToBottom(true);
    setHasNewBelow(false);
  }, []);

  const scrollToTop = useCallback(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTo({ top: 0, behavior: "smooth" });
    if (visibleMessages[0]) setActiveTimelineMessageId(visibleMessages[0].messageId);
  }, [visibleMessages]);

  const jumpToMessage = useCallback((messageId: string) => {
    const node = transcriptRef.current;
    if (!node) return;
    const el = document.getElementById(`im-msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashingMessageId(messageId);
      setActiveTimelineMessageId(messageId);
      window.setTimeout(() => {
        setFlashingMessageId((current) => (current === messageId ? null : current));
      }, 1500);
    }
  }, []);

  const onTranscriptScroll = useCallback(() => {
    const node = transcriptRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
    setPinnedToBottom(nearBottom);
    if (nearBottom) setHasNewBelow(false);

    const articles = node.querySelectorAll<HTMLElement>("article.im-message");
    const containerTop = node.getBoundingClientRect().top;
    let closestId: string | undefined;
    for (const article of articles) {
      const rect = article.getBoundingClientRect();
      if (rect.bottom >= containerTop + 20) {
        closestId = article.id.replace("im-msg-", "");
        break;
      }
    }
    if (closestId) setActiveTimelineMessageId(closestId);
  }, []);

  const insertIntoComposer = useCallback((text: string) => {
    setDraft((current) => {
      const base = current.trim();
      return base ? `${base}\n${text}` : text;
    });
    textareaRef.current?.focus();
  }, []);

  const members = room?.members.filter((member) => member.enabled) ?? [];
  const timelineNodes = useMemo(() => {
    return buildTimelineNodes(
      visibleMessages,
      members,
      roleColor,
      memberLabel,
      roleInitial,
      formatTime,
      (ms) => formatDay(ms, t)
    );
  }, [formatTime, memberLabel, members, t, visibleMessages]);
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
  const activeJob = room?.jobs.find((job) => isActiveJobStatus(job.status)) ?? null;
  const permissionOwner = activeJob
    ? members.find((member) => member.memberId === activeJob.memberId)
    : undefined;
  const canDispatch = Boolean(room?.project.localPath);
  const mentioned = mentionIds
    .map((id) => members.find((member) => member.memberId === id))
    .filter((member): member is ImMember => Boolean(member));

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

  const translateMessage = useCallback(async (message: ImMessage) => {
    if (translations[message.messageId]) {
      setTranslations((current) => {
        const next = { ...current };
        delete next[message.messageId];
        return next;
      });
      return;
    }
    setTranslatingIds((current) => {
      const next = new Set(current);
      next.add(message.messageId);
      return next;
    });
    try {
      const result = await desktopApi().imRunSelectionAction({ actionId: "translate", text: message.body });
      setTranslations((current) => ({ ...current, [message.messageId]: result.text }));
    } catch (error) {
      setError(error);
    } finally {
      setTranslatingIds((current) => {
        const next = new Set(current);
        next.delete(message.messageId);
        return next;
      });
    }
  }, [setError, translations]);

  useEffect(() => {
    setTranslations({});
    setTranslatingIds(new Set());
  }, [selectedProjectId]);

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

  const cancelJob = useCallback(async (job: ImJob) => {
    try {
      await desktopApi().imCancelJob({ jobId: job.jobId });
    } catch (error) {
      setError(error);
    }
  }, [setError]);

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
                  <button type="button" className={`tool-btn ghost-btn${sidebarTab === "knowledge" ? " active" : ""}`} onClick={() => setSidebarTab("knowledge")}>
                    {t("desktop.im.knowledge")} ({room.knowledge.length})
                  </button>
                  <button type="button" className="tool-btn" onClick={() => void associateFolder()}>
                    {t("desktop.im.associateFolder")}
                  </button>
                </div>
              </div>
              <div className="im-transcript-wrap">
                <div ref={transcriptRef} className="im-transcript" aria-label={t("desktop.im.transcript")} onScroll={onTranscriptScroll}>
                {visibleMessages.length ? visibleMessages.map((message, index) => {
                  const speaker = members.find((member) => member.memberId === message.authorMemberId);
                  const displayBody = translations[message.messageId] ?? message.body;
                  const isTranslating = translatingIds.has(message.messageId);
                  const translated = Boolean(translations[message.messageId]);
                  const roleColorValue = speaker ? roleColor(speaker.templateId) : undefined;
                  const prevVisible = visibleMessages[index - 1];
                  const showDate = !prevVisible || dayKey(prevVisible.createdAtMs) !== dayKey(message.createdAtMs);
                  return (
                    <Fragment key={message.messageId}>
                      {showDate && (
                        <div className="im-date-separator" aria-hidden="true">{formatDay(message.createdAtMs, t)}</div>
                      )}
                      <article
                        id={`im-msg-${message.messageId}`}
                        className={`im-message is-${message.kind.replace(".", "-")}${flashingMessageId === message.messageId ? " is-flashing" : ""}`}
                        style={roleColorValue ? { "--im-role-color": roleColorValue } as CSSProperties : undefined}
                        onContextMenu={(event) => openSelectionMenu(event, message)}
                      >
                        {message.kind !== "system" && (
                          <header>
                            <span className="im-message-author">
                              {roleColorValue && (
                                <span className="im-role-avatar" aria-hidden="true" style={{ "--im-role-color": roleColorValue } as CSSProperties}>
                                  {roleInitial(speaker ? memberLabel(speaker) : message.authorLabel)}
                                </span>
                              )}
                              <strong>
                                {speaker ? memberLabel(speaker) : message.authorLabel}
                                {speaker ? <> {agentTag(speaker.agent, speaker.model, t)}</> : null}
                              </strong>
                            </span>
                            <span className="im-message-meta">
                              <time dateTime={new Date(message.createdAtMs).toISOString()} className="im-message-time">
                                {formatTime(message.createdAtMs)}
                              </time>
                            </span>
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
                              const mentionColor = mentionMember ? roleColor(mentionMember.templateId) : undefined;
                              return (
                                <span
                                  key={mentionId}
                                  className="im-message-mention"
                                  style={mentionColor ? { "--im-role-color": mentionColor } as CSSProperties : undefined}
                                >
                                  @{mentionMember ? memberLabel(mentionMember) : mentionId}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {message.thinking ? (
                          <div className="im-message-thinking">
                            <button
                              type="button"
                              className="im-message-thinking-toggle"
                              aria-expanded={expandedThinking[message.messageId] === true}
                              onClick={() => setExpandedThinking((curr) => ({
                                ...curr,
                                [message.messageId]: !curr[message.messageId]
                              }))}
                            >
                              <ThemeIcon
                                name="chevron-right"
                                className={expandedThinking[message.messageId] ? "is-expanded" : ""}
                                size={12}
                                aria-hidden="true"
                              />
                              <span>
                                {t("desktop.im.thinking")}
                                {message.streaming && !message.body ? (
                                  <span className="im-thinking-spinner" aria-hidden="true" />
                                ) : null}
                              </span>
                            </button>
                            {expandedThinking[message.messageId] ? (
                              <div
                                className="im-message-thinking-body markdown-body"
                                dangerouslySetInnerHTML={{ __html: renderMarkdown(message.thinking) }}
                              />
                            ) : null}
                          </div>
                        ) : null}
                        {displayBody ? (
                          <div
                            className="markdown-body"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(displayBody) }}
                          />
                        ) : null}
                        {message.streaming && (
                          <span className="im-streaming-cursor" aria-hidden="true" />
                        )}
                        {(message.kind === "human" || message.kind === "role.say") && (
                          <div className="im-message-actions">
                            <button type="button" className="im-message-action" onClick={() => void copyText(message.body)}>
                              {t("desktop.common.copy")}
                            </button>
                            <button type="button" className="im-message-action im-quote-btn" onClick={() => quoteMessage(message)}>
                              {t("desktop.im.quote")}
                            </button>
                            <button
                              type="button"
                              className="im-message-action"
                              disabled={isTranslating}
                              onClick={() => void translateMessage(message)}
                            >
                              {translated
                                ? t("desktop.im.restore")
                                : isTranslating
                                  ? t("desktop.im.actionRunning")
                                  : t("desktop.im.translate")}
                            </button>
                          </div>
                        )}
                      </article>
                    </Fragment>
                  );
                }) : (
                  room?.project.localPath
                    ? <p className="im-empty">{t("desktop.im.emptyRoom")}</p>
                    : (
                      <div className="im-empty im-empty-cta">
                        <p>{t("desktop.im.emptyRoomNoFolder")}</p>
                        <button type="button" className="tool-btn" onClick={() => void associateFolder()}>
                          {t("desktop.im.associateFolder")}
                        </button>
                      </div>
                    )
                )}
                </div>
                <ImTimeline
                  nodes={timelineNodes}
                  activeMessageId={activeTimelineMessageId}
                  onJump={jumpToMessage}
                  onJumpTop={scrollToTop}
                  onJumpBottom={scrollToBottom}
                  t={t}
                />
                {hasNewBelow && (
                  <button type="button" className="im-new-below" onClick={scrollToBottom}>
                    <ThemeIcon name="arrow-down" size={12} aria-hidden="true" />
                    {t("desktop.im.newMessages")}
                  </button>
                )}
              </div>
              {room?.jobs.some((job) => job.status === "awaiting_user") && (
                <div className="im-active-jobs-banner" aria-label={t("desktop.im.currentJob")}>
                  <div className="im-active-jobs-header">
                    <span className="im-active-jobs-title">{t("desktop.im.currentJob")}</span>
                  </div>
                  <div className="im-active-jobs-list">
                    {room.jobs
                      .filter((job) => job.status === "awaiting_user")
                      .map((job) => {
                        const owner = members.find((member) => member.memberId === job.memberId);
                        const name = owner ? memberLabel(owner) : job.memberId;
                        const agent = owner?.agent;
                        const model = owner?.model;
                        return (
                          <div key={job.jobId} className={`im-active-job-item is-${job.status}`}>
                            <span className={`im-job-dot is-${job.status}`} aria-hidden="true" />
                            <span className="im-active-job-name">{name}</span>
                            {agent && (
                              <span className="s-provider-tag" data-provider={agent}>
                                {t(`desktop.im.agent.${agent}`)}{model ? ` · ${model}` : ""}
                              </span>
                            )}
                            <span className="im-active-job-status">
                              {t(`desktop.im.job.${job.status}`)}
                            </span>
                            <button
                              type="button"
                              className="im-job-cancel-btn"
                              onClick={() => void cancelJob(job)}
                              aria-label={t("desktop.im.cancelJob")}
                              title={t("desktop.im.cancelJob")}
                            >
                              <ThemeIcon name="close" size={11} />
                            </button>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
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
                        <span className="im-role-avatar" aria-hidden="true" style={{ "--im-role-color": roleColor(member.templateId) } as CSSProperties}>
                          {roleInitial(memberLabel(member))}
                        </span>
                        @{memberLabel(member)} {agentTag(member.agent, member.model, t)}
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
          <div className="im-sidebar-tabs" role="tablist" aria-label={t("desktop.im.members")}>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "members"}
              className={sidebarTab === "members" ? "active" : ""}
              onClick={() => setSidebarTab("members")}
            >
              {t("desktop.im.members")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === "knowledge"}
              className={sidebarTab === "knowledge" ? "active" : ""}
              onClick={() => setSidebarTab("knowledge")}
            >
              {t("desktop.im.knowledge")} ({room?.knowledge.length ?? 0})
            </button>
          </div>
          {sidebarTab === "knowledge" ? (
            <div className="im-knowledge-pane" aria-label={t("desktop.im.knowledge")}>
              {room?.knowledge.length ? room.knowledge.map((item) => (
                <div key={item.itemId} className="im-knowledge-item">
                  <span className="im-kind-icon" aria-hidden="true">
                    <ThemeIcon name={item.kind === "link" ? "globe" : item.kind === "image" ? "file-image" : "file-text"} size={13} />
                  </span>
                  <div className="im-knowledge-main">
                    <strong title={item.title || item.fileName || item.url || ""}>{item.title || item.fileName || item.url}</strong>
                    <span className="im-folder-path">{item.kind === "link" ? item.url : item.kind === "image" ? item.fileName : item.body.slice(0, 80)}</span>
                  </div>
                  <span className="im-knowledge-item-actions">
                    {item.kind === "link" && item.url ? (
                      <button
                        type="button"
                        className="tool-btn ghost-btn"
                        title={t("desktop.im.openLink")}
                        aria-label={t("desktop.im.openLink")}
                        onClick={() => void desktopApi().openExternalUrl(item.url || "")}
                      >
                        <ThemeIcon name="external-link" size={12} />
                      </button>
                    ) : null}
                    <button type="button" className="tool-btn ghost-btn" onClick={() => void removeKnowledge(item)} aria-label={t("desktop.im.removeKnowledge")}>
                      <ThemeIcon name="close" size={12} />
                    </button>
                  </span>
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
          ) : (
            templates.length ? templates.map((template) => {
              const enabledMember = members.find((item) => item.templateId === template.templateId);
              const label = enabledMember
                ? memberLabel(enabledMember)
                : builtinRoleLabel(template.templateId, template.name, t);
              const jobStatus = enabledMember
                ? room?.jobs.find((item) => item.memberId === enabledMember.memberId && isActiveJobStatus(item.status))?.status ?? "idle"
                : "idle";
              const rowColor = roleColor(template.templateId);
              return (
                <label key={template.templateId} className="im-member-row">
                  <span className="im-member-head">
                    <span className="im-member-ident">
                      <input
                        type="checkbox"
                        checked={Boolean(enabledMember)}
                        onChange={(event) => void toggleTemplate(template, event.target.checked)}
                      />
                      <span className="im-role-avatar" aria-hidden="true" style={{ "--im-role-color": rowColor } as CSSProperties}>
                        {roleInitial(label)}
                      </span>
                      <strong>{label}</strong>
                    </span>
                    {enabledMember && jobStatus !== "idle" ? (
                      <span
                        className={`im-job-dot is-${jobStatus}`}
                        title={t(`desktop.im.job.${jobStatus}`)}
                        aria-label={t(`desktop.im.job.${jobStatus}`)}
                      />
                    ) : <span className="im-job-dot is-idle" aria-hidden="true" />}
                  </span>
                  {agentTag(template.agent, template.model, t)}
                </label>
              );
            }) : <p className="im-empty">{t("desktop.im.noMembers")}</p>
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
            <span className="im-selection-result-actions">
              {!selectionResult.loading ? (
                <>
                  <button type="button" className="tool-btn ghost-btn" onClick={() => void copyText(selectionResult.text)}>
                    {t("desktop.common.copy")}
                  </button>
                  <button type="button" className="tool-btn ghost-btn" onClick={() => {
                    insertIntoComposer(selectionResult.text);
                    setSelectionResult(null);
                  }}>
                    {t("desktop.im.sendToComposer")}
                  </button>
                </>
              ) : null}
              <button type="button" className="tool-btn ghost-btn" onClick={() => setSelectionResult(null)} aria-label={t("desktop.common.cancel")}>
                <ThemeIcon name="close" size={12} />
              </button>
            </span>
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
