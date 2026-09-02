import { ThemeIcon } from "../../components/ThemeIcon";
import { VariableVirtualList, type VariableVirtualListHandle } from "../../components/VariableVirtualList";
import { renderMarkdown } from "../../components/Markdown";
import { ImTimeline } from "./ImTimeline";
import { ImMessageItem } from "./ImMessageItem";
import { ImComposer } from "./ImComposer";
import { ImChatAvatar } from "./ImChatAvatar";
import { useImProjectTools } from "./ImProjectTools";
import { buildTimelineNodes } from "./timelineModel";
import { createPortal } from "react-dom";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type JSX, type MouseEvent as ReactMouseEvent, type ReactPortal, type UIEvent } from "react";
import type { AgentCitation, AgentToolDescriptor } from "@agent-resume/core";
import { type AskToolPrefs } from "../../components/ToolSettingsPopover";
import { Sheet } from "../../components/Sheet";
import { CitationSheet, extractCitationsFromMessage, isNote, isSession, periodFromCitation } from "./CitationSheet";
import { desktopApi } from "../../bridge";
import { notifyDesktop } from "../../components/Notifications";
import { useI18n } from "../../i18n";
import { storedWidth } from "../../storage";
import {
  IM_AGENTS,
  IM_AGENT_SUGGESTED_MODELS,
  IM_SUGGESTED_THOUGHT_LEVELS,
  isBuiltinTemplateId,
  isProjectRoleTemplateId,
  isSuggestedThoughtLevel,
  type ImAgent,
  type ImAgentModelOption,
  type ImEvent,
  type ImJob,
  type ImKnowledgeItem,
  type ImMember,
  type ImMessage,
  type ImProject,
  type ImQuotedMessage,
  type ImRoleTemplate,
  type ImRoom,
  type ImSelectionAction
} from "../../../shared/imTypes";
import {
  agentTag,
  basename,
  builtinRoleLabel,
  formatDay,
  formatTime,
  isActiveJobStatus,
  isResumableJob,
  isScratchPath,
  roleColor,
  roleInitial,
  roleLabel,
  storageBoolean,
  type PendingImage
} from "./imUtils";

const SIDEBAR_COLLAPSED_KEY = "im-sidebar-collapsed";
const SIDEBAR_WIDTH_KEY = "im-sidebar-width";
const SELECTED_PROJECT_KEY = "im-selected-project";
const IM_PROJECT_TOOLS_KEY_PREFIX = "im-project-tools:";

function imProjectToolsKey(projectId: string): string {
  return `${IM_PROJECT_TOOLS_KEY_PREFIX}${projectId}`;
}

function readImProjectTools(projectId: string): AskToolPrefs {
  try {
    const raw = localStorage.getItem(imProjectToolsKey(projectId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AskToolPrefs>;
      if (parsed.mode === "auto" || parsed.mode === "custom" || parsed.mode === "off") {
        return { mode: parsed.mode, enabledTools: Array.isArray(parsed.enabledTools) ? parsed.enabledTools : [] };
      }
    }
  } catch {
    // fallback
  }
  return { mode: "auto", enabledTools: [] };
}

function writeImProjectTools(projectId: string, prefs: AskToolPrefs): void {
  try {
    localStorage.setItem(imProjectToolsKey(projectId), JSON.stringify(prefs));
  } catch {
    // ignore
  }
}
type TranscriptItem =
  | { kind: "message"; message: ImMessage }
  | { kind: "pending"; job: ImJob };

function estimateTranscriptItemSize(item: TranscriptItem): number {
  if (item.kind === "pending") return 88;
  const body = item.message.body ?? "";
  const lines = Math.max(1, body.split("\n").length);
  const wrapped = Math.ceil(body.length / 72);
  return Math.min(720, 88 + Math.max(lines, wrapped) * 18);
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
  const [followUpTo, setFollowUpTo] = useState<ImMessage | null>(null);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; project: ImProject } | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => storageBoolean(SIDEBAR_COLLAPSED_KEY));
  const [sidebarWidth, setSidebarWidth] = useState(() => storedWidth(SIDEBAR_WIDTH_KEY, 240, 160, 360));
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [copiedFilePath, setCopiedFilePath] = useState<string | null>(null);
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
  const [membersDrawerOpen, setMembersDrawerOpen] = useState(false);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [popoverAnchorRect, setPopoverAnchorRect] = useState<DOMRect | null>(null);
  const [isTogglingAll, setIsTogglingAll] = useState(false);
  const [customMemberModelId, setCustomMemberModelId] = useState<string | null>(null);
  const [customMemberThoughtId, setCustomMemberThoughtId] = useState<string | null>(null);
  const [agentModelsMap, setAgentModelsMap] = useState<Record<string, ImAgentModelOption[]>>({});
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeBody, setKnowledgeBody] = useState("");
  const [knowledgeUrl, setKnowledgeUrl] = useState("");
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [hasNewBelow, setHasNewBelow] = useState(false);
  const [activeTimelineMessageId, setActiveTimelineMessageId] = useState<string | undefined>();
  const [flashingMessageId, setFlashingMessageId] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);
  const [citationDrawerState, setCitationDrawerState] = useState<{
    open: boolean;
    citations: AgentCitation[];
    initialMarker?: string | null;
  }>({ open: false, citations: [] });
  const [toolPrefs, setToolPrefs] = useState<AskToolPrefs>(() => readImProjectTools(selectedProjectId));
  const [toolCatalog, setToolCatalog] = useState<AgentToolDescriptor[] | null>(null);
  const transcriptVirtualizerRef = useRef<VariableVirtualListHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const newChatInputRef = useRef<HTMLInputElement | null>(null);
  const prevMsgCount = useRef(0);
  const timelineJumpLockRef = useRef<string | null>(null);

  const memberLabel = useCallback((member: ImMember) => roleLabel(member, t), [t]);

  const allMembers = useMemo(() => room?.members ?? [], [room?.members]);
  const members = useMemo(() => allMembers.filter((member) => member.enabled), [allMembers]);
  const visibleMessages = useMemo(() => {
    const raw = (room?.messages ?? []).filter((message) => {
      if (message.kind !== "job.card") return true;
      const job = room?.jobs.find((item) => item.jobId === message.jobId);
      return job?.status === "failed";
    });

    const seenJobMessages = new Set<string>();
    const result: ImMessage[] = [];
    for (let i = raw.length - 1; i >= 0; i--) {
      const msg = raw[i]!;
      if (msg.kind === "role.say" && msg.jobId) {
        if (seenJobMessages.has(msg.jobId)) {
          continue;
        }
        seenJobMessages.add(msg.jobId);
      }
      result.unshift(msg);
    }
    return result;
  }, [room?.jobs, room?.messages]);
  const activeJobs = useMemo(() => room?.jobs.filter((job) => isActiveJobStatus(job.status)) ?? [], [room?.jobs]);
  const activePendingJobs = useMemo(() => {
    return activeJobs.filter(
      (job) => !visibleMessages.some((msg) => msg.jobId === job.jobId)
    );
  }, [activeJobs, visibleMessages]);
  const transcriptItems = useMemo<TranscriptItem[]>(() => [
    ...visibleMessages.map((message) => ({ kind: "message" as const, message })),
    ...activePendingJobs.map((job) => ({ kind: "pending" as const, job }))
  ], [activePendingJobs, visibleMessages]);
  const messageIndexById = useMemo(() => {
    const index = new Map<string, number>();
    transcriptItems.forEach((item, itemIndex) => {
      if (item.kind === "message") index.set(item.message.messageId, itemIndex);
    });
    return index;
  }, [transcriptItems]);
  const projectRoot = room?.project.localPath && !isScratchPath(room.project.localPath)
    ? room.project.localPath
    : null;
  const projectTools = useImProjectTools(projectRoot);

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
      if (show) {
        setPinnedToBottom(true);
        setHasNewBelow(false);
        void loadProjects();
      }
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
    if (!selectedProjectId) return;
    setToolPrefs(readImProjectTools(selectedProjectId));
  }, [selectedProjectId]);

  useEffect(() => {
    if (toolCatalog) return;
    const api = desktopApi();
    if (typeof api.listAgentTools !== "function") return;
    void api.listAgentTools({ projectPath: projectRoot || undefined })
      .then((list) => setToolCatalog(list))
      .catch(() => setToolCatalog([]));
  }, [toolCatalog, projectRoot]);

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
          if (event.message.jobId && event.message.kind === "role.say") {
            const existingJobIndex = current.messages.findIndex((item) => item.jobId === event.message.jobId && item.kind === "role.say");
            if (existingJobIndex >= 0) {
              const nextMessages = [...current.messages];
              nextMessages[existingJobIndex] = event.message;
              return { ...current, messages: nextMessages };
            }
          }
          return { ...current, messages: [...current.messages, event.message] };
        }
        if (event.type === "messageUpdate") {
          const hasMessageId = current.messages.some((item) => item.messageId === event.message.messageId);
          if (hasMessageId) {
            return {
              ...current,
              messages: current.messages.map((item) => item.messageId === event.message.messageId ? event.message : item)
            };
          }
          if (event.message.jobId && event.message.kind === "role.say") {
            const existingJobIndex = current.messages.findIndex((item) => item.jobId === event.message.jobId && item.kind === "role.say");
            if (existingJobIndex >= 0) {
              const nextMessages = [...current.messages];
              nextMessages[existingJobIndex] = event.message;
              return { ...current, messages: nextMessages };
            }
          }
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
    const count = transcriptItems.length;
    const grew = count > prevMsgCount.current;
    prevMsgCount.current = count;
    if (pinnedToBottom && count > 0) {
      transcriptVirtualizerRef.current?.scrollToIndex(count - 1, { align: "end", behavior: "auto" });
    } else if (grew) {
      setHasNewBelow(true);
    }
  }, [pinnedToBottom, transcriptItems]);

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

  const scrollToBottom = useCallback(() => {
    const lastIndex = transcriptItems.length - 1;
    if (lastIndex < 0) return;
    transcriptVirtualizerRef.current?.scrollToIndex(lastIndex, { align: "end", behavior: "smooth" });
    setPinnedToBottom(true);
    setHasNewBelow(false);
  }, [transcriptItems.length]);

  const scrollToTop = useCallback(() => {
    if (!transcriptItems.length) return;
    const topMessageId = visibleMessages[0]?.messageId ?? null;
    timelineJumpLockRef.current = topMessageId;
    setPinnedToBottom(false);
    transcriptVirtualizerRef.current?.scrollToIndex(0, { align: "start", behavior: "smooth" });
    if (topMessageId) setActiveTimelineMessageId(topMessageId);
  }, [transcriptItems.length, visibleMessages]);

  const jumpToMessage = useCallback((messageId: string) => {
    const index = messageIndexById.get(messageId);
    if (index == null) return;
    timelineJumpLockRef.current = messageId;
    setPinnedToBottom(false);
    setFlashingMessageId(messageId);
    setActiveTimelineMessageId(messageId);
    transcriptVirtualizerRef.current?.scrollToIndex(index, { align: "start", behavior: "smooth" });
    window.setTimeout(() => {
      if (timelineJumpLockRef.current === messageId) timelineJumpLockRef.current = null;
      setFlashingMessageId((current) => (current === messageId ? null : current));
    }, 1500);
  }, [messageIndexById]);

  const onTranscriptScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (node.clientHeight <= 0) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
    setPinnedToBottom(nearBottom);
    if (nearBottom) setHasNewBelow(false);
  }, []);

  const onTranscriptVisibleRange = useCallback((startIndex: number, endIndex: number) => {
    const lockedId = timelineJumpLockRef.current;
    if (lockedId) {
      const lockedIndex = messageIndexById.get(lockedId);
      if (lockedIndex == null || (lockedIndex >= startIndex && lockedIndex <= endIndex)) {
        timelineJumpLockRef.current = null;
      }
      return;
    }
    const item = transcriptItems[startIndex];
    if (item?.kind === "message") setActiveTimelineMessageId(item.message.messageId);
  }, [messageIndexById, transcriptItems]);

  const insertIntoComposer = useCallback((text: string) => {
    setDraft((current) => {
      const base = current.trim();
      return base ? `${base}\n${text}` : text;
    });
    textareaRef.current?.focus();
  }, []);

  const timelineNodes = useMemo(() => {
    return buildTimelineNodes(
      visibleMessages,
      allMembers,
      roleColor,
      memberLabel,
      roleInitial,
      formatTime,
      (ms) => formatDay(ms, t),
      room?.jobs
    );
  }, [allMembers, memberLabel, room?.jobs, t, visibleMessages]);

  const activeJob = useMemo(() => {
    return room?.jobs.find((job) => isActiveJobStatus(job.status)) ?? null;
  }, [room?.jobs]);

  const permissionOwner = useMemo(() => {
    return activeJob
      ? members.find((member) => member.memberId === activeJob.memberId)
      : undefined;
  }, [activeJob, members]);

  const handleToggleThinking = useCallback((messageId: string) => {
    setExpandedThinking((curr) => ({
      ...curr,
      [messageId]: !curr[messageId]
    }));
  }, []);

  const handleToggleFiles = useCallback((messageId: string) => {
    setExpandedFiles((curr) => ({
      ...curr,
      [messageId]: curr[messageId] === false ? true : false
    }));
  }, []);

  const handleEditDelegation = useCallback((instruction: string, targetMember?: ImMember) => {
    if (targetMember) {
      setMentionIds((curr) => curr.includes(targetMember.memberId) ? curr : [...curr, targetMember.memberId]);
    }
    setDraft((curr) => {
      const base = curr.trim();
      return base ? `${base}\n${instruction}` : instruction;
    });
    textareaRef.current?.focus();
  }, []);

  const handleRoutingTipClick = useCallback(() => {
    setDraft((curr) => {
      const trimmed = curr.trim();
      if (!trimmed) return "@";
      return curr.endsWith(" ") ? `${curr}@` : `${curr} @`;
    });
    setMentionOpen(true);
    textareaRef.current?.focus();
  }, []);

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
    setFollowUpTo(null);
    quoteSelection(message, message.body);
  }, [quoteSelection]);

  const continueAsk = useCallback((message: ImMessage) => {
    if (message.kind !== "role.say" || !message.authorMemberId) return;
    const owner = allMembers.find((member) => member.memberId === message.authorMemberId && member.enabled);
    if (!owner) return;
    setFollowUpTo(message);
    setQuotes([]);
    setMentionIds([owner.memberId]);
    setMentionOpen(false);
    textareaRef.current?.focus();
  }, [allMembers]);

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
    if (!selectionMenu && !selectionResult && !folderMenu) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".im-selection-menu, .im-selection-result, .im-folder-menu")) return;
      setSelectionMenu(null);
      setFolderMenu(null);
      if (!selectionResult?.loading) setSelectionResult(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectionMenu(null);
        setFolderMenu(null);
        if (!selectionResult?.loading) setSelectionResult(null);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [selectionMenu, selectionResult, folderMenu]);

  const copyFilePath = useCallback(async (pathStr: string) => {
    try {
      await navigator.clipboard.writeText(pathStr);
      setCopiedFilePath(pathStr);
      setTimeout(() => {
        setCopiedFilePath((current) => (current === pathStr ? null : current));
      }, 2000);
    } catch {
      // ignore
    }
  }, []);

  const startCreateChat = useCallback(async () => {
    setSidebarCollapsed(false);
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "0"); } catch { /* ignore */ }
    setCreating(false);
    setFolderMenu(null);
    setRenamingProjectId(null);
    try {
      const project = await desktopApi().imCreateProject({ name: t("desktop.im.untitledChat") });
      await loadProjects();
      selectProject(project.projectId);
      setTimeout(() => textareaRef.current?.focus(), 50);
    } catch (error) {
      setError(error);
    }
  }, [loadProjects, selectProject, setError, t]);

  useEffect(() => {
    if (creating) {
      setTimeout(() => {
        newChatInputRef.current?.focus();
        newChatInputRef.current?.select();
      }, 0);
    }
  }, [creating]);

  useEffect(() => {
    if (!active) return;
    const onShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() === "t" || event.code === "KeyT") {
        event.preventDefault();
        event.stopPropagation();
        startCreateChat();
      }
    };
    window.addEventListener("keydown", onShortcut, true);
    const stopIpc = typeof desktopApi().onWorkbenchCmdT === "function"
      ? desktopApi().onWorkbenchCmdT(() => {
          startCreateChat();
        })
      : undefined;
    return () => {
      window.removeEventListener("keydown", onShortcut, true);
      stopIpc?.();
    };
  }, [active, startCreateChat]);

  const createProject = useCallback(async (event?: FormEvent) => {
    event?.preventDefault();
    const name = newName.trim() || t("desktop.im.untitledChat");
    try {
      const project = await desktopApi().imCreateProject({ name });
      setNewName("");
      setCreating(false);
      await loadProjects();
      selectProject(project.projectId);
    } catch (error) {
      setError(error);
    }
  }, [loadProjects, newName, selectProject, setError, t]);

  const associateFolder = useCallback(async (projectId = selectedProjectId) => {
    if (!projectId) return;
    try {
      const picked = await desktopApi().imPickLocalPath({ title: t("desktop.im.associateFolderTitle") });
      if (!picked.ok) return;
      const project = await desktopApi().imSetLocalPath({ projectId, localPath: picked.path });
      setProjects((current) => current.map((item) => item.projectId === project.projectId ? project : item));
      setRoom((current) => current && current.project.projectId === project.projectId ? { ...current, project } : current);
    } catch (error) {
      setError(error);
    }
  }, [selectedProjectId, setError, t]);

  const autoRenameChat = useCallback(async (project: ImProject) => {
    try {
      const updated = await desktopApi().imAutoRenameProject({ projectId: project.projectId });
      setProjects((current) => current.map((item) => item.projectId === updated.projectId ? updated : item));
      setRoom((current) => current && current.project.projectId === updated.projectId ? { ...current, project: updated } : current);
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const revealFolder = useCallback(async (project: ImProject) => {
    if (!project.localPath) return;
    try {
      await desktopApi().revealProjectInFinder({ projectPath: project.localPath });
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const commitRename = useCallback(async (projectId: string) => {
    const name = renameValue.trim();
    setRenamingProjectId(null);
    if (!name) return;
    try {
      const project = await desktopApi().imRenameProject({ projectId, name });
      setProjects((current) => current.map((item) => item.projectId === project.projectId ? project : item));
      setRoom((current) => current && current.project.projectId === project.projectId ? { ...current, project } : current);
    } catch (error) {
      setError(error);
    }
  }, [renameValue, setError]);

  const deleteChat = useCallback(async (project: ImProject) => {
    const confirmed = window.confirm(t("desktop.im.deleteChatConfirm", project.name));
    if (!confirmed) return;
    try {
      await desktopApi().imDeleteProject({ projectId: project.projectId });
      const remaining = projects.filter((item) => item.projectId !== project.projectId);
      setProjects(remaining);
      if (selectedProjectId === project.projectId) {
        const nextId = remaining[0]?.projectId || "";
        selectProject(nextId);
        if (!nextId) setRoom(null);
      }
    } catch (error) {
      setError(error);
    }
  }, [projects, selectedProjectId, selectProject, setError, t]);

  const openFolderMenu = useCallback((event: ReactMouseEvent, project: ImProject) => {
    event.preventDefault();
    event.stopPropagation();
    setFolderMenu({ x: event.clientX, y: event.clientY, project });
    setSelectionMenu(null);
  }, []);

  const send = useCallback(async () => {
    if (!selectedProjectId || sending) return;
    const body = draft.trim();
    if (!body && !quotes.length && !pendingImages.length) return;
    setSending(true);
    try {
      await desktopApi().imPostMessage({
        projectId: selectedProjectId,
        body,
        quoteIds: followUpTo ? [] : quotes.map((quote) => quote.messageId),
        mentionRoleIds: mentionIds,
        images: pendingImages.map(({ fileName, mimeType, data }) => ({ fileName, mimeType, data })),
        followUpToMessageId: followUpTo?.messageId
      });
      setDraft("");
      setQuotes([]);
      setFollowUpTo(null);
      setMentionIds([]);
      setPendingImages([]);
      setMentionOpen(false);
    } catch (error) {
      setError(error);
    } finally {
      setSending(false);
    }
  }, [draft, followUpTo, mentionIds, pendingImages, quotes, selectedProjectId, sending, setError]);

  const resendUserMessage = useCallback((message: ImMessage) => {
    setSelectionMenu(null);
    setDraft(message.body);
    setMentionIds(message.mentionRoleIds ? [...message.mentionRoleIds] : []);
    setQuotes(message.quotes ? [...message.quotes] : []);
    if (message.images?.length) {
      const restoredImages: PendingImage[] = message.images.map((img) => ({
        id: img.id,
        fileName: img.fileName,
        mimeType: img.mimeType,
        previewUrl: img.previewUrl || "",
        data: img.previewUrl && img.previewUrl.startsWith("data:") ? img.previewUrl.split(",")[1] || "" : "",
        sizeBytes: img.sizeBytes || 0
      }));
      setPendingImages(restoredImages);
    } else {
      setPendingImages([]);
    }
    textareaRef.current?.focus();
    scrollToBottom();
  }, [scrollToBottom]);

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
        setProjects((current) => current.map((p) => p.projectId === selectedProjectId ? {
          ...p,
          roles: [...(p.roles ?? []).filter((r) => r.templateId !== template.templateId), { templateId: member.templateId, name: member.name }]
        } : p));
        return;
      }
      const member = room?.members.find((item) => item.templateId === template.templateId);
      if (!member) return;
      await desktopApi().imRemoveMember({ memberId: member.memberId });
      setRoom((current) => current
        ? { ...current, members: current.members.filter((item) => item.memberId !== member.memberId) }
        : current);
      setProjects((current) => current.map((p) => p.projectId === selectedProjectId ? {
        ...p,
        roles: (p.roles ?? []).filter((r) => r.templateId !== template.templateId)
      } : p));
      setMentionIds((current) => current.filter((id) => id !== member.memberId));
      if (expandedMemberId === member.memberId) setExpandedMemberId(null);
    } catch (error) {
      setError(error);
    }
  }, [expandedMemberId, room?.members, selectedProjectId, setError]);

  const allMemberChecked = useMemo(() => {
    if (!templates.length) return false;
    return templates.every((tpl) => members.some((m) => m.templateId === tpl.templateId));
  }, [templates, members]);
  const someMemberChecked = useMemo(() => {
    if (!templates.length) return false;
    return templates.some((tpl) => members.some((m) => m.templateId === tpl.templateId));
  }, [templates, members]);

  const toggleAllMembers = useCallback(async (nextChecked: boolean) => {
    if (!selectedProjectId || isTogglingAll) return;
    setIsTogglingAll(true);
    try {
      if (nextChecked) {
        const toEnable = templates.filter((tpl) => !members.some((m) => m.templateId === tpl.templateId));
        for (const tpl of toEnable) {
          await desktopApi().imAddMember({ projectId: selectedProjectId, templateId: tpl.templateId }).then((member) => {
            setRoom((cur) => cur && !cur.members.some((it) => it.memberId === member.memberId) ? { ...cur, members: [...cur.members, member] } : cur);
            setProjects((cur) => cur.map((p) => p.projectId === selectedProjectId ? { ...p, roles: [...(p.roles ?? []).filter((r) => r.templateId !== tpl.templateId), { templateId: member.templateId, name: member.name }] } : p));
          });
        }
      } else {
        const toDisable = [...members];
        for (const m of toDisable) {
          const tpl = templates.find((t) => t.templateId === m.templateId);
          if (!tpl) continue;
          await desktopApi().imRemoveMember({ memberId: m.memberId }).then(() => {
            setRoom((cur) => cur ? { ...cur, members: cur.members.filter((it) => it.memberId !== m.memberId) } : cur);
            setProjects((cur) => cur.map((p) => p.projectId === selectedProjectId ? { ...p, roles: (p.roles ?? []).filter((r) => r.templateId !== tpl.templateId) } : p));
            setMentionIds((cur) => cur.filter((id) => id !== m.memberId));
            if (expandedMemberId === m.memberId) {
              setExpandedMemberId(null);
              setPopoverAnchorRect(null);
            }
          });
        }
      }
    } catch (error) {
      setError(error);
    } finally {
      setIsTogglingAll(false);
    }
  }, [selectedProjectId, isTogglingAll, templates, members, expandedMemberId, setError]);

  useEffect(() => {
    if (!expandedMemberId) {
      setPopoverAnchorRect(null);
      return;
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".im-member-config-popover") || target.closest(".im-member-config-btn")) return;
      setExpandedMemberId(null);
      setPopoverAnchorRect(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpandedMemberId(null);
        setPopoverAnchorRect(null);
      }
    };
    const onScrollOrResize = () => {
      setExpandedMemberId(null);
      setPopoverAnchorRect(null);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [expandedMemberId]);

  const fetchModelsForAgent = useCallback(async (targetAgent: ImAgent) => {
    if (agentModelsMap[targetAgent]?.length) return agentModelsMap[targetAgent];
    try {
      const list = await desktopApi().imListAgentModels({ agent: targetAgent });
      setAgentModelsMap((curr) => ({ ...curr, [targetAgent]: list }));
      return list;
    } catch {
      const fallback = IM_AGENT_SUGGESTED_MODELS[targetAgent] || [];
      setAgentModelsMap((curr) => ({ ...curr, [targetAgent]: fallback }));
      return fallback;
    }
  }, [agentModelsMap]);

  const onMemberAgentChange = useCallback(async (member: ImMember, nextAgent: ImAgent) => {
    try {
      void fetchModelsForAgent(nextAgent);
      const updated = await desktopApi().imSetMemberAgent({ memberId: member.memberId, agent: nextAgent });
      setRoom((current) => current
        ? { ...current, members: current.members.map((m) => m.memberId === updated.memberId ? updated : m) }
        : current);
    } catch (error) {
      setError(error);
    }
  }, [fetchModelsForAgent, setError]);

  const onMemberModelChange = useCallback(async (member: ImMember, nextModel: string) => {
    try {
      const updated = await desktopApi().imSetMemberModel({ memberId: member.memberId, model: nextModel.trim() || null });
      setRoom((current) => current
        ? { ...current, members: current.members.map((m) => m.memberId === updated.memberId ? updated : m) }
        : current);
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const onMemberThoughtLevelChange = useCallback(async (member: ImMember, nextThoughtLevel: string) => {
    try {
      const updated = await desktopApi().imSetMemberThoughtLevel({
        memberId: member.memberId,
        thoughtLevel: nextThoughtLevel.trim() || null
      });
      setRoom((current) => current
        ? { ...current, members: current.members.map((m) => m.memberId === updated.memberId ? updated : m) }
        : current);
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const onMemberResetOverrides = useCallback(async (member: ImMember) => {
    try {
      const updated = await desktopApi().imResetMemberOverrides({ memberId: member.memberId });
      setCustomMemberModelId((current) => current === member.memberId ? null : current);
      setCustomMemberThoughtId((current) => current === member.memberId ? null : current);
      setRoom((current) => current
        ? { ...current, members: current.members.map((m) => m.memberId === updated.memberId ? updated : m) }
        : current);
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const cancelJob = useCallback(async (job: ImJob) => {
    try {
      await desktopApi().imCancelJob({ jobId: job.jobId });
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const resumeJob = useCallback(async (job: ImJob) => {
    try {
      await desktopApi().imResumeJob({ jobId: job.jobId });
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const handleOpenCitations = useCallback((message: ImMessage, marker?: string) => {
    const citations = extractCitationsFromMessage(message, room);
    setCitationDrawerState({
      open: true,
      citations,
      initialMarker: marker
    });
  }, [room]);

  const handleOpenCitation = useCallback((citation: AgentCitation) => {
    if (isNote(citation)) {
      if (citation.noteId) {
        window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
        window.dispatchEvent(new CustomEvent("agent-resume:open-note", { detail: citation.noteId }));
      } else {
        window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
      }
      return;
    }
    if (isSession(citation)) {
      const session = citation.session;
      if (session?.provider && session.id) {
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
      } else {
        window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
      }
      return;
    }
    const period = periodFromCitation(citation);
    if (period) {
      window.dispatchEvent(new CustomEvent("agent-resume:report-focus", { detail: period }));
    }
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "report" }));
  }, []);

  const handleResumeCitationSession = useCallback(async (citation: AgentCitation) => {
    const session = citation.session;
    if (!session?.provider || !session.id) {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
      return;
    }
    try {
      const result = await desktopApi().workbenchOpenSession({ provider: session.provider, id: session.id });
      if (result.external) {
        notifyDesktop({ text: t("desktop.im.resumeStarted", session.provider, session.id), kind: "info" });
        return;
      }
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-open-session", { detail: session }));
    } catch (error) {
      setError(error);
    }
  }, [setError, t]);

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
          aria-label={t("desktop.im.chats")}
        >
          {!sidebarCollapsed && (
            <div className="im-folders">
              {creating ? (
                <form className="im-new-project" onSubmit={(event) => void createProject(event)}>
                  <input
                    ref={newChatInputRef}
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder={t("desktop.im.chatName")}
                    aria-label={t("desktop.im.chatName")}
                    autoFocus
                  />
                  <button type="submit" className="tool-btn">{t("desktop.common.confirm")}</button>
                  <button type="button" className="tool-btn ghost-btn" onClick={() => setCreating(false)}>
                    {t("desktop.common.cancel")}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="im-new-project-btn"
                  onClick={startCreateChat}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    startCreateChat();
                  }}
                  title={`${t("desktop.im.newChat")} (⌘T)`}
                >
                  <ThemeIcon name="plus" size={14} aria-hidden="true" />
                  {t("desktop.im.newChat")}
                </button>
              )}
              {projects.length ? projects.map((project) => {
                const scratch = isScratchPath(project.localPath);
                const pathLabel = !project.localPath
                  ? t("desktop.im.tempFolder")
                  : scratch
                    ? t("desktop.im.tempFolder")
                    : basename(project.localPath);
                const activeRoles = project.projectId === selectedProjectId && room
                  ? room.members.filter((m) => m.enabled).map((m) => ({ templateId: m.templateId, name: memberLabel(m) }))
                  : (project.roles ?? []).map((r) => ({ templateId: r.templateId, name: builtinRoleLabel(r.templateId, r.name, t) }));

                if (renamingProjectId === project.projectId) {
                  return (
                    <form
                      key={project.projectId}
                      className={`im-folder-row im-folder-rename${selectedProjectId === project.projectId ? " active" : ""}`}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void commitRename(project.projectId);
                      }}
                    >
                      <ImChatAvatar roles={activeRoles} size={28} />
                      <input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        aria-label={t("desktop.im.renameChat")}
                        autoFocus
                        onBlur={() => void commitRename(project.projectId)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setRenamingProjectId(null);
                          }
                        }}
                      />
                    </form>
                  );
                }
                return (
                  <button
                    key={project.projectId}
                    type="button"
                    className={`im-folder-row${selectedProjectId === project.projectId ? " active" : ""}`}
                    onClick={() => selectProject(project.projectId)}
                    onContextMenu={(event) => openFolderMenu(event, project)}
                  >
                    <ImChatAvatar roles={activeRoles} size={28} />
                    <span className="im-folder-label">{project.name}</span>
                    <span className="im-folder-path">{pathLabel}</span>
                  </button>
                );
              }) : (
                <p className="im-empty">{t("desktop.im.noChats")}</p>
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
                <div className="im-room-head-info">
                  <ImChatAvatar
                    roles={members.map((m) => ({ templateId: m.templateId, name: memberLabel(m) }))}
                    size={34}
                    onClick={() => setMembersDrawerOpen(true)}
                  />
                  <div className="im-room-head-titles">
                    <h2>{room.project.name}</h2>
                    <p className="im-room-path">
                      <span>{room.project.localPath || t("desktop.im.tempFolder")}</span>
                      <button
                        type="button"
                        className="im-room-path-btn"
                        onClick={() => void associateFolder()}
                        title={t("desktop.im.associateFolder")}
                        aria-label={t("desktop.im.associateFolder")}
                      >
                        <ThemeIcon name="folder" size={13} aria-hidden="true" />
                      </button>
                    </p>
                  </div>
                </div>
                <div className="im-room-head-actions">
                  {projectTools.toolbar}
                </div>
              </div>
              <div className="im-transcript-wrap">
                <VariableVirtualList
                  ref={transcriptVirtualizerRef}
                  className="im-transcript"
                  items={transcriptItems}
                  getKey={(item) => item.kind === "message" ? item.message.messageId : `pending-job-${item.job.jobId}`}
                  gap={20}
                  estimateSize={estimateTranscriptItemSize}
                  pinToBottom={pinnedToBottom}
                  onVisibleRangeChange={onTranscriptVisibleRange}
                  onScroll={onTranscriptScroll}
                  empty={<p className="im-empty">{t("desktop.im.emptyRoom")}</p>}
                  renderItem={(item, transcriptIndex) => {
                    if (item.kind === "message") {
                      const message = item.message;
                      const messageIndex = visibleMessages.findIndex((entry) => entry.messageId === message.messageId);
                      const displayBody = translations[message.messageId]
                        ?? (message.kind === "system" && message.body.startsWith("desktop.") ? (t(message.body) || message.body) : message.body);
                      return (
                        <ImMessageItem
                          message={message}
                          prevMessage={messageIndex > 0 ? visibleMessages[messageIndex - 1] : undefined}
                          allMembers={allMembers}
                          room={room}
                          displayBody={displayBody}
                          isTranslating={translatingIds.has(message.messageId)}
                          translated={Boolean(translations[message.messageId])}
                          isFlashing={flashingMessageId === message.messageId}
                          isThinkingExpanded={expandedThinking[message.messageId] === true}
                          isFilesExpanded={expandedFiles[message.messageId] !== false}
                          copiedFilePath={copiedFilePath}
                          memberLabel={memberLabel}
                          onToggleThinking={handleToggleThinking}
                          onToggleFiles={handleToggleFiles}
                          onCopyText={copyText}
                          onQuoteMessage={quoteMessage}
                          onTranslateMessage={translateMessage}
                          onContinueAsk={continueAsk}
                          onResumeJob={resumeJob}
                          onCancelJob={cancelJob}
                          onPreviewImage={setPreviewModalUrl}
                          onCopyFilePath={copyFilePath}
                          onEditDelegation={handleEditDelegation}
                          onOpenSelectionMenu={openSelectionMenu}
                          onRoutingTipClick={handleRoutingTipClick}
                          onOpenCitations={handleOpenCitations}
                          t={t}
                        />
                      );
                    }

                    const job = item.job;
                    const owner = allMembers.find((member) => member.memberId === job.memberId)
                      || allMembers.find((member) => member.templateId === job.memberId);
                    const roleColorValue = owner ? roleColor(owner.templateId) : roleColor("developer");
                    const label = owner ? memberLabel(owner) : "Role";
                    return (
                      <article
                        key={`pending-job-${job.jobId}`}
                        className="im-message is-role-say is-pending-job"
                        style={roleColorValue ? { "--im-role-color": roleColorValue } as CSSProperties : undefined}
                        data-transcript-index={transcriptIndex}
                      >
                        <header>
                          <span className="im-message-author">
                            {roleColorValue && (
                              <span className="im-role-avatar" aria-hidden="true" style={{ "--im-role-color": roleColorValue } as CSSProperties}>
                                {roleInitial(label)}
                              </span>
                            )}
                            <strong>
                              {label}
                              {owner ? <> {agentTag(owner.agent, owner.model, t)}</> : null}
                            </strong>
                          </span>
                        </header>
                        <div className="im-pending-job-body">
                          <span className={`im-job-dot is-${job.status}`} aria-hidden="true" />
                          <span className="im-pending-job-label">
                            {job.status === "queued"
                              ? t("desktop.im.inQueue")
                              : job.status === "connecting"
                                ? t("desktop.im.connecting")
                                : job.status === "awaiting_user"
                                  ? t("desktop.im.job.awaiting_user")
                                  : t("desktop.im.typing")}
                          </span>
                          <span className="im-jumping-dots" aria-hidden="true">
                            <span className="im-jumping-dot" />
                            <span className="im-jumping-dot" />
                            <span className="im-jumping-dot" />
                          </span>
                        </div>
                        <div className="im-generating-bar">
                          <button
                            type="button"
                            className="btn small ghost-btn im-stop-generating-btn"
                            onClick={() => void cancelJob(job)}
                            aria-label={t("desktop.im.stopAnswer")}
                            title={t("desktop.im.stopAnswer")}
                          >
                            <ThemeIcon name="square" size={11} aria-hidden="true" />
                            <span>{t("desktop.im.stopAnswer")}</span>
                          </button>
                        </div>
                      </article>
                    );
                  }}
                />
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
              <ImComposer
                members={members}
                draft={draft}
                quotes={quotes}
                followUpTo={followUpTo}
                mentionIds={mentionIds}
                pendingImages={pendingImages}
                sending={sending}
                mentionOpen={mentionOpen}
                toolPrefs={toolPrefs}
                toolCatalog={toolCatalog}
                projectPath={projectRoot}
                onToolPrefsChange={(next) => {
                  setToolPrefs(next);
                  if (selectedProjectId) writeImProjectTools(selectedProjectId, next);
                }}
                setMentionOpen={setMentionOpen}
                onDraftChange={setDraft}
                onQuotesChange={setQuotes}
                onFollowUpToChange={setFollowUpTo}
                onMentionIdsChange={setMentionIds}
                onPendingImagesChange={setPendingImages}
                onSend={() => void send()}
                onPreviewImage={setPreviewModalUrl}
                onError={setError}
                memberLabel={memberLabel}
                textareaRef={textareaRef}
                t={t}
              />
            </>
          ) : (
            <p className="im-empty">{t("desktop.im.selectChat")}</p>
          )}
        </div>
        {projectTools.pane}
      </div>
      <Sheet open={membersDrawerOpen} title={t("desktop.im.members")} onClose={() => setMembersDrawerOpen(false)} bodyClassName="im-members-drawer">
        <div className="im-members" aria-label={t("desktop.im.members")}>
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
              <>
                <div className="im-members-select-all">
                  <label className="im-members-select-all-label">
                    <input
                      type="checkbox"
                      checked={allMemberChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = !allMemberChecked && someMemberChecked;
                      }}
                      disabled={!selectedProjectId || !templates.length || isTogglingAll}
                      onChange={(event) => void toggleAllMembers(event.target.checked)}
                      aria-label={allMemberChecked ? t("desktop.im.deselectAll") : t("desktop.im.selectAll")}
                    />
                    <span>{allMemberChecked ? t("desktop.im.deselectAll") : t("desktop.im.selectAll")}</span>
                  </label>
                  <span className="im-members-select-all-count">{members.length}/{templates.length}</span>
                </div>
                <div className="im-members-list">
                  {templates.length ? templates.map((template) => {
                const enabledMember = members.find((item) => item.templateId === template.templateId);
                const label = enabledMember
                  ? memberLabel(enabledMember)
                  : builtinRoleLabel(template.templateId, template.name, t);
                const jobStatus = enabledMember
                  ? room?.jobs.find((item) => item.memberId === enabledMember.memberId && isActiveJobStatus(item.status))?.status ?? "idle"
                  : "idle";
                const rowColor = roleColor(template.templateId);
                const isProject = template.source === "project" || isProjectRoleTemplateId(template.templateId);
                const isCustomized = Boolean(
                  enabledMember && (
                    enabledMember.agent !== template.agent ||
                    (enabledMember.model || "") !== (template.model || "") ||
                    (enabledMember.thoughtLevel || "") !== (template.thoughtLevel || "")
                  )
                );
                const effectiveAgent = enabledMember ? enabledMember.agent : template.agent;
                const effectiveModel = enabledMember ? enabledMember.model : template.model;
                const isExpanded = Boolean(enabledMember && expandedMemberId === enabledMember.memberId);

                return (
                  <div key={template.templateId} className={`im-member-row${isCustomized ? " is-customized" : ""}`}>
                    <div className="im-member-head">
                      <label className="im-member-ident">
                        <input
                          type="checkbox"
                          checked={Boolean(enabledMember)}
                          onChange={(event) => void toggleTemplate(template, event.target.checked)}
                        />
                        <span className="im-role-avatar" aria-hidden="true" style={{ "--im-role-color": rowColor } as CSSProperties}>
                          {roleInitial(label)}
                        </span>
                        <strong>{label}</strong>
                        {isProject ? <span className="matrix-badge-repo">Repo</span> : null}
                        {isCustomized ? (
                          <span className="im-member-custom-badge" title={t("desktop.im.customBadge")}>
                            {t("desktop.im.customBadge")}
                          </span>
                        ) : null}
                      </label>
                      <div className="im-member-actions">
                        {enabledMember && jobStatus !== "idle" ? (
                          <span
                            className={`im-job-dot is-${jobStatus}`}
                            title={t(`desktop.im.job.${jobStatus}`)}
                            aria-label={t(`desktop.im.job.${jobStatus}`)}
                          />
                        ) : <span className="im-job-dot is-idle" aria-hidden="true" />}
                        {enabledMember ? (
                          <button
                            type="button"
                            className={`tool-btn ghost-btn im-member-config-btn${isExpanded ? " active" : ""}`}
                            onClick={(event) => {
                              const next = isExpanded ? null : enabledMember.memberId;
                              if (next && event.currentTarget instanceof HTMLElement) {
                                setPopoverAnchorRect(event.currentTarget.getBoundingClientRect());
                              } else if (!next) {
                                setPopoverAnchorRect(null);
                              }
                              setExpandedMemberId(next);
                              if (next) void fetchModelsForAgent(enabledMember.agent);
                            }}
                            title={t("desktop.im.configRole")}
                            aria-label={t("desktop.im.configRole")}
                            aria-expanded={isExpanded}
                          >
                            <ThemeIcon name="settings" size={13} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="im-member-tag-line">
                      {agentTag(effectiveAgent, effectiveModel, t)}
                    </div>
                  </div>
                );
                  }) : <p className="im-empty">{t("desktop.im.noMembers")}</p>}
                </div>
                {expandedMemberId && popoverAnchorRect && (() => {
                  const member = members.find((m) => m.memberId === expandedMemberId);
                  if (!member) return null;
                  const template = templates.find((t) => t.templateId === member.templateId);
                  const memberModels = agentModelsMap[member.agent] ?? IM_AGENT_SUGGESTED_MODELS[member.agent] ?? [];
                  const isCustomMemberModel = Boolean(member.model && !memberModels.some((m) => m.id === member.model));
                  const isCustomMemberThought = Boolean(member.thoughtLevel && !isSuggestedThoughtLevel(member.thoughtLevel));
                  const memberModelGroups: Record<string, ImAgentModelOption[]> = {};
                  for (const m of memberModels) {
                    if (!m.id) continue;
                    const p = m.provider || "Suggested";
                    if (!memberModelGroups[p]) memberModelGroups[p] = [];
                    memberModelGroups[p].push(m);
                  }
                  const isCustomized = Boolean(
                    template && (
                      member.agent !== template.agent ||
                      (member.model || "") !== (template.model || "") ||
                      (member.thoughtLevel || "") !== (template.thoughtLevel || "")
                    )
                  );
                  const popoverStyle: CSSProperties = {
                    position: "fixed",
                    left: Math.min(popoverAnchorRect.right + 8, window.innerWidth - 344),
                    top: Math.max(8, Math.min(popoverAnchorRect.top, window.innerHeight - 360)),
                    width: 320,
                    zIndex: 70,
                  };
                  // Keep popover inside viewport horizontally
                  if (popoverStyle.left !== undefined && typeof popoverStyle.left === "number" && popoverStyle.left < 8) popoverStyle.left = 8;
                  return createPortal(
                    <div className="im-member-config-popover" role="dialog" aria-label={t("desktop.im.configRole")} style={popoverStyle}>
                      <div className="im-member-config-popover-head">
                        <strong>{memberLabel(member)}</strong>
                        <button type="button" className="icon-btn" aria-label={t("desktop.common.close")} onClick={() => { setExpandedMemberId(null); setPopoverAnchorRect(null); }}>
                          <ThemeIcon name="close" size={12} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="im-member-config">
                        <label>
                          <span>{t("desktop.im.roleAgent")}</span>
                          <select value={member.agent} onChange={(event) => void onMemberAgentChange(member, event.target.value as ImAgent)}>
                            {IM_AGENTS.map((agentKey) => (
                              <option key={agentKey} value={agentKey}>
                                {t(`desktop.im.agent.${agentKey}`)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>{t("desktop.im.roleModel")}</span>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <select value={customMemberModelId === member.memberId || isCustomMemberModel ? "__custom__" : (member.model ?? "")} onChange={(event) => { const val = event.target.value; if (val === "__custom__") { setCustomMemberModelId(member.memberId); } else { setCustomMemberModelId(null); void onMemberModelChange(member, val); } }}>
                              <option value="">{t("desktop.im.defaultModel")}</option>
                              {Object.entries(memberModelGroups).map(([groupName, items]) => (
                                <optgroup key={groupName} label={groupName}>
                                  {items.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                              <option value="__custom__">{t("desktop.im.customModelOption")}</option>
                            </select>
                            {(customMemberModelId === member.memberId || isCustomMemberModel) && (
                              <input value={member.model ?? ""} placeholder="Enter model ID…" onChange={(event) => void onMemberModelChange(member, event.target.value)} autoFocus />
                            )}
                          </div>
                        </label>
                        <label>
                          <span>{t("desktop.im.roleThoughtLevel")}</span>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <select value={customMemberThoughtId === member.memberId || isCustomMemberThought ? "__custom__" : (member.thoughtLevel ?? "")} onChange={(event) => { const val = event.target.value; if (val === "__custom__") { setCustomMemberThoughtId(member.memberId); } else { setCustomMemberThoughtId(null); void onMemberThoughtLevelChange(member, val); } }}>
                              <option value="">{t("desktop.im.defaultThoughtLevel")}</option>
                              {IM_SUGGESTED_THOUGHT_LEVELS.map((level) => (
                                <option key={level} value={level}>
                                  {t(`desktop.im.thoughtLevel.${level}`)}
                                </option>
                              ))}
                              <option value="__custom__">{t("desktop.im.customThoughtLevelOption")}</option>
                            </select>
                            {(customMemberThoughtId === member.memberId || isCustomMemberThought) && (
                              <input value={member.thoughtLevel ?? ""} placeholder={t("desktop.settings.imThoughtLevelPlaceholder")} onChange={(event) => void onMemberThoughtLevelChange(member, event.target.value)} autoFocus />
                            )}
                          </div>
                        </label>
                        {isCustomized ? (
                          <div className="im-member-config-footer">
                            <button type="button" className="tool-btn ghost-btn" onClick={() => void onMemberResetOverrides(member)}>
                              {t("desktop.im.resetDefault")}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>,
                    document.body
                  );
                })()}
              </>
            )}
        </div>
      </Sheet>
      {folderMenu ? createPortal(
        <div
          className="im-folder-menu chat-context-menu"
          role="menu"
          style={{
            left: Math.max(8, Math.min(folderMenu.x, window.innerWidth - 200)),
            top: Math.max(8, Math.min(folderMenu.y, window.innerHeight - 180))
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const project = folderMenu.project;
              setFolderMenu(null);
              void autoRenameChat(project);
            }}
          >
            {t("desktop.workbench.autoRename")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenameValue(folderMenu.project.name);
              setRenamingProjectId(folderMenu.project.projectId);
              setFolderMenu(null);
            }}
          >
            {t("desktop.im.renameChat")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const projectId = folderMenu.project.projectId;
              setFolderMenu(null);
              void associateFolder(projectId);
            }}
          >
            {t("desktop.im.associateFolder")}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!folderMenu.project.localPath}
            onClick={() => {
              const project = folderMenu.project;
              setFolderMenu(null);
              void revealFolder(project);
            }}
          >
            {t("desktop.common.revealInFinder")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const project = folderMenu.project;
              setFolderMenu(null);
              void deleteChat(project);
            }}
          >
            {t("desktop.im.deleteChat")}
          </button>
        </div>,
        document.body
      ) : null}
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
          {selectionMenu.message.kind === "human" && (
            <>
              <hr className="context-menu-separator" />
              <button
                type="button"
                role="menuitem"
                disabled={sending}
                onClick={() => void resendUserMessage(selectionMenu.message)}
              >
                {t("desktop.common.resend")}
              </button>
            </>
          )}
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
      {previewModalUrl ? createPortal(
        <div
          className="im-image-lightbox"
          role="dialog"
          aria-label="Image preview"
          onClick={() => setPreviewModalUrl(null)}
        >
          <div className="im-image-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={previewModalUrl} alt="Enlarged preview" />
            <button
              type="button"
              className="im-image-lightbox-close"
              onClick={() => setPreviewModalUrl(null)}
              aria-label={t("desktop.common.close")}
            >
              <ThemeIcon name="close" size={16} />
            </button>
          </div>
        </div>,
        document.body
      ) : null}
      <CitationSheet
        open={citationDrawerState.open}
        citations={citationDrawerState.citations}
        initialMarker={citationDrawerState.initialMarker}
        onClose={() => setCitationDrawerState({ open: false, citations: [] })}
        onOpenCitation={handleOpenCitation}
        onResumeSession={handleResumeCitationSession}
        t={t}
      />
    </section>,
    host
  );
}
