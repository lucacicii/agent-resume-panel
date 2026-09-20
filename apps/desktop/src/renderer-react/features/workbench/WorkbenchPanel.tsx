import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { ProviderIcon } from "../../components/ProviderIcon";
import { ResizeHandle } from "../../components/ResizeHandle";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type ReactPortal } from "react";
import type { Terminal } from "@xterm/xterm";
import {
  TerminalView,
  trackTerminalMouseModes,
  trackTuiRedraw,
  isTerminalAtBottom,
  type TerminalPane,
  type WorkbenchPaneGroup,
  type TerminalRendererMode
} from "./terminal/TerminalView";
import {
  type AgentProvider,
  type AgentSession,
  type GtdStatus,
  type PanelSettings,
  type TaskGtdRollup
} from "@agent-resume/core";
import {
  WORKBENCH_NEW_SESSION_TARGET_OPTIONS,
  buildComposerMentionPrompt,
  matchComposerMentionForCwd,
  resolveComposerMention
} from "../settings/model";
import {
  DESKTOP_GTD_STATUSES,
  desktopGtdColumn,
  desktopGtdLabelKey,
  type DesktopGtdStatus
} from "../../gtd";
import { desktopApi } from "../../bridge";
import { confirmDestructive } from "../../confirmAction";
import { contextMenuPoint, showContextMenuAt } from "../../nativeContextMenu";
import { useMenuKeyboard, useMenuPosition } from "../../components/menuOverlay";
import { CodeEditor, type CodeEditorHandle, type CodeEditorSearchResult } from "../../components/CodeEditor";
import type { CodeMirrorAppearance } from "../../components/codeMirrorThemes";
import { renderMarkdown } from "../../components/Markdown";
import { imageSrcFromElement, posixDirname } from "../../components/markdownImage";
import { notifyDesktop } from "../../components/Notifications";
import { useOverlayState } from "../../components/useOverlayMotion";
import { syncTruncationTitle } from "../../components/truncationTitle";
import { VirtualList } from "../../components/VirtualList";
import type { TerminalEngineType } from "./terminal";
import { useI18n } from "../../i18n";
import { AcpChatView } from "./AcpChatView";
import { SelectionActionItems } from "../../selection/SelectionActionItems";
import {
  SelectionActionResult,
  useSelectionActionResult
} from "../../selection/SelectionActionResult";
import { BrowserPaneView } from "../browser/BrowserPaneView";
import type { BrowserSessionState } from "../../../shared/browserTypes";
import type { WorkbenchFocusSessionRequest, WorkbenchSendSelectionRequest } from "../../../shared/workbenchSelection";
import { collectActiveSessionDots, type ActiveSessionDot } from "./activeSessionDots";
import { rollupDot } from "./sessionStatus/taskRollup";
import { sessionDotStatusClass } from "./sessionStatus/dotStatus";
import { useAcpStatus, useAgentStatus, type AcpStatusEvent, type SessionDotRuntime, type SessionDotStatus } from "./sessionStatus";
import { COMPOSER_TIP_LIMIT, EMPTY_COMPOSER_WORKSPACE_PROJECTS, type ComposerSendTip, type ComposerWorkspaceProject } from "./TerminalComposer";
import { TerminalComposerStack } from "./TerminalComposerStack";
import { formatTuiSlashInput, type TuiSlashCommand } from "./tuiSlashCommands";
import {
  FloatingSessionNote,
  sessionNoteMatchesTarget,
  type FloatingSessionNoteTarget
} from "./FloatingSessionNote";
import { DiffWorkerPool } from "./diffWorkerPool";
import {
  WorkbenchDiffView,
  type WorkbenchDiffHunkTarget,
  type WorkbenchDiffLineTarget,
  type WorkbenchDiffPane
} from "./WorkbenchDiffView";
export {
  advanceDiffSearchMatchIndex,
  collectDiffSearchMatches,
  findDiffSearchMatchIndex
} from "./WorkbenchDiffView";
import {
  WorkbenchFileExplorer,
  type WorkbenchFileExplorerHandle
} from "./WorkbenchFileExplorer";
import { useWorkbenchSearch } from "./search/useWorkbenchSearch";
import { rankSearchRootOptions, type SearchRootOption } from "./search/rootPicker";
import { WorkbenchSearchSidePane } from "./search/WorkbenchSearchSidePane";
import { useWorkbenchQuickAccess } from "./quick-access/useWorkbenchQuickAccess";
import { SessionTranscriptPane } from "./SessionTranscriptPane";
import {
  QuickAccess,
  type QuickAccessCommand,
  type QuickAccessFile
} from "./QuickAccess";
import { useWorkbenchScripts } from "./scripts/useWorkbenchScripts";
import { WorkbenchScriptsPane } from "./scripts/WorkbenchScriptsPane";
import { resolveTerminalThemeId } from "./terminalThemes";
import { appearanceStateFromSettings } from "../../themes";
import { storedWidth } from "../../storage";
import {
  type TerminalGitBranches,
  type GitChange,
  type GitLog,
  type GitLogCommit,
  type GitShow,
  type GitHistoryContext,
  GIT_REFRESH_DEBOUNCE_MS,
  gitOperationError,
  gitChangeKey,
  gitChangeFilePath,
  uniqueGitChanges,
  formatGitCommitDate,
  gitCommitBranchNames
} from "./git/workbenchGitModel";
import { GitChangesPanel } from "./git/GitChangesPanel";
import { useWorkbenchGit } from "./git/useWorkbenchGit";
import {
  GitGraphPortals,
  GitCommitBranches,
  GitActionIcons,
  BranchGraphNavigation
} from "./git/GitGraphView";
import { WorkbenchDetailHeader } from "./layout/WorkbenchDetailHeader";
import { taskFromRecord, type WorkbenchTask } from "./task";
import {
  createTaskWorkbench,
  deleteTaskWorkbench,
  ensureTaskWorkbenches,
  mergeTaskSessionKeys,
  readActiveWorkbenchId,
  renameTaskWorkbench,
  setTaskWorkbenchLayout,
  workbenchDisplayName,
  writeActiveWorkbenchId,
  type Workbench
} from "./workbenchModel";
import { NotePaneView } from "./notes/NotePaneView";

type DesktopApi = ReturnType<typeof desktopApi>;
type FileInspection = Awaited<ReturnType<DesktopApi["workbenchInspectFile"]>>;

/** Session tabs are auto-renamed after staying inactive this long. */
const SESSION_AUTO_RENAME_DELAY_MS = 2 * 60_000;
type EditorPane = Extract<FileInspection, { kind: "text" }> & {
  key: string;
  path: string;
  projectPath: string;
  content: string;
  dirty: boolean;
  saving?: boolean;
  diskState?: "changed" | "deleted" | "external";
  /** Workbench this pane was opened under (undefined = project-scoped, no task). */
  workbenchId?: string;
  /** In-memory display mode for the active tab; resets when the tab closes. */
  view?: "edit" | "preview";
};

/** A note editing tab. Notes are cross-project; `projectPath` is only the scope the tab was opened under. */
type NotePane = {
  key: string;
  noteId: string;
  projectPath: string | null;
  title: string;
  dirty?: boolean;
  workbenchId?: string;
};

function reconcileEditorInspection(editor: EditorPane, inspected: FileInspection): EditorPane {
  if (editor.saving) return editor;
  if (inspected.kind === "missing") {
    return editor.diskState === "deleted" ? editor : { ...editor, diskState: "deleted" };
  }
  if (inspected.kind === "external") {
    return editor.diskState === "external" ? editor : { ...editor, diskState: "external" };
  }
  if (inspected.version === editor.version) {
    return editor.diskState ? { ...editor, diskState: undefined } : editor;
  }
  if (editor.dirty) {
    return editor.diskState === "changed" ? editor : { ...editor, diskState: "changed" };
  }
  return {
    ...editor,
    ...inspected,
    content: inspected.content,
    dirty: false,
    diskState: undefined
  };
}

type DiffPane = WorkbenchDiffPane & {
  projectPath: string;
  workbenchId?: string;
};

type PendingWorkbenchSession = {
  key: string;
  terminalKey: string;
  provider: AgentProvider;
  projectPath: string;
  title: string;
  createdAt: number;
  knownSessionKeys: string[];
  /** When set, append the bound session to this task on bind. */
  taskNoteId?: string;
};
type WorkbenchSessionRow =
  | { kind: "pending"; pending: PendingWorkbenchSession }
  | { kind: "session"; session: AgentSession };
type AcpChatPane = {
  key: string;
  recordId: string;
  title: string;
  provider: string;
  projectPath: string;
  workbenchId?: string;
  initialPrompt?: string;
};
type BrowserPane = {
  key: string;
  title: string;
  group: "browser";
  browserId: string;
  projectPath: string;
  workbenchId?: string;
  boundRecordId?: string;
  startUrl?: string;
  surfaceKind: "workbench" | "window";
};
type SideView = "files" | "git" | "search" | "scripts" | null;
type SearchReveal = { path: string; line: number; column: number; endColumn: number };
const GTD_STATUSES = DESKTOP_GTD_STATUSES;
/** Shared empty list so a project-less task keeps a stable array identity. */
const EMPTY_PROJECT_PATHS: string[] = [];
const WORKBENCH_SESSION_ROW_HEIGHT = 64;
type CatalogProject = {
  projectId: string;
  portableKey: string;
  alias: string;
  hidden: boolean;
  pinned?: boolean;
  keptVisible?: boolean;
  lastSeenAtMs: number | null;
  updatedAtMs: number;
  localPath: string | null;
  pathMissing: boolean;
  sessionCount: number;
};
type WorkbenchProject = {
  id: string;
  path: string;
  portableKey: string;
  pathMissing: boolean;
  sessions: AgentSession[];
  /** Catalog aggregate; unlike `sessions`, this is not limited to loaded pages. */
  sessionCount: number;
  pendingCount: number;
  label: string;
  active: boolean;
  pinned: boolean;
  updatedAt: number;
};
type WorkbenchContextMenu = {
  kind: "session" | "session-tab" | "editor-tab" | "task" | "note";
  x: number;
  y: number;
  /** Tasks / notes: the note id (and title for labels). */
  noteId?: string;
  noteTitle?: string;
  workspaceDir?: string;
  /** Task title + whether it has ever been linked to a session. */
  taskTitle?: string;
  taskHasSessions?: boolean;
  session?: AgentSession;
  floatingNoteTarget?: FloatingSessionNoteTarget;
  hasFloatingNote?: boolean;
  editorKey?: string;
  editorPreview?: boolean;
};
type GitLogContextMenu = {
  x: number;
  y: number;
  commit: GitLogCommit;
  branchName: string | null;
};
type GitLogDialog =
  | { kind: "branch"; commit: GitLogCommit }
  | { kind: "reset"; commit: GitLogCommit };
type WorkbenchNewSessionTarget =
  | { channel: "cli"; provider: AgentProvider }
  | { channel: "acp"; provider: string };
type WorkbenchNewSessionPicker = {
  projectPath?: string;
  projectId?: string;
  mentionId?: string;
  agentTarget?: WorkbenchNewSessionTarget;
};
type ProjectPickDialog =
  | {
      kind: "moveSessionToTask";
      session: AgentSession;
      options: Array<{ noteId: string; label: string; path?: string }>;
      query: string;
      busy: boolean;
      status: string;
    };

/**
 * Session indexed under another user's home (cross-machine catalog sync).
 * Do NOT flag mere path-string differences on the same machine.
 */
function isOtherMachineSession(session: AgentSession, _localPath?: string | null): boolean {
  const raw = session.projectPath?.trim() || "";
  if (!raw || raw.startsWith("~") || raw.startsWith("$HOME")) return false;
  const normalized = raw.replaceAll("\\", "/");
  // Absolute path under a different /Users/name or /home/name than common same-host patterns
  // is treated as foreign. Tilde / relative paths are local-relative.
  if (!normalized.startsWith("/")) return false;
  const userMatch = normalized.match(/^\/Users\/([^/]+)(?:\/|$)/);
  const homeMatch = normalized.match(/^\/home\/([^/]+)(?:\/|$)/);
  if (!userMatch && !homeMatch) return false;
  // Compare against the first path segment of localPath when available; else treat
  // non-matching only when we can detect "Users/X" vs current selection.
  // Without process.homedir in renderer, use: if localPath is set and its /Users/name differs.
  const local = (_localPath || "").replaceAll("\\", "/");
  if (local) {
    const localUser = local.match(/^\/Users\/([^/]+)/);
    const localHome = local.match(/^\/home\/([^/]+)/);
    if (userMatch && localUser) return userMatch[1] !== localUser[1];
    if (homeMatch && localHome) return homeMatch[1] !== localHome[1];
    // local path exists but not under Users/home — still show badge for foreign Users paths
    if (userMatch || homeMatch) return true;
  }
  // No local path context: only flag obvious multi-user home paths that look absolute-foreign
  // (cannot know current username without IPC; avoid over-flagging).
  return false;
}
type BranchMenuPosition = {
  right: number;
  top: number;
};

const PROJECT_KEY = "workbench-selected-project";
const QUICK_ACCESS_PROJECT_KEY = "workbench-quick-access-project";
const LIST_WIDTH_KEY = "wb-list-pane-width";
const SIDE_WIDTH_KEY = "wb-side-panel-width";
const SESSION_VIEW_MODE_KEY = "wb-session-view-mode";
const TUI_SPLIT_HEIGHT_KEY = "wb-tui-split-height";
const ALL_PROJECTS_PANE_KEY = "__all_projects__";

function effectiveGtdStatus(
  statuses: Record<string, GtdStatus>,
  session: AgentSession
): GtdStatus {
  return statuses[sessionKey(session)] || "inbox";
}

function paneProjectKey(projectPath: string | null): string {
  return projectPath || ALL_PROJECTS_PANE_KEY;
}

/**
 * The visibility scope of a pane: its workbench when it was opened under one,
 * else its project. Workbench scoping is what keeps two workbenches of the same
 * task (even on the same repo) from sharing a pane stack.
 */
function paneScopeKey(pane: { projectPath?: string | null; workbenchId?: string }): string {
  return pane.workbenchId ? `wb:${pane.workbenchId}` : paneProjectKey(pane.projectPath ?? null);
}

function workbenchScope(workbenchId: string | null | undefined): string | null {
  return workbenchId ? `wb:${workbenchId}` : null;
}

/** Shape of `TaskWorkbench.layoutJson`, written by the persist effect below. */
type PersistedWorkbenchLayout = {
  openNoteIds?: unknown;
  activePaneKey?: unknown;
  terminals?: unknown;
};

/** A terminal pane as it is stored, so a reopened workbench can adopt its pty. */
type PersistedTerminalPane = Pick<
  TerminalPane,
  "key" | "title" | "group" | "cwd" | "projectPath" | "sessionKey" | "command"
> & { ptyId: number };

/** Stored pane entries are untrusted: they come from an older layout blob. */
function readPersistedTerminals(parsed: PersistedWorkbenchLayout): PersistedTerminalPane[] {
  if (!Array.isArray(parsed.terminals)) return [];
  const panes: PersistedTerminalPane[] = [];
  for (const entry of parsed.terminals) {
    if (!entry || typeof entry !== "object") continue;
    const pane = entry as Record<string, unknown>;
    if (typeof pane.key !== "string" || typeof pane.cwd !== "string") continue;
    if (typeof pane.ptyId !== "number") continue;
    if (pane.group !== "session" && pane.group !== "terminal") continue;
    panes.push({
      key: pane.key,
      ptyId: pane.ptyId,
      group: pane.group,
      cwd: pane.cwd,
      title: typeof pane.title === "string" ? pane.title : "",
      projectPath: typeof pane.projectPath === "string" ? pane.projectPath : pane.cwd,
      ...(typeof pane.sessionKey === "string" ? { sessionKey: pane.sessionKey } : {}),
      ...(typeof pane.command === "string" ? { command: pane.command } : {})
    });
  }
  return panes;
}

/** Record a bound session as owned by the active workbench (best-effort). */
function recordSessionInWorkbench(workbenchId: string | null | undefined, sessionKey: string): void {
  if (!workbenchId || typeof desktopApi().assignSessionToTaskWorkbench !== "function") return;
  const separator = sessionKey.indexOf(":");
  if (separator <= 0) return;
  void desktopApi().assignSessionToTaskWorkbench({
    workbenchId,
    provider: sessionKey.slice(0, separator),
    agentSessionId: sessionKey.slice(separator + 1)
  }).catch(() => undefined);
}

function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

/** Case-insensitive `.md` files support tab preview; `.mdx` is out of scope. */
function isMarkdownFilePath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function sessionKey(session: AgentSession): string {
  return `${session.provider}:${session.id}`;
}

function catalogSessionKeysInRows(rows: readonly WorkbenchSessionRow[]): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    if (row.kind === "session") keys.push(sessionKey(row.session));
  }
  return keys;
}

/** Separator between the LLM-suggested session title and its project suffix. */
const SESSION_TITLE_SUFFIX_LEAD = " · ";

/** Drop a previously appended " · project" suffix before recomposing. */
function stripSessionTitleSuffix(title: string, projectName: string): string {
  const suffix = `${SESSION_TITLE_SUFFIX_LEAD}${projectName}`;
  return title.endsWith(suffix) ? title.slice(0, title.length - suffix.length).trim() : title;
}

/** Compose "title · project", capped at the 180-char native store limit. */
function composeSessionTitle(base: string, projectName: string): string {
  const MAX_TITLE_LENGTH = 180;
  const suffix = `${SESSION_TITLE_SUFFIX_LEAD}${projectName}`;
  if (base.endsWith(suffix)) return base;
  let core = stripSessionTitleSuffix(base, projectName);
  if (core.length + suffix.length <= MAX_TITLE_LENGTH) return `${core}${suffix}`;
  if (core.length >= MAX_TITLE_LENGTH - SESSION_TITLE_SUFFIX_LEAD.length) {
    core = core.slice(0, MAX_TITLE_LENGTH - SESSION_TITLE_SUFFIX_LEAD.length);
  }
  const budget = MAX_TITLE_LENGTH - core.length - SESSION_TITLE_SUFFIX_LEAD.length;
  const project = projectName.slice(0, Math.min(projectName.length, budget));
  return project ? `${core}${SESSION_TITLE_SUFFIX_LEAD}${project}` : core;
}

function sessionNoteTarget(session: AgentSession, projectName?: string): FloatingSessionNoteTarget {
  return {
    provider: session.provider,
    sessionId: session.id,
    projectPath: session.projectPath || "",
    projectName: projectName || basename(session.projectPath),
    sessionTitle: session.title || session.id
  };
}

function sessionIdentityFromKey(value: string | undefined): { provider: string; sessionId: string } | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { provider: value.slice(0, separator), sessionId: value.slice(separator + 1) };
}

function composerHistoryKey(pane: Pick<TerminalPane, "key" | "sessionKey">): string {
  return pane.sessionKey || pane.key;
}

function terminalSessionNoteTarget(pane: TerminalPane, projectName?: string): FloatingSessionNoteTarget | null {
  const identity = sessionIdentityFromKey(pane.sessionKey);
  if (!identity) return null;
  return {
    ...identity,
    projectPath: pane.projectPath || "",
    projectName: projectName || basename(pane.projectPath),
    sessionTitle: pane.title || identity.sessionId
  };
}

function acpSessionNoteTarget(pane: AcpChatPane, projectName?: string): FloatingSessionNoteTarget {
  return {
    provider: "chat",
    sessionId: pane.recordId,
    projectPath: pane.projectPath || "",
    projectName: projectName || basename(pane.projectPath),
    sessionTitle: pane.title || pane.recordId
  };
}

function projectPathKey(value = ""): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

/** ACP chats are catalog provider "chat" (extension dual-write + desktop merge). Never treat CLI providers as ACP. */
function isAcpSession(session: AgentSession): boolean {
  return session.provider === "chat";
}

function acpListSessionKey(recordId: string): string {
  return `chat:${recordId}`;
}

function sessionTabTitle(
  pane: Pick<TerminalPane, "title" | "sessionKey"> | Pick<AcpChatPane, "title" | "recordId">,
  sessionTitles: ReadonlyMap<string, string>
): string {
  const key = "recordId" in pane ? acpListSessionKey(pane.recordId) : pane.sessionKey;
  return (key ? sessionTitles.get(key)?.trim() : "") || pane.title;
}

/** Live status bullet for a session tab; nothing at all for an idle (`open`) pane. */
function sessionTabDot(status: SessionDotStatus | undefined): ReactNode {
  if (!status || status === "open") return null;
  return <span className={`session-dot${sessionDotStatusClass(status)}`} aria-hidden="true" />;
}

function formatDateTime(timestamp: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Persist a layout value for the workbench this window is showing. */
function writeWorkbenchValue(key: string, workbenchId: string | null | undefined, value: string): void {
  try { localStorage.setItem(workbenchScopedKey(key, workbenchId), value); } catch { /* storage is optional */ }
}

function storageString(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

/**
 * UI state that belongs to one workbench rather than to the app.
 *
 * Every window shares one localStorage, so two windows showing different
 * workbenches would otherwise overwrite each other's pane widths and view mode.
 * The unscoped key stays as the fallback for the first window, before its
 * workbench resolves.
 */
function workbenchScopedKey(key: string, workbenchId: string | null | undefined): string {
  return workbenchId ? `${key}:${workbenchId}` : key;
}

function statusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

function normalizeWorkbenchPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const prefix = normalized.startsWith("/") ? "/" : "";
  const parts = normalized.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length && stack.at(-1) !== "..") stack.pop();
      else if (!prefix) stack.push(part);
      continue;
    }
    stack.push(part);
  }
  return `${prefix}${stack.join("/")}` || prefix || ".";
}

function isWorkbenchPathWithin(value: string, root: string): boolean {
  const candidate = normalizeWorkbenchPath(value);
  const targetRoot = normalizeWorkbenchPath(root);
  return candidate === targetRoot || candidate.startsWith(`${targetRoot}/`);
}

export function workbenchActiveFilePath(
  projectPath: string | null,
  editorPath: string | undefined,
  diff: Pick<WorkbenchDiffPane, "path" | "repoRoot" | "repoPath"> | undefined
): string | undefined {
  if (editorPath) return editorPath;
  if (!diff) return undefined;
  const repoFilePath = normalizeWorkbenchPath(gitChangeFilePath(diff));
  if (!projectPath || isWorkbenchPathWithin(repoFilePath, projectPath)) return repoFilePath;
  const displayFilePath = normalizeWorkbenchPath(`${projectPath}/${diff.path}`);
  return isWorkbenchPathWithin(displayFilePath, projectPath) ? displayFilePath : repoFilePath;
}

export { isTerminalAtBottom };
export function WorkbenchPanel(): ReactPortal | null {
  const host = document.getElementById("react-workbench");
  const { t, locale } = useI18n();
  const [active, setActive] = useState(false);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [sessionsCursor, setSessionsCursor] = useState<{ updatedAt: number; provider: string; id: string }>();
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);
  const sessionQuerySequenceRef = useRef(0);
  const projectMetadataLoadedRef = useRef(false);
  const [catalogProjects, setCatalogProjects] = useState<CatalogProject[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [gtdStatuses, setGtdStatuses] = useState<Record<string, GtdStatus>>({});
  const [taskRollup, setTaskRollup] = useState<TaskGtdRollup | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(storageString(PROJECT_KEY) || null);
  const [sessionQuery, setSessionQuery] = useState("");
  /** Task workspace scope (set by the board); renders a dedicated view. */
  const [taskScope, setTaskScope] = useState<WorkbenchTask | null>(null);
  /** Left panel tab: the task's notes, or its session list. */
  const [leftTab, setLeftTab] = useState<"note" | "session">("session");
  /** Left-panel note list: all notes, optionally filtered to the task's note tree. */
  const [noteItems, setNoteItems] = useState<Array<{ noteId: string; title: string; updatedAtMs: number; gtdStatus?: GtdStatus }>>([]);
  const [noteFilter, setNoteFilter] = useState<"task" | "all">("task");
  const [noteQuery, setNoteQuery] = useState("");
  /** Left-panel session list: the task's sessions, or all sessions. */
  const [sessionFilter, setSessionFilter] = useState<"task" | "all">("task");
  const [taskNoteIds, setTaskNoteIds] = useState<Set<string>>(() => new Set());
  /** Note link graph, for reverse task ownership in the "all" note list. */
  const [noteLinks, setNoteLinks] = useState<Array<{ parentNoteId: string; childNoteId: string }>>([]);
  /** Pending request to open a task's note once its workbench is active. */
  const [taskNoteRequest, setTaskNoteRequest] = useState<{ noteId: string; title?: string; nonce: number } | null>(null);
  /** Persisted workbenches of the scoped task (GTD task → n workbenches). */
  const [workbenches, setWorkbenches] = useState<Workbench[]>([]);
  const [activeWorkbenchId, setActiveWorkbenchId] = useState<string | null>(null);
  /** workbenchId → bound session keys (`provider:id`), for tab status dots. */
  const [workbenchSessionKeys, setWorkbenchSessionKeys] = useState<Record<string, string[]>>({});
  const [renamingWorkbenchId, setRenamingWorkbenchId] = useState<string | null>(null);
  const [workbenchRenameDraft, setWorkbenchRenameDraft] = useState("");
  /**
   * Where the NEXT session starts. Decoupled from the panel context
   * (`selectedProject`): null means "let the task decide" — one project →
   * that project, several or none → the task's neutral workspace.
   */
  const [sessionTarget, setSessionTarget] = useState<string | null>(null);
  const sessionTargetRef = useRef<string | null>(null);
  /**
   * The task's shared (neutral) workspace directory. Deterministic per note, so
   * the header can name it before anything is written there.
   */
  const [taskWorkspaceDir, setTaskWorkspaceDir] = useState<string | null>(null);
  const [tasks, setTasks] = useState<WorkbenchTask[]>([]);
  const [selectedSessionKeys, setSelectedSessionKeys] = useState<Set<string>>(() => new Set());
  const [selectionAnchorKey, setSelectionAnchorKey] = useState("");
  const [activeSessionKey, setActiveSessionKey] = useState("");
  const [listWidth, setListWidth] = useState(() => storedWidth(LIST_WIDTH_KEY, 324, 240, 720));
  const [sideWidth, setSideWidth] = useState(() => storedWidth(SIDE_WIDTH_KEY, 320, 240, 840));
  const [sessionViewMode, setSessionViewMode] = useState<"hybrid" | "terminal">(() => {
    const stored = storageString(SESSION_VIEW_MODE_KEY);
    return stored === "terminal" ? "terminal" : "hybrid";
  });
  const [tuiSplitHeight, setTuiSplitHeight] = useState(() => storedWidth(TUI_SPLIT_HEIGHT_KEY, 180, 80, 600));
  const [tuiCollapsed, setTuiCollapsed] = useState(false);
  const [terminals, setTerminals] = useState<TerminalPane[]>([]);
  const [pendingSessions, setPendingSessions] = useState<PendingWorkbenchSession[]>([]);
  const [terminalCreating, setTerminalCreating] = useState(false);
  const [editors, setEditors] = useState<EditorPane[]>([]);
  const [imagePreview, setImagePreview, imagePreviewClosing] = useOverlayState<string>();
  const [diffs, setDiffs] = useState<DiffPane[]>([]);
  const [acpChats, setAcpChats] = useState<AcpChatPane[]>([]);
  const [browsers, setBrowsers] = useState<BrowserPane[]>([]);
  const [notePanes, setNotePanes] = useState<NotePane[]>([]);
  const [activePanes, setActivePanes] = useState<Record<string, string>>({});
  const [side, setSide] = useState<SideView>(null);
  const [editorContextMenu, setEditorContextMenu, editorContextMenuClosing] = useOverlayState<{ x: number; y: number; hasSelection: boolean; selectedText: string }>();
  const {
    selectionResult,
    selectionResultClosing,
    runSelectionAction,
    copySelectionResult,
    clearSelectionResult
  } = useSelectionActionResult();
  const [pendingExplorerReveal, setPendingExplorerReveal] = useState<{ rootPath: string; path: string } | null>(null);
  const searchProjectOptionRefs = useRef(new Map<string, HTMLButtonElement>());
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const [editorFindOpen, setEditorFindOpen] = useState(false);
  const [editorFindQuery, setEditorFindQuery] = useState("");
  const [editorFindResult, setEditorFindResult] = useState<CodeEditorSearchResult | null>(null);
  const editorFindInputRef = useRef<HTMLInputElement | null>(null);
  const editorFindQueryRef = useRef("");
  const previousEditorKeyRef = useRef("");
  const pendingRevealRef = useRef<SearchReveal | null>(null);
  const [gitLog, setGitLog] = useState<GitLog | null>(null);
  const [gitShow, setGitShow] = useState<GitShow | null>(null);
  const [gitHistoryContext, setGitHistoryContext] = useState<GitHistoryContext | null>(null);
  const [gitLogLoading, setGitLogLoading] = useState(false);
  const [gitLogError, setGitLogError] = useState("");
  const [discardingGitPaths, setDiscardingGitPaths] = useState<Set<string>>(() => new Set());
  const editorContextMenuRef = useRef<HTMLDivElement>(null);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const [branchPane, setBranchPane] = useState<TerminalPane | null>(null);
  const [branchMenuPosition, setBranchMenuPosition] = useState<BranchMenuPosition | null>(null);
  const [branchResult, setBranchResult] = useState<TerminalGitBranches | null>(null);

  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const setStatus = useCallback((s: { text: string; kind?: "error" | "ok" | "warning" }) => {
    if (s.text) notifyDesktop({ text: s.text, kind: (s.kind ?? "info") as "error" | "ok" | "info" });
  }, []);
  const [contextMenu, setContextMenu, contextMenuClosing] = useOverlayState<WorkbenchContextMenu>();
  const [floatingNoteTarget, setFloatingNoteTarget] = useState<FloatingSessionNoteTarget | null>(null);
  const [gitLogDialog, setGitLogDialog, gitLogDialogClosing] = useOverlayState<GitLogDialog>();
  const gitLogDialogBusyRef = useRef(false);
  const gitLogDialogInputRef = useRef<HTMLInputElement | null>(null);
  const [newSessionPicker, setNewSessionPicker, newSessionPickerClosing] = useOverlayState<WorkbenchNewSessionPicker>();
  const [projectPickDialog, setProjectPickDialog, projectPickDialogClosing] = useOverlayState<ProjectPickDialog>();
  const [draggedSessionKey, setDraggedSessionKey] = useState<string | null>(null);
  const terminalRefs = useRef(new Map<number, Terminal>());
  const terminalMouseTrackingRef = useRef(new Map<number, boolean>());
  const pendingSessionsRef = useRef<PendingWorkbenchSession[]>([]);
  /** Latest task workspace scope, for values read during session binding. */
  const taskScopeRef = useRef<{ noteId: string } | null>(null);
  const workbenchesRef = useRef<Workbench[]>([]);
  const activeWorkbenchIdRef = useRef<string | null>(null);
  /** A workbench explicitly requested by a deep-link (GTD chip), honored over the stored one. */
  const pendingWorkbenchIdRef = useRef<string | null>(null);
  const draggedSessionRef = useRef<AgentSession | null>(null);
  const gitRefreshTimers = useRef(new Map<string, number>());
  const gitLogRequestRef = useRef(0);
  const terminalsRef = useRef<TerminalPane[]>([]);
  const refreshTerminalGitRef = useRef<(key: string) => Promise<void>>(async () => {});
  const editorsRef = useRef<EditorPane[]>([]);
  /** Latest editor save, so the window-close flush never captures a stale one. */
  const saveEditorRef = useRef<(key: string) => Promise<boolean>>(async () => true);
  const diffsRef = useRef<DiffPane[]>([]);
  const notePanesRef = useRef<NotePane[]>([]);
  const fileExplorerRef = useRef<WorkbenchFileExplorerHandle | null>(null);
  const selectedProjectRef = useRef<string | null>(selectedProject);
  const catalogProjectsRef = useRef<CatalogProject[]>(catalogProjects);
  const activeRef = useRef(active);
  const activePanesRef = useRef<Record<string, string>>(activePanes);
  const sessionsRef = useRef<AgentSession[]>(sessions);
  const acpChatsRef = useRef<AcpChatPane[]>(acpChats);
  const browsersRef = useRef<BrowserPane[]>(browsers);
  const autoRenameTimersRef = useRef(new Map<string, number>());
  const deferredAutoRenameKeysRef = useRef(new Set<string>());
  const watchedRootsRef = useRef<string[]>([]);
  const editorReconcilesRef = useRef(new Map<string, { promise: Promise<void>; queued: boolean }>());
  /** Per-project MRU of activated pane keys (newest first). Used after ⌘W / tab close. */
  const paneHistoryRef = useRef<Record<string, string[]>>({});
  const focusPaneAfterPtyRef = useRef("");
  /** Agent-session composer focus handles keyed by pane key (registered by TerminalComposer). */
  const composerFocusRefs = useRef(new Map<string, (options?: { caret?: "end" }) => void>());
  const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});
  const [composerTips, setComposerTips] = useState<Record<string, ComposerSendTip[]>>({});
  const [transcriptFocus, setTranscriptFocus] = useState<{ text: string; sentAtMs?: number; nonce: number } | null>(null);
  const openingSessionKeysRef = useRef(new Set<string>());
  /** Latest openSession closure for the agent-resume:workbench-open-session listener. */
  const openSessionRef = useRef<(session: AgentSession) => Promise<void>>(() => Promise.resolve());
  const openDiffForPathRef = useRef<(projectPath: string, filePath: string) => Promise<void>>(async () => undefined);
  const settingsRef = useRef<PanelSettings | null>(null);
  const newSessionButtonRef = useRef<HTMLButtonElement>(null);
  const newSessionPickerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const liveTaskEarly = taskScope
    ? tasks.find((item) => item.noteId === taskScope.noteId)
    : undefined;
  const sideRootProjects = liveTaskEarly?.projects ?? taskScope?.projects ?? EMPTY_PROJECT_PATHS;
  const sideRoot = taskScope
    ? (sessionTarget
      || liveTaskEarly?.primaryProject
      || taskScope.primaryProject
      || sideRootProjects[0]
      || null)
    : null;
  /**
   * Roots the explorer and git panels span. A focused project (a chip click)
   * narrows to that one; a shared task workspace shows every referenced
   * project; a plain project selection stays itself.
   */
  const sideRoots = useMemo(() => {
    const candidates = sessionTarget
      ? [sessionTarget]
      : taskScope
        ? sideRootProjects
        : (selectedProject ? [selectedProject] : []);
    const seen = new Set<string>();
    const roots: string[] = [];
    for (const candidate of candidates) {
      const key = projectPathKey(candidate);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      roots.push(candidate);
    }
    return roots;
  }, [sessionTarget, selectedProject, sideRootProjects, taskScope]);
  /** Stable identity of the root set, for effects that must reset when it changes. */
  const sideRootsKey = sideRoots.map(projectPathKey).join("\0");
  const sideRootsRef = useRef<string[]>(sideRoots);
  sideRootsRef.current = sideRoots;
  /** The root an absolute path belongs to (longest match), or "" when outside every root. */
  const projectForPath = useCallback((targetPath: string): string => {
    let best = "";
    for (const root of sideRootsRef.current) {
      if (root.length > best.length && isWorkbenchPathWithin(targetPath, root)) best = root;
    }
    return best;
  }, []);

  const {
    git,
    gitRef,
    gitRoot,
    gitExpandedDirs,
    gitRefreshing,
    gitSyncing,
    commitMessage,
    commitBusy,
    commitSuggestion,
    gitRepositories,
    canCommit,
    projectTracking,
    refreshGit,
    toggleGitDirectory,
    toggleGitStage,
    selectGitRoot,
    setCommitMessage,
    suggestCommit,
    commit,
    syncGitBranch,
    checkoutGitPanelBranch,
    notifyGitSuccess,
    notifyGitFailure
  } = useWorkbenchGit({
    active,
    selectedProjects: sideRoots,
    selectedProjectsRef: sideRootsRef,
    side,
    nestedScanMaxDepth: settings?.workbench?.gitNestedScanMaxDepth,
    nestedScanIgnoreDirs: settings?.workbench?.gitNestedScanIgnoreDirs,
    onGitMutated: () => {
      terminalsRef.current.forEach((pane) => void refreshTerminalGitRef.current(pane.key));
    },
    notifyStatus: setStatus
  });

  useEffect(() => { terminalsRef.current = terminals; }, [terminals]);
  useEffect(() => { editorsRef.current = editors; }, [editors]);
  useEffect(() => { diffsRef.current = diffs; }, [diffs]);
  useEffect(() => { notePanesRef.current = notePanes; }, [notePanes]);
  useEffect(() => { selectedProjectRef.current = selectedProject; }, [selectedProject]);

  const refreshOpenGitDiffs = useCallback(async (changedPaths: ReadonlySet<string> | null) => {
    if (!selectedProject) return;
    const projectDiffs = diffsRef.current.filter(
      (pane) => pane.projectPath === selectedProject && pane.source !== "commit"
    );
    if (!projectDiffs.length) return;
    const targets = changedPaths === null
      ? projectDiffs
      : projectDiffs.filter((pane) => changedPaths.has(normalizeWorkbenchPath(gitChangeFilePath(pane))));
    if (!targets.length) return;
    await Promise.all(targets.map(async (pane) => {
      try {
        const refreshed = await desktopApi().terminalGitDiffSides({
          cwd: pane.repoRoot,
          path: pane.repoPath,
          staged: pane.source === "staged"
        });
        if (pane.source !== "untracked" && !refreshed.hunks.length) {
          setDiffs((current) => current.filter((item) => item.key !== pane.key));
          setActivePanes((current) => {
            const projectKey = paneProjectKey(selectedProject);
            return current[projectKey] === pane.key ? { ...current, [projectKey]: "" } : current;
          });
        } else if (refreshed.oldText !== pane.oldText || refreshed.newText !== pane.newText) {
          setDiffs((current) => current.map((item) => item.key === pane.key ? { ...item, ...refreshed } : item));
        }
      } catch {
        // Transient failure: keep the last rendered diff; the next change event re-attempts.
      }
    }));
  }, [selectedProject]);

  const gitRefreshDebounceRef = useRef(0);
  const gitDiffRefreshPendingRef = useRef<{ paths: Set<string>; fullRescan: boolean }>({
    paths: new Set(),
    fullRescan: false
  });
  useEffect(() => {
    const api = desktopApi();
    if (typeof api.onWorkbenchFileSystemChanged !== "function") return;
    const unsubscribe = api.onWorkbenchFileSystemChanged((event) => {
      if (event.type !== "change") return;
      if (!activeRef.current || !watchedRootsRef.current.some((root) => projectPathKey(root) === projectPathKey(event.rootPath))) return;
      const pending = gitDiffRefreshPendingRef.current;
      if (event.fullRescan || !event.paths.length) {
        pending.fullRescan = true;
      } else {
        for (const changedPath of event.paths) pending.paths.add(normalizeWorkbenchPath(changedPath));
      }
      if (gitRefreshDebounceRef.current) window.clearTimeout(gitRefreshDebounceRef.current);
      gitRefreshDebounceRef.current = window.setTimeout(() => {
        gitRefreshDebounceRef.current = 0;
        const { paths, fullRescan } = gitDiffRefreshPendingRef.current;
        gitDiffRefreshPendingRef.current = { paths: new Set(), fullRescan: false };
        void refreshGit(false);
        void refreshOpenGitDiffs(fullRescan ? null : paths);
      }, GIT_REFRESH_DEBOUNCE_MS);
    });
    return () => {
      if (gitRefreshDebounceRef.current) window.clearTimeout(gitRefreshDebounceRef.current);
      gitRefreshDebounceRef.current = 0;
      unsubscribe();
    };
  }, [refreshGit, refreshOpenGitDiffs]);
  useEffect(() => { catalogProjectsRef.current = catalogProjects; }, [catalogProjects]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { activePanesRef.current = activePanes; }, [activePanes]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { acpChatsRef.current = acpChats; }, [acpChats]);
  useEffect(() => { browsersRef.current = browsers; }, [browsers]);
  useEffect(() => () => {
    for (const timer of autoRenameTimersRef.current.values()) window.clearTimeout(timer);
    autoRenameTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!pendingExplorerReveal || side !== "files") return;
    if (projectPathKey(selectedProject || "") !== projectPathKey(pendingExplorerReveal.rootPath)) return;
    const frame = window.requestAnimationFrame(() => {
      const explorer = fileExplorerRef.current;
      if (!explorer) return;
      void explorer.revealPath(pendingExplorerReveal.path).finally(() => {
        setPendingExplorerReveal((current) => current === pendingExplorerReveal ? null : current);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingExplorerReveal, selectedProject, side]);
  useEffect(() => { pendingSessionsRef.current = pendingSessions; }, [pendingSessions]);
  useEffect(() => { sessionTargetRef.current = sessionTarget; }, [sessionTarget]);
  useEffect(() => { taskScopeRef.current = taskScope ? { noteId: taskScope.noteId } : null; }, [taskScope]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Task GTD rollup for the scoped task (children + linked sessions).
  useEffect(() => {
    const noteId = taskScope?.noteId;
    if (!noteId || typeof desktopApi().taskGtdRollup !== "function") {
      setTaskRollup(null);
      return;
    }
    let active = true;
    const refresh = () => {
      void desktopApi().taskGtdRollup({ noteId })
        .then((rollup) => { if (active) setTaskRollup(rollup); })
        .catch(() => { if (active) setTaskRollup(null); });
    };
    refresh();
    window.addEventListener("agent-resume:notes-mutated", refresh);
    return () => {
      active = false;
      window.removeEventListener("agent-resume:notes-mutated", refresh);
    };
  }, [taskScope?.noteId]);

  // Keep the scoped task's accent in step with refreshed task records, so a
  // template recolor re-skins this window on its next task refresh.
  useEffect(() => {
    const noteId = taskScope?.noteId;
    if (!noteId) return;
    const record = tasks.find((item) => item.noteId === noteId);
    if (!record?.accent) return;
    if (taskScope.accent?.colorKey === record.accent.colorKey
      && taskScope.accent?.shade === record.accent.shade) return;
    setTaskScope((current) => current && current.noteId === noteId ? { ...current, accent: record.accent } : current);
  }, [tasks, taskScope]);

  // The task's accent dresses the whole window: html[data-task-accent] plus
  // data-task-shade drive the CSS color-family derivation in styles.css. Only
  // task windows set it; board and standalone-note windows stay neutral.
  useEffect(() => {
    const root = document.documentElement;
    const accent = taskScope?.accent;
    if (accent && root.dataset.windowMode === "task") {
      root.dataset.taskAccent = accent.colorKey;
      root.dataset.taskShade = String(accent.shade);
    } else {
      delete root.dataset.taskAccent;
      delete root.dataset.taskShade;
    }
  }, [taskScope?.accent]);

  const openSessionKeys = useMemo(() => {
    const keys = new Set(terminals.flatMap((pane) => (pane.sessionKey ? [pane.sessionKey] : [])));
    for (const pane of acpChats) {
      keys.add(acpListSessionKey(pane.recordId));
    }
    return keys;
  }, [acpChats, terminals]);
  const sessionTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const session of sessions) {
      const title = session.title.trim();
      if (title) titles.set(sessionKey(session), title);
    }
    return titles;
  }, [sessions]);
  // Live session status is owned by the agent-status daemon; this component
  // only declares which panes exist. ACP chats are not PTY panes, so their
  // lifecycle is tracked locally and merged below.
  const statusPanes = useMemo(
    () => terminals
      .filter((pane) => pane.group === "session")
      .map((pane) => ({ key: pane.key, ptyId: pane.ptyId ?? null, sessionKey: pane.sessionKey })),
    [terminals]
  );

  const statusView = useAgentStatus(statusPanes);
  const acpStatus = useAcpStatus();
  const sessionRuntimeByPaneKey = useMemo(() => {
    const merged = new Map<string, SessionDotRuntime>(statusView.byPaneKey);
    for (const pane of acpChats) {
      const runtime = acpStatus.byChatId.get(pane.recordId);
      if (runtime) merged.set(pane.key, runtime);
    }
    return merged;
  }, [acpChats, acpStatus.byChatId, statusView.byPaneKey]);
  const activeSessionDots = useMemo(
    () => collectActiveSessionDots(terminals, acpChats, sessionTitles, sessionRuntimeByPaneKey),
    [acpChats, sessionRuntimeByPaneKey, sessionTitles, terminals]
  );
  const dotByKey = useMemo(() => {
    const map = new Map<string, ActiveSessionDot>();
    for (const dot of activeSessionDots) if (dot.sessionKey) map.set(dot.sessionKey, dot);
    return map;
  }, [activeSessionDots]);

  // ACP carries its own structured lifecycle; feed it to the ACP status hook.
  useEffect(() => {
    const subscribe = desktopApi().onAcpStream;
    if (typeof subscribe !== "function") return;
    const off = subscribe((raw) => acpStatus.ingest(raw as AcpStatusEvent));
    return () => off();
  }, [acpStatus.ingest]);

  // One stream: report this window's panes to main, which merges every window
  // (plus daemon-only panes) and fans the result back out. The board and the
  // selection menu read it from there, so there is no second in-process event.
  useEffect(() => {
    desktopApi().setWorkbenchActiveSessions?.(activeSessionDots);
  }, [activeSessionDots]);

  const composerHistoryKeys = useMemo(() => terminals
    .filter((pane) => pane.group === "session")
    .map((pane) => `${pane.key}::${pane.sessionKey || ""}`)
    .join("|"), [terminals]);

  const loadComposerTipsFromDb = useCallback(() => {
    const list = desktopApi().workbenchComposerSendList;
    if (typeof list !== "function") return;
    const sessionPanes = terminalsRef.current.filter((pane) => pane.group === "session");
    void Promise.all(sessionPanes.map(async (pane) => {
      const identity = sessionIdentityFromKey(pane.sessionKey);
      const records = await list({
        paneKey: pane.key,
        sessionKey: pane.sessionKey || undefined,
        agentSessionId: identity?.sessionId,
        limit: COMPOSER_TIP_LIMIT
      });
      return {
        key: composerHistoryKey(pane),
        tips: records.map((record) => ({ id: record.id, text: record.text, createdAtMs: record.createdAtMs }))
      };
    })).then((rows) => {
      setComposerTips((current) => {
        let changed = false;
        const next = { ...current };
        for (const row of rows) {
          const existing = current[row.key] || [];
          const byId = new Map<string, ComposerSendTip>();
          for (const tip of row.tips) byId.set(tip.id, tip);
          for (const tip of existing) {
            if (!byId.has(tip.id)) byId.set(tip.id, tip);
          }
          const merged = [...byId.values()]
            .sort((a, b) => b.createdAtMs - a.createdAtMs)
            .slice(0, COMPOSER_TIP_LIMIT);
          const same = merged.length === existing.length
            && merged.every((tip, index) => tip.id === existing[index]?.id && tip.text === existing[index]?.text);
          if (same) continue;
          next[row.key] = merged;
          changed = true;
        }
        return changed ? next : current;
      });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadComposerTipsFromDb();
  }, [composerHistoryKeys, loadComposerTipsFromDb]);

  const sessionQueryRequest = useCallback((cursor?: { updatedAt: number; provider: string; id: string }) => {
    const request: NonNullable<Parameters<DesktopApi["querySessionsPage"]>[0]> = {
      limit: 100,
      cursor,
      search: sessionQuery.trim() || undefined
    };
    return request;
  }, [sessionQuery]);

  const loadProjectMetadata = useCallback(async () => {
    const listProjects = typeof desktopApi().listProjects === "function"
      ? desktopApi().listProjects()
      : Promise.resolve([] as CatalogProject[]);
    const [nextAliases, nextSettings, nextProjects, nextGtdStatuses] = await Promise.all([
      desktopApi().listProjectAliases(),
      desktopApi().getSettings(),
      listProjects,
      typeof desktopApi().listSessionGtdStatuses === "function"
        ? desktopApi().listSessionGtdStatuses()
        : Promise.resolve({} as Record<string, GtdStatus>)
    ]);
    setAliases(nextAliases);
    setSettings(nextSettings);
    catalogProjectsRef.current = nextProjects || [];
    setCatalogProjects(nextProjects || []);
    setGtdStatuses(nextGtdStatuses || {});
  }, []);

  const loadSessions = useCallback(async () => {
    const sequence = ++sessionQuerySequenceRef.current;
    try {
      const page = await desktopApi().querySessionsPage(sessionQueryRequest());
      if (sequence !== sessionQuerySequenceRef.current) return;
      setSessions(page.sessions);
      setSessionsTotal(page.total);
      setSessionsCursor(page.nextCursor);
      setStatus({ text: "" });
    } catch (error) {
      if (sequence === sessionQuerySequenceRef.current) setStatus({ text: statusError(error), kind: "error" });
    }
  }, [sessionQueryRequest]);

  const reloadWorkbench = useCallback(async () => {
    // Mark immediately so the first active render does not start a duplicate
    // catalog aggregate while this full refresh is in flight.
    projectMetadataLoadedRef.current = true;
    try {
      await loadProjectMetadata();
      await loadSessions();
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [loadProjectMetadata, loadSessions]);

  useEffect(() => {
    if (!active) return;
    // The Workbench can become active without a tab-change event. Load
    // aggregates once in that case.
    if (!projectMetadataLoadedRef.current) {
      void reloadWorkbench();
      return;
    }
    const timer = window.setTimeout(() => { void loadSessions(); }, 250);
    return () => window.clearTimeout(timer);
  }, [active, loadSessions, reloadWorkbench, sessionQuery]);

  const loadMoreSessions = useCallback(async () => {
    if (!sessionsCursor || sessionsLoadingMore) return;
    const sequence = sessionQuerySequenceRef.current;
    setSessionsLoadingMore(true);
    try {
      const page = await desktopApi().querySessionsPage(sessionQueryRequest(sessionsCursor));
      if (sequence !== sessionQuerySequenceRef.current) return;
      setSessions((current) => {
        const known = new Set(current.map(sessionKey));
        return [...current, ...page.sessions.filter((session) => !known.has(sessionKey(session)))];
      });
      setSessionsTotal(page.total);
      setSessionsCursor(page.nextCursor);
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    } finally {
      setSessionsLoadingMore(false);
    }
  }, [sessionQueryRequest, sessionsCursor, sessionsLoadingMore]);

  const performAutoRenameSession = useCallback(async (provider: string, id: string) => {
    deferredAutoRenameKeysRef.current.delete(`${provider}:${id}`);
    const session = sessionsRef.current.find((item) => item.provider === provider && item.id === id);
    if (!session) return; // Session was hidden/deleted — nothing left to auto-rename.
    try {
      const projectName = session.projectPath ? basename(session.projectPath) : "";
      let result: { title: string; nativeRenamed: boolean; nativeError?: string };
      if (projectName) {
        // Sessions get " · project" appended to the LLM-suggested title so the
        // project context survives outside the workbench.
        const suggested = await desktopApi().autoRenameSession({ provider, id, persist: false });
        const title = composeSessionTitle(suggested.title, projectName);
        const renamed = await desktopApi().renameSession({ provider, id, title });
        result = { title, nativeRenamed: renamed.nativeRenamed, nativeError: renamed.nativeError };
      } else {
        result = await desktopApi().autoRenameSession({ provider, id, persist: true });
      }
      await loadSessions();
      // Success is silent; the list refresh already reflects the new title.
      if (activeRef.current && !result.nativeRenamed && result.nativeError) {
        setStatus({
          text: t("desktop.sessions.renamed", result.title) + t("desktop.sessions.renamedNativeError", result.nativeError),
          kind: "error",
        });
      }
      window.dispatchEvent(new CustomEvent("agent-resume:sessions-mutated", { detail: { kind: "session-title" } }));
    } catch (error) {
      const message = statusError(error);
      // Session was hidden/deleted while the delayed rename was pending — treat as a no-op.
      if (/Session not found/.test(message)) return;
      if (activeRef.current) setStatus({ text: message, kind: "error" });
    }
  }, [loadSessions, setStatus, t]);

  const cancelSessionAutoRename = useCallback((key: string) => {
    const timer = autoRenameTimersRef.current.get(key);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      autoRenameTimersRef.current.delete(key);
    }
  }, []);

  const isSessionPaneActive = useCallback((key: string) => {
    if (!activeRef.current) return false;
    const activePaneKey = activePanesRef.current[workbenchScope(activeWorkbenchIdRef.current) ?? paneProjectKey(selectedProjectRef.current || null)] || "";
    if (!activePaneKey) return false;
    return Boolean(
      terminalsRef.current.some((pane) => pane.key === activePaneKey && pane.sessionKey === key)
      || acpChatsRef.current.some((pane) => pane.key === activePaneKey && acpListSessionKey(pane.recordId) === key)
    );
  }, []);

  const scheduleSessionAutoRename = useCallback((key: string, provider: string, id: string) => {
    if (!key || !provider || !id || isSessionPaneActive(key) || autoRenameTimersRef.current.has(key)) return;
    const timer = window.setTimeout(() => {
      autoRenameTimersRef.current.delete(key);
      if (isSessionPaneActive(key)) return;
      void performAutoRenameSession(provider, id);
    }, SESSION_AUTO_RENAME_DELAY_MS);
    autoRenameTimersRef.current.set(key, timer);
  }, [isSessionPaneActive, performAutoRenameSession]);

  const scheduleSessionPaneAutoRename = useCallback((pane: TerminalPane | AcpChatPane) => {
    const key = "sessionKey" in pane && pane.sessionKey
      ? pane.sessionKey
      : "recordId" in pane
        ? acpListSessionKey(pane.recordId)
        : "";
    const identity = sessionIdentityFromKey(key);
    if (identity) scheduleSessionAutoRename(key, identity.provider, identity.sessionId);
  }, [scheduleSessionAutoRename]);

  const deferSessionPaneAutoRename = useCallback((pane: TerminalPane | AcpChatPane) => {
    const key = "sessionKey" in pane && pane.sessionKey
      ? pane.sessionKey
      : "recordId" in pane
        ? acpListSessionKey(pane.recordId)
        : "";
    if (key) deferredAutoRenameKeysRef.current.add(key);
  }, []);

  useEffect(() => {
    const activePaneKey = active ? activePanes[workbenchScope(activeWorkbenchIdRef.current) ?? paneProjectKey(selectedProject || null)] || "" : "";
    const activeKeys = new Set<string>();
    if (activePaneKey) {
      for (const pane of terminals) {
        if (pane.key === activePaneKey && pane.sessionKey) activeKeys.add(pane.sessionKey);
      }
      for (const pane of acpChats) {
        if (pane.key === activePaneKey) activeKeys.add(acpListSessionKey(pane.recordId));
      }
    }
    for (const key of activeKeys) {
      if (isSessionPaneActive(key)) cancelSessionAutoRename(key);
    }
    for (const pane of terminals) {
      if (!pane.sessionKey) continue;
      const identity = sessionIdentityFromKey(pane.sessionKey);
      if (identity && !activeKeys.has(pane.sessionKey)) {
        scheduleSessionAutoRename(pane.sessionKey, identity.provider, identity.sessionId);
      }
    }
    for (const pane of acpChats) {
      const key = acpListSessionKey(pane.recordId);
      const identity = sessionIdentityFromKey(key);
      if (identity && !activeKeys.has(key)) {
        scheduleSessionAutoRename(key, identity.provider, identity.sessionId);
      }
    }
    for (const key of deferredAutoRenameKeysRef.current) {
      const identity = sessionIdentityFromKey(key);
      if (!identity || (activeKeys.has(key) && isSessionPaneActive(key))) continue;
      scheduleSessionAutoRename(key, identity.provider, identity.sessionId);
      deferredAutoRenameKeysRef.current.delete(key);
    }
  }, [acpChats, active, activePanes, cancelSessionAutoRename, isSessionPaneActive, scheduleSessionAutoRename, selectedProject, terminals]);

  useEffect(() => {
    if (typeof desktopApi().onSessionsSynced !== "function") return;
    return desktopApi().onSessionsSynced(() => { void reloadWorkbench(); });
  }, [reloadWorkbench]);

  useEffect(() => {
    const onSessionsMutated = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string }>).detail;
      if (detail?.kind !== "session-title") return;
      void loadSessions();
    };
    window.addEventListener("agent-resume:sessions-mutated", onSessionsMutated);
    return () => window.removeEventListener("agent-resume:sessions-mutated", onSessionsMutated);
  }, [loadSessions]);

  const refreshSessionsAfterAcpConnect = useCallback(() => {
    void loadSessions();
  }, [loadSessions]);

  const loadSessionsRef = useRef(loadSessions);
  loadSessionsRef.current = loadSessions;
  const triggerSessionSync = useCallback(() => {
    if (typeof desktopApi().syncSessions === "function") {
      void desktopApi().syncSessions().catch(() => undefined);
    } else {
      void loadSessionsRef.current();
    }
  }, []);

  useEffect(() => {
    if (!pendingSessions.length) return;
    const timers = [600, 1_800, 4_000].map((delay) =>
      window.setTimeout(() => { triggerSessionSync(); }, delay)
    );
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [pendingSessions.length, triggerSessionSync]);

  useEffect(() => {
    if (!pendingSessions.length || !sessions.length) return;
    const claimed = new Set(terminals.flatMap((pane) => pane.sessionKey ? [pane.sessionKey] : []));
    const assignments = new Map<string, string>();

    for (const pending of [...pendingSessions].sort((a, b) => a.createdAt - b.createdAt)) {
      const known = new Set(pending.knownSessionKeys);
      const candidates = sessions
        .filter((session) => {
          const key = sessionKey(session);
          if (session.provider === "chat") return false;
          if (known.has(key) || claimed.has(key)) return false;
          if (projectPathKey(session.projectPath) !== projectPathKey(pending.projectPath)) return false;
          if (session.updatedAt < pending.createdAt - 15_000) return false;
          return true;
        })
        .sort((a, b) => {
          const aProv = a.provider === pending.provider ? 0 : 1;
          const bProv = b.provider === pending.provider ? 0 : 1;
          if (aProv !== bProv) return aProv - bProv;
          return Math.abs(a.updatedAt - pending.createdAt) - Math.abs(b.updatedAt - pending.createdAt);
        });
      const candidate = candidates[0];
      if (!candidate) continue;
      const key = sessionKey(candidate);
      claimed.add(key);
      assignments.set(pending.terminalKey, key);
    }

    if (!assignments.size) return;
    const bindSessions = (current: TerminalPane[]) => current.map((pane) => {
      const key = assignments.get(pane.key);
      return key ? { ...pane, sessionKey: key } : pane;
    });
    terminalsRef.current = bindSessions(terminalsRef.current);
    setTerminals(bindSessions);
    for (const pending of pendingSessions) {
      const sessionKeyValue = assignments.get(pending.terminalKey);
      if (!sessionKeyValue) continue;
      // Sessions started inside a task workspace belong to that task.
      if (pending.taskNoteId && typeof desktopApi().notesLinkSessionToTask === "function") {
        void desktopApi().notesLinkSessionToTask({
          noteId: pending.taskNoteId,
          sessionKey: sessionKeyValue,
          projectPath: pending.projectPath
        }).then(() => {
          window.dispatchEvent(new Event("agent-resume:notes-mutated"));
        }).catch(() => undefined);
      }
      recordSessionInWorkbench(activeWorkbenchIdRef.current, sessionKeyValue);
    }
    setPendingSessions((current) => current.filter((pending) => !assignments.has(pending.terminalKey)));
    // The active pending terminal just bound to a catalog session: move the
    // list highlight from the (now removed) pending row to the bound row.
    const activePaneKey = activePanesRef.current[workbenchScope(activeWorkbenchIdRef.current) ?? paneProjectKey(selectedProjectRef.current || null)] || "";
    const boundSessionKey = assignments.get(activePaneKey);
    if (boundSessionKey) setActiveSessionKey(boundSessionKey);
  }, [loadSessions, pendingSessions, reloadWorkbench, sessions, terminals]);

  useEffect(() => {
    const onTab = (event: Event) => {
      const show = (event as CustomEvent<string>).detail === "workbench";
      setActive(show);
      if (show) void reloadWorkbench();
    };
    const onSettingsSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ settings?: PanelSettings; section?: string }>).detail;
      if (detail?.settings) setSettings(detail.settings);
    };
    window.addEventListener("agent-resume:tab-change", onTab);
    window.addEventListener("agent-resume:settings-saved", onSettingsSaved);
    return () => {
      window.removeEventListener("agent-resume:tab-change", onTab);
      window.removeEventListener("agent-resume:settings-saved", onSettingsSaved);
    };
  }, [reloadWorkbench]);

  useEffect(() => {
    if (!editorContextMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".wb-context-menu")) setEditorContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditorContextMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editorContextMenu]);

  useEffect(() => () => {
    gitRefreshTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".wb-context-menu")) setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (contextMenu) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!selectedSessionKeys.size) return;
      event.preventDefault();
      setSelectedSessionKeys(new Set());
      setSelectionAnchorKey("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, contextMenu, selectedSessionKeys.size]);

  useEffect(() => {
    if (!gitLogDialog) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".wb-git-log-dialog")) closeGitLogDialog();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeGitLogDialog();
      }
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => {
      gitLogDialogInputRef.current?.focus();
      gitLogDialogInputRef.current?.select();
    });
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gitLogDialog?.kind, gitLogDialog?.commit?.hash]);

  useEffect(() => {
    if (!newSessionPicker) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)
        || (!newSessionPickerRef.current?.contains(target) && !newSessionButtonRef.current?.contains(target))) {
        setNewSessionPicker(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setNewSessionPicker(null);
        newSessionButtonRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    const frame = window.requestAnimationFrame(() => {
      newSessionPickerRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [newSessionPicker]);

  useEffect(() => {
    if (!branchPane) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".wb-git-branch-popover")) {
        setBranchPane(null);
        setBranchResult(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBranchPane(null);
        setBranchResult(null);
      }
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [branchPane]);

  const allProjects = useMemo((): WorkbenchProject[] => {
    if (catalogProjects.length) {
      const sessionsByProjectId = new Map<string, AgentSession[]>();
      const unassignedSessionsByPath = new Map<string, AgentSession[]>();
      const pendingCountByPath = new Map<string, number>();
      for (const session of sessions) {
        if (session.projectId) {
          const group = sessionsByProjectId.get(session.projectId) || [];
          group.push(session);
          sessionsByProjectId.set(session.projectId, group);
        } else if (session.projectPath) {
          const key = projectPathKey(session.projectPath);
          const group = unassignedSessionsByPath.get(key) || [];
          group.push(session);
          unassignedSessionsByPath.set(key, group);
        }
      }
      for (const pending of pendingSessions) {
        const key = projectPathKey(pending.projectPath);
        pendingCountByPath.set(key, (pendingCountByPath.get(key) || 0) + 1);
      }
      const catalogRows = catalogProjects.flatMap((project) => {
        const group = [
          ...(sessionsByProjectId.get(project.projectId) || []),
          ...(project.localPath ? unassignedSessionsByPath.get(projectPathKey(project.localPath)) || [] : [])
        ];
        const projectPath = project.localPath || project.portableKey;
        const pendingCount = pendingCountByPath.get(projectPathKey(projectPath)) || 0;
        // Hide empty catalog rows unless the user explicitly opened the project.
        if ((project.sessionCount || 0) === 0 && group.length === 0 && pendingCount === 0 && !project.keptVisible) return [];
        const path = projectPath;
        return [{
          id: project.projectId,
          path,
          portableKey: project.portableKey,
          pathMissing: project.pathMissing,
          sessions: group,
          sessionCount: project.sessionCount || 0,
          pendingCount,
          label: project.alias || aliases[path] || aliases[project.projectId] || basename(path),
          active: pendingCount > 0 || group.some((session) => openSessionKeys.has(sessionKey(session))),
          pinned: project.pinned === true,
          updatedAt: group.length
            ? Math.max(...group.map((item) => item.updatedAt))
            : (project.lastSeenAtMs || project.updatedAtMs || 0)
        }];
      });
      const knownPaths = new Set(catalogRows.map((project) => projectPathKey(project.path)));
      const pendingOnly = new Map<string, PendingWorkbenchSession[]>();
      for (const pending of pendingSessions) {
        const key = projectPathKey(pending.projectPath);
        if (knownPaths.has(key)) continue;
        pendingOnly.set(key, [...(pendingOnly.get(key) || []), pending]);
      }
      const rows = [...catalogRows, ...[...pendingOnly.entries()].map(([path, pending]) => ({
        id: path,
        path,
        portableKey: path,
        pathMissing: false,
        sessions: [],
        sessionCount: 0,
        pendingCount: pending.length,
        label: aliases[path] || basename(path),
        active: true,
        pinned: false,
        updatedAt: Math.max(...pending.map((item) => item.createdAt))
      }))];
      return rows.sort((a, b) => Number(b.pinned) - Number(a.pinned)
        || b.updatedAt - a.updatedAt
        || a.label.localeCompare(b.label)
        || a.path.localeCompare(b.path)
        || a.id.localeCompare(b.id));
    }

    const grouped = new Map<string, { sessions: AgentSession[]; pendingCount: number; updatedAt: number }>();
    for (const session of sessions) {
      if (!session.projectPath) continue;
      const group = grouped.get(session.projectPath) || { sessions: [], pendingCount: 0, updatedAt: 0 };
      group.sessions.push(session);
      group.updatedAt = Math.max(group.updatedAt, session.updatedAt);
      grouped.set(session.projectPath, group);
    }
    for (const pending of pendingSessions) {
      const group = grouped.get(pending.projectPath) || { sessions: [], pendingCount: 0, updatedAt: 0 };
      group.pendingCount += 1;
      group.updatedAt = Math.max(group.updatedAt, pending.createdAt);
      grouped.set(pending.projectPath, group);
    }
    return [...grouped.entries()].map(([path, group]) => ({
      id: path,
      path,
      portableKey: path,
      pathMissing: false,
      sessions: group.sessions,
      sessionCount: group.sessions.length,
      folders: [],
      folderAssignments: [],
      pendingCount: group.pendingCount,
      label: aliases[path] || basename(path),
      active: group.pendingCount > 0 || group.sessions.some((session) => openSessionKeys.has(sessionKey(session))),
      pinned: false,
      updatedAt: group.updatedAt
    })).sort((a, b) => Number(b.pinned) - Number(a.pinned)
      || b.updatedAt - a.updatedAt
      || a.label.localeCompare(b.label)
      || a.path.localeCompare(b.path)
      || a.id.localeCompare(b.id));
  }, [aliases, catalogProjects, openSessionKeys, pendingSessions, sessions]);

  const selectedProjectMeta = useMemo(
    () => allProjects.find((project) => project.path === selectedProject || project.id === selectedProject) || null,
    [allProjects, selectedProject]
  );

  const selectedSessions = sessions;
  const selectedSessionScope = taskScope
    ? (taskScope.title || t("desktop.workbench.taskView"))
    : t("desktop.workbench.allSessions");
  /**
   * A task's sessions come from the catalog by key, not from the selected
   * project's page — that is what lets one task span several repositories.
   */
  const liveTask = useMemo(
    () => (taskScope ? tasks.find((item) => item.noteId === taskScope.noteId) : undefined),
    [taskScope, tasks]
  );
  /** Projects come from the live task, so a manual add shows up immediately. */
  const scopeProjects = useMemo(
    () => liveTask?.projects ?? taskScope?.projects ?? [],
    [liveTask, taskScope]
  );
  const scopeProjectsRef = useRef<string[]>(scopeProjects);
  useEffect(() => { scopeProjectsRef.current = scopeProjects; }, [scopeProjects]);
  // Resolve the shared workspace path for the header; it need not exist yet.
  useEffect(() => {
    const noteId = taskScope?.noteId;
    if (!noteId || typeof desktopApi().notesTaskWorkspace !== "function") {
      setTaskWorkspaceDir(null);
      return;
    }
    let cancelled = false;
    void desktopApi().notesTaskWorkspace({ noteId }).then(({ dir }) => {
      if (!cancelled) setTaskWorkspaceDir(dir || null);
    }).catch(() => { if (!cancelled) setTaskWorkspaceDir(null); });
    return () => { cancelled = true; };
  }, [taskScope?.noteId]);
  const taskSessionKeys = useMemo(
    () => mergeTaskSessionKeys(liveTask?.sessions ?? taskScope?.sessions ?? [], terminals, activeWorkbenchId ?? null),
    [liveTask, taskScope, terminals, activeWorkbenchId]
  );
  /**
   * Whether the task's session set is authoritative. A task that exists in
   * the catalog, or a scope that explicitly carries `sessions` (including `[]`),
   * declares its sessions — an empty list then means "none". A scope that omits
   * `sessions` is unspecified and falls back to the selected project's list.
   */
  const taskSessionsKnown = liveTask !== undefined || taskScope?.sessions !== undefined;
  const [taskSessions, setTaskSessions] = useState<AgentSession[] | null>(null);
  const taskSessionKeyString = taskSessionKeys.join("|");
  useEffect(() => {
    if (!taskScope) { setTaskSessions(null); return; }
    const parsed = taskSessionKeyString
      ? taskSessionKeyString.split("|").map((key) => {
          const separator = key.indexOf(":");
          return separator > 0 && separator < key.length - 1
            ? { provider: key.slice(0, separator), id: key.slice(separator + 1) }
            : null;
        }).filter((entry): entry is { provider: string; id: string } => entry !== null)
      : [];
    if (!parsed.length || typeof desktopApi().querySessionsPage !== "function") {
      setTaskSessions(null);
      return;
    }
    let alive = true;
    void desktopApi().querySessionsPage({ keys: parsed, limit: 500 })
      .then((page) => { if (alive) setTaskSessions(page.sessions); })
      .catch(() => { if (alive) setTaskSessions([]); });
    return () => { alive = false; };
  }, [taskScope, taskSessionKeyString]);

  const visibleSessions = useMemo(() => {
    // "Task" shows exactly the task's sessions (across projects, from the catalog by key);
    // "All" shows every session. When the task's session set is unspecified, fall
    // back to the selected project's list rather than showing nothing.
    const scoped = sessionFilter === "task" && taskScope && taskSessionsKnown;
    const source = scoped ? (taskSessions ?? []) : selectedSessions;
    return source.filter((session) =>
      `${session.title} ${session.id} ${session.provider}`.toLowerCase().includes(sessionQuery.trim().toLowerCase())
    ).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [selectedSessions, sessionQuery, sessionFilter, taskScope, taskSessionsKnown, taskSessions]);
  const selectedPendingSessions = useMemo(() => {
    if (!taskScope) return pendingSessions;
    return pendingSessions.filter((pending) => pending.taskNoteId === taskScope.noteId);
  }, [pendingSessions, taskScope]);
  const visiblePendingSessions = useMemo(() => selectedPendingSessions.filter((pending) =>
    `${pending.title} ${pending.provider}`.toLowerCase().includes(sessionQuery.trim().toLowerCase())
  ).sort((a, b) => b.createdAt - a.createdAt), [selectedPendingSessions, sessionQuery]);
  const visibleSessionRows = useMemo<WorkbenchSessionRow[]>(() => [
    ...visiblePendingSessions.map((pending) => ({ kind: "pending" as const, pending })),
    ...visibleSessions.map((session) => ({ kind: "session" as const, session }))
  ], [visiblePendingSessions, visibleSessions]);
  /** Left-panel note list: the task's note tree when filtered, else every note. */
  const visibleNotes = useMemo(() => {
    const q = noteQuery.trim().toLowerCase();
    return noteItems.filter((note) => {
      if (q && !note.title.toLowerCase().includes(q)) return false;
      if (noteFilter === "task" && taskScope) return taskNoteIds.has(note.noteId);
      return true;
    });
  }, [noteItems, noteQuery, noteFilter, taskScope, taskNoteIds]);
  /**
   * Reverse task ownership for the "all" lists. A note belongs to the nearest
   * task in its link-tree ancestry; a session belongs to the task whose
   * front-matter lists it.
   */
  const taskByNoteId = useMemo(() => {
    const map = new Map<string, WorkbenchTask>();
    const byNoteId = new Map(tasks.map((task) => [task.noteId, task] as const));
    const parentByChild = new Map(noteLinks.map((link) => [link.childNoteId, link.parentNoteId] as const));
    const ownerOf = (noteId: string): WorkbenchTask | undefined => {
      const seen = new Set<string>();
      let current = noteId;
      while (!seen.has(current)) {
        seen.add(current);
        const owner = byNoteId.get(current);
        if (owner) return owner;
        const parent = parentByChild.get(current);
        if (!parent) return undefined;
        current = parent;
      }
      return undefined;
    };
    for (const note of noteItems) {
      const owner = ownerOf(note.noteId);
      if (owner) map.set(note.noteId, owner);
    }
    return map;
  }, [tasks, noteLinks, noteItems]);
  const taskBySessionKey = useMemo(() => {
    const map = new Map<string, WorkbenchTask>();
    for (const task of tasks) {
      for (const key of task.sessions) map.set(key, task);
    }
    return map;
  }, [tasks]);
  const activeSessionRowIndex = useMemo(() => visibleSessionRows.findIndex((row) =>
    row.kind === "pending" ? row.pending.key === activeSessionKey : sessionKey(row.session) === activeSessionKey
  ), [activeSessionKey, visibleSessionRows]);
  useEffect(() => {
    const visibleKeys = new Set(catalogSessionKeysInRows(visibleSessionRows));
    setSelectedSessionKeys((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const key of current) {
        if (visibleKeys.has(key)) next.add(key);
        else changed = true;
      }
      return changed ? next : current;
    });
    setSelectionAnchorKey((current) => current && !visibleKeys.has(current) ? "" : current);
  }, [visibleSessionRows]);
  const activeScopeKey = workbenchScope(activeWorkbenchId) ?? paneProjectKey(selectedProject);
  const currentTerminals = terminals.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const currentSessionTerminals = currentTerminals.filter((pane) => pane.group === "session");
  const currentShellTerminals = currentTerminals.filter((pane) => pane.group === "terminal");
  const currentEditors = editors.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const currentDiffs = diffs.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const currentAcpChats = acpChats.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const currentBrowsers = browsers.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const currentNotePanes = notePanes.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const activePane = activePanes[activeScopeKey] || "";
  const activeTerminal = currentTerminals.find((pane) => pane.key === activePane);
  const currentEditor = currentEditors.find((pane) => pane.key === activePane);
  const currentDiff = currentDiffs.find((pane) => pane.key === activePane);
  const currentFilePath = workbenchActiveFilePath(selectedProject, currentEditor?.path, currentDiff);
  const currentAcpChat = currentAcpChats.find((pane) => pane.key === activePane);
  const currentNotePane = currentNotePanes.find((pane) => pane.key === activePane);
  /** The noteId whose pane is currently active (for row highlighting). */
  const activeNotePaneId = currentNotePane?.noteId ?? null;
  const activeTranscriptRunning = useMemo(() => {
    const paneKey = currentAcpChat?.key ?? activeTerminal?.key;
    if (!paneKey) return false;
    return sessionRuntimeByPaneKey.get(paneKey)?.status === "running";
  }, [activeTerminal, currentAcpChat, sessionRuntimeByPaneKey]);
  const prevTranscriptRunningRef = useRef(activeTranscriptRunning);
  useEffect(() => {
    if (prevTranscriptRunningRef.current && !activeTranscriptRunning) {
      if (pendingSessionsRef.current.length > 0) {
        triggerSessionSync();
      }
    }
    prevTranscriptRunningRef.current = activeTranscriptRunning;
  }, [activeTranscriptRunning, triggerSessionSync]);
  const toggleSessionViewMode = useCallback(() => {
    setSessionViewMode((current) => {
      const next = current === "hybrid" ? "terminal" : "hybrid";
      writeWorkbenchValue(SESSION_VIEW_MODE_KEY, activeWorkbenchIdRef.current, next);
      return next;
    });
  }, []);
  /** Prefer the active terminal's git info; fall back to any project terminal or status tracking. */
  const branchStatusTerminal = activeTerminal
    || currentTerminals.find((pane) => Boolean(pane.branch) || pane.gitMode === "nested")
    || null;
  const branchStatusNested = Boolean(
    branchStatusTerminal?.gitMode === "nested" && (branchStatusTerminal.nestedRepos?.length || 0) > 0
  );
  const branchStatusLabel = branchStatusNested
    ? t("desktop.workbench.nestedRepoCount", branchStatusTerminal?.nestedRepos?.length || 0)
    : (branchStatusTerminal?.branch || projectTracking?.branch || null);
  const branchStatusPane: TerminalPane | null = branchStatusTerminal || (
    selectedProject && branchStatusLabel
      ? {
        key: `project-git:${selectedProject}`,
        title: "",
        group: "terminal",
        cwd: gitRoot || selectedProject,
        projectPath: selectedProject,
        branch: projectTracking?.branch ?? null,
        repoRoot: gitRoot || projectTracking?.repoRoot || selectedProject,
        gitMode: git?.nestedRepos?.length ? "nested" : "direct",
        nestedRepos: (git?.nestedRepos || []).map((repo) => ({
          root: repo.root,
          displayPath: repo.displayPath,
          branch: git?.tracking?.find((item) => item.repoRoot === repo.root)?.branch ?? null
        }))
      }
      : null
  );

  editorFindQueryRef.current = editorFindQuery;

  const clearEditorFindSearch = useCallback(() => {
    editorRef.current?.clearSearch();
    setEditorFindResult(null);
  }, []);

  const runEditorFind = useCallback((
    direction: "forward" | "backward",
    query = editorFindQueryRef.current,
    reset = false
  ) => {
    const value = query.trim();
    if (!value) {
      clearEditorFindSearch();
      return { current: 0, total: 0 };
    }
    const result = reset
      ? (editorRef.current?.setSearchQuery(value) ?? { current: 0, total: 0 })
      : (editorRef.current?.navigateSearch(direction) ?? { current: 0, total: 0 });
    setEditorFindResult(result);
    window.requestAnimationFrame(() => editorFindInputRef.current?.focus());
    return result;
  }, [clearEditorFindSearch]);

  const openEditorFind = useCallback(() => {
    if (!currentEditor) return;
    const selectedText = editorRef.current?.getSelectedText().trim() || "";
    if (selectedText) {
      setEditorFindQuery(selectedText);
      editorFindQueryRef.current = selectedText;
      runEditorFind("forward", selectedText, true);
    } else if (editorFindQueryRef.current.trim()) {
      runEditorFind("forward", editorFindQueryRef.current, true);
    }
    setEditorFindOpen(true);
  }, [currentEditor, runEditorFind]);

  const closeEditorFind = useCallback(() => {
    setEditorFindOpen(false);
    setEditorFindQuery("");
    editorFindQueryRef.current = "";
    clearEditorFindSearch();
  }, [clearEditorFindSearch]);

  /** Map a workbench pane key to the catalog session row it represents, so
   *  activating a tab keeps the session-list highlight in sync (the reverse
   *  direction of clicking a wb-list-item). ACP chat panes encode their
   *  recordId in the key; session-group terminals carry their bound session,
   *  or a pending row while awaiting the catalog bind. */
  const workbenchPaneSessionKey = useCallback((paneKey: string): string => {
    if (!paneKey) return "";
    if (paneKey.startsWith("acp:")) return acpListSessionKey(paneKey.slice("acp:".length));
    const terminalPane = terminalsRef.current.find((pane) => pane.key === paneKey);
    if (terminalPane?.sessionKey) return terminalPane.sessionKey;
    return terminalPane?.group === "session" ? `pending:${paneKey}` : "";
  }, []);

  const setActivePane = useCallback((paneKey: string, projectPath = selectedProject) => {
    if (paneKey !== activePane && activePane.startsWith("editor:")) closeEditorFind();
    if (paneKey !== activePane) focusPaneAfterPtyRef.current = "";
    const projectKey = workbenchScope(activeWorkbenchIdRef.current) ?? paneProjectKey(projectPath);
    if (paneKey) {
      const previous = paneHistoryRef.current[projectKey] || [];
      paneHistoryRef.current[projectKey] = [paneKey, ...previous.filter((key) => key !== paneKey)].slice(0, 32);
    }
    setActivePanes((current) => current[projectKey] === paneKey ? current : { ...current, [projectKey]: paneKey });
    setActiveSessionKey(workbenchPaneSessionKey(paneKey));
  }, [activePane, closeEditorFind, selectedProject, workbenchPaneSessionKey]);

  const registerComposerFocus = useCallback((key: string, focus: (options?: { caret?: "end" }) => void) => {
    composerFocusRefs.current.set(key, focus);
    if (focusPaneAfterPtyRef.current === key) {
      const pane = terminalsRef.current.find((entry) => entry.key === key);
      if (pane?.ptyId != null) {
        focusPaneAfterPtyRef.current = "";
        window.requestAnimationFrame(() => focus());
      }
    }
    return () => {
      composerFocusRefs.current.delete(key);
    };
  }, []);

  const focusWorkbenchPane = useCallback((paneKey: string) => {
    if (!paneKey) return;
    if (focusPaneAfterPtyRef.current && focusPaneAfterPtyRef.current !== paneKey) {
      focusPaneAfterPtyRef.current = "";
    }
    window.requestAnimationFrame(() => {
      const terminalPane = terminalsRef.current.find((pane) => pane.key === paneKey);
      // Agent/TUI sessions route text entry to their composer; shell terminals
      // keep raw xterm focus.
      if (terminalPane?.group === "session" && terminalPane.ptyId != null) {
        const focusComposer = composerFocusRefs.current.get(paneKey);
        if (focusComposer) {
          focusComposer();
          return;
        }
        // Composer has not mounted yet — defer so onPty's PTY-ready focus
        // (which retries the composer) wins instead of falling to xterm.
        focusPaneAfterPtyRef.current = paneKey;
        return;
      }
      if (terminalPane?.ptyId != null) {
        terminalRefs.current.get(terminalPane.ptyId)?.focus();
        return;
      }
      if (terminalPane) {
        focusPaneAfterPtyRef.current = paneKey;
        return;
      }
      if (paneKey.startsWith("acp:")) {
        document.querySelector<HTMLTextAreaElement>(".wb-acp-chat:not([hidden]) .wb-acp-compose-input textarea")?.focus();
        return;
      }
      if (paneKey.startsWith("editor:")) {
        editorRef.current?.focus();
      }
    });
  }, []);

  const setComposerDraft = useCallback((paneKey: string, value: string) => {
    setComposerDrafts((current) => current[paneKey] === value ? current : { ...current, [paneKey]: value });
  }, []);

  const selectProject = (project: string | null, options?: { keepSessionKey?: boolean; keepSide?: boolean }) => {
    const projectChanged = selectedProjectRef.current !== project;
    selectedProjectRef.current = project;
    setSelectedProject((current) => {
      if (current === project) return current;
      return project;
    });
    try {
      if (project) {
        localStorage.setItem(PROJECT_KEY, project);
        localStorage.setItem(QUICK_ACCESS_PROJECT_KEY, project);
      }
      else localStorage.removeItem(PROJECT_KEY);
    } catch { /* persistence is optional */ }
    if (!options?.keepSessionKey) setActiveSessionKey("");
    if (projectChanged) {
      setSelectedSessionKeys((current) => current.size ? new Set() : current);
      setSelectionAnchorKey((current) => current ? "" : current);
    }
    if (!options?.keepSide && projectChanged) setSide(null);
    setGitLog(null);
    setGitShow(null);
    setGitHistoryContext(null);
    setGitLogLoading(false);
    setGitLogError("");
    gitLogRequestRef.current += 1;
  };

  const focusPendingSession = useCallback((pending: PendingWorkbenchSession) => {
    selectProject(pending.projectPath, { keepSessionKey: true });
    setActivePane(pending.terminalKey, pending.projectPath);
    setActiveSessionKey(pending.key);
  }, [setActivePane]);

  const addTerminal = useCallback((
    title: string,
    cwd: string,
    command?: string,
    projectPath = selectedProject || cwd,
    openedSessionKey?: string,
    group: Exclude<WorkbenchPaneGroup, "code" | "browser" | "note"> = openedSessionKey ? "session" : "terminal",
    launch?: { initialPrompt?: string; env?: Record<string, string> }
  ): string => {
    const key = `terminal:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const pane = { key, title, group, cwd, command, projectPath, sessionKey: openedSessionKey, workbenchId: activeWorkbenchIdRef.current ?? undefined, ...launch };
    terminalsRef.current = [...terminalsRef.current, pane];
    setTerminals((current) => [...current, pane]);
    setActivePane(key, projectPath);
    return key;
  }, [selectedProject, setActivePane]);

  const addPendingSession = useCallback((
    terminalKey: string,
    provider: AgentProvider,
    projectPath: string,
    title: string
  ) => {
    const pending: PendingWorkbenchSession = {
      key: `pending:${terminalKey}`,
      terminalKey,
      provider,
      projectPath,
      title,
      createdAt: Date.now(),
      knownSessionKeys: sessions.map(sessionKey),
      taskNoteId: taskScopeRef.current?.noteId
    };
    pendingSessionsRef.current = [...pendingSessionsRef.current, pending];
    setPendingSessions((current) => [...current, pending]);
  }, [sessions]);

  const refreshTerminalGit = useCallback(async (key: string) => {
    const pane = terminalsRef.current.find((item) => item.key === key);
    if (!pane) return;
    try {
      const workbench = settingsRef.current?.workbench;
      const info = await desktopApi().terminalGitInfo({
        cwd: pane.cwd,
        nestedScan: {
          maxDepth: workbench?.gitNestedScanMaxDepth,
          ignoreDirs: workbench?.gitNestedScanIgnoreDirs
        }
      });
      setTerminals((current) => current.map((item) => item.key === key ? {
        ...item,
        branch: info.branch,
        repoRoot: info.repoRoot,
        gitMode: info.mode,
        nestedRepos: info.nestedRepos
      } : item));
    } catch { /* Git status is supplementary to the terminal */ }
  }, []);
  useEffect(() => { refreshTerminalGitRef.current = refreshTerminalGit; }, [refreshTerminalGit]);

  const onTerminalInput = useCallback((key: string) => {
    const existing = gitRefreshTimers.current.get(key);
    if (existing) window.clearTimeout(existing);
    gitRefreshTimers.current.set(key, window.setTimeout(() => {
      gitRefreshTimers.current.delete(key);
      void refreshTerminalGit(key);
    }, 500));
    // User typing into a session TUI counts as immediate activity, and the
    // daemon sees the echoed bytes within a tick.
  }, [refreshTerminalGit]);

  const activateComposerPane = useCallback((paneKey: string) => {
    const pane = terminalsRef.current.find((item) => item.key === paneKey);
    if (!pane || pane.group !== "session") return;
    if (pane.projectPath !== selectedProjectRef.current) {
      selectProject(pane.projectPath, { keepSessionKey: true, keepSide: true });
    }
    setActivePane(paneKey, pane.projectPath);
  }, [setActivePane]);

  const sendComposerToTerminal = useCallback((paneKey: string) => {
    const pane = terminalsRef.current.find((item) => item.key === paneKey);
    if (!pane || pane.group !== "session") return;
    const text = (composerDrafts[paneKey] || "").trim();
    if (!text || pane.ptyId == null) return;
    if (pane.projectPath !== selectedProjectRef.current) {
      selectProject(pane.projectPath, { keepSessionKey: true, keepSide: true });
    }
    setActivePane(paneKey, pane.projectPath);
    const submitDirectly = sessionViewMode === "hybrid" && tuiCollapsed;
    void desktopApi().terminalInput({
      id: pane.ptyId,
      data: submitDirectly ? `${text}\r` : text
    });
    onTerminalInput(paneKey);
    const identity = sessionIdentityFromKey(pane.sessionKey);
    const localTip: ComposerSendTip = {
      id: `local:${paneKey}:${Date.now()}`,
      text,
      createdAtMs: Date.now()
    };
    const historyKey = composerHistoryKey(pane);
    setComposerTips((current) => {
      const existing = current[historyKey] || current[paneKey] || [];
      return { ...current, [historyKey]: [localTip, ...existing].slice(0, COMPOSER_TIP_LIMIT) };
    });
    const append = desktopApi().workbenchComposerSendAppend;
    if (typeof append === "function") {
      void append({
        paneKey,
        projectPath: pane.projectPath,
        sessionKey: pane.sessionKey || null,
        provider: identity?.provider || null,
        agentSessionId: identity?.sessionId || null,
        text
      }).then((record) => {
        setComposerTips((current) => {
          const existing = current[historyKey] || current[paneKey] || [];
          const withoutLocal = existing.filter((tip) => tip.id !== localTip.id);
          return {
            ...current,
            [historyKey]: [{ id: record.id, text: record.text, createdAtMs: record.createdAtMs }, ...withoutLocal].slice(0, COMPOSER_TIP_LIMIT)
          };
        });
      }).catch(() => undefined);
    }
    setTranscriptFocus({ text, sentAtMs: localTip.createdAtMs, nonce: Date.now() });
    if (!identity) {
      triggerSessionSync();
    }
    if (!submitDirectly) {
      window.requestAnimationFrame(() => {
        terminalRefs.current.get(pane.ptyId!)?.focus();
      });
    }
  }, [composerDrafts, onTerminalInput, sessionViewMode, setActivePane, tuiCollapsed]);

  const runComposerSlashCommand = useCallback((paneKey: string, command: TuiSlashCommand, args = "") => {
    const pane = terminalsRef.current.find((item) => item.key === paneKey);
    if (!pane || pane.group !== "session" || pane.ptyId == null) return;
    if (pane.projectPath !== selectedProjectRef.current) {
      selectProject(pane.projectPath, { keepSessionKey: true, keepSide: true });
    }
    setActivePane(paneKey, pane.projectPath);
    setComposerDraft(paneKey, "");
    void desktopApi().terminalInput({ id: pane.ptyId, data: formatTuiSlashInput(command.name, args) });
    onTerminalInput(paneKey);
    window.requestAnimationFrame(() => {
      terminalRefs.current.get(pane.ptyId!)?.focus();
    });
  }, [onTerminalInput, setActivePane, setComposerDraft]);

  const onPtyDetach = useCallback((id: number) => {
    terminalRefs.current.delete(id);
  }, []);

  const onPty = useCallback((key: string, id: number, terminal: Terminal | null) => {
    const livePane = terminalsRef.current.find((item) => item.key === key);
    if (!livePane) {
      // Spawn resolved after the tab was closed — kill the orphan PTY.
      void desktopApi().terminalDestroy({ id });
      return;
    }
    if (terminal) {
      terminalRefs.current.set(id, terminal);
    } else {
      terminalRefs.current.delete(id);
    }
    setTerminals((current) => {
      const next = current.map((pane) => pane.key === key ? { ...pane, ptyId: id } : pane);
      terminalsRef.current = next;
      return next;
    });
    if (!terminal) return;
    if (focusPaneAfterPtyRef.current === key) {
      const pane = terminalsRef.current.find((entry) => entry.key === key);
      window.requestAnimationFrame(() => {
        // Agent-session panes land in their composer once it has mounted
        // (setReady commits before the next frame); shells focus xterm.
        if (pane?.group === "session") {
          const tryFocus = (attempt = 0) => {
            const focusComposer = composerFocusRefs.current.get(key);
            if (focusComposer) {
              focusPaneAfterPtyRef.current = "";
              focusComposer();
              return;
            }
            if (attempt < 8) window.requestAnimationFrame(() => tryFocus(attempt + 1));
          };
          tryFocus();
          return;
        }
        focusPaneAfterPtyRef.current = "";
        terminal.focus();
      });
    }
    void refreshTerminalGit(key);
  }, [refreshTerminalGit]);

  const onInitialPromptSubmitted = useCallback((key: string) => {
    setTerminals((current) => {
      const next = current.map((pane) => pane.key === key ? { ...pane, initialPrompt: undefined } : pane);
      terminalsRef.current = next;
      return next;
    });
  }, []);

  const nextPaneAfterClose = useCallback((
    scopeKey: string,
    closedKey: string,
    options?: {
      remainingTerminals?: TerminalPane[];
      remainingAcp?: AcpChatPane[];
      remainingEditors?: EditorPane[];
      remainingDiffs?: DiffPane[];
      remainingBrowsers?: BrowserPane[];
    }
  ) => {
    const history = (paneHistoryRef.current[scopeKey] || []).filter((item) => item !== closedKey);
    paneHistoryRef.current[scopeKey] = history;
    const remainingTerminals =
      options?.remainingTerminals ??
      terminals.filter((item) => paneScopeKey(item) === scopeKey && item.key !== closedKey);
    const remainingAcp =
      options?.remainingAcp ?? acpChats.filter((item) => paneScopeKey(item) === scopeKey && item.key !== closedKey);
    const projectEditors = options?.remainingEditors
      ?? editors.filter((item) => paneScopeKey(item) === scopeKey && item.key !== closedKey);
    const projectDiffs = options?.remainingDiffs
      ?? diffs.filter((item) => paneScopeKey(item) === scopeKey && item.key !== closedKey);
    const remainingBrowsers = options?.remainingBrowsers
      ?? browsers.filter((item) => paneScopeKey(item) === scopeKey && item.key !== closedKey);
    const closedGroup: WorkbenchPaneGroup | null =
      terminals.find((item) => item.key === closedKey)?.group
      ?? (acpChats.some((item) => item.key === closedKey) ? "session" : null)
      ?? (browsers.some((item) => item.key === closedKey) ? "browser" : null)
      ?? (editors.some((item) => item.key === closedKey) || diffs.some((item) => item.key === closedKey) ? "code" : null);
    const groupsByKey = new Map<string, WorkbenchPaneGroup>([
      ...remainingTerminals.map((item) => [item.key, item.group] as const),
      ...remainingAcp.map((item) => [item.key, "session"] as const),
      ...projectEditors.map((item) => [item.key, "code"] as const),
      ...projectDiffs.map((item) => [item.key, "code"] as const),
      ...remainingBrowsers.map((item) => [item.key, "browser"] as const)
    ]);
    const liveKeys = new Set([
      ...remainingTerminals.map((item) => item.key),
      ...remainingAcp.map((item) => item.key),
      ...projectEditors.map((item) => item.key),
      ...projectDiffs.map((item) => item.key),
      ...remainingBrowsers.map((item) => item.key)
    ]);
    const nextPane =
      history.find((item) => liveKeys.has(item) && groupsByKey.get(item) === closedGroup) ||
      history.find((item) => liveKeys.has(item)) ||
      remainingTerminals[remainingTerminals.length - 1]?.key ||
      remainingAcp[remainingAcp.length - 1]?.key ||
      projectEditors[0]?.key ||
      projectDiffs[0]?.key ||
      remainingBrowsers[remainingBrowsers.length - 1]?.key ||
      "";
    if (nextPane) {
      paneHistoryRef.current[scopeKey] = [nextPane, ...history.filter((item) => item !== nextPane)].slice(0, 32);
    }
    const wasActive = activePanesRef.current[scopeKey] === closedKey;
    setActivePanes((current) => (current[scopeKey] === closedKey ? { ...current, [scopeKey]: nextPane } : current));
    // Closing the active pane switches which session row should be highlighted.
    if (wasActive) setActiveSessionKey(workbenchPaneSessionKey(nextPane));
  }, [acpChats, browsers, diffs, editors, terminals, workbenchPaneSessionKey]);

  const closeTerminal = useCallback((key: string) => {
    const pane = terminalsRef.current.find((item) => item.key === key);
    if (pane?.ptyId) {
      terminalRefs.current.delete(pane.ptyId);
      terminalMouseTrackingRef.current.delete(pane.ptyId);
      void desktopApi().terminalDestroy({ id: pane.ptyId });
    }
    const remaining = terminalsRef.current.filter((item) => item.key !== key);
    terminalsRef.current = remaining;
    setTerminals(remaining);
    setComposerDrafts((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setComposerTips((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPendingSessions((current) => current.filter((pending) => pending.terminalKey !== key));
    if (pane) {
      deferSessionPaneAutoRename(pane);
      nextPaneAfterClose(paneScopeKey(pane), key, {
        remainingTerminals: remaining.filter((item) => paneScopeKey(item) === paneScopeKey(pane))
      });
    }
  }, [deferSessionPaneAutoRename, nextPaneAfterClose]);

  const closeAcpChat = useCallback((key: string) => {
    const pane = acpChats.find((item) => item.key === key);
    setAcpChats((current) => current.filter((item) => item.key !== key));
    if (pane) {
      deferSessionPaneAutoRename(pane);
      void desktopApi().acpDisconnect({ chatId: pane.recordId });
      nextPaneAfterClose(paneScopeKey(pane), key, {
        remainingAcp: acpChats.filter((item) => paneScopeKey(item) === paneScopeKey(pane) && item.key !== key)
      });
    }
  }, [acpChats, deferSessionPaneAutoRename, nextPaneAfterClose]);

  const closeEditor = useCallback((key: string) => {
    const pane = editors.find((item) => item.key === key);
    if (!pane) return;
    const close = () => {
      if (activePane === key) closeEditorFind();
      const remainingEditors = editors.filter((item) => item.key !== key);
      setEditors(remainingEditors);
      nextPaneAfterClose(paneScopeKey(pane), key, { remainingEditors });
    };
    if (!pane.dirty) {
      close();
      return;
    }
    // Native discard prompt: it resolves before the pane is torn down.
    void (async () => {
      if (await confirmDestructive(t("desktop.workbench.fileDiscardConfirm", basename(pane.path)), t("desktop.common.discard"))) {
        close();
      }
    })();
  }, [activePane, closeEditorFind, editors, nextPaneAfterClose, t]);

  const closeDiff = useCallback((key: string) => {
    const pane = diffs.find((item) => item.key === key);
    if (!pane) return;
    const remainingDiffs = diffs.filter((item) => item.key !== key);
    setDiffs(remainingDiffs);
    nextPaneAfterClose(paneScopeKey(pane), key, { remainingDiffs });
  }, [diffs, nextPaneAfterClose]);

  const addAcpChat = useCallback((record: {
    id: string;
    title: string;
    provider: string;
    projectPath: string;
  }, launch?: { initialPrompt?: string }) => {
    const key = `acp:${record.id}`;
    const projectPath = record.projectPath;
    const initialPrompt = launch?.initialPrompt?.trim() || undefined;
    setAcpChats((current) => {
      if (current.some((pane) => pane.key === key)) {
        if (!initialPrompt) return current;
        return current.map((pane) => pane.key === key && !pane.initialPrompt ? { ...pane, initialPrompt } : pane);
      }
      return [
        ...current,
        {
          key,
          recordId: record.id,
          title: record.title || t("desktop.workbench.acpChat"),
          provider: record.provider,
          projectPath,
          workbenchId: activeWorkbenchIdRef.current ?? undefined,
          ...(initialPrompt ? { initialPrompt } : {})
        }
      ];
    });
    setActivePane(key, projectPath);
  }, [setActivePane, t]);

  /**
   * Record a session started while a task is open as one of its sessions.
   * The session's own cwd is always safe to pass: the main process drops the
   * panel's internal workspace directory instead of treating it as a repository.
   */
  const linkSessionToOpenTask = useCallback((sessionKey: string, projectPath: string) => {
    const noteId = taskScopeRef.current?.noteId;
    if (!noteId || typeof desktopApi().notesLinkSessionToTask !== "function") return;
    void desktopApi().notesLinkSessionToTask({ noteId, sessionKey, projectPath })
      .then(() => { window.dispatchEvent(new Event("agent-resume:notes-mutated")); })
      .catch(() => undefined);
    recordSessionInWorkbench(activeWorkbenchIdRef.current, sessionKey);
  }, []);

  const closeBrowser = useCallback((key: string) => {
    const pane = browsers.find((item) => item.key === key);
    if (!pane) return;
    setBrowsers((current) => current.filter((item) => item.key !== key));
    void desktopApi().browserDestroy({ browserId: pane.browserId }).catch(() => undefined);
    nextPaneAfterClose(paneScopeKey(pane), key, {
      remainingBrowsers: browsers.filter((item) => paneScopeKey(item) === paneScopeKey(pane) && item.key !== key)
    });
  }, [browsers, nextPaneAfterClose]);

  const openBrowser = useCallback(async (targetProject?: string, startUrl?: string) => {
    const projectPath = targetProject || selectedProject;
    if (!projectPath) {
      setStatus({ text: t("desktop.workbench.selectProjectHint"), kind: "error" });
      return;
    }
    try {
      const session = await desktopApi().browserCreate({
        projectPath,
        startUrl,
        surface: "workbench"
      });
      const key = `browser:${session.id}`;
      setBrowsers((current) => {
        if (current.some((pane) => pane.key === key)) return current;
        return [
          ...current,
          {
            key,
            title: session.tabs[0]?.title || t("desktop.browser.newTab"),
            group: "browser",
            browserId: session.id,
            projectPath,
            workbenchId: activeWorkbenchIdRef.current ?? undefined,
            startUrl,
            surfaceKind: session.surface.kind
          }
        ];
      });
      setActivePane(key, projectPath);
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [selectedProject, setActivePane, t]);

  // Auto-register browser panes created outside the Workbench UI (MCP browser_open,
  // agent-driven sessions, standalone window dock-back). Without this the pane has no
  // host/bounds reporting, so the live WebContentsView never attaches and the group is blank.
  useEffect(() => {
    if (typeof desktopApi().onBrowserEvent !== "function") return;
    const upsertPane = (session: BrowserSessionState) => {
      setBrowsers((current) => {
        const key = `browser:${session.id}`;
        const title =
          session.tabs.find((tab) => tab.tabId === session.activeTabId)?.title ||
          session.tabs[0]?.title ||
          t("desktop.browser.newTab");
        const existing = current.find((pane) => pane.key === key);
        if (!existing) {
          return [
            ...current,
            {
              key,
              title,
              group: "browser" as const,
              browserId: session.id,
              projectPath: session.projectPath,
              workbenchId: activeWorkbenchIdRef.current ?? undefined,
              surfaceKind: session.surface.kind
            }
          ];
        }
        return current.map((pane) =>
          pane.key === key
            ? { ...pane, title, surfaceKind: session.surface.kind }
            : pane
        );
      });
    };
    const off = desktopApi().onBrowserEvent((event) => {
      if (event.type === "state") {
        upsertPane(event.session);
        return;
      }
      if (event.type === "surface") {
        void desktopApi()
          .browserGet({ browserId: event.browserId })
          .then((session) => {
            if (session) upsertPane(session);
          })
          .catch(() => undefined);
      }
    });
    return off;
  }, [t]);

  const updateNotePaneTitle = useCallback((noteId: string, title: string) => {
    setNotePanes((current) => current.map((pane) => pane.noteId === noteId ? { ...pane, title } : pane));
  }, []);

  const setNotePaneDirty = useCallback((noteId: string, dirty: boolean) => {
    setNotePanes((current) => current.map((pane) => pane.noteId === noteId ? { ...pane, dirty } : pane));
  }, []);

  /** Open (or focus) a note as an editing tab in the pane tab groups. */
  const openNotePane = useCallback((noteId: string, title?: string) => {
    if (!noteId) return;
    const workbenchId = activeWorkbenchIdRef.current ?? undefined;
    const key = workbenchId ? `note:${workbenchId}:${noteId}` : `note:${noteId}`;
    setNotePanes((current) => current.some((pane) => pane.key === key)
      ? current
      : [...current, { key, noteId, projectPath: selectedProjectRef.current, title: title || "", workbenchId }]);
    setActivePane(key);
    if (!title) {
      void desktopApi().notesRead({ noteId }).then((result) => {
        updateNotePaneTitle(noteId, result.record.title || result.record.filename.replace(/\.md$/i, "") || noteId);
      }).catch(() => undefined);
    }
  }, [setActivePane, updateNotePaneTitle]);

  const closeNotePane = useCallback((key: string) => {
    const remaining = notePanesRef.current.filter((item) => item.key !== key);
    notePanesRef.current = remaining;
    setNotePanes(remaining);
    setActivePanes((current) => {
      let changed = false;
      const next = { ...current };
      for (const [projectKey, activeKey] of Object.entries(current)) {
        if (activeKey !== key) continue;
        next[projectKey] = remaining[remaining.length - 1]?.key || "";
        changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  /** Add an extra note under the current task (a linked child note) and open it. */
  const addChildNote = useCallback(async () => {
    const parentNoteId = taskScopeRef.current?.noteId;
    if (!parentNoteId) return;
    if (typeof desktopApi().notesCreateLinkedChild !== "function") return;
    try {
      const created = await desktopApi().notesCreateLinkedChild({ parentNoteId });
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      openNotePane(created.noteId);
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [openNotePane]);

  /** “New note” in the left panel: a child of the task, else a standalone library note. */
  const addNote = useCallback(async () => {
    const api = desktopApi();
    const parentNoteId = taskScopeRef.current?.noteId;
    try {
      const created = parentNoteId && typeof api.notesCreateLinkedChild === "function"
        ? await api.notesCreateLinkedChild({ parentNoteId })
        : typeof api.notesCreate === "function"
          ? await api.notesCreate({ scope: "library" })
          : null;
      if (!created) return;
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      openNotePane(created.noteId);
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [openNotePane]);

  const closeActivePane = useCallback((): boolean => {
    if (!activePane) return false;
    if (activePane.startsWith("terminal:")) {
      closeTerminal(activePane);
    } else if (activePane.startsWith("acp:")) {
      closeAcpChat(activePane);
    } else if (activePane.startsWith("editor:")) {
      closeEditor(activePane);
    } else if (activePane.startsWith("browser:")) {
      closeBrowser(activePane);
    } else if (activePane.startsWith("note:")) {
      closeNotePane(activePane);
    } else {
      closeDiff(activePane);
    }
    return true;
  }, [activePane, closeAcpChat, closeBrowser, closeDiff, closeEditor, closeNotePane, closeTerminal]);

  const openBlankTerminal = useCallback(async (targetProject?: string) => {
    if (terminalCreating) return;
    setTerminalCreating(true);
    try {
      const cwd = targetProject || selectedProject || await desktopApi().createScratchDir();
      if (!selectedProject) selectProject(cwd);
      addTerminal(t("desktop.workbench.terminalLabel", currentShellTerminals.length + 1), cwd, undefined, cwd);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { setTerminalCreating(false); }
  }, [addTerminal, currentShellTerminals.length, selectedProject, t, terminalCreating]);

  const parseNewSessionTarget = useCallback((rawValue: string): WorkbenchNewSessionTarget | null => {
    const raw = rawValue.trim();
    if (raw.startsWith("acp:")) {
      const provider = raw.slice(4);
      if (["claude", "codex", "grok", "opencode", "pi", "prime"].includes(provider)) {
        return { channel: "acp", provider };
      }
    }
    if (raw.startsWith("cli:")) {
      return { channel: "cli", provider: (raw.slice(4) || "codex") as AgentProvider };
    }
    return null;
  }, []);

  const resolveNewSessionTarget = useCallback((): WorkbenchNewSessionTarget | null => {
    const workbench = settings?.workbench;
    const raw = String(workbench?.defaultNewSessionTarget ?? "").trim();
    if (workbench && Object.prototype.hasOwnProperty.call(workbench, "defaultNewSessionTarget") && raw === "") {
      return null;
    }
    const target = parseNewSessionTarget(raw);
    if (target) return target;
    return {
      channel: "cli",
      provider: (workbench?.defaultNewSessionProvider || "codex") as AgentProvider
    };
  }, [parseNewSessionTarget, settings?.workbench]);

  /**
   * New-session cwd: an explicit target, the selected project, or — when a work
   * item is open with no project chosen — the task's own neutral workspace
   * (deterministic, not a throwaway scratch dir).
   */
  const resolveNewSessionCwd = useCallback(async (targetProject?: string): Promise<{ cwd: string; isWorkspace: boolean }> => {
    if (targetProject) return { cwd: targetProject, isWorkspace: false };
    const scope = taskScopeRef.current;
    if (scope) {
      // An explicit chip choice always wins.
      const explicit = sessionTargetRef.current;
      if (explicit) return { cwd: explicit, isWorkspace: false };
      const projects = scopeProjectsRef.current;
      // Exactly one repository → the task has an unambiguous cwd.
      if (projects.length === 1) return { cwd: projects[0], isWorkspace: false };
      // Several (or none) → the neutral workspace; the address table tells the
      // agent where each repository lives.
      if (typeof desktopApi().notesEnsureTaskWorkspace === "function") {
        try {
          const { dir } = await desktopApi().notesEnsureTaskWorkspace({ noteId: scope.noteId });
          if (dir) return { cwd: dir, isWorkspace: true };
        } catch {
          /* fall through */
        }
      }
    }
    if (selectedProject) return { cwd: selectedProject, isWorkspace: false };
    return { cwd: await desktopApi().createScratchDir(), isWorkspace: false };
  }, [selectedProject]);

  const launchNewSession = useCallback(async (
    target: WorkbenchNewSessionTarget,
    targetProject?: string,
    projectId?: string,
    initialPrompt?: string,
    mentionId?: string
  ) => {
    if (terminalCreating) return;
    setTerminalCreating(true);
    try {
      const mentions = settings?.workbench?.composerMentions ?? [];
      const explicitMention = resolveComposerMention(mentions, mentionId || "");
      const resolvedCwd = explicitMention
        ? { cwd: explicitMention.cwd, isWorkspace: false }
        : await resolveNewSessionCwd(targetProject);
      let cwd = resolvedCwd.cwd;
      if (!explicitMention && projectId && typeof desktopApi().resolveProjectCwd === "function") {
        const resolved = await desktopApi().resolveProjectCwd({ projectId });
        if (resolved.source === "missing" || !resolved.cwd) {
          setStatus({ text: t("desktop.workbench.pathMissingHint"), kind: "error" });
          return;
        }
        cwd = resolved.cwd;
      }
      const mention = explicitMention || matchComposerMentionForCwd(mentions, cwd);
      if (mention) cwd = mention.cwd;
      if (taskScopeRef.current && !resolvedCwd.isWorkspace) selectProject(cwd, { keepSessionKey: true });
      const prompt = [mention ? buildComposerMentionPrompt(mention) : "", initialPrompt?.trim() || ""]
        .filter(Boolean)
        .join("\n\n");
      if (target.channel === "acp") {
        const record = await desktopApi().acpCreateSession({ projectPath: cwd, provider: target.provider });
        addAcpChat(record, prompt ? { initialPrompt: prompt } : undefined);
        linkSessionToOpenTask(acpListSessionKey(record.id), cwd);
        await reloadWorkbench();
      } else {
        const result = await desktopApi().workbenchNewSession({
          cwd,
          provider: target.provider as AgentProvider,
          executionMode: "standard",
          ...(taskScopeRef.current?.noteId ? { taskNoteId: taskScopeRef.current.noteId } : {})
        });
        if (result.unsupportedYolo || result.warning) {
          notifyDesktop({
            text: t("desktop.workbench.yoloNotSupported", target.provider),
            kind: "info"
          });
        }
        if (result.external || result.mode === "external-system") {
          setStatus({
            text: prompt
              ? t("desktop.notes.sendSelectionExternal")
              : result.copied
                ? t("desktop.workbench.externalCommandCopied")
                : result.command || t("desktop.workbench.externalTerminalHint"),
            kind: prompt ? "warning" : "ok"
          });
          await loadSessions();
          return;
        }
        if (result.mode === "xterm" && result.command) {
          const launchCwd = result.cwd || cwd;
          const title = t("desktop.workbench.newSessionTitle", basename(launchCwd));
          const terminalKey = addTerminal(title, launchCwd, result.command, launchCwd, undefined, "session", { initialPrompt: prompt, env: result.env });
          addPendingSession(terminalKey, target.provider, launchCwd, title);
          setSessionViewMode("hybrid");
          writeWorkbenchValue(SESSION_VIEW_MODE_KEY, activeWorkbenchIdRef.current, "hybrid");
        }
        await loadSessions();
      }
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { setTerminalCreating(false); }
  }, [addAcpChat, addPendingSession, addTerminal, linkSessionToOpenTask, loadSessions, reloadWorkbench, settings?.workbench?.composerMentions, t, terminalCreating]);

  const requestNewSession = useCallback(async (targetProject?: string, projectId?: string) => {
    if (terminalCreating) return;
    const target = resolveNewSessionTarget();
    const mentions = settings?.workbench?.composerMentions ?? [];
    if (!target) {
      setNewSessionPicker({ projectPath: targetProject, projectId });
      return;
    }
    if (mentions.length) {
      setNewSessionPicker({ projectPath: targetProject, projectId, agentTarget: target });
      return;
    }
    await launchNewSession(target, targetProject, projectId);
  }, [launchNewSession, resolveNewSessionTarget, settings?.workbench?.composerMentions, terminalCreating]);

  const newSession = useCallback(() => requestNewSession(), [requestNewSession]);

  const chooseNewSessionTarget = useCallback(async (rawTarget: string) => {
    const target = parseNewSessionTarget(rawTarget);
    const picker = newSessionPicker;
    if (!target || !picker) return;
    setNewSessionPicker(null);
    await launchNewSession(target, picker.projectPath, picker.projectId, undefined, picker.mentionId);
  }, [launchNewSession, newSessionPicker, parseNewSessionTarget]);

  const chooseNewSessionMention = useCallback(async (mentionId?: string) => {
    const picker = newSessionPicker;
    if (!picker) return;
    if (picker.agentTarget) {
      setNewSessionPicker(null);
      await launchNewSession(picker.agentTarget, picker.projectPath, picker.projectId, undefined, mentionId);
      return;
    }
    setNewSessionPicker({ ...picker, mentionId });
  }, [launchNewSession, newSessionPicker]);

  const queueTerminalPrompt = useCallback((paneKey: string, text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    setTerminals((current) => {
      const next = current.map((pane) => pane.key === paneKey ? { ...pane, initialPrompt: prompt } : pane);
      terminalsRef.current = next;
      return next;
    });
  }, []);

  const sendSelectionToOpenPane = useCallback((paneKey: string, text: string) => {
    const prompt = text.trim();
    if (!prompt) return false;
    const terminal = terminalsRef.current.find((pane) => pane.key === paneKey);
    if (terminal) {
      selectProject(terminal.projectPath, { keepSessionKey: true });
      setActivePane(terminal.key, terminal.projectPath);
      if (terminal.sessionKey) setActiveSessionKey(terminal.sessionKey);
      focusWorkbenchPane(terminal.key);
      if (terminal.ptyId != null) {
        void desktopApi().terminalInput({ id: terminal.ptyId, data: `${prompt}\r` });
      } else {
        queueTerminalPrompt(terminal.key, prompt);
      }
      return true;
    }
    const chat = acpChatsRef.current.find((pane) => pane.key === paneKey);
    if (chat) {
      selectProject(chat.projectPath, { keepSessionKey: true });
      setActivePane(chat.key, chat.projectPath);
      setActiveSessionKey(acpListSessionKey(chat.recordId));
      focusWorkbenchPane(chat.key);
      setAcpChats((current) => current.map((pane) => pane.key === paneKey ? { ...pane, initialPrompt: prompt } : pane));
      return true;
    }
    return false;
  }, [focusWorkbenchPane, queueTerminalPrompt, selectProject, setActivePane]);

  const handleSelectionSend = useCallback((payload: WorkbenchSendSelectionRequest) => {
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    if (payload.kind === "existing-session") {
      if (!sendSelectionToOpenPane(payload.paneKey, payload.text)) {
        setStatus({ text: t("desktop.notes.sendSelectionMissingSession"), kind: "error" });
      }
      return;
    }
    const target = parseNewSessionTarget(payload.target);
    if (!target) {
      setStatus({ text: t("desktop.notes.sendSelectionMissingSession"), kind: "error" });
      return;
    }
    void launchNewSession(target, payload.projectPath, undefined, payload.text);
  }, [launchNewSession, parseNewSessionTarget, sendSelectionToOpenPane, setStatus, t]);

  useEffect(() => {
    const api = desktopApi();
    if (typeof api.onWorkbenchSendSelection !== "function") return;
    return api.onWorkbenchSendSelection((payload) => handleSelectionSend(payload));
  }, [handleSelectionSend]);

  const handleNewSessionPickerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')];
    if (!buttons.length) return;
    event.preventDefault();
    const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }, []);

  useEffect(() => desktopApi().onWorkbenchCmdT(() => {
    if (!active) return;
    if (settings?.workbench?.cmdTAction === "newSession") void newSession();
    else void openBlankTerminal();
  }), [active, newSession, openBlankTerminal, settings?.workbench?.cmdTAction]);

  useEffect(() => {
    if (typeof window.agentResume.setWorkbenchActive !== "function") return;
    window.agentResume.setWorkbenchActive(active && Boolean(activePane));
    return () => window.agentResume.setWorkbenchActive(false);
  }, [active, activePane]);

  useEffect(() => desktopApi().onWorkbenchCmdW(() => {
    if (!active) return;
    if (closeActivePane()) return;
    // A workbench window with no pane left to close is the window itself.
    if (document.documentElement.dataset.windowMode === "task") void desktopApi().taskWindowClose();
  }), [active, closeActivePane]);

  /**
   * Closing a workbench window flushes its unsaved editor buffers first; if one
   * cannot be saved, the window stays open rather than dropping the edit.
   */
  useEffect(() => {
    if (document.documentElement.dataset.windowMode !== "task") return;
    const stop = desktopApi().onTaskWindowCloseRequested?.(() => {
      void (async () => {
        const dirty = editorsRef.current.filter((pane) => pane.dirty).map((pane) => pane.key);
        for (const key of dirty) {
          try { await saveEditorRef.current(key); } catch { /* reported by the editor status */ }
        }
        const stillDirty = editorsRef.current.some((pane) => pane.dirty);
        await desktopApi().taskWindowCloseReady?.({ ok: !stillDirty }).catch(() => undefined);
      })();
    });
    return () => stop?.();
  }, []);

  /** ⌘⇧F / Ctrl+Shift+F — open Find in Files (Search side panel). */
  useEffect(() => {
    const openSearchPanel = () => {
      if (!active) return;
      setSearchProjectMode(false);
      setSearchProjectQuery("");
      setSide("search");
      window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    const unsub =
      typeof desktopApi().onWorkbenchCmdShiftF === "function"
        ? desktopApi().onWorkbenchCmdShiftF(openSearchPanel)
        : () => undefined;
    // Renderer fallback when main bridge is unavailable (tests / older preload).
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active) return;
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      openSearchPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      unsub();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!active || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "w") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      closeActivePane();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, closeActivePane]);

  useEffect(() => {
    if (!editorFindOpen) return;
    window.requestAnimationFrame(() => {
      editorFindInputRef.current?.focus();
      editorFindInputRef.current?.select();
    });
  }, [editorFindOpen]);

  useEffect(() => {
    const editorKey = currentEditor?.key || "";
    if (previousEditorKeyRef.current && previousEditorKeyRef.current !== editorKey) closeEditorFind();
    previousEditorKeyRef.current = editorKey;
  }, [closeEditorFind, currentEditor?.key]);

  useEffect(() => {
    if (!active || !currentEditor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isFind = (event.metaKey || event.ctrlKey)
        && !event.shiftKey
        && !event.altKey
        && event.key.toLowerCase() === "f";
      if (isFind) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openEditorFind();
        return;
      }
      if (!editorFindOpen) return;
      const input = editorFindInputRef.current;
      if (input && event.key === "Enter" && !event.isComposing && event.target === input) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        runEditorFind(event.shiftKey ? "backward" : "forward", input.value);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        closeEditorFind();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, closeEditorFind, currentEditor, editorFindOpen, openEditorFind, runEditorFind]);

  /** Sessions already auto-imported into composer_sends this app run (append-only dedupe happens in core too). */
  const composerImportKeysRef = useRef(new Set<string>());

  const autoImportComposerSends = (session: AgentSession) => {
    const key = `${session.provider}:${session.id}`;
    if (composerImportKeysRef.current.has(key)) return;
    const fn = desktopApi().workbenchComposerSendImport;
    if (typeof fn !== "function") return;
    composerImportKeysRef.current.add(key);
    void fn({ provider: session.provider, id: session.id })
      .then((result) => {
        if (result.imported > 0) {
          loadComposerTipsFromDb();
        }
      })
      .catch(() => undefined);
  };

  // Restore-triggered composer panes (app reload / session pane reopen) do not
  // pass through openSession. When a session-bound pane shows no DB history,
  // auto-import its transcript user inputs once per app run.
  useEffect(() => {
    const sessionPanes = terminalsRef.current.filter((pane) => pane.group === "session" && pane.sessionKey);
    if (!sessionPanes.length) return;
    for (const pane of sessionPanes) {
      const key = composerHistoryKey(pane);
      const tips = composerTips[key] || composerTips[pane.key] || [];
      if (tips.length) continue;
      const identity = sessionIdentityFromKey(pane.sessionKey);
      if (!identity) continue;
      const importKey = `${identity.provider}:${identity.sessionId}`;
      if (composerImportKeysRef.current.has(importKey)) continue;
      composerImportKeysRef.current.add(importKey);
      const fn = desktopApi().workbenchComposerSendImport;
      if (typeof fn !== "function") continue;
      void fn({ provider: identity.provider, id: identity.sessionId })
        .then((result) => {
          if (result.imported > 0) loadComposerTipsFromDb();
        })
        .catch(() => undefined);
    }
  }, [composerTips, loadComposerTipsFromDb]);

  const openSession = async (session: AgentSession) => {
    const key = sessionKey(session);

    if (isAcpSession(session)) {
      const projectPath = session.projectPath || "";
      const existingAcp = acpChats.find((pane) => pane.recordId === session.id);
      if (existingAcp) {
        selectProject(existingAcp.projectPath || projectPath, { keepSessionKey: true });
        setActivePane(existingAcp.key, existingAcp.projectPath || projectPath);
        setActiveSessionKey(key);
        return;
      }
      if (openingSessionKeysRef.current.has(key)) return;
      openingSessionKeysRef.current.add(key);
      setActiveSessionKey(key);
      try {
        if (projectPath) selectProject(projectPath, { keepSessionKey: true });
        addAcpChat({
          id: session.id,
          title: session.title || session.id,
          provider: session.acpProvider || "claude",
          projectPath: projectPath || session.projectPath
        });
        setActiveSessionKey(key);
        autoImportComposerSends(session);
      } catch (error) {
        setStatus({ text: statusError(error), kind: "error" });
      } finally {
        openingSessionKeysRef.current.delete(key);
      }
      return;
    }

    const existing = terminalsRef.current.find((pane) => pane.sessionKey === key);
    if (existing) {
      selectProject(existing.projectPath, { keepSessionKey: true });
      setActivePane(existing.key, existing.projectPath);
      setActiveSessionKey(key);
      return;
    }
    if (openingSessionKeysRef.current.has(key)) return;
    openingSessionKeysRef.current.add(key);
    setActiveSessionKey(key);
    try {
      const result = await desktopApi().workbenchOpenSession({ provider: session.provider, id: session.id });
      // Main may return ACP for chat rows when opened via generic resume path.
      if (result.mode === "acp" && result.acp) {
        const acpProject = session.projectPath || result.cwd || "";
        if (acpProject) selectProject(acpProject, { keepSessionKey: true });
        addAcpChat({
          id: result.acp.chatId,
          title: result.acp.title || session.title || session.id,
          provider: result.acp.provider || session.acpProvider || "claude",
          projectPath: acpProject
        });
        setActiveSessionKey(key);
        autoImportComposerSends(session);
        return;
      }
      if (result.external || result.mode === "external-system") {
        setStatus({ text: result.command || t("desktop.workbench.externalTerminalHint"), kind: "ok" });
        return;
      }
      const cwd = (result.cwd || session.projectPath || "").trim();
      const command = (result.command || "").trim();
      if (!cwd) {
        setStatus({ text: t("desktop.workbench.pathMissingHint"), kind: "error" });
        return;
      }
      if (!command) {
        setStatus({ text: t("desktop.workbench.resumeCommandMissing"), kind: "error" });
        return;
      }
      // UI activation follows the assigned project (user-move aware); the shell
      // still runs in the native cwd where the agent's data lives.
      const projectPath = session.projectPath?.trim() || cwd;
      selectProject(projectPath, { keepSessionKey: true });
      const terminalKey = addTerminal(session.title || session.id, cwd, command, projectPath, key);
      setSessionViewMode("hybrid");
      writeWorkbenchValue(SESSION_VIEW_MODE_KEY, activeWorkbenchIdRef.current, "hybrid");
      // Box-primary: an agent session pane lands text entry in its composer
      // (deferred until the PTY spawns). Shell panes keep raw xterm focus.
      focusWorkbenchPane(terminalKey);
      setActiveSessionKey(key);
      autoImportComposerSends(session);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { openingSessionKeysRef.current.delete(key); }
  };

  // Keep the openSession listener attached to the latest closure (openSession is not memoized).
  openSessionRef.current = openSession;

  /** Complete xterm resume from Agent citation/tool (command already resolved by main). */
  const openResumeFromAgent = useCallback((detail: {
    provider: string;
    id: string;
    command: string;
    cwd: string;
    title?: string;
    projectPath?: string;
    initialPrompt?: string;
  }) => {
    const key = `${detail.provider}:${detail.id}`;
    const existing = terminalsRef.current.find((pane) => pane.sessionKey === key);
    if (existing) {
      selectProject(existing.projectPath);
      setActivePane(existing.key, existing.projectPath);
      setActiveSessionKey(key);
      focusWorkbenchPane(existing.key);
      if (detail.initialPrompt && existing.ptyId) {
        window.setTimeout(() => {
          void desktopApi().terminalInput({ id: existing.ptyId!, data: `${detail.initialPrompt}\r` });
        }, 250);
      }
      return;
    }
    const projectPath = detail.projectPath || detail.cwd;
    selectProject(projectPath);
    const paneKey = addTerminal(detail.title || detail.id, detail.cwd, detail.command, projectPath, key, "session", detail.initialPrompt ? { initialPrompt: detail.initialPrompt } : undefined);
    setSessionViewMode("hybrid");
    writeWorkbenchValue(SESSION_VIEW_MODE_KEY, activeWorkbenchIdRef.current, "hybrid");
    setActiveSessionKey(key);
    focusWorkbenchPane(paneKey);
  }, [addTerminal, focusWorkbenchPane, selectProject, setActivePane]);

  useEffect(() => {
    const onWindowResume = (event: Event) => {
      const detail = (event as CustomEvent<{
        provider: string;
        id: string;
        command: string;
        cwd: string;
        title?: string;
        projectPath?: string;
        initialPrompt?: string;
      }>).detail;
      if (!detail?.command || !detail?.cwd) return;
      openResumeFromAgent(detail);
    };
    window.addEventListener("agent-resume:workbench-resume", onWindowResume);
    const stopIpc =
      typeof desktopApi().onWorkbenchResumeFromAgent === "function"
        ? desktopApi().onWorkbenchResumeFromAgent((payload) => {
            window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
            openResumeFromAgent(payload);
          })
        : () => undefined;
    return () => {
      window.removeEventListener("agent-resume:workbench-resume", onWindowResume);
      stopIpc();
    };
  }, [openResumeFromAgent]);

  /** Kanban / Sessions / Agent resume: open the session, or focus it if already open. */
  useEffect(() => {
    const onOpenSession = (event: Event) => {
      const detail = (event as CustomEvent<AgentSession>).detail;
      if (!detail?.provider || !detail?.id) return;
      window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
      openSessionRef.current(detail);
    };
    window.addEventListener("agent-resume:workbench-open-session", onOpenSession);
    return () => window.removeEventListener("agent-resume:workbench-open-session", onOpenSession);
  }, []);

  /** Nav-rail dot clicked: switch project, activate the pane, focus it. */
  const focusWorkbenchSessionFromRail = useCallback((paneKey: string, projectPath: string) => {
    selectProject(projectPath, { keepSessionKey: true });
    setActivePane(paneKey, projectPath);
    focusWorkbenchPane(paneKey);
  }, [focusWorkbenchPane, selectProject, setActivePane]);

  const loadTasks = useCallback(async () => {
    if (typeof desktopApi().notesListTasks !== "function") return;
    try {
      const items = await desktopApi().notesListTasks();
      setTasks(items.map(taskFromRecord));
    } catch {
      /* the sidebar list is best-effort; the board remains the source of truth */
    }
  }, []);

  // Template recolors/deletes re-resolve task accents; refresh so an open
  // window re-skins (via the accent-sync effect) without being reopened.
  useEffect(() => {
    const stop = desktopApi().onTaskTemplatesChanged?.(() => { void loadTasks(); });
    return () => stop?.();
  }, [loadTasks]);

  /** All notes, for the left-panel note list. */
  const loadNotes = useCallback(async () => {
    if (typeof desktopApi().notesList !== "function") return;
    try {
      const notes = await desktopApi().notesList();
      setNoteItems(notes
        .map((note) => ({
          noteId: note.noteId,
          title: note.title || note.filename.replace(/\.md$/i, "") || note.noteId,
          updatedAtMs: note.updatedAtMs,
          gtdStatus: note.gtdStatus
        }))
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs));
      if (typeof desktopApi().notesListLinks === "function") {
        setNoteLinks(await desktopApi().notesListLinks());
      }
    } catch {
      /* best-effort */
    }
  }, []);

  /** Note ids of the scoped task's note tree (the task note + its linked children). */
  const loadTaskNoteIds = useCallback(async () => {
    const taskNoteId = taskScopeRef.current?.noteId;
    const api = desktopApi();
    if (!taskNoteId || typeof api.notesGetSubtree !== "function") {
      setTaskNoteIds(new Set());
      return;
    }
    try {
      let rootId = taskNoteId;
      if (typeof api.notesResolveLinkRoot === "function") {
        rootId = (await api.notesResolveLinkRoot({ noteId: taskNoteId })).rootNoteId;
      }
      const subtree = await api.notesGetSubtree({ rootNoteId: rootId });
      setTaskNoteIds(new Set<string>([subtree.rootNoteId, ...Object.keys(subtree.nodesById ?? {})]));
    } catch {
      setTaskNoteIds(new Set([taskNoteId]));
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void loadTasks();
  }, [active, loadTasks]);

  // The note list loads when the Note tab is shown and the scoped task changes.
  useEffect(() => {
    if (!active || leftTab !== "note") return;
    void loadNotes();
    void loadTaskNoteIds();
  }, [active, leftTab, loadNotes, loadTaskNoteIds, taskScope?.noteId]);

  // A task filters by default; without one, the list shows every note.
  useEffect(() => {
    setNoteFilter(taskScope ? "task" : "all");
    setSessionFilter(taskScope ? "task" : "all");
  }, [taskScope?.noteId]);

  useEffect(() => {
    const onNotesMutated = () => { void loadTasks(); void loadNotes(); void loadTaskNoteIds(); };
    window.addEventListener("agent-resume:notes-mutated", onNotesMutated);
    return () => window.removeEventListener("agent-resume:notes-mutated", onNotesMutated);
  }, [loadTasks, loadNotes, loadTaskNoteIds]);

  // Workbenches of the scoped task: load (ensuring ≥1) and restore the last one.
  useEffect(() => {
    workbenchesRef.current = workbenches;
  }, [workbenches]);

  useEffect(() => {
    activeWorkbenchIdRef.current = activeWorkbenchId;
  }, [activeWorkbenchId]);

  useEffect(() => {
    const taskNoteId = taskScope?.noteId;
    // Leaving a task keeps its panes alive but hidden: they re-attach when the
    // task is opened again, the same way project-scoped panes survive switches.
    if (!active || !taskNoteId) {
      setWorkbenches([]);
      workbenchesRef.current = [];
      setActiveWorkbenchId(null);
      return;
    }
    let cancelled = false;
    void ensureTaskWorkbenches(taskNoteId).then((list) => {
      if (cancelled) return;
      setWorkbenches(list);
      workbenchesRef.current = list;
      const stored = readActiveWorkbenchId(taskNoteId);
      const requested = pendingWorkbenchIdRef.current;
      pendingWorkbenchIdRef.current = null;
      const next = list.find((item) => item.workbenchId === requested)?.workbenchId
        ?? list.find((item) => item.workbenchId === stored)?.workbenchId
        ?? list[0]?.workbenchId
        ?? null;
      setActiveWorkbenchId(next);
      if (next) writeActiveWorkbenchId(taskNoteId, next);
      const api = desktopApi();
      if (typeof api.listTaskWorkbenchSessionLinks === "function") {
        void Promise.all(list.map(async (workbench) => {
          const links = await api.listTaskWorkbenchSessionLinks({ workbenchId: workbench.workbenchId }).catch(() => []);
          return [workbench.workbenchId, links.map((link) => `${link.provider}:${link.agentSessionId}`)] as const;
        })).then((entries) => {
          if (!cancelled) setWorkbenchSessionKeys(Object.fromEntries(entries));
        }).catch(() => undefined);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [active, taskScope?.noteId]);

  // The active workbench owns the project context (null = task neutral workspace).
  useEffect(() => {
    if (!activeWorkbenchId) return;
    const workbench = workbenches.find((item) => item.workbenchId === activeWorkbenchId);
    if (!workbench?.projectPath) return;
    if (selectedProjectRef.current === workbench.projectPath) return;
    selectProject(workbench.projectPath, { keepSessionKey: true });
  }, [activeWorkbenchId, workbenches, selectProject]);

  // Pane geometry and the session view mode belong to the workbench, so a
  // window picks up the values of the workbench it is showing.
  useEffect(() => {
    if (!activeWorkbenchId) return;
    setListWidth(storedWidth(workbenchScopedKey(LIST_WIDTH_KEY, activeWorkbenchId), 324, 240, 720));
    setSideWidth(storedWidth(workbenchScopedKey(SIDE_WIDTH_KEY, activeWorkbenchId), 320, 240, 840));
    setTuiSplitHeight(storedWidth(workbenchScopedKey(TUI_SPLIT_HEIGHT_KEY, activeWorkbenchId), 180, 80, 600));
    const mode = storageString(workbenchScopedKey(SESSION_VIEW_MODE_KEY, activeWorkbenchId));
    if (mode === "terminal" || mode === "hybrid") setSessionViewMode(mode);
  }, [activeWorkbenchId]);

  const activateWorkbench = useCallback((workbench: Workbench) => {
    setActiveWorkbenchId(workbench.workbenchId);
    activeWorkbenchIdRef.current = workbench.workbenchId;
    const taskNoteId = taskScopeRef.current?.noteId;
    if (taskNoteId) writeActiveWorkbenchId(taskNoteId, workbench.workbenchId);
    if (workbench.projectPath) selectProject(workbench.projectPath, { keepSessionKey: true });
  }, [selectProject]);

  const addWorkbench = useCallback(async () => {
    const taskNoteId = taskScopeRef.current?.noteId;
    if (!taskNoteId) return;
    try {
      const created = await createTaskWorkbench(taskNoteId, { projectPath: selectedProjectRef.current });
      if (!created) return;
      const list = await ensureTaskWorkbenches(taskNoteId);
      setWorkbenches(list);
      workbenchesRef.current = list;
      activateWorkbench(created);
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [activateWorkbench]);

  const commitWorkbenchRename = useCallback(async () => {
    const workbenchId = renamingWorkbenchId;
    const name = workbenchRenameDraft.trim();
    setRenamingWorkbenchId(null);
    if (!workbenchId || !name) return;
    try {
      const updated = await renameTaskWorkbench(workbenchId, name);
      if (!updated) return;
      setWorkbenches((current) => current.map((item) => item.workbenchId === workbenchId ? updated : item));
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [renamingWorkbenchId, workbenchRenameDraft]);

  /** Close and destroy every pane owned by a deleted workbench (PTYs, browsers, editors). */
  const discardWorkbenchPanes = useCallback((workbenchId: string) => {
    for (const pane of terminalsRef.current.filter((item) => item.workbenchId === workbenchId)) closeTerminal(pane.key);
    for (const pane of acpChatsRef.current.filter((item) => item.workbenchId === workbenchId)) closeAcpChat(pane.key);
    for (const pane of browsersRef.current.filter((item) => item.workbenchId === workbenchId)) void closeBrowser(pane.key);
    for (const pane of editorsRef.current.filter((item) => item.workbenchId === workbenchId)) closeEditor(pane.key);
    for (const pane of diffsRef.current.filter((item) => item.workbenchId === workbenchId)) closeDiff(pane.key);
    for (const pane of notePanesRef.current.filter((item) => item.workbenchId === workbenchId)) closeNotePane(pane.key);
  }, [closeAcpChat, closeBrowser, closeDiff, closeEditor, closeNotePane, closeTerminal]);

  const removeWorkbench = useCallback(async (workbench: Workbench) => {
    const taskNoteId = taskScopeRef.current?.noteId;
    if (!taskNoteId) return;
    if (workbenchesRef.current.length <= 1) return;
    if (!(await confirmDestructive(t("desktop.workbench.deleteWorkbenchConfirm", workbenchDisplayName(workbench)), t("desktop.common.delete")))) return;
    try {
      await deleteTaskWorkbench(workbench.workbenchId);
      discardWorkbenchPanes(workbench.workbenchId);
      const list = await ensureTaskWorkbenches(taskNoteId);
      setWorkbenches(list);
      workbenchesRef.current = list;
      if (workbench.workbenchId === activeWorkbenchIdRef.current) {
        const next = list[0];
        if (next) activateWorkbench(next);
      }
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [activateWorkbench, discardWorkbenchPanes, t]);

  /**
   * Re-attach the terminals a workbench had before its window was closed.
   *
   * The panes die with the renderer, but their ptys do not: a pane restored with
   * `ptyId` set adopts the running process (TerminalView attaches and replays)
   * instead of spawning a second agent for the same work.
   */
  const restoreWorkbenchTerminals = useCallback(async (
    workbenchId: string,
    persisted: PersistedTerminalPane[],
    projectPath: string | null
  ): Promise<void> => {
    if (!persisted.length || typeof desktopApi().terminalListForWorkbench !== "function") return;
    const live = await desktopApi().terminalListForWorkbench({ workbenchId }).catch(() => []);
    if (!live.length) return;
    const liveIds = new Set(live.map((entry) => entry.id));
    const knownPtyIds = new Set(
      terminalsRef.current
        .map((pane) => pane.ptyId)
        .filter((id): id is number => typeof id === "number")
    );
    const additions = persisted
      .filter((pane) => liveIds.has(pane.ptyId) && !knownPtyIds.has(pane.ptyId))
      .map((pane): TerminalPane => ({ ...pane, workbenchId }));
    if (!additions.length) return;
    terminalsRef.current = [...terminalsRef.current, ...additions];
    setTerminals((current) => [
      ...current,
      ...additions.filter((pane) => !current.some((item) => item.key === pane.key))
    ]);
    const scope = workbenchScope(workbenchId);
    if (scope && !activePanesRef.current[scope]) {
      setActivePane(additions[additions.length - 1]!.key, projectPath ?? selectedProject);
    }
  }, [selectedProject, setActivePane]);

  // Persist a workbench's panes so its workspace can be restored later. The
  // terminals carry their pty id: a reopened workbench adopts those processes.
  useEffect(() => {
    const workbenchId = activeWorkbenchIdRef.current;
    if (!workbenchId || typeof desktopApi().setTaskWorkbenchLayout !== "function") return;
    const openNoteIds = notePanesRef.current
      .filter((pane) => pane.workbenchId === workbenchId)
      .map((pane) => pane.noteId);
    const terminalsForWorkbench = terminalsRef.current
      .filter((pane) => pane.workbenchId === workbenchId && typeof pane.ptyId === "number")
      .map((pane) => ({
        key: pane.key,
        ptyId: pane.ptyId,
        title: pane.title,
        group: pane.group,
        cwd: pane.cwd,
        projectPath: pane.projectPath,
        ...(pane.sessionKey ? { sessionKey: pane.sessionKey } : {}),
        ...(pane.command ? { command: pane.command } : {})
      }));
    const activePaneKey = activePanesRef.current[workbenchScope(workbenchId) ?? ""] || "";
    void setTaskWorkbenchLayout(
      workbenchId,
      JSON.stringify({ openNoteIds, terminals: terminalsForWorkbench, activePaneKey })
    ).catch(() => undefined);
  }, [notePanes, terminals]);

  // Restore a workbench's persisted panes when it becomes active.
  useEffect(() => {
    const workbenchId = activeWorkbenchId;
    if (!workbenchId) return;
    const workbench = workbenchesRef.current.find((item) => item.workbenchId === workbenchId);
    if (!workbench?.layoutJson) return;
    let openNoteIds: string[] = [];
    let parsed: PersistedWorkbenchLayout = {};
    try {
      parsed = JSON.parse(workbench.layoutJson) as PersistedWorkbenchLayout;
      if (Array.isArray(parsed?.openNoteIds)) {
        openNoteIds = parsed.openNoteIds.filter((id): id is string => typeof id === "string");
      }
    } catch {
      return;
    }
    const persistedTerminals = readPersistedTerminals(parsed);
    void restoreWorkbenchTerminals(workbenchId, persistedTerminals, workbench.projectPath);
    if (!openNoteIds.length) return;
    const scope = `wb:${workbenchId}`;
    const existing = new Set(notePanesRef.current.map((pane) => pane.key));
    const additions = openNoteIds
      .filter((noteId) => !existing.has(`note:${workbenchId}:${noteId}`))
      .map((noteId) => ({
        key: `note:${workbenchId}:${noteId}`,
        noteId,
        projectPath: workbench.projectPath,
        title: "",
        workbenchId
      }));
    if (additions.length) setNotePanes((current) => {
      const keys = new Set(current.map((pane) => pane.key));
      const fresh = additions.filter((pane) => !keys.has(pane.key));
      return fresh.length ? [...current, ...fresh] : current;
    });
    if (!activePanesRef.current[scope] && (additions[0] || existing.size)) {
      const firstKey = additions[0]?.key
        ?? notePanesRef.current.find((pane) => pane.workbenchId === workbenchId)?.key;
      if (firstKey) setActivePane(firstKey, workbench.projectPath ?? selectedProject);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkbenchId, restoreWorkbenchTerminals]);

  // Open the task's note once its workbench is active (request comes from the board).
  useEffect(() => {
    if (!taskNoteRequest || !activeWorkbenchId) return;
    setLeftTab("note");
    openNotePane(taskNoteRequest.noteId, taskNoteRequest.title);
    setTaskNoteRequest(null);
  }, [taskNoteRequest, activeWorkbenchId, openNotePane]);

  useEffect(() => {
    const onTask = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchTask>).detail;
      if (!detail?.noteId) return;
      pendingWorkbenchIdRef.current = (detail as { workbenchId?: string }).workbenchId ?? null;
      if ((detail as { openNote?: boolean }).openNote) {
        // Opening a task shows its note: defer until the workbench is active.
        setTaskNoteRequest({ noteId: detail.noteId, title: detail.title, nonce: Date.now() });
      }
      taskScopeRef.current = { noteId: detail.noteId };
      setTaskScope(detail);
      // Entering a task lands on its session list; the explicit open-note
      // request above overrides this once its workbench is active.
      setLeftTab("session");
      const target = detail.primaryProject ?? detail.projects?.[0];
      // The task owns its project context: opening one must not inherit a
      // stale selection, so a project-less task clears it.
      selectProject(target ?? null, { keepSessionKey: true });
      setSessionTarget(null);
    };
    const onTaskClear = () => {
      setTaskScope(null);
      setLeftTab("session");
      setSessionTarget(null);
      selectProject(null, { keepSessionKey: true, keepSide: true });
    };
    window.addEventListener("agent-resume:workbench-task", onTask);
    window.addEventListener("agent-resume:workbench-task-clear", onTaskClear);
    return () => {
      window.removeEventListener("agent-resume:workbench-task", onTask);
      window.removeEventListener("agent-resume:workbench-task-clear", onTaskClear);
    };
  }, []);

  const addProjectToTask = useCallback(async (projectPath: string) => {
    const scope = taskScopeRef.current;
    if (!scope || typeof desktopApi().notesAddTaskProject !== "function") return;
    try {
      await desktopApi().notesAddTaskProject({ noteId: scope.noteId, projectPath });
      setSessionTarget(projectPath);
      selectProject(projectPath, { keepSessionKey: true });
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickTaskProject = useCallback(async () => {
    const scope = taskScopeRef.current;
    if (!scope) return;
    try {
      if (typeof desktopApi().addProject !== "function") return;
      const result = await desktopApi().addProject({ title: t("desktop.workbench.addProjectTitle") });
      if (!result.ok) return;
      const projectPath = result.project.localPath || result.project.portableKey;
      if (!projectPath) return;
      await addProjectToTask(projectPath);
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [addProjectToTask, t]);

  const removeProject = useCallback(async (projectPath: string) => {
    const scope = taskScopeRef.current;
    if (!scope || typeof desktopApi().notesRemoveTaskProject !== "function") return;
    if (!(await confirmDestructive(t("desktop.workbench.removeProjectConfirm", basename(projectPath)), t("desktop.common.remove")))) return;
    try {
      await desktopApi().notesRemoveTaskProject({ noteId: scope.noteId, projectPath });
      if (sessionTargetRef.current && projectPathKey(sessionTargetRef.current) === projectPathKey(projectPath)) {
        setSessionTarget(null);
      }
      if (selectedProjectRef.current && projectPathKey(selectedProjectRef.current) === projectPathKey(projectPath)) {
        const remaining = scopeProjectsRef.current.filter((path) => projectPathKey(path) !== projectPathKey(projectPath));
        selectProject(remaining[0] ?? null, { keepSessionKey: true });
      }
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [t]);

  useEffect(() => {
    const onFocusSession = (event: Event) => {
      const detail = (event as CustomEvent<{ paneKey?: string; projectPath?: string }>).detail;
      if (!detail?.paneKey) return;
      focusWorkbenchSessionFromRail(detail.paneKey, detail.projectPath || selectedProjectRef.current || "");
    };
    window.addEventListener("agent-resume:workbench-focus-session", onFocusSession);
    const api = desktopApi();
    const stopIpc = typeof api.onWorkbenchFocusSession === "function"
      ? api.onWorkbenchFocusSession((payload: WorkbenchFocusSessionRequest) => {
          window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
          focusWorkbenchSessionFromRail(payload.paneKey, payload.projectPath || selectedProjectRef.current || "");
        })
      : undefined;
    return () => {
      window.removeEventListener("agent-resume:workbench-focus-session", onFocusSession);
      stopIpc?.();
    };
  }, [focusWorkbenchSessionFromRail]);

  useEffect(() => {
    const onOpenDiff = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string; filePath?: string }>).detail;
      const projectPath = detail?.projectPath?.trim();
      const filePath = detail?.filePath?.trim();
      if (!projectPath || !filePath) return;
      selectProject(projectPath, { keepSessionKey: true });
      void openDiffForPathRef.current(projectPath, filePath);
    };
    window.addEventListener("agent-resume:workbench-open-diff", onOpenDiff);
    return () => window.removeEventListener("agent-resume:workbench-open-diff", onOpenDiff);
  }, []);

  const taskMenu = (event: React.MouseEvent, item: Pick<WorkbenchTask, "noteId" | "title" | "sessions">) => {
    event.preventDefault();
    const menu: WorkbenchContextMenu = {
      kind: "task",
      noteId: item.noteId,
      taskTitle: item.title,
      taskHasSessions: (item.sessions?.length ?? 0) > 0,
      x: event.clientX,
      y: event.clientY
    };
    setContextMenu(menu);
    // The workspace is allocated on demand, so ask whether it exists before
    // offering to open it.
    if (typeof desktopApi().notesTaskWorkspace !== "function") return;
    void desktopApi().notesTaskWorkspace({ noteId: item.noteId }).then(({ dir, exists }) => {
      if (!exists) return;
      setContextMenu((current) => current === menu ? { ...current, workspaceDir: dir } : current);
    }).catch(() => undefined);
  };

  const refreshFloatingNoteAvailability = useCallback((target: FloatingSessionNoteTarget, menu: WorkbenchContextMenu) => {
    const api = desktopApi();
    if (typeof api.notesList !== "function") return;
    void api.notesList().then((notes) => {
      const hasFloatingNote = notes.some((note) => sessionNoteMatchesTarget(note, target));
      setContextMenu((current) => current === menu ? { ...current, hasFloatingNote } : current);
    }).catch(() => undefined);
  }, []);

  const sessionMenu = (event: React.MouseEvent, session: AgentSession) => {
    event.preventDefault();
    const key = sessionKey(session);
    if (!selectedSessionKeys.has(key)) {
      setSelectedSessionKeys(new Set([key]));
      setSelectionAnchorKey(key);
    }
    const menu: WorkbenchContextMenu = { kind: "session", session, x: event.clientX, y: event.clientY };
    setContextMenu(menu);
    refreshFloatingNoteAvailability(sessionNoteTarget(session, aliases[session.projectPath] || basename(session.projectPath)), menu);
  };

  const noteMenu = (event: React.MouseEvent, note: { noteId: string; title: string }) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      kind: "note",
      noteId: note.noteId,
      noteTitle: note.title,
      x: event.clientX,
      y: event.clientY
    });
  };

  /** Clear the scoped task's own GTD mark so it follows its notes and sessions again. */
  const clearTaskPin = useCallback(async () => {
    const noteId = taskScopeRef.current?.noteId;
    if (!noteId || typeof desktopApi().notesSetGtdStatus !== "function") return;
    try {
      await desktopApi().notesSetGtdStatus({ noteId, status: null });
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, []);

  const selectCatalogSessionRange = useCallback((anchorKey: string, targetKey: string) => {
    const catalogKeys = catalogSessionKeysInRows(visibleSessionRows);
    const anchorIndex = catalogKeys.indexOf(anchorKey);
    const targetIndex = catalogKeys.indexOf(targetKey);
    if (targetIndex < 0) {
      setSelectedSessionKeys(new Set([targetKey]));
      setSelectionAnchorKey(targetKey);
      return;
    }
    const start = anchorIndex < 0 ? targetIndex : Math.min(anchorIndex, targetIndex);
    const end = anchorIndex < 0 ? targetIndex : Math.max(anchorIndex, targetIndex);
    setSelectedSessionKeys(new Set(catalogKeys.slice(start, end + 1)));
    setSelectionAnchorKey(anchorIndex < 0 ? targetKey : anchorKey);
  }, [visibleSessionRows]);

  const handleCatalogSessionClick = (event: React.MouseEvent, session: AgentSession) => {
    const key = sessionKey(session);
    if (event.shiftKey) {
      event.preventDefault();
      selectCatalogSessionRange(selectionAnchorKey || key, key);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      setSelectedSessionKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setSelectionAnchorKey(key);
      return;
    }
    setSelectedSessionKeys(new Set([key]));
    setSelectionAnchorKey(key);
    void openSession(session);
  };

  const sessionTabMenu = (
    event: React.MouseEvent,
    target: FloatingSessionNoteTarget | null,
    paneKey: string
  ) => {
    if (activePane !== paneKey) return;
    event.preventDefault();
    if (!target) return;
    const menu: WorkbenchContextMenu = {
      kind: "session-tab",
      floatingNoteTarget: target,
      x: event.clientX,
      y: event.clientY
    };
    setContextMenu(menu);
    refreshFloatingNoteAvailability(target, menu);
  };

  const editorTabMenu = (event: React.MouseEvent, pane: EditorPane) => {
    event.preventDefault();
    setActivePane(pane.key, selectedProject);
    if (!isMarkdownFilePath(pane.path)) return;
    setContextMenu({
      kind: "editor-tab",
      editorKey: pane.key,
      editorPreview: pane.view === "preview",
      x: event.clientX,
      y: event.clientY
    });
  };

  const openFloatingNote = useCallback((target: FloatingSessionNoteTarget) => {
    setFloatingNoteTarget({ ...target });
  }, []);

  const openMountedNote = async (owner: { scope: "session"; projectPath: string; provider: string; sessionId: string }) => {
    try {
      const result = await desktopApi().notesCreate(owner);
      openNotePane(result.noteId);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  };

  // Notes open as editing tabs in the pane tab groups (IM citations, tasks, etc.).
  useEffect(() => {
    const onOpenNote = (event: Event) => {
      const noteId = (event as CustomEvent<string>).detail;
      if (!noteId) return;
      openNotePane(noteId);
    };
    window.addEventListener("agent-resume:open-note", onOpenNote);
    return () => window.removeEventListener("agent-resume:open-note", onOpenNote);
  }, [openNotePane]);

  const openMoveSessionToTaskDialog = (session: AgentSession) => {
    const options = tasks
      .map((task) => ({ noteId: task.noteId, label: task.title, path: task.primaryProject || task.projects?.[0] }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!options.length) {
      setStatus({ text: t("desktop.workbench.moveToTaskNoTargets"), kind: "error" });
      return;
    }
    setProjectPickDialog({
      kind: "moveSessionToTask",
      session,
      options,
      query: "",
      busy: false,
      status: ""
    });
  };

  const applyMoveSessionToTask = async (target: { noteId: string; label: string; path?: string }) => {
    if (!projectPickDialog || projectPickDialog.kind !== "moveSessionToTask") return;
    const session = projectPickDialog.session;
    setProjectPickDialog((current) => current ? { ...current, busy: true, status: t("desktop.workbench.moveToTaskRunning") } : current);
    try {
      await desktopApi().notesLinkSessionToTask({
        noteId: target.noteId,
        sessionKey: sessionKey(session),
        projectPath: session.projectPath
      });
      setProjectPickDialog(null);
      setStatus({ text: t("desktop.workbench.moveToTaskDone", target.label) });
      await reloadWorkbench();
      await loadTasks();
      window.dispatchEvent(new Event("agent-resume:notes-mutated"));
      window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
    } catch (error) {
      setProjectPickDialog((current) => current ? { ...current, busy: false, status: statusError(error) } : current);
    }
  };

  const runContextAction = async (action: string) => {
    const menu = contextMenu;
    setContextMenu(null);
    if (!menu) return;
    if (menu.kind === "task" && menu.noteId) {
      if (action === "followChildren") {
        try {
          await desktopApi().notesSetGtdStatus({ noteId: menu.noteId, status: null });
          window.dispatchEvent(new Event("agent-resume:notes-mutated"));
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
        return;
      }
      if (action === "openWorkspace" && typeof desktopApi().notesOpenTaskWorkspace === "function") {
        try {
          await desktopApi().notesOpenTaskWorkspace({ noteId: menu.noteId });
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "deleteTask") {
        // Only a task that has never been linked to a session may be deleted.
        if (menu.taskHasSessions) return;
        if (typeof desktopApi().notesDelete !== "function") return;
        const label = menu.taskTitle || menu.noteId;
        if (!(await confirmDestructive(t("desktop.workbench.deleteTaskConfirm", label), t("desktop.common.delete")))) return;
        try {
          await desktopApi().notesDelete({ noteId: menu.noteId });
          if (taskScopeRef.current?.noteId === menu.noteId) {
            // The task's workbenches are gone for good: close their panes.
            for (const workbench of workbenchesRef.current) discardWorkbenchPanes(workbench.workbenchId);
            taskScopeRef.current = null;
            setTaskScope(null);
            setSessionTarget(null);
          }
          await loadTasks();
          window.dispatchEvent(new Event("agent-resume:notes-mutated"));
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      return;
    }
    if (menu.kind === "session-tab") {
      if (action === "floatingNote" && menu.floatingNoteTarget) openFloatingNote(menu.floatingNoteTarget);
      return;
    }
    if (menu.kind === "editor-tab") {
      if (action === "toggleEditorPreview" && menu.editorKey) {
        setEditors((current) => current.map((item) => item.key === menu.editorKey
          ? { ...item, view: item.view === "preview" ? "edit" : "preview" }
          : item));
      }
      return;
    }
    if (menu.kind === "note" && menu.noteId) {
      const noteId = menu.noteId;
      if (action.startsWith("gtd:")) {
        const status = action === "gtd:clear"
          ? null
          : GTD_STATUSES.includes(action.slice(4) as DesktopGtdStatus)
            ? action.slice(4) as DesktopGtdStatus
            : null;
        if (action !== "gtd:clear" && !status) return;
        try {
          await desktopApi().notesSetGtdStatus({ noteId, status });
          setNoteItems((current) => current.map((item) => item.noteId === noteId ? { ...item, gtdStatus: status ?? undefined } : item));
          window.dispatchEvent(new Event("agent-resume:notes-mutated"));
          setStatus({ text: "" });
        } catch (error) {
          const message = t("desktop.workbench.gtdStatusSaveFailed", statusError(error));
          setStatus({ text: message, kind: "error" });
          notifyDesktop({ text: message, kind: "error" });
        }
        return;
      }
      return;
    }
    const session = menu.session;
    if (!session) return;
    if (action === "moveTask") {
      openMoveSessionToTaskDialog(session);
      return;
    }
    if (action.startsWith("gtd:")) {
      const status = action === "gtd:clear"
        ? null
        : GTD_STATUSES.includes(action.slice(4) as DesktopGtdStatus)
          ? action.slice(4) as DesktopGtdStatus
          : null;
      if (action !== "gtd:clear" && !status) return;
      try {
        await desktopApi().setSessionGtdStatus({ provider: session.provider, id: session.id, status });
        setGtdStatuses((current) => {
          const next = { ...current };
          const key = sessionKey(session);
          if (status) next[key] = status;
          else delete next[key];
          return next;
        });
        setStatus({ text: "" });
        window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
      } catch (error) {
        const message = t("desktop.workbench.gtdStatusSaveFailed", statusError(error));
        setStatus({ text: message, kind: "error" });
        notifyDesktop({ text: message, kind: "error" });
      }
      return;
    }
    if (action === "floatingNote") openFloatingNote(sessionNoteTarget(session, aliases[session.projectPath] || basename(session.projectPath)));
    if (action === "note") await openMountedNote({ scope: "session", projectPath: session.projectPath, provider: session.provider, sessionId: session.id });
    if (action === "codex") {
      try { await desktopApi().workbenchOpenCodexApp({ provider: session.provider, id: session.id }); }
      catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    }
    if (action === "preview") window.dispatchEvent(new CustomEvent("agent-resume:workbench-open-session", { detail: session }));
    if (action === "autoRename") {
      cancelSessionAutoRename(sessionKey(session));
      await performAutoRenameSession(session.provider, session.id);
    }
    if (action === "remove") {
      const selectedCatalog = visibleSessions.filter((item) => selectedSessionKeys.has(sessionKey(item)));
      const targets = selectedCatalog.length > 1 && selectedSessionKeys.has(sessionKey(session))
        ? selectedCatalog
        : [session];
      const confirmed = targets.length > 1
        ? await confirmDestructive(t("desktop.workbench.removeMultipleConfirm", targets.length), t("desktop.common.remove"))
        : await confirmDestructive(t("desktop.workbench.removeConfirm", session.title || session.id), t("desktop.common.remove"));
      if (!confirmed) return;
      await removeSelectedSessionsFromPanel(targets);
    }
  };

  const removeSelectedSessionsFromPanel = async (targets: AgentSession[]) => {
    if (!targets.length) return;
    for (const item of targets) {
      const key = sessionKey(item);
      cancelSessionAutoRename(key);
      deferredAutoRenameKeysRef.current.delete(key);
    }
    try {
      const api = desktopApi();
      if (targets.length > 1 && typeof api.hideSessions === "function") {
        await api.hideSessions({ sessions: targets.map((item) => ({ provider: item.provider, id: item.id })) });
      } else {
        for (const item of targets) {
          await api.hideSession({ provider: item.provider, id: item.id });
        }
      }
      setSelectedSessionKeys(new Set());
      setSelectionAnchorKey("");
      // The task-scoped session list reads from a separately fetched key set, so
      // drop the hidden rows here; reloadWorkbench only refreshes the global list.
      const removed = new Set(targets.map(sessionKey));
      setTaskSessions((current) => current
        ? current.filter((session) => !removed.has(sessionKey(session)))
        : current);
      await reloadWorkbench();
      window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  };

  const syncEditorFromDisk = useCallback(async (editor: EditorPane) => {
    if (editor.saving) return;
    try {
      const inspected = await desktopApi().workbenchInspectFile({
        rootPath: editor.projectPath,
        filePath: editor.path
      });
      const latestEditor = editorsRef.current.find((item) => item.key === editor.key);
      if (!latestEditor || reconcileEditorInspection(latestEditor, inspected) === latestEditor) return;
      setEditors((current) => {
        let changed = false;
        const next = current.map((item) => {
          if (item.key !== editor.key) return item;
          const updated = reconcileEditorInspection(item, inspected);
          if (updated !== item) changed = true;
          return updated;
        });
        if (!changed) return current;
        editorsRef.current = next;
        return next;
      });
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, []);

  const reconcileProjectEditors = useCallback((rootPath: string) => {
    const key = projectPathKey(rootPath);
    const existing = editorReconcilesRef.current.get(key);
    if (existing) {
      existing.queued = true;
      return existing.promise;
    }

    const state = { promise: Promise.resolve(), queued: false };
    const reconcile = async () => {
      do {
        state.queued = false;
        await Promise.all(editorsRef.current
          .filter((editor) => editor.projectPath === rootPath)
          .map((editor) => syncEditorFromDisk(editor)));
      } while (state.queued);
    };
    state.promise = reconcile().finally(() => {
      if (editorReconcilesRef.current.get(key) === state) editorReconcilesRef.current.delete(key);
    });
    editorReconcilesRef.current.set(key, state);
    return state.promise;
  }, [syncEditorFromDisk]);

  const {
    scriptPackages,
    scriptsLoading,
    scriptsError,
    scriptsTruncated,
    scriptsSectionCollapsed,
    loadScripts,
    runScript,
    toggleScriptsSectionCollapsed
  } = useWorkbenchScripts({
    active,
    projects: sideRoots,
    side,
    runScript: (script, _pkg) => {
      const projectPath = projectForPath(script.run.cwd) || sideRoot || script.run.cwd;
      addTerminal(script.name, script.run.cwd, script.run.command, projectPath);
    }
  });

  const editorSettings = settings?.workbench?.editor;
  const editorAppearance: CodeMirrorAppearance = settings?.workbench?.editorTheme === "light" || settings?.workbench?.editorTheme === "dark"
    ? settings.workbench.editorTheme
    : "follow-app";
  const terminalThemeId = resolveTerminalThemeId(settings?.workbench?.terminalTheme);
  const desktopAppearance = useMemo(() => appearanceStateFromSettings(settings || {}), [settings]);
  const terminalEngine: TerminalEngineType =
    settings?.workbench?.terminalEngine === "ghostty-web" ? "ghostty-web" : "xterm";
  const terminalRendererMode: TerminalRendererMode =
    settings?.workbench?.terminalRenderer === "canvas" ? "canvas" : "webgl";
  const saveEditor = async (key: string, force = false) => {
    const editor = editorsRef.current.find((item) => item.key === key);
    if (!editor || !editor.dirty) return true;
    if (!force && editor.diskState) return false;
    const savingEditors = editorsRef.current.map((item) => item.key === key ? { ...item, saving: true } : item);
    editorsRef.current = savingEditors;
    setEditors(savingEditors);
    try {
      const result = await desktopApi().workbenchSaveFileText({
        rootPath: editor.projectPath,
        filePath: editor.path,
        content: editor.content,
        encoding: editor.encoding,
        expectedVersion: editor.version,
        force
      });
      if (!result.ok) {
        setEditors((current) => {
          const next = current.map((item) => item.key === key
            ? { ...item, saving: false, diskState: result.reason === "missing" ? "deleted" as const : "changed" as const }
            : item);
          editorsRef.current = next;
          return next;
        });
        return false;
      }
      setEditors((current) => {
        const next = current.map((item) => item.key === key
          ? { ...item, version: result.version, size: result.size, mtimeMs: result.mtimeMs, dirty: false, saving: false, diskState: undefined }
          : item);
        editorsRef.current = next;
        return next;
      });
      return true;
    } catch (error) {
      setEditors((current) => {
        const next = current.map((item) => item.key === key ? { ...item, saving: false } : item);
        editorsRef.current = next;
        return next;
      });
      setStatus({ text: t("desktop.workbench.fileSaveFailed", statusError(error)), kind: "error" });
      return false;
    }
  };
  saveEditorRef.current = saveEditor;

  const saveTimers = useRef(new Map<string, number>());
  useEffect(() => () => saveTimers.current.forEach((timer) => window.clearTimeout(timer)), []);
  const updateEditorContent = (key: string, content: string) => {
    setEditors((current) => current.map((item) => item.key === key ? { ...item, content, dirty: true } : item));
    const existing = saveTimers.current.get(key);
    if (existing) window.clearTimeout(existing);
    const delay = editorSettings?.autoSaveDelayMs ?? 600;
    saveTimers.current.set(key, window.setTimeout(() => {
      saveTimers.current.delete(key);
      void saveEditor(key);
    }, delay));
  };

  const applyEditorReveal = useCallback((reveal: SearchReveal, expectedPath: string) => {
    pendingRevealRef.current = reveal;
    // Same already-active file won't change currentEditor/activePane, so the reveal
    // effect may not re-run — always schedule an explicit reveal for open files.
    // Double rAF: first paint after setActivePane, then CodeMirror is ready.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const pending = pendingRevealRef.current;
        if (!pending) return;
        const editor = editorsRef.current.find((item) => item.key === `editor:${expectedPath}` || item.path === expectedPath);
        const active = editorRef.current;
        if (!active || !editor) return;
        const pendingNorm = pending.path.replaceAll("\\", "/");
        const editorNorm = editor.path.replaceAll("\\", "/");
        if (
          pendingNorm !== editorNorm
          && !pendingNorm.endsWith(`/${editorNorm}`)
          && !editorNorm.endsWith(`/${pendingNorm}`)
          && pendingNorm !== expectedPath.replaceAll("\\", "/")
        ) {
          return;
        }
        active.revealRange({
          line: pending.line,
          column: pending.column,
          endColumn: pending.endColumn
        });
        pendingRevealRef.current = null;
      });
    });
  }, []);

  const openFile = async (
    path: string,
    reveal?: SearchReveal,
    targetProject = selectedProject,
    view: "edit" | "preview" = "edit"
  ) => {
    if (!targetProject) return;
    try {
      const key = `editor:${path}`;
      const existing = editorsRef.current.find((item) => item.key === key)
        || editorsRef.current.find((item) => item.path === path);
      if (existing) {
        await syncEditorFromDisk(existing);
        if (view === "preview" && existing.view !== "preview") {
          setEditors((current) => current.map((item) => item.key === existing.key ? { ...item, view: "preview" } : item));
        }
        setActivePane(existing.key, targetProject);
        if (reveal) applyEditorReveal({ ...reveal, path: existing.path }, existing.path);
        return;
      }
      const inspected = await desktopApi().workbenchInspectFile({ rootPath: targetProject, filePath: path });
      if (inspected.kind === "missing") throw new Error(t("desktop.workbench.fileDeletedOnDisk"));
      if (inspected.kind === "external") { await desktopApi().workbenchOpenPath({ rootPath: targetProject, filePath: path }); return; }
      setEditors((current) => {
        const next = [...current, { ...inspected, key, path, projectPath: targetProject, content: inspected.content, dirty: false, view, workbenchId: activeWorkbenchIdRef.current ?? undefined }];
        editorsRef.current = next;
        return next;
      });
      if (reveal) pendingRevealRef.current = { ...reveal, path };
      setActivePane(key, targetProject);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  };

  const {
    quickAccessOpen,
    quickAccessMode,
    setQuickAccessMode,
    quickAccessQuery,
    setQuickAccessQuery,
    quickAccessLoading,
    quickAccessTruncated,
    quickAccessError,
    quickAccessRoot,
    quickAccessVisibleFiles,
    quickAccessSearchTruncated,
    loadQuickAccessFiles,
    closeQuickAccess,
    invalidateQuickAccessCache
  } = useWorkbenchQuickAccess({
    projects: sideRoots,
    projectForPath,
    quickAccessProjectKey: QUICK_ACCESS_PROJECT_KEY,
    onDismissOverlays: () => {
      setContextMenu(null);
      setBranchPane(null);
      setProjectPickDialog(null);
    }
  });
  const openQuickAccessFile = useCallback(async (file: QuickAccessFile) => {
    const rootPath = projectForPath(file.path) || quickAccessRoot;
    if (!rootPath) return;
    closeQuickAccess();
    selectProject(rootPath);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    await openFile(file.path, undefined, rootPath);
  }, [closeQuickAccess, projectForPath, quickAccessRoot, syncEditorFromDisk]);

  const openQuickAccessDirectory = useCallback((directory: QuickAccessFile) => {
    const rootPath = projectForPath(directory.path) || quickAccessRoot;
    if (!rootPath) return;
    closeQuickAccess();
    selectProject(rootPath);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    setPendingExplorerReveal({ rootPath, path: directory.path });
    setSide("files");
  }, [closeQuickAccess, projectForPath, quickAccessRoot]);

  const reloadEditorFromDisk = useCallback(async (key: string) => {
    const editor = editorsRef.current.find((item) => item.key === key);
    if (!editor) return;
    try {
      const inspected = await desktopApi().workbenchInspectFile({
        rootPath: editor.projectPath,
        filePath: editor.path
      });
      if (inspected.kind !== "text") {
        setEditors((current) => {
          const next = current.map((item) => item.key === key
            ? { ...item, diskState: inspected.kind === "missing" ? "deleted" as const : "external" as const }
            : item);
          editorsRef.current = next;
          return next;
        });
        return;
      }
      setEditors((current) => {
        const next = current.map((item) => item.key === key
          ? { ...item, ...inspected, content: inspected.content, dirty: false, saving: false, diskState: undefined }
          : item);
        editorsRef.current = next;
        return next;
      });
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  }, []);

  const recreateEditorFile = useCallback(async (key: string) => {
    const editor = editorsRef.current.find((item) => item.key === key);
    if (!editor) return;
    try {
      const result = await desktopApi().workbenchCreateFileText({
        rootPath: editor.projectPath,
        filePath: editor.path,
        content: editor.content,
        encoding: editor.encoding
      });
      if (!result.ok) {
        await reloadEditorFromDisk(key);
        return;
      }
      setEditors((current) => {
        const next = current.map((item) => item.key === key
          ? { ...item, version: result.version, size: result.size, mtimeMs: result.mtimeMs, dirty: false, saving: false, diskState: undefined }
          : item);
        editorsRef.current = next;
        return next;
      });
      void fileExplorerRef.current?.refresh();
    } catch (error) { setStatus({ text: t("desktop.workbench.fileSaveFailed", statusError(error)), kind: "error" }); }
  }, [reloadEditorFromDisk, t]);

  useEffect(() => {
    const api = desktopApi();
    if (typeof api.workbenchSetFileWatch !== "function") return;
    const roots = sideRootsRef.current;
    if (!active || !roots.length) {
      watchedRootsRef.current = [];
      void api.workbenchSetFileWatch({ rootPaths: null }).catch(() => undefined);
      return;
    }
    watchedRootsRef.current = [];
    const requestedKey = roots.map(projectPathKey).join("\0");
    void api.workbenchSetFileWatch({ rootPaths: roots })
      .then((result) => {
        if (sideRootsRef.current.map(projectPathKey).join("\0") !== requestedKey) return;
        watchedRootsRef.current = result.rootPaths || [];
        void fileExplorerRef.current?.refresh();
        return Promise.all(result.rootPaths.map((root) => reconcileProjectEditors(root)));
      })
      .catch((error) => setStatus({ text: statusError(error), kind: "error" }));
    return () => {
      watchedRootsRef.current = [];
      void api.workbenchSetFileWatch({ rootPaths: null }).catch(() => undefined);
    };
  }, [active, reconcileProjectEditors, sideRootsKey]);

  useEffect(() => {
    const api = desktopApi();
    if (typeof api.onWorkbenchFileSystemChanged !== "function") return;
    const unsubscribe = api.onWorkbenchFileSystemChanged((event) => {
      invalidateQuickAccessCache(event.rootPath);
      if (event.type === "error") {
        if (watchedRootsRef.current.some((root) => projectPathKey(root) === projectPathKey(event.rootPath))) {
          setStatus({ text: event.message, kind: "error" });
        }
        return;
      }
      if (!activeRef.current || !watchedRootsRef.current.some((root) => projectPathKey(root) === projectPathKey(event.rootPath))) return;
      void fileExplorerRef.current?.refresh();
      void reconcileProjectEditors(event.rootPath);
    });
    return unsubscribe;
  }, [invalidateQuickAccessCache, reconcileProjectEditors]);

  useEffect(() => {
    const onFocus = () => {
      if (!activeRef.current || !selectedProjectRef.current) return;
      void fileExplorerRef.current?.refresh();
      void reconcileProjectEditors(selectedProjectRef.current);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reconcileProjectEditors]);

  const {
    searchQuery,
    setSearchQuery,
    searchMatchCase,
    setSearchMatchCase,
    searchWholeWord,
    setSearchWholeWord,
    searchUseRegex,
    setSearchUseRegex,
    searchTruncated,
    searchLoading,
    searchError,
    searchExpanded,
    setSearchExpanded,
    searchSelectedKey,
    setSearchSelectedKey,
    searchProjectMode,
    setSearchProjectMode,
    searchProjectQuery,
    setSearchProjectQuery,
    searchProjectSelectionId,
    setSearchProjectSelectionId,
    searchFilesInclude,
    setSearchFilesInclude,
    searchFilesExclude,
    setSearchFilesExclude,
    searchDetailsOpen,
    searchReplaceOpen,
    searchReplaceText,
    setSearchReplaceText,
    searchReplacing,
    searchInputRef,
    searchReplaceInputRef,
    searchIncludeInputRef,
    searchExcludeInputRef,
    searchTimerRef,
    searchGroups,
    searchFileCount,
    searchMatchCount,
    searchReplaceVisible,
    runProjectSearch,
    performSearchReplace,
    findInExplorerFolder,
    toggleSearchDetails,
    toggleSearchReplace,
    resetSearchProjectMode
  } = useWorkbenchSearch({
    projects: sideRoots,
    projectForPath,
    side,
    getDirtyEditorPaths: (projectPath) => editorsRef.current
      .filter((editor) => editor.projectPath === projectPath && editor.dirty)
      .map((editor) => editor.path),
    onStatus: setStatus,
    onReconcileEditors: (projectPath) => { void reconcileProjectEditors(projectPath); },
    onOpenSearchSide: () => setSide("search")
  });

  useEffect(() => {
    if (!currentEditor) return;
    const pending = pendingRevealRef.current;
    if (!pending) return;
    const pendingNorm = pending.path.replaceAll("\\", "/");
    const editorNorm = currentEditor.path.replaceAll("\\", "/");
    const pathMatches =
      pendingNorm === editorNorm
      || pendingNorm.endsWith(`/${editorNorm}`)
      || editorNorm.endsWith(`/${pendingNorm}`);
    if (!pathMatches) return;
    const handle = editorRef.current;
    if (!handle) return;
    // Wait a frame so CodeMirror mounts with the new document.
    const timer = window.requestAnimationFrame(() => {
      if (!pendingRevealRef.current) return;
      handle.revealRange({
        line: pending.line,
        column: pending.column,
        endColumn: pending.endColumn
      });
      pendingRevealRef.current = null;
    });
    return () => window.cancelAnimationFrame(timer);
  }, [currentEditor, activePane]);

  const openDiff = async (change: GitChange, staged: boolean, projectPath = selectedProjectRef.current) => {
    if (!projectPath) return;
    const key = `diff:${change.repoRoot}:${change.repoPath}:${staged}`;
    if (diffsRef.current.some((item) => item.key === key)) {
      setActivePane(key, projectPath);
      return;
    }
    try {
      const result = await desktopApi().terminalGitDiffSides({ cwd: change.repoRoot, path: change.repoPath, staged });
      const source = staged ? "staged" : change.status === "?" ? "untracked" : "working-tree";
      setDiffs((current) => [...current, {
        key,
        projectPath,
        workbenchId: activeWorkbenchIdRef.current ?? undefined,
        repoRoot: change.repoRoot,
        repoPath: change.repoPath,
        path: change.path,
        source,
        ...result
      }]);
      setActivePane(key, projectPath);
    } catch (error) { notifyGitFailure("desktop.workbench.sidePanelDiffFailed", error); }
  };

  const matchCachedGitChange = (filePath: string): { change: GitChange; staged: boolean } | null => {
    const target = normalizeWorkbenchPath(filePath);
    const cached = gitRef.current;
    if (!cached) return null;
    const matchIn = (entries: GitChange[]) => entries.find((change) => {
      const abs = normalizeWorkbenchPath(gitChangeFilePath(change));
      const display = normalizeWorkbenchPath(change.path);
      return abs === target || display === target || target.endsWith(`/${display}`);
    });
    const unstaged = matchIn(cached.unstaged);
    if (unstaged) return { change: unstaged, staged: false };
    const staged = matchIn(cached.staged);
    if (staged) return { change: staged, staged: true };
    return null;
  };

  const openDiffForPath = async (projectPath: string, filePath: string) => {
    const absPath = normalizeWorkbenchPath(filePath);
    const root = normalizeWorkbenchPath(projectPath);
    const relative = absPath === root
      ? ""
      : absPath.startsWith(`${root}/`)
        ? absPath.slice(root.length + 1)
        : absPath;
    if (!relative) {
      await openFile(absPath, undefined, projectPath);
      return;
    }
    const cached = matchCachedGitChange(absPath);
    if (cached) {
      await openDiff(cached.change, cached.staged, projectPath);
      return;
    }
    const addDiffPane = (
      result: Awaited<ReturnType<DesktopApi["terminalGitDiffSides"]>>,
      staged: boolean
    ) => {
      const repoRoot = projectPath;
      const key = `diff:${repoRoot}:${relative}:${staged}`;
      if (diffsRef.current.some((item) => item.key === key)) {
        setActivePane(key, projectPath);
        return;
      }
      setDiffs((current) => [...current, {
        key,
        projectPath,
        workbenchId: activeWorkbenchIdRef.current ?? undefined,
        repoRoot,
        repoPath: relative,
        path: relative,
        source: staged ? "staged" : "working-tree",
        ...result
      }]);
      setActivePane(key, projectPath);
    };
    try {
      const working = await desktopApi().terminalGitDiffSides({ cwd: projectPath, path: relative, staged: false });
      if (working.hunks.length) {
        addDiffPane(working, false);
        return;
      }
    } catch {
      // Fall through to staged / editor.
    }
    try {
      const stagedDiff = await desktopApi().terminalGitDiffSides({ cwd: projectPath, path: relative, staged: true });
      if (stagedDiff.hunks.length) {
        addDiffPane(stagedDiff, true);
        return;
      }
    } catch {
      // Fall through to editor.
    }
    notifyDesktop({ text: t("desktop.workbench.noGitDiffFallback"), kind: "info" });
    await openFile(absPath, undefined, projectPath);
  };
  openDiffForPathRef.current = openDiffForPath;

  const discardGitChanges = async (changes: GitChange[], targetPath: string, isDirectory: boolean) => {
    const uniqueChanges = uniqueGitChanges(changes);
    const keys = uniqueChanges.map(gitChangeKey);
    if (!uniqueChanges.length || keys.some((key) => discardingGitPaths.has(key))) return;
    const confirmMessage = isDirectory
      ? t("desktop.workbench.gitDiscardDirectoryConfirm", targetPath, uniqueChanges.length)
      : t(
          uniqueChanges[0]!.status === "?"
            ? "desktop.workbench.gitDiscardUntrackedConfirm"
            : "desktop.workbench.gitDiscardConfirm",
          targetPath
        );
    if (!(await confirmDestructive(confirmMessage, t("desktop.common.discard")))) return;
    setDiscardingGitPaths((current) => {
      const next = new Set(current);
      keys.forEach((key) => next.add(key));
      return next;
    });
    const succeeded: GitChange[] = [];
    const failures: unknown[] = [];
    try {
      for (const change of uniqueChanges) {
        try {
          await desktopApi().terminalGitDiscardChange({ repoRoot: change.repoRoot, path: change.repoPath });
          succeeded.push(change);
        } catch (error) {
          failures.push(error);
        }
      }
      if (succeeded.length) {
        const succeededPaneKeys = new Set(succeeded.map((change) => `${change.repoRoot}\0${change.path}`));
        setDiffs((current) => current.filter((pane) => !succeededPaneKeys.has(`${pane.repoRoot}\0${pane.path}`)));
        setActivePanes((current) => {
          const projectKey = paneProjectKey(selectedProject);
          const active = current[projectKey];
          const activeWasDiscarded = succeeded.some((change) => active?.startsWith(`diff:${change.repoRoot}:${change.repoPath}:`));
          return activeWasDiscarded ? { ...current, [projectKey]: "" } : current;
        });
      }
      await refreshGit();
      currentTerminals.forEach((pane) => void refreshTerminalGit(pane.key));
      if (!failures.length) {
        notifyGitSuccess("desktop.workbench.gitDiscardSucceeded", targetPath);
      } else if (isDirectory) {
        const message = t(
          "desktop.workbench.gitDiscardDirectoryPartial",
          succeeded.length,
          uniqueChanges.length,
          targetPath,
          gitOperationError(failures[0])
        );
        setStatus({ text: message, kind: "error" });
        notifyDesktop({ text: message, kind: "error" });
      } else {
        notifyGitFailure("desktop.workbench.gitDiscardFailed", failures[0]);
      }
    } finally {
      setDiscardingGitPaths((current) => {
        const next = new Set(current);
        keys.forEach((key) => next.delete(key));
        return next;
      });
    }
  };

  const discardGitChange = async (change: GitChange) => {
    await discardGitChanges([change], change.path, false);
  };

  const discardGitDirectory = async (changes: GitChange[], directoryPath: string) => {
    await discardGitChanges(changes, directoryPath, true);
  };

  const refreshGitDiffAfterDiscard = async (pane: DiffPane) => {
    const refreshed = await desktopApi().terminalGitDiffSides({
      cwd: pane.repoRoot,
      path: pane.repoPath,
      staged: pane.source === "staged"
    });
    if (!refreshed.hunks.length) {
      setDiffs((current) => current.filter((item) => item.key !== pane.key));
      if (activePane === pane.key) setActivePane("");
    } else {
      setDiffs((current) => current.map((item) => item.key === pane.key ? { ...item, ...refreshed } : item));
    }
    await refreshGit();
    currentTerminals.forEach((terminal) => void refreshTerminalGit(terminal.key));
  };

  const discardGitHunk = async (pane: DiffPane, target: WorkbenchDiffHunkTarget) => {
    if (pane.source !== "working-tree" && pane.source !== "staged") return;
    const confirmMessage = pane.source === "staged"
      ? t("desktop.workbench.gitDiscardHunkStagedConfirm", pane.path)
      : t("desktop.workbench.gitDiscardHunkConfirm", pane.path);
    if (!(await confirmDestructive(confirmMessage, t("desktop.common.discard")))) return;
    try {
      await desktopApi().terminalGitDiscardHunk({
        repoRoot: pane.repoRoot,
        path: pane.repoPath,
        staged: pane.source === "staged",
        target
      });
      await refreshGitDiffAfterDiscard(pane);
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitDiscardFailed", error);
    }
  };

  const discardGitLine = async (pane: DiffPane, target: WorkbenchDiffLineTarget) => {
    if (pane.source !== "working-tree" && pane.source !== "staged") return;
    const confirmMessage = pane.source === "staged"
      ? t("desktop.workbench.gitDiscardLineStagedConfirm", pane.path)
      : t("desktop.workbench.gitDiscardLineConfirm", pane.path);
    if (!(await confirmDestructive(confirmMessage, t("desktop.common.discard")))) return;
    try {
      await desktopApi().terminalGitDiscardLine({
        repoRoot: pane.repoRoot,
        path: pane.repoPath,
        staged: pane.source === "staged",
        target
      });
      await refreshGitDiffAfterDiscard(pane);
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitDiscardFailed", error);
    }
  };

  const stageGitHunk = async (pane: DiffPane, target: WorkbenchDiffHunkTarget) => {
    if (pane.source !== "working-tree") return;
    try {
      await desktopApi().terminalGitStageHunk({
        repoRoot: pane.repoRoot,
        path: pane.repoPath,
        target
      });
      await refreshGitDiffAfterDiscard(pane);
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitStageHunkFailed", error);
    }
  };

  const unstageGitHunk = async (pane: DiffPane, target: WorkbenchDiffHunkTarget) => {
    if (pane.source !== "staged") return;
    try {
      await desktopApi().terminalGitUnstageHunk({
        repoRoot: pane.repoRoot,
        path: pane.repoPath,
        target
      });
      await refreshGitDiffAfterDiscard(pane);
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitUnstageHunkFailed", error);
    }
  };

  const stageGitLine = async (pane: DiffPane, target: WorkbenchDiffLineTarget) => {
    if (pane.source !== "working-tree") return;
    try {
      await desktopApi().terminalGitStageLine({
        repoRoot: pane.repoRoot,
        path: pane.repoPath,
        target
      });
      await refreshGitDiffAfterDiscard(pane);
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitStageLineFailed", error);
    }
  };

  const unstageGitLine = async (pane: DiffPane, target: WorkbenchDiffLineTarget) => {
    if (pane.source !== "staged") return;
    try {
      await desktopApi().terminalGitUnstageLine({
        repoRoot: pane.repoRoot,
        path: pane.repoPath,
        target
      });
      await refreshGitDiffAfterDiscard(pane);
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitUnstageLineFailed", error);
    }
  };

  const openGitShowFileDiff = async (hash: string, path: string) => {
    const repoRoot = gitHistoryContext?.repoRoot || gitRoot;
    if (!repoRoot) return;
    try {
      const result = await desktopApi().terminalGitShowFileDiffSides({ repoRoot, hash, path });
      if (!selectedProject) return;
      const key = `logdiff:${repoRoot}:${hash}:${path}`;
      setDiffs((current) => current.some((item) => item.key === key) ? current : [...current, {
        key,
        projectPath: selectedProject,
        workbenchId: activeWorkbenchIdRef.current ?? undefined,
        repoRoot,
        repoPath: path,
        path,
        source: "commit",
        ...result
      }]);
      setActivePane(key);
    } catch (error) { notifyGitFailure("desktop.workbench.sidePanelDiffFailed", error); }
  };

  const loadGitLog = async () => {
    if (!gitRoot) return;
    const requestId = gitLogRequestRef.current + 1;
    gitLogRequestRef.current = requestId;
    setGitHistoryContext({ kind: "repository", repoRoot: gitRoot });
    setGitLogLoading(true);
    setGitLogError("");
    try {
      setGitShow(null);
      const result = await desktopApi().terminalGitLog({ repoRoot: gitRoot, limit: 150 });
      if (gitLogRequestRef.current !== requestId) return;
      setGitLog(result);
    } catch (error) {
      if (gitLogRequestRef.current !== requestId) return;
      setGitLog(null);
      setGitLogError(gitOperationError(error));
      notifyGitFailure("desktop.workbench.gitLogLoadFailed", error);
    } finally {
      if (gitLogRequestRef.current === requestId) setGitLogLoading(false);
    }
  };

  const loadGitFileHistory = async (filePath: string) => {
    const projectRoot = projectForPath(filePath) || selectedProject;
    if (!projectRoot) return;
    const requestId = gitLogRequestRef.current + 1;
    gitLogRequestRef.current = requestId;
    setSide("git");
    setGitHistoryContext({ kind: "file", projectRoot, filePath, repoRoot: "", repoPath: "" });
    setGitLog(null);
    setGitShow(null);
    setGitLogLoading(true);
    setGitLogError("");
    try {
      const result = await desktopApi().workbenchGitFileLog({ rootPath: projectRoot, filePath, limit: 150 });
      if (gitLogRequestRef.current !== requestId || selectedProjectRef.current !== projectRoot) return;
      setGitHistoryContext({
        kind: "file",
        projectRoot,
        filePath,
        repoRoot: result.repoRoot,
        repoPath: result.repoPath
      });
      setGitLog({ commits: result.commits, layout: result.layout });
    } catch (error) {
      if (gitLogRequestRef.current !== requestId || selectedProjectRef.current !== projectRoot) return;
      setGitLogError(gitOperationError(error));
      notifyGitFailure("desktop.workbench.gitFileHistoryLoadFailed", error);
    } finally {
      if (gitLogRequestRef.current === requestId) setGitLogLoading(false);
    }
  };

  const showCommit = async (commit: GitLogCommit) => {
    const repoRoot = gitHistoryContext?.repoRoot || gitRoot;
    if (!repoRoot) return;
    try {
      setGitShow(await desktopApi().terminalGitShow({ repoRoot, hash: commit.hash }));
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitShowLoadFailed", error);
      return;
    }
    // File history opens the commit's diff in the workbench middle area; the
    // repository-wide log only shows commit details and never auto-opens diffs.
    if (gitHistoryContext?.kind === "file") {
      const pathAtCommit = commit.pathAtCommit || gitHistoryContext.repoPath;
      if (pathAtCommit) await openGitShowFileDiff(commit.hash, pathAtCommit);
    }
  };

  /**
   * Commit menu. Native: system highlight and edge flipping, keyboard driven,
   * and the destructive Revert entry sits last after a separator.
   */
  const openGitLogContextMenu = async (event: { clientX: number; clientY: number; target: EventTarget | null }, commit: GitLogCommit) => {
    const branchName = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-branch-name]")?.dataset.branchName
        || gitCommitBranchNames(commit)[0]
        || null
      : gitCommitBranchNames(commit)[0] || null;
    const choice = await showContextMenuAt(contextMenuPoint(event), [
      { id: "copy-hash", label: t("desktop.workbench.gitCopyCommitHash") },
      ...(branchName ? [{ id: "copy-branch", label: t("desktop.workbench.gitCopyBranchName") }] : []),
      { type: "separator" },
      { id: "cherry-pick", label: t("desktop.workbench.gitCherryPick") },
      { id: "new-branch", label: t("desktop.workbench.gitNewBranchFromCommit") },
      { id: "checkout", label: t("desktop.workbench.gitCheckoutCommit") },
      { id: "reset", label: t("desktop.workbench.gitReset") },
      { type: "separator" },
      { id: "merge", label: t("desktop.workbench.gitMerge") },
      { id: "revert", label: t("desktop.workbench.gitRevert") }
    ]);
    if (choice === "copy-hash") desktopApi().clipboardWriteText?.(commit.hash);
    else if (choice === "copy-branch" && branchName) desktopApi().clipboardWriteText?.(branchName);
    else if (choice === "cherry-pick") void cherryPickGitLogCommit(commit);
    else if (choice === "new-branch") setGitLogDialog({ kind: "branch", commit });
    else if (choice === "checkout") void checkoutGitLogCommit(commit);
    else if (choice === "reset") setGitLogDialog({ kind: "reset", commit });
    else if (choice === "merge") void mergeGitLogCommit(commit);
    else if (choice === "revert") void revertGitLogCommit(commit);
  };

  const copyGitLogValue = (value: string) => {
    desktopApi().clipboardWriteText?.(value);
  };

  const revertGitLogCommit = async (commit: GitLogCommit) => {
    const repoRoot = gitHistoryContext?.repoRoot || gitRoot;
    if (!repoRoot) return;
    const label = commit.subject || commit.shortHash;
    if (!(await confirmDestructive(t("desktop.workbench.gitRevertConfirm", label), t("desktop.workbench.gitRevert")))) return;
    try {
      await desktopApi().terminalGitRevert({ repoRoot, hash: commit.hash });
      notifyGitSuccess("desktop.workbench.gitRevertSucceeded", commit.shortHash);
      await refreshGit();
      if (gitHistoryContext?.kind === "file") {
        await loadGitFileHistory(gitHistoryContext.filePath);
      } else {
        await loadGitLog();
      }
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitRevertFailed", error);
    }
  };

  const mergeGitLogCommit = async (commit: GitLogCommit) => {
    const repoRoot = gitHistoryContext?.repoRoot || gitRoot;
    if (!repoRoot) return;
    const label = commit.subject || commit.shortHash;
    if (!(await confirmDestructive(t("desktop.workbench.gitMergeConfirm", label), t("desktop.workbench.gitMerge")))) return;
    try {
      await desktopApi().terminalGitMerge({ repoRoot, hash: commit.hash });
      notifyGitSuccess("desktop.workbench.gitMergeSucceeded");
      await refreshGit();
      if (gitHistoryContext?.kind === "file") {
        await loadGitFileHistory(gitHistoryContext.filePath);
      } else {
        await loadGitLog();
      }
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitMergeFailed", error);
    }
  };

  const cherryPickGitLogCommit = async (commit: GitLogCommit) => {
    const repoRoot = gitHistoryContext?.repoRoot || gitRoot;
    if (!repoRoot) return;
    const label = commit.subject || commit.shortHash;
    if (!(await confirmDestructive(t("desktop.workbench.gitCherryPickConfirm", label), t("desktop.workbench.gitCherryPick")))) return;
    try {
      await desktopApi().terminalGitCherryPick({ repoRoot, hash: commit.hash });
      notifyGitSuccess("desktop.workbench.gitCherryPickSucceeded", commit.shortHash);
      await refreshGit();
      if (gitHistoryContext?.kind === "file") {
        await loadGitFileHistory(gitHistoryContext.filePath);
      } else {
        await loadGitLog();
      }
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitCherryPickFailed", error);
    }
  };

  const checkoutGitLogCommit = async (commit: GitLogCommit) => {
    const repoRoot = gitHistoryContext?.repoRoot || gitRoot;
    if (!repoRoot) return;
    const label = commit.subject || commit.shortHash;
    if (!(await confirmDestructive(t("desktop.workbench.gitCheckoutCommitConfirm", label), t("desktop.workbench.gitCheckoutCommit")))) return;
    try {
      await desktopApi().terminalGitCheckoutCommit({ repoRoot, hash: commit.hash });
      notifyGitSuccess("desktop.workbench.gitCheckoutCommitSucceeded", commit.shortHash);
      await refreshGit();
      if (gitHistoryContext?.kind === "file") {
        await loadGitFileHistory(gitHistoryContext.filePath);
      } else {
        await loadGitLog();
      }
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitCheckoutCommitFailed", error);
    }
  };

  const resetGitLogCommit = async (commit: GitLogCommit, mode: "soft" | "mixed" | "hard") => {
    const repoRoot = gitHistoryContext?.repoRoot || gitRoot;
    if (!repoRoot || gitLogDialogBusyRef.current) return;
    const label = commit.subject || commit.shortHash;
    if (!(await confirmDestructive(t("desktop.workbench.gitResetConfirm", label, t(`desktop.workbench.gitResetMode${mode === "soft" ? "Soft" : mode === "mixed" ? "Mixed" : "Hard"}`)), t("desktop.workbench.gitReset")))) return;
    gitLogDialogBusyRef.current = true;
    setGitLogDialog(null);
    try {
      await desktopApi().terminalGitReset({ repoRoot, hash: commit.hash, mode });
      notifyGitSuccess("desktop.workbench.gitResetSucceeded", commit.shortHash);
      await refreshGit();
      if (gitHistoryContext?.kind === "file") {
        await loadGitFileHistory(gitHistoryContext.filePath);
      } else {
        await loadGitLog();
      }
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitResetFailed", error);
    } finally {
      gitLogDialogBusyRef.current = false;
    }
  };

  const createBranchFromGitLogCommit = async (commit: GitLogCommit, rawName: string) => {
    const repoRoot = gitHistoryContext?.repoRoot || gitRoot;
    if (!repoRoot || gitLogDialogBusyRef.current) return;
    const branch = rawName.trim();
    if (!branch) return;
    gitLogDialogBusyRef.current = true;
    setGitLogDialog(null);
    try {
      await desktopApi().terminalGitBranchFromCommit({ repoRoot, hash: commit.hash, branch });
      notifyGitSuccess("desktop.workbench.gitBranchFromCommitSucceeded", branch);
      await refreshGit();
      if (gitHistoryContext?.kind === "file") {
        await loadGitFileHistory(gitHistoryContext.filePath);
      } else {
        await loadGitLog();
      }
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitBranchFromCommitFailed", error);
    } finally {
      gitLogDialogBusyRef.current = false;
    }
  };

  const closeGitLogDialog = () => {
    if (gitLogDialogBusyRef.current) return;
    setGitLogDialog(null);
  };

  const closeGitHistory = () => {
    const returnToExplorer = gitHistoryContext?.kind === "file";
    gitLogRequestRef.current += 1;
    setGitHistoryContext(null);
    setGitLog(null);
    setGitShow(null);
    setGitLogLoading(false);
    setGitLogError("");
    if (returnToExplorer) setSide("files");
  };

  const retryGitHistory = () => {
    if (gitHistoryContext?.kind === "file") {
      void loadGitFileHistory(gitHistoryContext.filePath);
    } else {
      void loadGitLog();
    }
  };

  const openBranchMenu = async (pane: TerminalPane, anchor: HTMLButtonElement) => {
    try {
      const rect = anchor.getBoundingClientRect();
      setBranchMenuPosition({
        right: Math.max(8, window.innerWidth - rect.right),
        // Detail-head button: open menu below the chip (was bottom-anchored when status lived under the terminal).
        top: Math.min(window.innerHeight - 16, rect.bottom + 6)
      });
      setBranchPane(pane);
      setBranchResult(null);
      const workbench = settingsRef.current?.workbench;
      const result = await desktopApi().terminalGitBranches({
        cwd: pane.cwd,
        nestedScan: {
          maxDepth: workbench?.gitNestedScanMaxDepth,
          ignoreDirs: workbench?.gitNestedScanIgnoreDirs
        }
      });
      setBranchResult(result);
    } catch (error) { notifyGitFailure("desktop.workbench.loadBranchesFailed", error); }
  };

  const checkoutBranch = async (branch: string, repoRoot?: string | null) => {
    if (!branchPane) return;
    try {
      await desktopApi().terminalGitCheckout({ cwd: branchPane.cwd, branch, repoRoot: repoRoot || branchPane.repoRoot || undefined });
      setBranchPane(null);
      setBranchResult(null);
      await refreshTerminalGit(branchPane.key);
      await refreshGit();
      notifyGitSuccess("desktop.workbench.checkoutBranchSucceeded", branch);
    } catch (error) { notifyGitFailure("desktop.workbench.checkoutBranchFailed", error); }
  };

  const renderBranchMenu = (): React.JSX.Element | React.JSX.Element[] => {
    if (!branchResult) return <p className="wb-git-branch-empty muted">{t("desktop.common.loading")}</p>;
    if (branchResult.mode === "nested") {
      if (!branchResult.repos?.length) return <p className="wb-git-branch-empty muted">{t("desktop.workbench.noGitBranches")}</p>;
      return branchResult.repos.map((repo) => <div className="wb-git-branch-repo-group" key={repo.root}>
        <div className="wb-git-branch-repo-head">{repo.displayPath || repo.root || t("desktop.workbench.nestedRepoUntitled")}</div>
        {repo.branches.length ? repo.branches.map((branch) => <button type="button" className={`wb-git-branch-item${branch === repo.current ? " active" : ""}`} key={branch} onClick={() => void checkoutBranch(branch, repo.root)}>{branch}</button>) : <p className="wb-git-branch-empty muted">{t("desktop.workbench.noGitBranches")}</p>}
      </div>);
    }
    const branches = branchResult.branches || [];
    if (!branches.length) return <p className="wb-git-branch-empty muted">{t("desktop.workbench.noGitBranches")}</p>;
    return branches.map((branch) => <button type="button" className={`wb-git-branch-item${branch === (branchResult.current ?? branchPane?.branch) ? " active" : ""}`} key={branch} onClick={() => void checkoutBranch(branch, branchResult.repoRoot)}>{branch}</button>);
  };

  useEffect(() => {
    const data = desktopApi().onTerminalData(({ id, data: value }) => {
      const terminal = terminalRefs.current.get(id);
      if (!terminal) return;
      trackTerminalMouseModes(id, value, terminalMouseTrackingRef.current);
      trackTuiRedraw(value, terminal);
      terminal.write(value);
    });
    const exited = desktopApi().onTerminalExit(({ id }) => {
      terminalRefs.current.get(id)?.write(`\r\n${t("desktop.workbench.terminalClosed")}\r\n`);
      const pane = terminalsRef.current.find((item) => item.ptyId === id);
      if (pane) scheduleSessionPaneAutoRename(pane);
    });
    const respawned = desktopApi().onTerminalRespawned(({ id }) => terminalRefs.current.get(id)?.write(`\r\n${t("desktop.workbench.shellRestored")}\r\n`));
    return () => { data(); exited(); respawned(); };
  }, [scheduleSessionPaneAutoRename, t]);

  const changes = git ? [{ title: t("desktop.workbench.sidePanelStaged"), staged: true, entries: git.staged }, { title: t("desktop.workbench.sidePanelChanges"), staged: false, entries: git.unstaged }] : [];
  const setWidth = (kind: "list" | "side", delta: number) => {
    const current = kind === "list" ? listWidth : sideWidth;
    const limits = kind === "list" ? [240, 720] : [240, 840];
    const next = Math.max(limits[0], Math.min(limits[1], current + delta));
    if (kind === "list") { setListWidth(next); writeWorkbenchValue(LIST_WIDTH_KEY, activeWorkbenchIdRef.current, String(next)); }
    else { setSideWidth(next); writeWorkbenchValue(SIDE_WIDTH_KEY, activeWorkbenchIdRef.current, String(next)); }
  };

  const contextMenuWidth = contextMenu?.kind === "session" || contextMenu?.kind === "session-tab" ? 210 : 240;
  const contextMenuHeight = (() => {
    if (!contextMenu) return 320;
    switch (contextMenu.kind) {
      case "session-tab":
      case "editor-tab":
      case "task":
        return 64;
      case "session":
        return 462;
      case "note":
        return 220;
      default:
        return 320;
    }
  })();
  const contextMenuLeft = contextMenu
    ? Math.max(8, Math.min(contextMenu.x, window.innerWidth - contextMenuWidth - 8))
    : 8;
  // Both of these are DOM menus (the GTD tag grid and the agent picker have no
  // NSMenu equivalent), so they get the measured position and the keyboard
  // behaviour from the shared hook instead of guessed clamps.
  const closeContextMenu = useCallback(() => setContextMenu(null), [setContextMenu]);
  useMenuPosition(
    Boolean(contextMenu) && !contextMenuClosing,
    contextMenuRef,
    { x: contextMenu?.x ?? 0, y: contextMenu?.y ?? 0 }
  );
  useMenuKeyboard(Boolean(contextMenu) && !contextMenuClosing, contextMenuRef, closeContextMenu);

  const editorDiskAlert = currentEditor?.diskState ? <div
    className={`wb-editor-disk-alert is-${currentEditor.diskState}`}
    role="alert"
  >
    <span>{t(currentEditor.diskState === "changed"
      ? "desktop.workbench.fileConflict"
      : currentEditor.diskState === "deleted"
        ? "desktop.workbench.fileDeletedOnDisk"
        : "desktop.workbench.fileUnavailableOnDisk")}</span>
    <div className="wb-editor-disk-actions">
      {currentEditor.diskState === "changed" ? <>
        <button type="button" onClick={() => {
          void (async () => {
            if (!currentEditor.dirty || (await confirmDestructive(t("desktop.workbench.fileReloadConfirm"), t("desktop.common.discard")))) {
              void reloadEditorFromDisk(currentEditor.key);
            }
          })();
        }}>{t("desktop.workbench.fileReload")}</button>
        <button type="button" disabled={editorSettings?.editable === false} onClick={() => void saveEditor(currentEditor.key, true)}>{t("desktop.workbench.fileOverwrite")}</button>
      </> : currentEditor.diskState === "deleted" ?
        <button type="button" disabled={editorSettings?.editable === false} onClick={() => {
          void (async () => {
            if (await confirmDestructive(t("desktop.workbench.fileRecreateConfirm", basename(currentEditor.path)), t("desktop.workbench.fileRecreate"))) {
              void recreateEditorFile(currentEditor.key);
            }
          })();
        }}>{t("desktop.workbench.fileRecreate")}</button>
        : <button type="button" onClick={() => void desktopApi().workbenchOpenPath({
          rootPath: currentEditor.projectPath,
          filePath: currentEditor.path
        })}>{t("desktop.workbench.fileOpenDefault")}</button>}
    </div>
  </div> : null;

  const quickAccessRecentPaths = (() => {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const root of sideRoots) {
      for (const key of paneHistoryRef.current[paneProjectKey(root)] || []) {
        if (!key.startsWith("editor:")) continue;
        const path = key.slice("editor:".length);
        if (seen.has(path)) continue;
        seen.add(path);
        paths.push(path);
      }
    }
    return paths;
  })();
  /**
   * The local folders a task references — its shared workspace — enriched from
   * the catalog so labels, pinned state and path-missing hints still apply. The
   * Search root picker stays inside the task's own folders.
   */
  const workspaceRootOptions = useMemo<SearchRootOption[]>(() => {
    if (!taskScope) return [];
    const knownByPath = new Map(allProjects.map((project) => [projectPathKey(project.path), project]));
    return sideRootProjects.map((path) => {
      const known = knownByPath.get(projectPathKey(path));
      const missing = known?.pathMissing === true;
      return {
        id: known?.id || path,
        path,
        label: aliases[path] || known?.label || basename(path),
        detail: missing ? t("desktop.workbench.pathMissingLabel", known?.portableKey || path) : path,
        pinned: known?.pinned,
        disabledReason: missing ? t("desktop.workbench.pathMissingHint") : undefined
      };
    });
  }, [aliases, allProjects, sideRootProjects, t, taskScope]);

  /**
   * The `#` menu in a session running in the shared workspace offers the task's
   * referenced repositories (their folders live outside the workspace cwd).
   */
  const composerWorkspaceProjects = useMemo<ComposerWorkspaceProject[]>(
    () => workspaceRootOptions
      .filter((option) => !option.disabledReason)
      .map((option) => ({ label: option.label, path: option.path })),
    [workspaceRootOptions]
  );

  const searchRootOptions = useMemo<SearchRootOption[]>(() => {
    if (taskScope) return workspaceRootOptions;
    return allProjects.map((project) => ({
      id: project.id,
      path: project.path,
      label: project.label,
      detail: project.pathMissing
        ? t("desktop.workbench.pathMissingLabel", project.portableKey)
        : project.path,
      pinned: project.pinned,
      disabledReason: project.pathMissing ? t("desktop.workbench.pathMissingHint") : undefined
    }));
  }, [allProjects, t, taskScope, workspaceRootOptions]);
  const searchProjectResults = useMemo(
    () => rankSearchRootOptions(searchRootOptions, searchProjectQuery),
    [searchRootOptions, searchProjectQuery]
  );
  const searchProjectResultIds = searchProjectResults.map((project) => project.id);
  const searchProjectResultSignature = searchProjectResultIds.join("\0");
  const searchProjectCurrentPath = taskScope
    ? (sideRoots.length === 1 ? sideRoots[0] : "")
    : (selectedProjectMeta?.path || selectedProject || "");
  const searchProjectCurrentId = !searchProjectQuery.trim()
    ? searchProjectResults.find((project) => projectPathKey(project.path) === projectPathKey(searchProjectCurrentPath))?.id || ""
    : "";
  const searchProjectSelectedIndex = searchProjectSelectionId
    ? searchProjectResultIds.indexOf(searchProjectSelectionId)
    : -1;
  const searchProjectActiveIndex = searchProjectSelectedIndex >= 0
    ? searchProjectSelectedIndex
    : searchProjectResults.length ? 0 : -1;
  const searchProjectActive = searchProjectActiveIndex >= 0
    ? searchProjectResults[searchProjectActiveIndex]
    : undefined;
  const searchProjectOptionId = (projectId: string) => `wb-search-project-${encodeURIComponent(projectId)}`;

  useEffect(() => {
    if (!searchProjectMode) return;
    setSearchProjectSelectionId((current) => {
      if (current && searchProjectResultIds.includes(current)) return current;
      return searchProjectCurrentId || searchProjectResultIds[0] || "";
    });
  }, [searchProjectCurrentId, searchProjectMode, searchProjectResultSignature]);

  useEffect(() => {
    if (!searchProjectMode || !searchProjectActive) return;
    searchProjectOptionRefs.current.get(searchProjectActive.id)?.scrollIntoView?.({ block: "nearest" });
  }, [searchProjectActive?.id, searchProjectMode]);

  const enterSearchProjectMode = () => {
    setSearchProjectQuery("");
    setSearchProjectSelectionId("");
    setSearchProjectMode(true);
  };
  const leaveSearchProjectMode = () => {
    setSearchProjectMode(false);
    setSearchProjectQuery("");
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  };
  const moveSearchProjectSelection = (offset: -1 | 1) => {
    if (!searchProjectResults.length) return;
    const currentIndex = searchProjectActiveIndex >= 0
      ? searchProjectActiveIndex
      : offset > 0 ? -1 : 0;
    const nextIndex = (currentIndex + offset + searchProjectResults.length) % searchProjectResults.length;
    setSearchProjectSelectionId(searchProjectResults[nextIndex].id);
  };
  const activateSearchProject = (project = searchProjectActive) => {
    if (!project || project.disabledReason) return;
    if (taskScopeRef.current) setSessionTarget(project.path);
    selectProject(project.path, { keepSide: true });
    leaveSearchProjectMode();
  };
  const searchProjectLabel = taskScope
    ? (sideRoots.length === 1
      ? (aliases[sideRoots[0]] || basename(sideRoots[0]))
      : sideRoots.length > 1
        ? t("desktop.workbench.sharedWorkspace")
        : t("desktop.workbench.quickAccessSelectProject"))
    : selectedProjectMeta
      ? `${selectedProjectMeta.label} — ${selectedProjectMeta.path}`
      : t("desktop.workbench.quickAccessSelectProject");
  const noProjectReason = sideRoots.length ? undefined : t("desktop.workbench.quickAccessNoProjectCommand");
  const macShortcuts = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const shortcut = (key: string) => macShortcuts ? `⌘${key}` : `Ctrl+${key}`;
  const openWorkbenchView = (view?: SideView) => {
    closeQuickAccess();
    if (quickAccessRoot) selectProject(quickAccessRoot);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    if (view) setSide(view);
    if (view === "search") resetSearchProjectMode();
  };
  const navigateToWorkbench = () => {
    closeQuickAccess();
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
  };
  const navigateToGtd = () => {
    closeQuickAccess();
    window.dispatchEvent(new CustomEvent("agent-resume:view-gtd"));
  };
  /** Switching tasks is the palette's context switch: workbench roots follow the task. */
  const openQuickAccessTask = (task: WorkbenchTask) => {
    closeQuickAccess();
    window.dispatchEvent(new CustomEvent("agent-resume:view-open-task", {
      detail: { ...task, projects: task.projects ?? [] }
    }));
  };
  const quickAccessCommands: QuickAccessCommand[] = [
    // 1. Navigation / 导航
    {
      id: "view.workbench",
      label: t("desktop.workbench.quickAccessShowWorkbench"),
      category: t("desktop.workbench.quickAccessCategoryNavigation"),
      keywords: "view workbench switch surface",
      run: navigateToWorkbench
    },
    {
      id: "view.gtd",
      label: t("desktop.workbench.quickAccessShowGtd"),
      category: t("desktop.workbench.quickAccessCategoryNavigation"),
      keywords: "view gtd board tasks kanban",
      run: navigateToGtd
    },
    // 2. Workspace & Context / 工作区与上下文
    {
      id: "workbench.exitTask",
      label: t("desktop.workbench.quickAccessExitTask"),
      category: t("desktop.workbench.quickAccessCategoryWorkspace"),
      keywords: "exit close clear task task workspace",
      disabledReason: taskScope ? undefined : t("desktop.workbench.taskNoProject"),
      run: () => {
        closeQuickAccess();
        window.dispatchEvent(new CustomEvent("agent-resume:workbench-task-clear"));
      }
    },
    // 3. Tasks / 任务
    ...tasks.map((item): QuickAccessCommand => ({
      id: `task.open.${item.noteId}`,
      label: item.title,
      detail: item.next
        ? `${t("desktop.workbench.taskNext")} ${item.next}`
        : t("desktop.workbench.taskSessions", item.sessions.length),
      category: t("desktop.workbench.quickAccessCategoryTasks"),
      keywords: `task switch open context ${item.title} ${item.next || ""}`,
      run: () => openQuickAccessTask(item)
    })),
    // 4. Sessions & Terminals / 会话与终端
    {
      id: "workbench.newSession",
      label: t("desktop.workbench.quickAccessNewSession"),
      category: t("desktop.workbench.quickAccessCategorySessions"),
      keywords: "agent new session ai chat prompt",
      disabledReason: noProjectReason,
      run: () => {
        openWorkbenchView();
        void newSession();
      }
    },
    {
      id: "workbench.newTerminal",
      label: t("desktop.workbench.quickAccessNewTerminal"),
      category: t("desktop.workbench.quickAccessCategorySessions"),
      keywords: "shell bash terminal new",
      disabledReason: noProjectReason,
      run: () => {
        openWorkbenchView();
        void openBlankTerminal(sessionTarget || sideRoots[0]);
      }
    },
    // 5. Side Panels / 侧栏面板
    {
      id: "workbench.explorer",
      label: t("desktop.workbench.quickAccessShowExplorer"),
      category: t("desktop.workbench.quickAccessCategoryPanels"),
      keywords: "files sidebar file tree explorer",
      disabledReason: noProjectReason,
      run: () => openWorkbenchView("files")
    },
    {
      id: "workbench.git",
      label: t("desktop.workbench.quickAccessShowGit"),
      category: t("desktop.workbench.quickAccessCategoryPanels"),
      keywords: "changes source control git diff commit",
      disabledReason: noProjectReason,
      run: () => openWorkbenchView("git")
    },
    {
      id: "workbench.search",
      label: t("desktop.workbench.quickAccessShowSearch"),
      category: t("desktop.workbench.quickAccessCategoryPanels"),
      keywords: "find content sidebar text search grep",
      disabledReason: noProjectReason,
      run: () => openWorkbenchView("search")
    },
    {
      id: "workbench.scripts",
      label: t("desktop.workbench.quickAccessShowScripts"),
      category: t("desktop.workbench.quickAccessCategoryPanels"),
      keywords: "run package npm pnpm scripts build dev",
      disabledReason: noProjectReason,
      run: () => openWorkbenchView("scripts")
    },
    // 6. Files / 文件
    {
      id: "file.goToFile",
      label: t("desktop.workbench.quickAccessGoToFile"),
      category: t("desktop.workbench.quickAccessCategoryFiles"),
      keywords: "quick open file path",
      shortcut: shortcut("P"),
      disabledReason: noProjectReason,
      run: () => {
        setQuickAccessMode("files");
        setQuickAccessQuery("");
        if (sideRoots.length) void loadQuickAccessFiles();
      }
    },
    {
      id: "file.findInFiles",
      label: t("desktop.workbench.quickAccessFindInFiles"),
      category: t("desktop.workbench.quickAccessCategoryFiles"),
      keywords: "search project content find text",
      shortcut: macShortcuts ? "⌘⇧F" : "Ctrl+Shift+F",
      disabledReason: noProjectReason,
      run: () => openWorkbenchView("search")
    },
    {
      id: "file.save",
      label: t("desktop.workbench.quickAccessSaveCurrentFile"),
      category: t("desktop.workbench.quickAccessCategoryFiles"),
      keywords: "write editor save file",
      shortcut: shortcut("S"),
      disabledReason: currentEditor ? undefined : t("desktop.workbench.quickAccessNoActiveEditor"),
      run: () => {
        closeQuickAccess();
        if (currentEditor) void saveEditor(currentEditor.key);
      }
    },
    {
      id: "file.closePane",
      label: t("desktop.workbench.quickAccessCloseActivePane"),
      category: t("desktop.workbench.quickAccessCategoryFiles"),
      keywords: "close tab terminal editor pane",
      shortcut: shortcut("W"),
      disabledReason: active && activePane ? undefined : t("desktop.workbench.quickAccessNoActivePane"),
      run: () => {
        closeQuickAccess();
        closeActivePane();
      }
    },
    // 7. Application / 应用
    {
      id: "app.settings",
      label: t("desktop.workbench.quickAccessOpenSettings"),
      category: t("desktop.workbench.quickAccessCategoryApplication"),
      keywords: "preferences configuration settings app",
      shortcut: shortcut(","),
      run: () => {
        closeQuickAccess();
        // Settings is its own window now; the main process opens or focuses it.
        void desktopApi().openSettingsWindow?.({ pane: "general" }).catch(() => undefined);
      }
    }
  ];

  const newSessionAnchorRect = newSessionButtonRef.current?.getBoundingClientRect();
  const closeNewSessionPicker = useCallback(() => setNewSessionPicker(null), [setNewSessionPicker]);
  useMenuPosition(
    Boolean(newSessionPicker) && !newSessionPickerClosing,
    newSessionPickerRef,
    { x: newSessionAnchorRect?.left ?? 0, y: (newSessionAnchorRect?.bottom ?? 0) + 4 }
  );
  useMenuKeyboard(
    Boolean(newSessionPicker) && !newSessionPickerClosing,
    newSessionPickerRef,
    closeNewSessionPicker
  );
  // The editor menu carries the selection actions (rich content, not an NSMenu), so
  // it keeps its DOM but takes the shared measured position and keyboard handling.
  const closeEditorContextMenu = useCallback(() => setEditorContextMenu(null), [setEditorContextMenu]);
  useMenuPosition(
    Boolean(editorContextMenu) && !editorContextMenuClosing,
    editorContextMenuRef,
    { x: editorContextMenu?.x ?? 0, y: editorContextMenu?.y ?? 0 }
  );
  useMenuKeyboard(
    Boolean(editorContextMenu) && !editorContextMenuClosing,
    editorContextMenuRef,
    closeEditorContextMenu
  );
  const closeBranchMenu = useCallback(() => setBranchPane(null), []);
  useMenuPosition(Boolean(branchPane), branchMenuRef, {
    x: branchMenuPosition ? Math.max(8, window.innerWidth - branchMenuPosition.right) : 8,
    y: branchMenuPosition?.top ?? 0
  });
  useMenuKeyboard(Boolean(branchPane), branchMenuRef, closeBranchMenu);

  const newSessionPickerStyle = newSessionAnchorRect
    ? {
        left: Math.max(8, Math.min(newSessionAnchorRect.left, window.innerWidth - 248)),
        top: Math.min(newSessionAnchorRect.bottom + 4, window.innerHeight - 360)
      }
    : { left: 8, top: 48 };

  const clearWorkbenchDrag = () => {
    draggedSessionRef.current = null;
    setDraggedSessionKey(null);
  };

  const paneTabGroups = <div className="wb-pane-tab-groups">
    <div className="wb-terminal-tabs is-session-group" data-pane-group="session">
      <button ref={newSessionButtonRef} type="button" className={`wb-pane-tab-group-label${terminalCreating ? " is-busy" : ""}`} disabled={terminalCreating} aria-label={t("desktop.workbench.newSession")} title={t("desktop.workbench.newSession")} aria-haspopup="menu" aria-expanded={Boolean(newSessionPicker)} onClick={() => { if (newSessionPicker && !newSessionPickerClosing) setNewSessionPicker(null); else void newSession(); }}>{terminalCreating ? <ThemeIcon name="loader" className="spin" size={ICON_SIZE.dense} aria-hidden="true" /> : <ThemeIcon name="bot" size={ICON_SIZE.dense} aria-hidden="true" />}</button>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.tabGroupSession")}>
        {currentSessionTerminals.map((pane) => <div className={`wb-terminal-tab is-session${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key} onContextMenu={(event) => sessionTabMenu(event, terminalSessionNoteTarget(pane, aliases[pane.projectPath] || basename(pane.projectPath)), pane.key)}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ProviderIcon provider={sessionIdentityFromKey(pane.sessionKey)?.provider || ""} size={ICON_SIZE.dense} aria-hidden="true" />{sessionTabDot(sessionRuntimeByPaneKey.get(pane.key)?.status)}{sessionTabTitle(pane, sessionTitles)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeTerminal")} onClick={() => closeTerminal(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
        {currentAcpChats.map((pane) => <div className={`wb-terminal-tab is-session is-acp${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key} onContextMenu={(event) => sessionTabMenu(event, acpSessionNoteTarget(pane, aliases[pane.projectPath] || basename(pane.projectPath)), pane.key)}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ProviderIcon provider={pane.provider} size={ICON_SIZE.dense} aria-hidden="true" />{sessionTabDot(sessionRuntimeByPaneKey.get(pane.key)?.status)}{sessionTabTitle(pane, sessionTitles)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeAcpChat")} onClick={() => closeAcpChat(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
      </div>
    </div>
    <div className="wb-terminal-tabs is-terminal-group" data-pane-group="terminal">
      <button type="button" className={`wb-pane-tab-group-label${terminalCreating ? " is-busy" : ""}`} disabled={terminalCreating} aria-label={t("desktop.workbench.newTerminal")} title={t("desktop.workbench.newTerminal")} onClick={() => void openBlankTerminal()}>{terminalCreating ? <ThemeIcon name="loader" className="spin" size={ICON_SIZE.dense} aria-hidden="true" /> : <ThemeIcon name="terminal" size={ICON_SIZE.dense} aria-hidden="true" />}</button>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.tabGroupTerminal")}>
        {currentShellTerminals.map((pane) => <div className={`wb-terminal-tab is-terminal${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="terminal" size={ICON_SIZE.dense} aria-hidden="true" />{pane.title}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeTerminal")} onClick={() => closeTerminal(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
      </div>
    </div>
    {currentEditors.length || currentDiffs.length ? <div className="wb-terminal-tabs is-code-group" data-pane-group="code">
      <div className="wb-pane-tab-group-label" aria-label={t("desktop.workbench.tabGroupCode")} title={t("desktop.workbench.tabGroupCode")}><ThemeIcon name="file-code" size={ICON_SIZE.dense} aria-hidden="true" /></div>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.tabGroupCode")}>
        {currentEditors.map((pane) => <div className={`wb-terminal-tab is-editor${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key} onContextMenu={(event) => editorTabMenu(event, pane)}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="file-code" size={ICON_SIZE.dense} aria-hidden="true" />{pane.dirty ? "* " : ""}{basename(pane.path)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeFile")} onClick={() => closeEditor(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
        {currentDiffs.map((pane) => <div className={`wb-terminal-tab is-diff${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="file-diff" size={ICON_SIZE.dense} aria-hidden="true" />{basename(pane.path)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeDiff")} onClick={() => closeDiff(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
      </div>
    </div> : null}
    <div className="wb-terminal-tabs is-note-group" data-pane-group="note">
      <button type="button" className="wb-pane-tab-group-label" aria-label={t("desktop.notes.newLinkedChild")} title={t("desktop.notes.newLinkedChild")} onClick={() => void addChildNote()}><ThemeIcon name="file-plus" size={ICON_SIZE.dense} aria-hidden="true" /></button>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.notes.allNotes")}>
        {currentNotePanes.map((pane) => <div className={`wb-terminal-tab is-note${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="file-text" size={ICON_SIZE.dense} aria-hidden="true" />{pane.dirty ? "* " : ""}{pane.title || t("desktop.notes.allNotes")}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.common.close")} onClick={() => closeNotePane(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
      </div>
    </div>
    <div className="wb-terminal-tabs is-browser-group" data-pane-group="browser">
      <button type="button" className="wb-pane-tab-group-label" aria-label={t("desktop.browser.newBrowser")} title={t("desktop.browser.newBrowser")} onClick={() => void openBrowser()}><ThemeIcon name="globe" size={ICON_SIZE.dense} aria-hidden="true" /></button>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.tabGroupBrowser")}>
        {currentBrowsers.map((pane) => <div className={`wb-terminal-tab is-browser${activePane === pane.key ? " active" : ""}${pane.surfaceKind === "window" ? " is-popped-out" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="globe" size={ICON_SIZE.dense} aria-hidden="true" />{pane.title}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.browser.closeBrowser")} onClick={() => closeBrowser(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
      </div>
    </div>
  </div>;

  const gitHistoryTitle = gitHistoryContext?.kind === "file"
    ? t("desktop.workbench.gitFileHistoryTitle", basename(gitHistoryContext.filePath))
    : t("desktop.workbench.gitLogTitle");
  const gitHistoryBackLabel = gitHistoryContext?.kind === "file"
    ? t("desktop.workbench.gitFileHistoryBackToExplorer")
    : t("desktop.workbench.gitLogBackToChanges");

  const renderGitLogRow = (commit: GitLogCommit, index: number) => {
    const selected = gitShow?.hash === commit.hash;
    return <button
      type="button"
      className={`wb-git-log-graph-row${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      key={commit.hash}
      onClick={() => void showCommit(commit)}
      onContextMenu={(event) => openGitLogContextMenu(event, commit)}
    ><span className={`wb-git-graph-node wb-git-graph-lane-${gitLog?.layout.rows[index]?.colorIndex ?? 0}`}><ThemeIcon name="circle" size={ICON_SIZE.inline} fill="currentColor" /></span><span className="wb-git-log-graph-content"><GitCommitBranches commit={commit} /><span className="wb-git-log-subject">{commit.subject || t("desktop.workbench.gitLogUntitled")}</span><span className="wb-git-log-meta"><span className="wb-git-log-hash">{commit.shortHash}</span><span className="wb-git-log-meta-sep">·</span><span>{commit.author}</span><span className="wb-git-log-meta-sep">·</span><span>{formatGitCommitDate(commit.date, locale)}</span></span></span></button>;
  };

  if (!host) return null;

  const headerSlot = document.getElementById("app-header-slot");
  // A workbench window has no app header to portal into, so it renders the same
  // header itself, where the window's own chrome strip is.
  const inlineHeader = document.documentElement.dataset.windowMode === "task";
  // The header names the task and points at the directory the workbench is in:
  // an explicitly activated project, the task's only project, else the shared
  // workspace — the same rule a new session uses for its cwd.
  const headerDirectory = sessionTarget
    || (scopeProjects.length === 1 ? scopeProjects[0] : null)
    || (taskScope ? taskWorkspaceDir : null)
    || selectedProject
    || null;
  const headerTitle = taskScope
    ? (taskScope.title || taskScope.noteId)
    : headerDirectory
      ? (aliases[headerDirectory] || basename(headerDirectory))
      : t("desktop.workbench.allSessions");
  const revealHeaderDirectory = () => {
    const target = headerDirectory;
    if (!target) return;
    void (async () => {
      try {
        // The shared workspace is allocated on demand, so create it before revealing.
        let dir = target;
        if (taskScope && target === taskWorkspaceDir && typeof desktopApi().notesEnsureTaskWorkspace === "function") {
          const ensured = await desktopApi().notesEnsureTaskWorkspace({ noteId: taskScope.noteId });
          if (ensured?.dir) dir = ensured.dir;
        }
        await desktopApi().workbenchRevealPath({ rootPath: dir, targetPath: dir });
      } catch (error) {
        notifyDesktop({ text: error instanceof Error ? error.message : String(error), kind: "error" });
      }
    })();
  };
  const detailHeader = (
    <WorkbenchDetailHeader
      onBackToGtd={inlineHeader ? undefined : () => window.dispatchEvent(new CustomEvent("agent-resume:view-gtd"))}
      title={headerTitle}
      directory={headerDirectory}
      onRevealDirectory={headerDirectory ? revealHeaderDirectory : undefined}
      side={side}
      branchStatusLabel={branchStatusLabel}
      branchStatusPane={branchStatusPane}
      branchStatusNested={branchStatusNested}
      onOpenBranchMenu={openBranchMenu}
      onToggleSide={(view) => setSide((current) => current === view ? null : view)}
    />
  );

  return createPortal(<><section className="panel workbench-panel react-workbench-panel" hidden={!active}>
    {inlineHeader && active ? <div className="wb-window-header">{detailHeader}</div> : null}
    <div className="workbench-layout" style={{ "--wb-list-width": `${listWidth}px`, "--wb-side-panel-width": `${sideWidth}px` } as CSSProperties}>
      <aside className="wb-list-pane">
        {taskScope && (
          <section className="wb-task" aria-label={t("desktop.workbench.taskView")} onContextMenu={(event) => taskMenu(event, taskScope)}>
            <div className="wb-task-head">
              <ThemeIcon name="square-kanban" size={ICON_SIZE.dense} aria-hidden="true" />
              <span className="wb-task-title">{taskScope.title || taskScope.noteId}</span>
              <span className={`wb-task-status is-${desktopGtdColumn(taskRollup?.status ?? taskScope.status)}`}>
                {t(desktopGtdLabelKey(taskRollup?.status ?? taskScope.status))}
              </span>
              {taskRollup?.total ? (
                <span className="wb-task-rollup" title={t("desktop.gtd.rollupHint")}>
                  {t("desktop.gtd.rollupProgress", taskRollup.counts.done, taskRollup.total)}
                </span>
              ) : null}
              {taskRollup?.override ? (
                <button
                  type="button"
                  className="wb-task-pin"
                  title={t("desktop.gtd.pinnedHint")}
                  onClick={() => void clearTaskPin()}
                >{t("desktop.gtd.pinned")}<ThemeIcon name="close" size={ICON_SIZE.inline} aria-hidden="true" /></button>
              ) : null}
              <button
                type="button"
                className="wb-icon-btn"
                onClick={() => setLeftTab("note")}
                aria-label={t("desktop.workbench.taskOpenNote")}
                title={t("desktop.workbench.taskOpenNote")}
              >
                <ThemeIcon name="file-text" size={ICON_SIZE.default} />
              </button>
            </div>
            {taskScope.next && (
              <p className="wb-task-line">
                <span className="wb-task-label">{t("desktop.workbench.taskNext")}</span>
                {taskScope.next}
              </p>
            )}
            {taskScope.decision && (
              <p className="wb-task-line is-decision">
                <ThemeIcon name="message-square-warning" size={ICON_SIZE.inline} aria-hidden="true" />
                {taskScope.decision}
              </p>
            )}
            <p className="wb-task-count">{t("desktop.workbench.taskSessions", taskScope.sessions?.length ?? 0)}</p>
            <div className="wb-task-projects">
              {scopeProjects.map((path) => {
                const active = sessionTarget
                  ? projectPathKey(path) === projectPathKey(sessionTarget)
                  : scopeProjects.length === 1;
                return (
                  <span key={path} className={`wb-task-project${active ? " is-active" : ""}`}>
                    <button
                      type="button"
                      className="wb-task-project-chip"
                      title={path}
                      onClick={() => { setSessionTarget(path); selectProject(path, { keepSessionKey: true }); }}
                    >
                      {path.split(/[\\/]/).filter(Boolean).at(-1) || path}
                    </button>
                    <button
                      type="button"
                      className="wb-task-project-remove"
                      title={t("desktop.workbench.removeProject")}
                      aria-label={t("desktop.workbench.removeProject")}
                      onClick={() => void removeProject(path)}
                    >
                      <ThemeIcon name="close" size={ICON_SIZE.inline} aria-hidden="true" />
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                className="wb-task-add-project"
                aria-label={t("desktop.workbench.addProject")}
                title={t("desktop.workbench.addProjectTitle")}
                onClick={() => void pickTaskProject()}
              >
                {scopeProjects.length === 0
                  ? t("desktop.workbench.taskNoProject")
                  : `+ ${t("desktop.workbench.addProject")}`}
              </button>
            </div>
            <p className="wb-task-target">
              {t("desktop.workbench.sessionTarget", sessionTarget
                ? basename(sessionTarget)
                : scopeProjects.length === 1
                  ? basename(scopeProjects[0])
                  : t("desktop.workbench.sharedWorkspace"))}
              {sessionTarget ? (
                <button
                  type="button"
                  className="wb-task-target-reset"
                  onClick={() => setSessionTarget(null)}
                  title={t("desktop.workbench.sessionTargetReset")}
                  aria-label={t("desktop.workbench.sessionTargetReset")}
                >
                  <ThemeIcon name="undo" size={ICON_SIZE.inline} aria-hidden="true" />
                </button>
              ) : null}
            </p>
          </section>
        )}
        <div className="wb-left-tabs" role="tablist" aria-label={t("desktop.workbench.leftPaneTabs")}>
          <button type="button" role="tab" className={`wb-left-tab${leftTab === "note" ? " active" : ""}`} aria-selected={leftTab === "note"} onClick={() => setLeftTab("note")}>{t("desktop.workbench.noteTab")}</button>
          <button type="button" role="tab" className={`wb-left-tab${leftTab === "session" ? " active" : ""}`} aria-selected={leftTab === "session"} onClick={() => setLeftTab("session")}>{t("desktop.workbench.sessionTab")}</button>
        </div>
        {leftTab === "note" ? (
          <>
            <div className="wb-note-list-toolbar">
              <div className="wb-note-filter" role="tablist" aria-label={t("desktop.workbench.noteFilter")}>
                <button type="button" role="tab" className={`wb-left-tab${noteFilter === "task" ? " active" : ""}`} aria-selected={noteFilter === "task"} disabled={!taskScope} onClick={() => setNoteFilter("task")}>{t("desktop.workbench.filterTask")}</button>
                <button type="button" role="tab" className={`wb-left-tab${noteFilter === "all" ? " active" : ""}`} aria-selected={noteFilter === "all"} onClick={() => setNoteFilter("all")}>{t("desktop.workbench.filterAll")}</button>
              </div>
              <input className="wb-search wb-note-search" type="search" aria-label={t("desktop.common.search")} placeholder={t("desktop.common.search")} value={noteQuery} autoComplete="off" spellCheck={false} onChange={(event) => setNoteQuery(event.target.value)} />
              <button type="button" className="wb-icon-btn wb-note-add" aria-label={t("desktop.workbench.newNote")} title={t("desktop.workbench.newNote")} onClick={() => void addNote()}><ThemeIcon name="file-plus" size={ICON_SIZE.default} /></button>
            </div>
            <div className="wb-note-list">
              {visibleNotes.length ? visibleNotes.map((note) => (
                <button
                  key={note.noteId}
                  type="button"
                  className={`wb-note-list-item${activeNotePaneId === note.noteId ? " active" : ""}${taskScope?.noteId === note.noteId ? " is-task" : ""}`}
                  title={note.title}
                  aria-label={note.title}
                  onContextMenu={(event) => noteMenu(event, note)}
                  onClick={() => openNotePane(note.noteId, note.title)}
                >
                  <ThemeIcon name="file-text" size={ICON_SIZE.dense} aria-hidden="true" />
                  <span className="wb-note-list-item-title">{note.title}</span>
                  {taskScope && noteFilter === "all" && taskByNoteId.has(note.noteId) ? <span className="wb-task-badge" aria-hidden="true" title={t("desktop.workbench.ownedByTask", taskByNoteId.get(note.noteId)?.title ?? "")}>{taskByNoteId.get(note.noteId)?.title}</span> : null}
                  {note.gtdStatus
                    ? <span className={`wb-gtd-status-badge is-${desktopGtdColumn(note.gtdStatus)}`} aria-label={t("desktop.workbench.gtdStatusLabel", t(desktopGtdLabelKey(note.gtdStatus)))}>{t(desktopGtdLabelKey(note.gtdStatus))}</span>
                    : <span className="wb-gtd-status-badge is-unmarked" title={t("desktop.gtd.unmarkedHint")}>{t("desktop.gtd.unmarked")}</span>}
                </button>
              )) : <p className="muted wb-list-empty">{t("desktop.workbench.noNotes")}</p>}
            </div>
          </>
        ) : (
        <>
        <div className="wb-note-list-toolbar">
          <div className="wb-note-filter" role="tablist" aria-label={t("desktop.workbench.sessionFilter")}>
            <button type="button" role="tab" className={`wb-left-tab${sessionFilter === "task" ? " active" : ""}`} aria-selected={sessionFilter === "task"} disabled={!taskScope} onClick={() => setSessionFilter("task")}>{t("desktop.workbench.filterTask")}</button>
            <button type="button" role="tab" className={`wb-left-tab${sessionFilter === "all" ? " active" : ""}`} aria-selected={sessionFilter === "all"} onClick={() => setSessionFilter("all")}>{t("desktop.workbench.filterAll")}</button>
          </div>
          <input className="wb-search wb-note-search" type="search" aria-label={t("desktop.workbench.searchSessions")} placeholder={t("desktop.common.search")} value={sessionQuery} autoComplete="off" spellCheck={false} onChange={(event) => { setSessionQuery(event.target.value); setSelectedSessionKeys((current) => current.size ? new Set() : current); setSelectionAnchorKey((current) => current ? "" : current); }} />
        </div>
        <div className="wb-list-meta-row"><p className="wb-list-meta">{selectedSessionKeys.size > 1 ? t("desktop.workbench.selectedCount", selectedSessionKeys.size) : sessionQuery ? t("desktop.workbench.listMetaSearch", selectedSessionScope, sessionQuery, visibleSessions.length + visiblePendingSessions.length) : `${visibleSessions.length + visiblePendingSessions.length} / ${sessionsTotal + selectedPendingSessions.length}`}</p>{selectedSessionKeys.size > 1 ? <button type="button" className="wb-list-remove-btn" onClick={() => {
          const targets = visibleSessions.filter((item) => selectedSessionKeys.has(sessionKey(item)));
          if (!targets.length) return;
          void (async () => {
            if (!(await confirmDestructive(t("desktop.workbench.removeMultipleConfirm", targets.length), t("desktop.common.remove")))) return;
            void removeSelectedSessionsFromPanel(targets);
          })();
        }}>{t("desktop.workbench.removeFromPanel")}</button> : null}<button type="button" className="wb-icon-btn" aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")} onClick={() => void reloadWorkbench()}><ThemeIcon name="refresh" size={ICON_SIZE.default} /></button></div>
        {visibleSessionRows.length ? <VirtualList
          className="wb-list"
          items={visibleSessionRows}
          itemHeight={WORKBENCH_SESSION_ROW_HEIGHT}
          scrollToIndex={activeSessionRowIndex}
          onEndReached={() => void loadMoreSessions()}
          endReachedThreshold={20}
          getKey={(row) => row.kind === "pending" ? row.pending.key : sessionKey(row.session)}
          renderItem={(row) => {
            if (row.kind === "pending") {
              const pending = row.pending;
              return <button type="button" className={`wb-list-item has-wb-activity${activeSessionKey === pending.key ? " active" : ""}`} onClick={() => focusPendingSession(pending)}><span className="wb-list-item-top"><span className="wb-session-title-wrap"><span className="wb-session-activity-dot" aria-hidden="true" /><span className="wb-list-item-title" ref={(el) => syncTruncationTitle(el)}>{pending.title}</span></span></span><span className="wb-list-item-preview" ref={(el) => syncTruncationTitle(el)}><span className="wb-list-item-date">{formatDateTime(pending.createdAt)}</span><span className="s-provider-tag" data-provider={pending.provider}>{pending.provider}</span>{" · "}{aliases[pending.projectPath] || basename(pending.projectPath)}</span></button>;
            }
            const session = row.session;
            const key = sessionKey(session);
            const isOpen = openSessionKeys.has(key);
            const isSelected = selectedSessionKeys.has(key);
            const otherMachine = isOtherMachineSession(session, selectedProjectMeta?.path || selectedProject);
            const gtdStatus = gtdStatuses[key];
            const isWaitingOnExit = !isOpen && Boolean(session.lastExitWaiting);
            const tooltipParts = [
              otherMachine ? t("desktop.workbench.otherMachineSessionHint", session.projectPath) : undefined,
              isWaitingOnExit ? t("desktop.workbench.lastExitWaiting") : undefined
            ].filter(Boolean);
            const sessionTooltip = tooltipParts.length ? tooltipParts.join(" · ") : undefined;
            return <button
              type="button"
              draggable={selectedSessionKeys.size <= 1}
              aria-selected={isSelected}
              className={`wb-list-item${activeSessionKey === key ? " active" : ""}${isSelected ? " is-selected" : ""}${isOpen ? " has-wb-activity" : ""}${otherMachine ? " is-other-machine" : ""}${draggedSessionKey === key ? " is-drag-source" : ""}`}
              onDragStart={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) {
                  event.preventDefault();
                  return;
                }
                clearWorkbenchDrag();
                draggedSessionRef.current = session;
                setDraggedSessionKey(key);
                event.dataTransfer.setData("text/plain", session.title || session.id);
                event.dataTransfer.setData("application/x-agent-resume-workbench-session", JSON.stringify({
                  provider: session.provider,
                  agentSessionId: session.id
                }));
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={clearWorkbenchDrag}
              onContextMenu={(event) => sessionMenu(event, session)}
              onClick={(event) => handleCatalogSessionClick(event, session)}
              title={sessionTooltip}
            ><span className="wb-list-item-top"><span className="wb-session-title-wrap">{isOpen ? <span className="wb-session-activity-dot" aria-hidden="true" /> : null}<span className="wb-list-item-title" ref={(el) => syncTruncationTitle(el)}>{session.title || session.id}</span>{otherMachine ? <span className="wb-other-machine-badge" aria-label={t("desktop.workbench.otherMachineBadge")}>{t("desktop.workbench.otherMachineBadge")}</span> : null}{sessionFilter === "all" && taskScope && taskBySessionKey.has(key) ? <span className="wb-task-badge" aria-hidden="true" title={t("desktop.workbench.ownedByTask", taskBySessionKey.get(key)?.title ?? "")}>{taskBySessionKey.get(key)?.title}</span> : null}</span></span><span className="wb-list-item-preview" ref={(el) => syncTruncationTitle(el)}><span className="wb-list-item-date">{formatDateTime(session.updatedAt)}</span><span className="s-provider-tag" data-provider={session.acpProvider || session.provider}>{session.acpProvider ? `acp/${session.acpProvider}` : session.provider}</span>{gtdStatus ? <span className={`wb-gtd-status-badge is-${gtdStatus}`} aria-label={t("desktop.workbench.gtdStatusLabel", t(`desktop.workbench.gtdStatus.${gtdStatus}`))}>{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</span> : <span className="wb-gtd-status-badge is-unmarked" title={t("desktop.gtd.unmarkedHint")}>{t("desktop.gtd.unmarked")}</span>}{" · "}{aliases[session.projectPath] || basename(session.projectPath)}</span></button>;
          }}
        /> : <div className="wb-list"><p className="muted wb-list-empty">{sessionQuery ? t("desktop.workbench.noMatchingSessions") : t("desktop.workbench.noSessionsInProject")}</p></div>}
        </>
        )}
      </aside>
      <ResizeHandle label={t("desktop.workbench.resizeSessions")} onDelta={(delta) => setWidth("list", delta)} />
      <main className="wb-detail">
        {active && headerSlot && !inlineHeader ? createPortal(detailHeader, headerSlot) : null}
        {taskScope && workbenches.length > 0 ? (
          <div className="wb-workbench-bar" role="tablist" aria-label={t("desktop.workbench.workbenchTabs")}>
            {workbenches.map((workbench) => {
              const wbDot = rollupDot({ work: { sessions: workbenchSessionKeys[workbench.workbenchId] ?? [] } }, dotByKey);
              return (
              <div
                key={workbench.workbenchId}
                className={`wb-workbench-tab${workbench.workbenchId === activeWorkbenchId ? " active" : ""}`}
              >
                {renamingWorkbenchId === workbench.workbenchId ? (
                  <input
                    className="wb-workbench-tab-input"
                    value={workbenchRenameDraft}
                    autoFocus
                    aria-label={t("desktop.common.rename")}
                    onChange={(event) => setWorkbenchRenameDraft(event.target.value)}
                    onBlur={() => void commitWorkbenchRename()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { event.preventDefault(); void commitWorkbenchRename(); }
                      if (event.key === "Escape") { event.preventDefault(); setRenamingWorkbenchId(null); }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={workbench.workbenchId === activeWorkbenchId}
                    className="wb-workbench-tab-label"
                    title={workbench.projectPath || workbenchDisplayName(workbench)}
                    onClick={() => activateWorkbench(workbench)}
                    onDoubleClick={() => {
                      setRenamingWorkbenchId(workbench.workbenchId);
                      setWorkbenchRenameDraft(workbenchDisplayName(workbench));
                    }}
                  >
                    <ThemeIcon name="square-kanban" size={ICON_SIZE.dense} aria-hidden="true" />
                    {wbDot && wbDot.status !== "open" ? <span className={`session-dot${sessionDotStatusClass(wbDot.status)}`} aria-hidden="true" /> : null}
                    {workbenchDisplayName(workbench)}
                  </button>
                )}
                {workbenches.length > 1 ? (
                  <button
                    type="button"
                    className="wb-workbench-tab-close"
                    aria-label={t("desktop.workbench.deleteWorkbench")}
                    title={t("desktop.workbench.deleteWorkbench")}
                    onClick={() => void removeWorkbench(workbench)}
                  >
                    <ThemeIcon name="close" size={ICON_SIZE.inline} />
                  </button>
                ) : null}
              </div>
              );
            })}
            <button
              type="button"
              className="wb-workbench-add"
              aria-label={t("desktop.workbench.newWorkbench")}
              title={t("desktop.workbench.newWorkbench")}
              onClick={() => void addWorkbench()}
            >
              <ThemeIcon name="plus" size={ICON_SIZE.dense} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className="wb-detail-body">
          <div className="wb-terminal-shell">{paneTabGroups}<div className="wb-terminal-stack">{terminals.filter((pane) => paneScopeKey(pane) === activeScopeKey && pane.key === activePane).map((pane) => {
            const sessionIdentity = sessionIdentityFromKey(pane.sessionKey);
            const pending = pendingSessions.find((item) => item.terminalKey === pane.key);
            const isSession = pane.group === "session";
            const showSplit = isSession && sessionViewMode === "hybrid";
            // In the shared workspace the `#` menu points at the task's repos.
            const composerProjects = taskWorkspaceDir && projectPathKey(pane.cwd) === projectPathKey(taskWorkspaceDir)
              ? composerWorkspaceProjects
              : EMPTY_COMPOSER_WORKSPACE_PROJECTS;

            if (showSplit) {
              const provider = sessionIdentity?.provider || pending?.provider || "codex";
              const sessionId = sessionIdentity?.sessionId || "";
              return (
                <div key={pane.key} className="wb-terminal-pane-wrap wb-terminal-pane-split">
                  <div className="wb-session-split-transcript">
                    <SessionTranscriptPane
                      provider={provider}
                      sessionId={sessionId}
                      iconProvider={provider}
                      active={active}
                      fontSize={settings?.workbench?.transcriptFontSize ?? 14}
                      focusUserMessage={transcriptFocus}
                      isPending={!sessionId}
                      onRefresh={triggerSessionSync}
                    />
                  </div>
                  <ResizeHandle
                    orientation="horizontal"
                    label={t("desktop.workbench.resizeTerminalSplit")}
                    onDelta={(delta) => {
                      setTuiSplitHeight((prev) => {
                        const next = Math.max(80, Math.min(600, prev - delta));
                        writeWorkbenchValue(TUI_SPLIT_HEIGHT_KEY, activeWorkbenchIdRef.current, String(next));
                        return next;
                      });
                    }}
                  />
                  <div
                    className={`wb-session-split-tui${tuiCollapsed ? " is-collapsed" : ""}`}
                    style={{ height: tuiCollapsed ? "28px" : `${tuiSplitHeight}px` }}
                  >
                    <div
                      className="wb-session-split-tui-head"
                      onClick={() => setTuiCollapsed((c) => !c)}
                    >
                      <span className="wb-session-split-tui-title">
                        <ThemeIcon name="terminal" size={ICON_SIZE.dense} />
                        <span>{t("desktop.workbench.terminalConsole")}</span>
                      </span>
                      <div className="wb-session-split-tui-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="wb-git-action-btn"
                          onClick={() => setTuiCollapsed((c) => !c)}
                          title={tuiCollapsed ? t("desktop.common.expand") : t("desktop.common.collapse")}
                          aria-label={tuiCollapsed ? t("desktop.common.expand") : t("desktop.common.collapse")}
                        >
                          <ThemeIcon name={tuiCollapsed ? "chevron-up" : "chevron-down"} size={ICON_SIZE.default} />
                        </button>
                        <button
                          type="button"
                          className="wb-git-action-btn"
                          onClick={toggleSessionViewMode}
                          title={t("desktop.workbench.fullTerminalMode")}
                          aria-label={t("desktop.workbench.fullTerminalMode")}
                        >
                          <ThemeIcon name="terminal" size={ICON_SIZE.default} />
                        </button>
                      </div>
                    </div>
                    {!tuiCollapsed ? (
                      <div className="wb-session-split-tui-body">
                        <TerminalView
                          pane={pane}
                          active={active}
                          themeId={terminalThemeId}
                          appearance={desktopAppearance}
                          rendererMode={terminalRendererMode}
                          engineType={terminalEngine}
                          onPty={onPty}
                          onDetach={onPtyDetach}
                          onInput={onTerminalInput}
                          onInitialPromptSubmitted={onInitialPromptSubmitted}
                          mouseTracking={terminalMouseTrackingRef}
                        />
                      </div>
                    ) : null}
                  </div>
                  <TerminalComposerStack
                    items={[{
                      pane: { key: pane.key, cwd: pane.cwd, group: pane.group, projectPath: pane.projectPath },
                      ptyId: pane.ptyId ?? null,
                      activePane: true,
                      value: composerDrafts[pane.key] || "",
                      provider: sessionIdentity?.provider || pending?.provider
                    }]}
                    onChange={setComposerDraft}
                    onSendToTerminal={sendComposerToTerminal}
                    onRunSlashCommand={runComposerSlashCommand}
                    onActivate={activateComposerPane}
                    onClose={closeTerminal}
                    registerFocus={registerComposerFocus}
                    slashPhrases={settings?.workbench?.composerSlashPhrases ?? []}
                    workspaceProjects={composerProjects}
                  />
                </div>
              );
            }

            return (
              <div key={pane.key} className="wb-terminal-pane-wrap">
                {isSession ? (
                  <div className="wb-terminal-fullscreen-bar">
                    <button
                      type="button"
                      className="wb-terminal-mode-toggle-btn"
                      onClick={toggleSessionViewMode}
                      title={t("desktop.workbench.splitViewMode")}
                    >
                      <ThemeIcon name="file-text" size={ICON_SIZE.dense} />
                      <span>{t("desktop.workbench.splitViewMode")}</span>
                    </button>
                  </div>
                ) : null}
                <TerminalView pane={pane} active={active} themeId={terminalThemeId} appearance={desktopAppearance} rendererMode={terminalRendererMode} engineType={terminalEngine} onPty={onPty} onDetach={onPtyDetach} onInput={onTerminalInput} onInitialPromptSubmitted={onInitialPromptSubmitted} mouseTracking={terminalMouseTrackingRef} />
                {pane.group === "session" ? (
                  <TerminalComposerStack
                    items={[{
                      pane: { key: pane.key, cwd: pane.cwd, group: pane.group, projectPath: pane.projectPath },
                      ptyId: pane.ptyId ?? null,
                      activePane: true,
                      value: composerDrafts[pane.key] || "",
                      provider: sessionIdentity?.provider || pendingSessions.find((pending) => pending.terminalKey === pane.key)?.provider
                    }]}
                    onChange={setComposerDraft}
                    onSendToTerminal={sendComposerToTerminal}
                    onRunSlashCommand={runComposerSlashCommand}
                    onActivate={activateComposerPane}
                    onClose={closeTerminal}
                    registerFocus={registerComposerFocus}
                    slashPhrases={settings?.workbench?.composerSlashPhrases ?? []}
                    workspaceProjects={composerProjects}
                  />
                ) : null}
              </div>
            );
          })}{editorFindOpen && currentEditor ? <div className="wb-editor-find-bar app-inline-search" role="search">
            <ThemeIcon name="search" size={ICON_SIZE.dense} aria-hidden="true" />
            <input
              ref={editorFindInputRef}
              className="wb-editor-find-input app-inline-search-input"
              type="text"
              value={editorFindQuery}
              placeholder={t("desktop.common.search")}
              aria-label={t("desktop.common.search")}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              onChange={(event) => {
                const value = event.target.value;
                setEditorFindQuery(value);
                editorFindQueryRef.current = value;
                runEditorFind("forward", value, true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closeEditorFind();
                }
              }}
            />
            <span className={`wb-editor-find-count app-inline-search-meta${editorFindResult?.total === 0 ? " is-empty" : ""}`} aria-live="polite">
              {editorFindQuery.trim() && editorFindResult
                ? t("desktop.common.findCount", editorFindResult.current, editorFindResult.total)
                : ""}
            </span>
            <button type="button" className="wb-editor-find-btn app-inline-search-btn" aria-label={t("desktop.common.findPrev")} onClick={() => runEditorFind("backward")}><ThemeIcon name="arrow-up" size={ICON_SIZE.dense} /></button>
            <button type="button" className="wb-editor-find-btn app-inline-search-btn" aria-label={t("desktop.common.findNext")} onClick={() => runEditorFind("forward")}><ThemeIcon name="arrow-down" size={ICON_SIZE.dense} /></button>
            <button type="button" className="wb-editor-find-btn app-inline-search-btn" aria-label={t("desktop.common.closeFind")} onClick={closeEditorFind}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button>
          </div> : null}{currentEditor ? <div className="wb-editor-pane" onContextMenu={(event) => { event.preventDefault(); const selectedText = editorRef.current?.getSelectedText().trim() || ""; setEditorContextMenu({ x: event.clientX, y: event.clientY, hasSelection: Boolean(selectedText), selectedText }); }}>{editorDiskAlert}{currentEditor.view === "preview" ? <div className="wb-editor-preview markdown-body" onClick={(event) => { const src = imageSrcFromElement(event.target); if (src) setImagePreview(src); }} dangerouslySetInnerHTML={{ __html: renderMarkdown(currentEditor.content, { baseDir: posixDirname(currentEditor.path), rootDir: currentEditor.projectPath, imageLabels: { openInBrowser: t("desktop.markdown.openInBrowser"), unavailable: t("desktop.markdown.imageUnavailable"), remoteImage: t("desktop.markdown.remoteImage") } }) }} /> : <CodeEditor ref={editorRef} className="wb-editor-host" value={currentEditor.content} onChange={(value) => updateEditorContent(currentEditor.key, value)} onBlur={() => { if (currentEditor.dirty) void saveEditor(currentEditor.key); }} ariaLabel={currentEditor.path} filePath={currentEditor.path} selectionProjectPath={currentEditor.projectPath} readOnly={editorSettings?.editable === false} fontSize={editorSettings?.fontSize ?? 13} wordWrap={editorSettings?.wordWrap ?? false} tabSize={editorSettings?.tabSize ?? 4} appearance={editorAppearance} />}<div className="wb-editor-status"><span className="wb-editor-status-path">{currentEditor.path}</span><span className="wb-editor-status-state">{currentEditor.saving ? t("desktop.workbench.fileSaving") : currentEditor.diskState === "changed" ? t("desktop.workbench.fileConflict") : currentEditor.diskState === "deleted" ? t("desktop.workbench.fileDeletedOnDisk") : currentEditor.diskState === "external" ? t("desktop.workbench.fileUnavailableOnDisk") : currentEditor.dirty ? t("desktop.workbench.fileModified") : t("desktop.workbench.fileSaved")}</span><button type="button" className="wb-git-action-btn" disabled={!currentEditor.dirty || currentEditor.saving || Boolean(currentEditor.diskState) || editorSettings?.editable === false} onClick={() => void saveEditor(currentEditor.key)} aria-label={t("desktop.common.save")}><ThemeIcon name="save" size={ICON_SIZE.default} /></button></div></div> : null}{currentDiff ? <div className="wb-git-diff-pane"><div className="wb-diff-head"><strong className="wb-diff-title">{currentDiff.path}</strong><button type="button" className="wb-git-action-btn wb-diff-open" aria-label={t("desktop.workbench.fileOpen")} title={t("desktop.workbench.fileOpen")} onClick={() => void openFile(gitChangeFilePath(currentDiff))}><ThemeIcon name="file" size={ICON_SIZE.default} /></button></div><div className="wb-diff-labels"><span className="wb-diff-label">{currentDiff.oldLabel}</span><span className="wb-diff-label">{currentDiff.newLabel}</span></div><DiffWorkerPool><WorkbenchDiffView diff={currentDiff} appearance={editorAppearance} onDiscardHunk={(target) => void discardGitHunk(currentDiff, target)} onDiscardLine={(target) => void discardGitLine(currentDiff, target)} onStageHunk={(target) => void stageGitHunk(currentDiff, target)} onUnstageHunk={(target) => void unstageGitHunk(currentDiff, target)} onStageLine={(target) => void stageGitLine(currentDiff, target)} onUnstageLine={(target) => void unstageGitLine(currentDiff, target)} /></DiffWorkerPool></div> : null}{currentNotePane ? <NotePaneView key={currentNotePane.key} noteId={currentNotePane.noteId} active={active} onOpenNote={(noteId) => openNotePane(noteId)} onTitleChange={updateNotePaneTitle} onDirtyChange={setNotePaneDirty} onClose={() => closeNotePane(currentNotePane.key)} /> : null}{acpChats.map((pane) => {
            const visible = paneScopeKey(pane) === activeScopeKey && activePane === pane.key;
            return <AcpChatView
              key={pane.key}
              recordId={pane.recordId}
              provider={pane.provider}
              projectPath={pane.projectPath}
              title={pane.title}
              active={active && visible}
              initialPrompt={pane.initialPrompt}
              onTitleChange={(nextTitle) => {
                setAcpChats((current) => current.map((item) => item.key === pane.key ? { ...item, title: nextTitle } : item));
                setSessions((current) => current.map((item) =>
                  sessionKey(item) === acpListSessionKey(pane.recordId) ? { ...item, title: nextTitle } : item
                ));
              }}
              onSessionReady={refreshSessionsAfterAcpConnect}
              onInitialPromptSubmitted={() => {
                setAcpChats((current) => current.map((item) => item.key === pane.key ? { ...item, initialPrompt: undefined } : item));
              }}
            />;
          })}{browsers.map((pane) => {
            const visible = paneScopeKey(pane) === activeScopeKey && activePane === pane.key;
            return <BrowserPaneView
              key={pane.key}
              browserId={pane.browserId}
              projectPath={pane.projectPath}
              active={active && visible}
              poppedOut={pane.surfaceKind === "window"}
              onSessionChange={(session) => {
                if (!session) return;
                setBrowsers((current) => current.map((item) => item.key === pane.key ? {
                  ...item,
                  title: session.tabs.find((tab) => tab.tabId === session.activeTabId)?.title || item.title,
                  surfaceKind: session.surface.kind
                } : item));
              }}
              onDestroyed={() => closeBrowser(pane.key)}
            />;
          })}{terminalCreating && !currentTerminals.some((pane) => !pane.ptyId) && !currentAcpChat ? <div className="wb-terminal-loading wb-terminal-loading-stack" role="status" aria-live="polite"><ThemeIcon name="loader" className="spin" size={ICON_SIZE.prominent} aria-hidden="true" /><span>{t("desktop.common.loading")}</span></div> : null}{!terminalCreating && !currentTerminals.length && !currentEditors.length && !currentDiffs.length && !currentAcpChats.length && !currentBrowsers.length && !currentNotePanes.length ? <p className="muted wb-terminal-hint">{selectedProject ? t("desktop.workbench.selectSessionHint") : t("desktop.workbench.selectProjectHint")}</p> : null}</div></div>
          {side ? <><ResizeHandle label={t("desktop.workbench.resizeSidePanel")} onDelta={(delta) => setWidth("side", -delta)} /><aside className="wb-side-panel">{side === "files" ? <div className="wb-side-pane wb-explorer-side-pane"><WorkbenchFileExplorer ref={fileExplorerRef} roots={sideRoots} activePath={currentFilePath} onOpenFile={(path) => void openFile(path, undefined, projectForPath(path) || undefined)} onOpenPreview={(path) => void openFile(path, undefined, projectForPath(path) || undefined, "preview")} onShowGitHistory={(path) => void loadGitFileHistory(path)} onFindInFolder={findInExplorerFolder} onError={(message) => setStatus({ text: message, kind: "error" })} /><WorkbenchScriptsPane compact hasProject={sideRoots.length > 0} selectedProject={sideRoot} packages={scriptPackages} loading={scriptsLoading} error={scriptsError} truncated={scriptsTruncated} collapsed={scriptsSectionCollapsed} onToggleCollapsed={toggleScriptsSectionCollapsed} onRefresh={sideRoots.length ? () => void loadScripts() : undefined} onRun={runScript} /></div> : side === "scripts" ? <WorkbenchScriptsPane hasProject={sideRoots.length > 0} selectedProject={sideRoot} packages={scriptPackages} loading={scriptsLoading} error={scriptsError} truncated={scriptsTruncated} onRefresh={sideRoots.length ? () => void loadScripts() : undefined} onRun={runScript} /> : side === "search" ? <WorkbenchSearchSidePane
            selectedProject={sideRoots[0] ?? null}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchProjectMode={searchProjectMode}
            searchProjectQuery={searchProjectQuery}
            onSearchProjectQueryChange={setSearchProjectQuery}
            searchProjectResults={searchProjectResults}
            searchProjectActive={searchProjectActive}
            searchProjectActiveIndex={searchProjectActiveIndex}
            searchProjectLabel={searchProjectLabel}
            searchProjectOptionId={searchProjectOptionId}
            searchProjectOptionRefs={searchProjectOptionRefs}
            onEnterSearchProjectMode={enterSearchProjectMode}
            onLeaveSearchProjectMode={leaveSearchProjectMode}
            onMoveSearchProjectSelection={moveSearchProjectSelection}
            onActivateSearchProject={activateSearchProject}
            onSearchProjectSelectionId={setSearchProjectSelectionId}
            searchMatchCase={searchMatchCase}
            searchWholeWord={searchWholeWord}
            searchUseRegex={searchUseRegex}
            onToggleMatchCase={() => setSearchMatchCase((v) => !v)}
            onToggleWholeWord={() => setSearchWholeWord((v) => !v)}
            onToggleUseRegex={() => setSearchUseRegex((v) => !v)}
            searchDetailsOpen={searchDetailsOpen}
            searchReplaceOpen={searchReplaceOpen}
            onToggleDetails={toggleSearchDetails}
            onToggleReplace={toggleSearchReplace}
            searchReplaceText={searchReplaceText}
            onSearchReplaceTextChange={setSearchReplaceText}
            searchFilesInclude={searchFilesInclude}
            onSearchFilesIncludeChange={setSearchFilesInclude}
            searchFilesExclude={searchFilesExclude}
            onSearchFilesExcludeChange={setSearchFilesExclude}
            searchInputRef={searchInputRef}
            searchReplaceInputRef={searchReplaceInputRef}
            searchIncludeInputRef={searchIncludeInputRef}
            searchExcludeInputRef={searchExcludeInputRef}
            searchLoading={searchLoading}
            searchError={searchError}
            searchTruncated={searchTruncated}
            searchGroups={searchGroups}
            searchFileCount={searchFileCount}
            searchMatchCount={searchMatchCount}
            searchExpanded={searchExpanded}
            onToggleGroup={(path) => setSearchExpanded((current) => {
              const next = new Set(current);
              if (next.has(path)) next.delete(path);
              else next.add(path);
              return next;
            })}
            searchSelectedKey={searchSelectedKey}
            searchReplaceVisible={searchReplaceVisible}
            searchReplacing={searchReplacing}
            onRunSearch={() => {
              window.clearTimeout(searchTimerRef.current);
              void runProjectSearch(searchQuery);
            }}
            onReplace={(files, onlyByPath) => void performSearchReplace(files, onlyByPath)}
            onOpenMatch={(match, key) => {
              setSearchSelectedKey(key);
              void openFile(match.path, { path: match.path, line: match.line, column: match.column, endColumn: match.endColumn }, projectForPath(match.path) || undefined);
            }}
          /> : <div className="wb-side-pane">
            <div className="wb-side-pane-head wb-git-pane-head">
              <span className="wb-side-pane-title">{gitHistoryContext ? gitHistoryTitle : t("desktop.workbench.sidePanelGit")}</span>
              <div className="wb-git-actions">{gitHistoryContext ? <>
                <button type="button" className="wb-git-action-btn" onClick={closeGitHistory} aria-label={gitHistoryBackLabel}><ThemeIcon name="chevron-left" size={ICON_SIZE.default} /></button>
                <button type="button" className="wb-git-action-btn" disabled={gitLogLoading} onClick={retryGitHistory} aria-label={t("desktop.common.refresh")}><ThemeIcon name="refresh" size={ICON_SIZE.default} className={gitLogLoading ? "spin" : undefined} /></button>
              </> : <>
                <button type="button" className="wb-git-action-btn" disabled={!gitRoot} onClick={() => void loadGitLog()} aria-label={t("desktop.workbench.gitLog")}><ThemeIcon name="history" size={ICON_SIZE.default} /></button>
                <button type="button" className="wb-git-action-btn" disabled={gitRefreshing} onClick={() => void refreshGit(true)} aria-label={t("desktop.common.refresh")}><ThemeIcon name="refresh" size={ICON_SIZE.default} className={gitRefreshing ? "spin" : undefined} /></button>
              </>}</div>
            </div>
            {gitHistoryContext ? <div className="wb-log-body">
              {gitLogLoading ? <p className="muted wb-git-empty" role="status">{t(gitHistoryContext.kind === "file" ? "desktop.workbench.gitFileHistoryLoading" : "desktop.common.loading")}</p>
                : gitLogError ? <div className="wb-git-panel"><p className="muted wb-git-empty is-error" role="alert">{t(gitHistoryContext.kind === "file" ? "desktop.workbench.gitFileHistoryLoadFailed" : "desktop.workbench.gitLogLoadFailed", gitLogError)}</p><button type="button" className="ghost-btn" onClick={retryGitHistory}>{t("desktop.common.refresh")}</button></div>
                  : gitHistoryContext.kind === "file" ? <div className="wb-git-log-history-layout">
                      <div className="wb-git-log-history-list">
                        {gitLog?.commits.length ? <div className="wb-git-log-graph-list">{gitLog.commits.map((commit, index) => renderGitLogRow(commit, index))}</div> : <p className="muted wb-git-empty">{t("desktop.workbench.gitFileHistoryEmpty")}</p>}
                      </div>
                      {gitShow ? <div className="wb-git-log-detail wb-git-log-history-detail">
                        <div className="wb-git-log-detail-head">
                          <div className="wb-git-log-detail-title-row">
                            <h4 className="wb-git-log-detail-subject">{gitShow.subject || t("desktop.workbench.gitLogUntitled")}</h4>
                            <button type="button" className="wb-git-log-detail-close" onClick={() => setGitShow(null)} aria-label={t("desktop.workbench.gitHistoryDetailClose")}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button>
                          </div>
                          <p className="wb-git-log-meta"><span className="wb-git-log-hash">{gitShow.shortHash}</span><span className="wb-git-log-meta-sep">·</span><span>{gitShow.author}</span><span className="wb-git-log-meta-sep">·</span><span>{formatGitCommitDate(gitShow.date, locale)}</span></p>
                        </div>
                        <pre className="wb-git-log-detail-body">{gitShow.body}</pre>
                        <div className="wb-git-log-files">{gitShow.files.length ? gitShow.files.map((file) => <button type="button" className="wb-git-log-file" key={file.path} onClick={() => void openGitShowFileDiff(gitShow.hash, file.path)}><span className="wb-git-file-status">{file.status}</span>{file.oldPath ? t("desktop.workbench.gitLogRename", file.oldPath, file.path) : file.path}</button>) : <p className="muted wb-git-empty">{t("desktop.workbench.gitLogNoFiles")}</p>}</div>
                      </div> : null}
                    </div>
                    : gitShow ? <>
                    <button type="button" className="wb-diff-back" onClick={() => setGitShow(null)} aria-label={t("desktop.workbench.gitLogBackToList")}><ThemeIcon name="chevron-left" size={ICON_SIZE.default} /></button>
                    <h4 className="wb-git-log-detail-subject">{gitShow.subject}</h4>
                    <p className="wb-git-log-meta">{gitShow.shortHash} · {gitShow.author}</p>
                    <pre className="wb-git-log-detail-body">{gitShow.body}</pre>
                    <div className="wb-git-log-files">{gitShow.files.length ? gitShow.files.map((file) => <button type="button" className="wb-git-log-file" key={file.path} onClick={() => void openGitShowFileDiff(gitShow.hash, file.path)}><span className="wb-git-file-status">{file.status}</span>{file.path}</button>) : <p className="muted wb-git-empty">{t("desktop.workbench.gitLogNoFiles")}</p>}</div>
                  </>
                    : gitLog?.commits.length ? <div className="wb-git-log-graph-list">{gitLog.commits.map((commit, index) => renderGitLogRow(commit, index))}</div>
                      : <p className="muted wb-git-empty">{t("desktop.workbench.gitLogEmpty")}</p>}
            </div> : <div className="wb-git-panel">{git?.isRepo || git?.nestedRepos?.length ? <>
              {changes.map((section) => section.entries.length ? <section className="wb-git-section" key={section.title}><h4 className="wb-git-section-title">{section.title}</h4>{section.entries.map((change, index) => <button type="button" className="wb-git-file" key={`${change.repoRoot}:${change.repoPath}:${index}`} onClick={() => void openDiff(change, section.staged)}><span className={`wb-git-file-status is-${change.status.toLowerCase().slice(0, 3)}`}>{change.status}</span><span className="wb-git-file-path">{change.path}</span></button>)}</section> : null)}
              {!changes.some((section) => section.entries.length) ? <p className="muted wb-git-empty">{t("desktop.workbench.sidePanelNoChanges")}</p> : null}
            </> : <p className="muted wb-git-empty">{sideRoot ? t("desktop.workbench.sidePanelGitUnavailable") : t("desktop.workbench.sidePanelNoRoot")}</p>}</div>}
          </div>}</aside></> : null}
        </div>
      </main>
    </div>
    {branchPane ? <div ref={branchMenuRef} className="wb-git-branch-popover" style={{ ...(branchMenuPosition ?? {}), visibility: "hidden" }}>{branchResult?.mode === "nested" ? <div className="wb-git-branch-list">{renderBranchMenu()}</div> : <><div className="wb-git-branch-repo-head">{branchResult?.repoRoot || branchPane.repoRoot || branchPane.cwd}</div><div className="wb-git-branch-list">{renderBranchMenu()}</div></>}</div> : null}
    {editorContextMenu ? <div ref={editorContextMenuRef} className={`wb-context-menu notes-selection-menu${editorContextMenuClosing ? " is-closing" : ""}`} role="menu" style={{ left: editorContextMenu.x, top: editorContextMenu.y, visibility: "hidden" }} onContextMenu={(event) => event.preventDefault()}>
      {editorContextMenu.selectedText ? (
        <>
          <SelectionActionItems
            text={editorContextMenu.selectedText}
            projectPath={currentEditor?.projectPath || selectedProject || undefined}
            onSent={() => setEditorContextMenu(null)}
            onActionStart={() => setEditorContextMenu(null)}
            runAction={runSelectionAction}
            x={editorContextMenu.x}
            y={editorContextMenu.y}
          />
          <div className="context-menu-separator" role="separator" />
        </>
      ) : null}
    </div> : null}
    {selectionResult ? (
      <SelectionActionResult
        result={selectionResult}
        closing={selectionResultClosing}
        onClose={clearSelectionResult}
        onCopy={copySelectionResult}
      />
    ) : null}
    {gitLogDialog ? <div className={`wb-git-log-dialog${gitLogDialogClosing ? " is-closing" : ""}`} role="dialog" aria-modal="true">
      {gitLogDialog.kind === "branch" ? <>
        <div className="wb-git-log-dialog-title">{t("desktop.workbench.gitBranchFromCommitTitle", gitLogDialog.commit.subject || gitLogDialog.commit.shortHash)}</div>
        <form className="wb-git-log-dialog-row" onSubmit={(event) => {
          event.preventDefault();
          void createBranchFromGitLogCommit(gitLogDialog.commit, gitLogDialogInputRef.current?.value || "");
        }}>
          <input ref={gitLogDialogInputRef} className="wb-git-log-dialog-input" type="text" placeholder={t("desktop.workbench.gitBranchFromCommitPlaceholder")} autoComplete="off" spellCheck={false} />
          <button type="submit" className="ghost-btn">{t("desktop.workbench.gitBranchFromCommitCreate")}</button>
        </form>
        <div className="wb-git-log-dialog-actions">
          <button type="button" className="ghost-btn" onClick={closeGitLogDialog}>{t("desktop.common.cancel")}</button>
        </div>
      </> : <>
        <div className="wb-git-log-dialog-title">{t("desktop.workbench.gitResetTitle", gitLogDialog.commit.subject || gitLogDialog.commit.shortHash)}</div>
        <div className="wb-git-log-dialog-actions wb-git-log-dialog-reset-actions">
          <button type="button" className="ghost-btn" onClick={() => void resetGitLogCommit(gitLogDialog.commit, "soft")}>{t("desktop.workbench.gitResetModeSoft")}</button>
          <button type="button" className="ghost-btn" onClick={() => void resetGitLogCommit(gitLogDialog.commit, "mixed")}>{t("desktop.workbench.gitResetModeMixed")}</button>
          <button type="button" className="ghost-btn context-menu-item-danger" onClick={() => void resetGitLogCommit(gitLogDialog.commit, "hard")}>{t("desktop.workbench.gitResetModeHard")}</button>
        </div>
        <div className="wb-git-log-dialog-actions">
          <button type="button" className="ghost-btn" onClick={closeGitLogDialog}>{t("desktop.common.cancel")}</button>
        </div>
      </>}
    </div> : null}
    {newSessionPicker ? <div ref={newSessionPickerRef} className={`wb-context-menu wb-new-session-picker${newSessionPickerClosing ? " is-closing" : ""}`} role="menu" aria-label={t("desktop.settings.defaultAgent")} style={{ ...newSessionPickerStyle, visibility: "hidden" }} onMouseDown={(event) => event.stopPropagation()} onKeyDown={handleNewSessionPickerKeyDown}>
      {(settings?.workbench?.composerMentions?.length ?? 0) > 0 ? <>
        <span className="wb-context-menu-label">{t("desktop.settings.composerMentionsWorkspace")}</span>
        <button type="button" role="menuitem" aria-pressed={!newSessionPicker.mentionId} onClick={() => void chooseNewSessionMention(undefined)}>{t("desktop.settings.composerMentionsCurrentProject")}</button>
        {(settings?.workbench?.composerMentions ?? []).map((mention) => (
          <button type="button" role="menuitem" key={mention.id} aria-pressed={newSessionPicker.mentionId === mention.id} onClick={() => void chooseNewSessionMention(mention.id)}>{mention.id}</button>
        ))}
        {newSessionPicker.agentTarget ? null : <div className="context-menu-separator" role="separator" />}
      </> : null}
      {newSessionPicker.agentTarget ? null : <>
        <span className="wb-context-menu-label">{t("desktop.settings.newSessionGroupCli")}</span>
        {WORKBENCH_NEW_SESSION_TARGET_OPTIONS.filter((option) => option.group === "cli").map((option) => <button type="button" role="menuitem" key={option.value} onClick={() => void chooseNewSessionTarget(option.value)}>{t(`desktop.settings.newSessionTarget.${option.value.replace(":", "_")}`)}</button>)}
        <div className="context-menu-separator" role="separator" />
        <span className="wb-context-menu-label">{t("desktop.settings.newSessionGroupAcp")}</span>
        {WORKBENCH_NEW_SESSION_TARGET_OPTIONS.filter((option) => option.group === "acp").map((option) => <button type="button" role="menuitem" key={option.value} onClick={() => void chooseNewSessionTarget(option.value)}>{t(`desktop.settings.newSessionTarget.${option.value.replace(":", "_")}`)}</button>)}
      </>}
    </div> : null}
    {contextMenu && !(contextMenu.kind === "task" && !contextMenu.workspaceDir && contextMenu.taskHasSessions) ? <div ref={contextMenuRef} className={`wb-context-menu${contextMenu.kind === "session" || contextMenu.kind === "session-tab" ? " wb-session-context-menu" : ""}${contextMenuClosing ? " is-closing" : ""}`} role="menu" style={{ left: contextMenuLeft, top: contextMenu.y, visibility: "hidden" }} onContextMenu={(event) => event.preventDefault()}>
      {contextMenu.kind === "session-tab" ? <button type="button" role="menuitem" onClick={() => void runContextAction("floatingNote")}>{t(contextMenu.hasFloatingNote ? "desktop.workbench.openFloatingNote" : "desktop.workbench.addFloatingNote")}</button> : contextMenu.kind === "editor-tab" ? <button type="button" role="menuitem" onClick={() => void runContextAction("toggleEditorPreview")}>{t(contextMenu.editorPreview ? "desktop.common.edit" : "desktop.workbench.preview")}</button> : contextMenu.kind === "note" ? <>
        <span className="wb-context-menu-label">{t("desktop.workbench.setGtdStatus")}</span>
        <div className="wb-gtd-context-tags" role="group" aria-label={t("desktop.workbench.setGtdStatus")}>
          {GTD_STATUSES.map((gtdStatus) => <button type="button" role="menuitemradio" className={`wb-gtd-context-tag is-${gtdStatus}`} aria-checked={noteItems.find((item) => item.noteId === contextMenu.noteId)?.gtdStatus === gtdStatus} key={gtdStatus} onClick={() => void runContextAction(`gtd:${gtdStatus}`)}>{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</button>)}
        </div>
        {noteItems.find((item) => item.noteId === contextMenu.noteId)?.gtdStatus ? <button type="button" role="menuitem" onClick={() => void runContextAction("gtd:clear")}>{t("desktop.workbench.clearGtdStatus")}</button> : null}
      </> : contextMenu.kind === "task" ? <>{contextMenu.workspaceDir ? <button type="button" role="menuitem" onClick={() => void runContextAction("openWorkspace")}>{t("desktop.workbench.openTaskWorkspace")}</button> : null}{contextMenu.noteId && contextMenu.noteId === taskScope?.noteId && taskRollup?.override ? <button type="button" role="menuitem" onClick={() => void runContextAction("followChildren")}>{t("desktop.gtd.followChildren")}</button> : null}{!contextMenu.taskHasSessions ? <>{contextMenu.workspaceDir ? <div className="context-menu-separator" role="separator" /> : null}<button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => void runContextAction("deleteTask")}>{t("desktop.workbench.deleteTask")}</button></> : null}</> : selectedSessionKeys.size > 1 && contextMenu.session && selectedSessionKeys.has(sessionKey(contextMenu.session)) ? <>
        <button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => void runContextAction("remove")}>{t("desktop.workbench.removeFromPanelCount", selectedSessionKeys.size)}</button>
      </> : <>
        {contextMenu.session?.provider === "codex" ? <button type="button" role="menuitem" onClick={() => void runContextAction("codex")}>{t("desktop.workbench.openInChatGpt")}</button> : null}
        <button type="button" role="menuitem" onClick={() => void runContextAction("preview")}>{t("desktop.workbench.preview")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("floatingNote")}>{t(contextMenu.hasFloatingNote ? "desktop.workbench.openFloatingNote" : "desktop.workbench.addFloatingNote")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("note")}>{t("desktop.workbench.mountNote")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("autoRename")}>{t("desktop.workbench.autoRename")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("moveTask")}>{t("desktop.workbench.moveToTask")}</button>
        <div className="context-menu-separator" role="separator" />
        <span className="wb-context-menu-label">{t("desktop.workbench.setGtdStatus")}</span>
        <div className="wb-gtd-context-tags" role="group" aria-label={t("desktop.workbench.setGtdStatus")}>
          {GTD_STATUSES.map((gtdStatus) => <button type="button" role="menuitemradio" className={`wb-gtd-context-tag is-${gtdStatus}`} aria-checked={contextMenu.session ? effectiveGtdStatus(gtdStatuses, contextMenu.session) === gtdStatus : false} key={gtdStatus} onClick={() => void runContextAction(`gtd:${gtdStatus}`)}>{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</button>)}
        </div>
        {contextMenu.session && gtdStatuses[sessionKey(contextMenu.session)] ? <button type="button" role="menuitem" onClick={() => void runContextAction("gtd:clear")}>{t("desktop.workbench.clearGtdStatus")}</button> : null}
        <div className="context-menu-separator" role="separator" />
        <button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => void runContextAction("remove")}>{t("desktop.workbench.removeFromPanel")}</button>
      </>}
    </div> : null}
    {projectPickDialog ? <div className={`wb-note-created-overlay${projectPickDialogClosing ? " is-closing" : ""}`}><div className="wb-note-created-backdrop" onClick={() => !projectPickDialog.busy && setProjectPickDialog(null)} /><div className="wb-note-created-panel wb-project-pick-panel" role="dialog" aria-modal="true" aria-label={t("desktop.workbench.moveToTask")}><p className="wb-note-created-title">{t("desktop.workbench.moveToTaskTitle", projectPickDialog.session.title || projectPickDialog.session.id)}</p><p className="muted wb-rename-status">{t("desktop.workbench.moveToTaskHint")}</p><input type="search" className="wb-rename-input" value={projectPickDialog.query} placeholder={t("desktop.common.search")} autoComplete="off" spellCheck={false} disabled={projectPickDialog.busy} onChange={(event) => setProjectPickDialog((current) => current ? { ...current, query: event.target.value } : current)} />{projectPickDialog.status ? <p className="wb-rename-status muted">{projectPickDialog.status}</p> : null}<div className="wb-project-pick-list" role="listbox">{projectPickDialog.options.filter((item) => `${item.label} ${item.path ?? ""}`.toLowerCase().includes(projectPickDialog.query.trim().toLowerCase())).map((item) => <button type="button" className="wb-project-pick-item" key={item.noteId} disabled={projectPickDialog.busy} onClick={() => void applyMoveSessionToTask(item)}><span className="wb-project-pick-label">{item.label}</span>{item.path ? <span className="wb-project-pick-path">{item.path}</span> : null}</button>)}</div><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" disabled={projectPickDialog.busy} onClick={() => setProjectPickDialog(null)}>{t("desktop.common.cancel")}</button></div></div></div> : null}
    <GitChangesPanel
      visible={side === "git" && !gitHistoryContext}
      git={git}
      gitRoot={gitRoot}
      repositories={gitRepositories}
      branch={projectTracking?.branch || ""}
      activeDiff={currentDiff && currentDiff.source !== "commit" ? {
        repoRoot: currentDiff.repoRoot,
        repoPath: currentDiff.repoPath,
        staged: currentDiff.source === "staged"
      } : undefined}
      expanded={gitExpandedDirs}
      discarding={discardingGitPaths}
      commitMessage={commitMessage}
      commitBusy={commitBusy}
      commitSuggestion={commitSuggestion}
      canCommit={canCommit}
      syncing={gitSyncing}
      onSelectRepo={(root) => {
        selectGitRoot(root);
        setGitLog(null);
        setGitShow(null);
        setGitLogError("");
      }}
      onSelectBranch={(selection) => void checkoutGitPanelBranch(selection)}
      onSync={() => void syncGitBranch()}
      onToggleDir={toggleGitDirectory}
      onToggleStage={(targets, targetStaged) => void toggleGitStage(targets, targetStaged)}
      onOpenDiff={(change, staged) => void openDiff(change, staged)}
      onOpenFile={(change) => {
        const filePath = gitChangeFilePath(change);
        void openFile(filePath, undefined, projectForPath(filePath) || undefined);
      }}
      onOpenExternal={(change) => {
        const filePath = gitChangeFilePath(change);
        const targetRoot = projectForPath(filePath);
        if (!targetRoot) return;
        void desktopApi().workbenchOpenPath({
          rootPath: targetRoot,
          filePath
        }).catch((error) => {
          setStatus({ text: t("desktop.workbench.fileOpenExternalFailed", statusError(error)), kind: "error" });
        });
      }}
      onCopyPath={(change) => {
        try {
          desktopApi().clipboardWriteText(gitChangeFilePath(change));
          setStatus({ text: t("desktop.workbench.explorerPathCopied") });
        } catch (error) {
          setStatus({ text: t("desktop.workbench.explorerCopyPathFailed", statusError(error)), kind: "error" });
        }
      }}
      onDiscard={(change) => void discardGitChange(change)}
      onDiscardDirectory={(changes, directoryPath) => void discardGitDirectory(changes, directoryPath)}
      onCommitMessageChange={setCommitMessage}
      onSuggestCommit={() => void suggestCommit()}
      onCommit={(pushAfter) => void commit(pushAfter)}
      labels={{
        stagedTitle: t("desktop.workbench.sidePanelStaged"),
        changesTitle: t("desktop.workbench.sidePanelChanges"),
        noChanges: t("desktop.workbench.sidePanelNoChanges"),
        unavailable: sideRoot ? t("desktop.workbench.sidePanelGitUnavailable") : t("desktop.workbench.sidePanelNoRoot"),
        messageLabel: t("desktop.workbench.gitCommitDialogTitle"),
        resizeInput: t("desktop.workbench.resizeCommitInput"),
        autoGenerate: t("desktop.workbench.gitCommitAutoGenerate"),
        commit: t("desktop.workbench.gitCommit"),
        commitAndPush: t("desktop.workbench.gitCommitAndPush"),
        sync: t("desktop.workbench.gitSync"),
        suggestedLlm: t("desktop.workbench.gitCommitSuggestedLlm"),
        suggestedUnconfigured: t("desktop.workbench.gitCommitSuggestedUnconfigured"),
        suggestedFallback: t("desktop.workbench.gitCommitSuggestedFallback"),
        openFile: t("desktop.workbench.fileOpen"),
        openDefault: t("desktop.workbench.fileOpenDefault"),
        copyPath: t("desktop.common.copyPath"),
        discard: t("desktop.workbench.gitDiscard")
      }}
    />
    <GitGraphPortals gitLog={gitLog} gitShow={gitShow} keepGraph={gitHistoryContext?.kind === "file"} />
    <GitActionIcons visible={side === "git" && !gitHistoryContext} />
    <BranchGraphNavigation visible={side === "git" && Boolean(gitLog)} title={gitHistoryTitle} ariaLabel={gitHistoryBackLabel} onBack={closeGitHistory} />
    {floatingNoteTarget ? <FloatingSessionNote target={floatingNoteTarget} onClose={() => setFloatingNoteTarget(null)} /> : null}
    {imagePreview ? <div className={`notes-image-preview${imagePreviewClosing ? " is-closing" : ""}`} role="dialog" aria-modal="true" onClick={() => setImagePreview(null)}><img src={imagePreview} alt="" /><button type="button" className="notes-image-preview-close" aria-label={t("desktop.common.close")} onClick={() => setImagePreview(null)}><ThemeIcon name="close" size={ICON_SIZE.default} /></button></div> : null}
  </section>
    <QuickAccess
      open={quickAccessOpen}
      mode={quickAccessMode}
      query={quickAccessQuery}
      files={quickAccessVisibleFiles}
      commands={quickAccessCommands}
      recentPaths={quickAccessRecentPaths}
      loading={quickAccessLoading}
      truncated={quickAccessTruncated || quickAccessSearchTruncated}
      error={quickAccessError}
      hasProject={Boolean(quickAccessRoot)}
      labels={{
        filePlaceholder: t("desktop.workbench.quickAccessFilePlaceholder"),
        commandPlaceholder: t("desktop.workbench.quickAccessCommandPlaceholder"),
        loading: t("desktop.workbench.quickAccessLoading"),
        noFiles: t("desktop.workbench.quickAccessNoFiles"),
        noCommands: t("desktop.workbench.quickAccessNoCommands"),
        noProject: t("desktop.workbench.quickAccessNoProject"),
        truncated: t("desktop.workbench.quickAccessTruncated"),
        close: t("desktop.workbench.quickAccessClose"),
        dialog: t("desktop.workbench.quickAccessDialog")
      }}
      onModeChange={(mode) => {
        setQuickAccessMode(mode);
      }}
      onQueryChange={setQuickAccessQuery}
      onClose={closeQuickAccess}
      onOpenFile={openQuickAccessFile}
      onOpenDirectory={openQuickAccessDirectory}
    />
  </>, host);
}
