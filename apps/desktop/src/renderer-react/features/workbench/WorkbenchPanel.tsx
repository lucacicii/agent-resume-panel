import { ThemeIcon } from "../../components/ThemeIcon";
import { ProviderIcon } from "../../components/ProviderIcon";
import { createPortal } from "react-dom";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type ReactPortal } from "react";
import { Terminal } from "@xterm/xterm";
import { CanvasAddon } from "@xterm/addon-canvas";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import {
  createOsc52ClipboardProvider,
  Utf8Base64,
  writeTerminalSelection
} from "./terminalClipboard";
import type {
  AgentProvider,
  AgentSession,
  GtdStatus,
  PanelSettings,
  WorkbenchProjectContextMenuAction,
  WorkbenchSessionFolder,
  WorkbenchSessionFolderAssignment
} from "@agent-resume/core";
import {
  DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU,
  WORKBENCH_NEW_SESSION_TARGET_OPTIONS
} from "../settings/model";
import { desktopApi } from "../../bridge";
import { CodeEditor, type CodeEditorHandle, type CodeEditorSearchResult } from "../../components/CodeEditor";
import type { CodeMirrorAppearance } from "../../components/codeMirrorThemes";
import { renderMarkdown } from "../../components/Markdown";
import { notifyDesktop } from "../../components/Notifications";
import { SegmentedControl } from "../../components/SegmentedControl";
import { syncTruncationTitle } from "../../components/truncationTitle";
import { VirtualList } from "../../components/VirtualList";
import type { TerminalEngineType } from "./terminal";
import { useI18n } from "../../i18n";
import { AcpChatView } from "./AcpChatView";
import { BrowserPaneView } from "../browser/BrowserPaneView";
import type { BrowserSessionState } from "../../../shared/browserTypes";
import {
  acpRuntimeToStatus,
  collectActiveSessionDots,
  type SessionDotRuntime
} from "./activeSessionDots";
import {
  applyTuiDebounce,
  createTuiDebounceState,
  detectTuiSessionStatus,
  type TuiDebounceState
} from "./tuiSessionStatus";
import { TerminalComposer } from "./TerminalComposer";
import {
  FloatingSessionNote,
  sessionNoteMatchesTarget,
  type FloatingSessionNoteTarget
} from "./FloatingSessionNote";
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
import { LinkGraphSidePane } from "./LinkGraphSidePane";
import { SessionTranscriptPane } from "./SessionTranscriptPane";
import type {
  LinkGraphAnalyzeArgs,
  LinkGraphAnalyzeResult,
  LinkGraphOutputLanguage,
  LinkGraphProgressEvent
} from "../../../shared/linkGraphTypes";
import {
  QuickAccess,
  rankQuickAccessProjects,
  type QuickAccessCommand,
  type QuickAccessFile,
  type QuickAccessMode,
  type QuickAccessProject
} from "./QuickAccess";
import { ScriptsTree, type ScriptEntryView, type ScriptPackageView } from "./ScriptsTree";
import { resolveTerminalTheme, resolveTerminalThemeId, type WorkbenchTerminalThemeId } from "./terminalThemes";
import { WB_PATH_DND_MIME, hasWorkbenchPathDnd, shellQuotePath, startWorkbenchPathDrag } from "./workbenchDnd";
import { appearanceStateFromSettings, type DesktopAppearanceState } from "../../themes";
import {
  emitWorkbenchSessionLaunched,
  onWorkbenchLaunchSession,
  waitForCatalogSession,
  type LaunchSessionRequest
} from "./sessionLaunchBridge";
import { storedWidth } from "../../storage";
import type { WorkbenchArrowDirection } from "../../../shared/workbenchShortcuts";
import { startModalOpenReporter } from "./shortcutModalReporter";

type DesktopApi = ReturnType<typeof desktopApi>;
type FileInspection = Awaited<ReturnType<DesktopApi["workbenchInspectFile"]>>;
type GitStatusResult = Awaited<ReturnType<DesktopApi["terminalGitStatus"]>>;
type GitRepoTracking = NonNullable<GitStatusResult["tracking"]>[number];
type TerminalGitInfo = Awaited<ReturnType<DesktopApi["terminalGitInfo"]>>;
type TerminalGitBranches = Awaited<ReturnType<DesktopApi["terminalGitBranches"]>>;
type GitChange = GitStatusResult["staged"][number];
type GitLog = Awaited<ReturnType<DesktopApi["terminalGitLog"]>>;
type GitLogCommit = GitLog["commits"][number];
type GitShow = Awaited<ReturnType<DesktopApi["terminalGitShow"]>>;
type GitGraphLayout = GitLog["layout"];
type GitGraphRow = GitGraphLayout["rows"][number];
type GitHistoryContext =
  | { kind: "repository"; repoRoot: string }
  | { kind: "file"; projectRoot: string; filePath: string; repoRoot: string; repoPath: string };
type CommitSuggestion = Awaited<ReturnType<DesktopApi["terminalGitSuggestCommit"]>>;

/** Local porcelain status poll while Workbench is active. */
const GIT_STATUS_POLL_MS = 10_000;
/** Debounce before re-running status after a watched file change. */
const GIT_REFRESH_DEBOUNCE_MS = 300;
/** Remote fetch cadence while Workbench is active. */
const GIT_AUTO_FETCH_MS = 60_000;
/** Cap nested monorepo fetch fan-out per sweep. */
const GIT_AUTO_FETCH_MAX_ROOTS = 8;
/** Session tabs are auto-renamed after staying inactive this long. */
const SESSION_AUTO_RENAME_DELAY_MS = 2 * 60_000;
type GitTreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children: GitTreeNode[];
  change?: GitChange;
};
type EditorPane = Extract<FileInspection, { kind: "text" }> & {
  key: string;
  path: string;
  projectPath: string;
  content: string;
  dirty: boolean;
  saving?: boolean;
  diskState?: "changed" | "deleted" | "external";
  /** In-memory display mode for the active tab; resets when the tab closes. */
  view?: "edit" | "preview";
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
};
type ActiveGitDiff = {
  repoRoot: string;
  repoPath: string;
  staged: boolean;
};
type WorkbenchPaneGroup = "session" | "terminal" | "code" | "browser";
type TerminalPane = {
  key: string;
  title: string;
  group: Exclude<WorkbenchPaneGroup, "code" | "browser">;
  sessionKey?: string;
  projectPath: string;
  cwd: string;
  command?: string;
  noteId?: string;
  initialPrompt?: string;
  ptyId?: number;
  branch?: string | null;
  repoRoot?: string | null;
  gitMode?: TerminalGitInfo["mode"];
  nestedRepos?: TerminalGitInfo["nestedRepos"];
};
type PendingWorkbenchSession = {
  key: string;
  terminalKey: string;
  provider: AgentProvider;
  projectPath: string;
  title: string;
  createdAt: number;
  knownSessionKeys: string[];
  /** When set, resolve Flow-run launch waiter after catalog binds. */
  flowRequestId?: string;
  flowId?: string;
  flowNodeId?: string;
  noteId?: string;
  /** When set, auto-assign the bound catalog session to this project folder. */
  folderProjectId?: string;
  folderId?: string;
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
};
type BrowserPane = {
  key: string;
  title: string;
  group: "browser";
  browserId: string;
  projectPath: string;
  boundRecordId?: string;
  startUrl?: string;
  surfaceKind: "workbench" | "window";
};
type SideView = "files" | "git" | "search" | "scripts" | "linkgraph" | "transcript" | null;
type SearchMatch = Awaited<ReturnType<DesktopApi["workbenchSearchText"]>>["matches"][number];
type SearchReveal = { path: string; line: number; column: number; endColumn: number };
type ProjectFilter = "all" | "pinned" | "active";
type SessionFilter = "all" | "active";
type WorkbenchSidebarView = "projects" | "gtd" | "tags";
type TagCategoryFilter =
  | "all"
  | "tech_stack"
  | "business_domain"
  | "architecture"
  | "task_type"
  | "problem_domain"
  | "concept_knowledge"
  | "context_env";
type WorkbenchTagItem = {
  tag: string;
  normalizedTag: string;
  category: string;
  sessionCount: number;
  noteCount: number;
  activeEntityCount: number;
  totalHits: number;
  globalWeight: number;
  status: string;
  pinned: boolean;
  updatedAtMs: number;
};
const TAG_CATEGORY_FILTERS = [
  "all",
  "tech_stack",
  "business_domain",
  "architecture",
  "task_type",
  "problem_domain",
  "concept_knowledge",
  "context_env"
] as const satisfies readonly TagCategoryFilter[];
const GTD_STATUSES = ["inbox", "next", "waiting", "someday", "reference", "done"] as const satisfies readonly GtdStatus[];
const GTD_ACTIVE_STATUSES = ["inbox", "next", "waiting", "someday", "reference"] as const satisfies readonly GtdStatus[];
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
  folders: WorkbenchSessionFolder[];
  folderAssignments: WorkbenchSessionFolderAssignment[];
  pendingCount: number;
  label: string;
  active: boolean;
  pinned: boolean;
  updatedAt: number;
};
type WorkbenchContextMenu = {
  kind: "project" | "folder" | "session" | "session-tab" | "editor-tab";
  x: number;
  y: number;
  projectPath?: string;
  projectId?: string;
  folderId?: string;
  parentId?: string | null;
  folderName?: string;
  session?: AgentSession;
  floatingNoteTarget?: FloatingSessionNoteTarget;
  hasFloatingNote?: boolean;
  editorLabel?: string;
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
};
type WorkbenchRenameDialog = {
  projectPath: string;
  projectId?: string;
  title: string;
  status: string;
};
type WorkbenchFolderDialog = {
  mode: "create" | "rename";
  projectId: string;
  parentId?: string | null;
  folderId?: string;
  title: string;
  status: string;
  busy: boolean;
};
type WorkbenchFolderPickerDialog = {
  projectId: string;
  projectPath: string;
  session: AgentSession;
  folders: WorkbenchSessionFolder[];
  query: string;
  busy: boolean;
  status: string;
};
type ProjectPickDialog =
  | {
      kind: "merge";
      sourceId: string;
      sourceLabel: string;
      options: Array<{ id: string; label: string; path: string }>;
      query: string;
      busy: boolean;
      status: string;
    }
  | {
      kind: "split";
      sourceId: string;
      sourceLabel: string;
      options: Array<{ absolutePath: string; portableKey: string; sessionCount: number }>;
      query: string;
      busy: boolean;
      status: string;
    }
  | {
      kind: "moveSession";
      session: AgentSession;
      sourceLabel: string;
      options: Array<{ id: string; label: string; path: string }>;
      query: string;
      busy: boolean;
      status: string;
    };

/**
 * Session indexed under another user's home (cross-machine catalog sync).
 * Do NOT flag mere path-string differences on the same machine.
 */
function enabledProjectMenuActions(settings: PanelSettings | null): Set<WorkbenchProjectContextMenuAction> {
  const configured = settings?.workbench?.projectContextMenu;
  // unset → defaults; explicit empty array → hide all
  if (!Array.isArray(configured)) {
    return new Set(DEFAULT_WORKBENCH_PROJECT_CONTEXT_MENU);
  }
  return new Set(configured);
}

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
const SIDEBAR_VIEW_KEY = "workbench-sidebar-view";
const PINNED_PROJECTS_KEY = "pinned-projects";
const FOLDERS_COLLAPSED_KEY = "wb-folders-collapsed";
const FOLDERS_WIDTH_KEY = "sidebar-folders-width";
const LIST_WIDTH_KEY = "wb-list-pane-width";
const SIDE_WIDTH_KEY = "wb-side-panel-width";
const DEFAULT_SIDE_WIDTH = 320;
const TRANSCRIPT_SIDE_WIDTH = 420;
const ALL_PROJECTS_PANE_KEY = "__all_projects__";
const UNCLASSIFIED_FOLDER_ID = "__workbench_unclassified__";

function effectiveGtdStatus(
  statuses: Record<string, GtdStatus>,
  session: AgentSession
): GtdStatus {
  return statuses[sessionKey(session)] || "inbox";
}

function paneProjectKey(projectPath: string | null): string {
  return projectPath || ALL_PROJECTS_PANE_KEY;
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

function folderAssignmentKey(provider: string, agentSessionId: string): string {
  return `${provider}:${agentSessionId}`;
}

function workbenchFolderPath(folder: WorkbenchSessionFolder, folders: WorkbenchSessionFolder[]): string {
  const byId = new Map(folders.map((item) => [item.folderId, item]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: WorkbenchSessionFolder | undefined = folder;
  while (current && !seen.has(current.folderId)) {
    seen.add(current.folderId);
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts.join(" / ");
}

/** Separator between the LLM-suggested session title and its project / folder suffix. */
const SESSION_TITLE_SUFFIX_LEAD = " · ";
const SESSION_TITLE_PATH_JOIN = " / ";

/** Resolve the folder path (root / subfolder) a session is assigned to, or null when unclassified. */
function sessionFolderPath(
  folderData: Record<string, {
    folders: WorkbenchSessionFolder[];
    assignments: WorkbenchSessionFolderAssignment[];
  }>,
  provider: string,
  id: string
): string | null {
  const key = folderAssignmentKey(provider, id);
  for (const entry of Object.values(folderData)) {
    const assignment = entry.assignments.find(
      (item) => folderAssignmentKey(item.provider, item.agentSessionId) === key
    );
    if (!assignment) continue;
    const folder = entry.folders.find((item) => item.folderId === assignment.folderId);
    return folder ? workbenchFolderPath(folder, entry.folders) : null;
  }
  return null;
}

/** Drop a previously appended " · project / folder / subfolder" suffix before recomposing. */
function stripSessionTitleSuffix(title: string, projectName: string, folderPath: string | null): string {
  const full = folderPath
    ? `${SESSION_TITLE_SUFFIX_LEAD}${projectName}${SESSION_TITLE_PATH_JOIN}${folderPath}`
    : `${SESSION_TITLE_SUFFIX_LEAD}${projectName}`;
  if (title.endsWith(full)) return title.slice(0, title.length - full.length).trim();
  const folderOnly = folderPath ? `${SESSION_TITLE_SUFFIX_LEAD}${folderPath}` : null;
  if (folderOnly && title.endsWith(folderOnly)) return title.slice(0, title.length - folderOnly.length).trim();
  const projectOnly = `${SESSION_TITLE_SUFFIX_LEAD}${projectName}`;
  if (title.endsWith(projectOnly)) return title.slice(0, title.length - projectOnly.length).trim();
  return title;
}

/**
 * Compose "title · project / folder / subfolder" (or "title · project" when unclassified).
 * Dedupes when the suggestion already carries the suffix and caps the total at the 180-char
 * native store limit, keeping the most specific (leaf) folder levels when the path does not fit.
 */
function composeSessionTitle(base: string, projectName: string, folderPath: string | null): string {
  const MAX_TITLE_LENGTH = 180;
  const suffix = folderPath
    ? `${SESSION_TITLE_SUFFIX_LEAD}${projectName}${SESSION_TITLE_PATH_JOIN}${folderPath}`
    : `${SESSION_TITLE_SUFFIX_LEAD}${projectName}`;
  if (base.endsWith(suffix)) return base;
  let core = stripSessionTitleSuffix(base, projectName, folderPath);
  if (core.length + suffix.length <= MAX_TITLE_LENGTH) return `${core}${suffix}`;
  if (core.length >= MAX_TITLE_LENGTH - SESSION_TITLE_SUFFIX_LEAD.length) {
    core = core.slice(0, MAX_TITLE_LENGTH - SESSION_TITLE_SUFFIX_LEAD.length);
  }
  const budget = MAX_TITLE_LENGTH - core.length - SESSION_TITLE_SUFFIX_LEAD.length;
  // Project name keeps priority over folder depth (both sit behind the title).
  const project = projectName.slice(0, Math.min(projectName.length, budget));
  const pathBudget = folderPath ? budget - project.length - SESSION_TITLE_PATH_JOIN.length : 0;
  let path = "";
  if (folderPath && pathBudget > 0) {
    const parts = folderPath.split(SESSION_TITLE_PATH_JOIN);
    const kept: string[] = [];
    let used = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const cost = (kept.length ? SESSION_TITLE_PATH_JOIN.length : 0) + parts[i].length;
      if (used + cost > pathBudget) break;
      kept.unshift(parts[i]);
      used += cost;
    }
    path = kept.length ? kept.join(SESSION_TITLE_PATH_JOIN) : parts[parts.length - 1].slice(0, Math.max(pathBudget, 1));
  }
  const body = project ? `${project}${path ? `${SESSION_TITLE_PATH_JOIN}${path}` : ""}` : path;
  return `${core}${SESSION_TITLE_SUFFIX_LEAD}${body}`;
}

function sessionBelongsToProject(session: AgentSession | null, project: WorkbenchProject): boolean {
  return Boolean(
    session
    && (
      (session.projectId && project.id === session.projectId)
      || (session.projectPath && project.path === session.projectPath)
    )
  );
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

function formatDateTime(timestamp: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function storageString(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function storageBoolean(key: string): boolean {
  return storageString(key) === "true";
}

function loadPinnedProjects(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(PINNED_PROJECTS_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch { return new Set(); }
}

function savePinnedProjects(projects: Set<string>): void {
  try { localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify([...projects])); } catch { /* storage is optional */ }
}

function statusError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function gitOperationError(error: unknown): string {
  return statusError(error).replace(/^Error invoking remote method 'terminal:[^']+': Error:\s*/, "");
}

function gitStatusLetter(status: string): string {
  const normalized = status.trim() || "?";
  if (normalized === "?" || normalized === "A") return "A";
  if (normalized === "D") return "D";
  return "M";
}

function gitStatusClass(status: string): string {
  const letter = gitStatusLetter(status);
  return letter === "A" ? "is-add" : letter === "D" ? "is-del" : "is-mod";
}

function gitChangeTreePath(change: Pick<GitChange, "path" | "repoPath">): string {
  return change.repoPath || change.path;
}

function buildGitChangeTree(changes: GitChange[]): GitTreeNode[] {
  const roots: GitTreeNode[] = [];
  const directories = new Map<string, GitTreeNode>();

  for (const change of changes) {
    const treePath = gitChangeTreePath(change);
    const parts = treePath.split("/").map((part) => part.trim()).filter(Boolean);
    let parentPath = "";
    let siblings = roots;
    for (const [index, name] of parts.entries()) {
      const isFile = index === parts.length - 1;
      const path = parentPath ? `${parentPath}/${name}` : name;
      if (isFile) {
        siblings.push({ name, path: treePath, isDirectory: false, children: [], change });
        continue;
      }
      let directory = directories.get(path);
      if (!directory) {
        directory = { name, path, isDirectory: true, children: [] };
        directories.set(path, directory);
        siblings.push(directory);
      }
      parentPath = path;
      siblings = directory.children;
    }
  }

  const sort = (nodes: GitTreeNode[]) => {
    nodes.sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory) || left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    nodes.filter((node) => node.isDirectory).forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

function gitDirectoryExpandKey(repoRoot: string, directoryPath: string): string {
  return repoRoot ? `${repoRoot}\0${directoryPath}` : directoryPath;
}

function gitDirectoryKeys(changes: GitChange[]): Set<string> {
  const keys = new Set<string>();
  for (const change of changes) {
    const parts = gitChangeTreePath(change).split("/").map((part) => part.trim()).filter(Boolean);
    let parentPath = "";
    for (const name of parts.slice(0, -1)) {
      parentPath = parentPath ? `${parentPath}/${name}` : name;
      keys.add(gitDirectoryExpandKey(change.repoRoot, parentPath));
    }
  }
  return keys;
}

function expandedGitDirectories(changes: GitChange[]): Set<string> {
  return gitDirectoryKeys(changes);
}

function reconcileExpandedGitDirectories(current: Set<string>, changes: GitChange[]): Set<string> {
  const available = gitDirectoryKeys(changes);
  const next = new Set<string>();
  for (const key of current) {
    if (available.has(key)) next.add(key);
  }
  return next;
}

function gitGroupCheckboxState(repoRoot: string, stagedEntries: GitChange[], unstagedEntries: GitChange[]): boolean | "mixed" {
  const stagedCount = stagedEntries.filter((change) => change.repoRoot === repoRoot).length;
  const unstagedCount = unstagedEntries.filter((change) => change.repoRoot === repoRoot).length;
  if (stagedCount && unstagedCount) return "mixed";
  if (stagedCount) return true;
  return false;
}

function gitChangeKey(change: Pick<GitChange, "repoRoot" | "repoPath">): string {
  return `${change.repoRoot}\0${change.repoPath}`;
}

function gitChangeFilePath(change: Pick<GitChange, "repoRoot" | "repoPath">): string {
  const repoRoot = change.repoRoot.replace(/[\\/]+$/, "");
  const repoPath = change.repoPath.replace(/^[\\/]+/, "");
  return `${repoRoot}/${repoPath}`;
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

function collectNodeChanges(node: GitTreeNode): GitChange[] {
  if (!node.isDirectory) return node.change ? [node.change] : [];
  return node.children.flatMap(collectNodeChanges);
}

/** Repo-relative paths under a node, deduplicated, for stage/unstage. */
function uniqueRepoPaths(changes: GitChange[]): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const change of changes) {
    if (seen.has(change.repoPath)) continue;
    seen.add(change.repoPath);
    paths.push(change.repoPath);
  }
  return paths;
}

/** Absolute drag path for a Git tree node, or null when it cannot be resolved. */
function gitNodeDragPath(node: GitTreeNode): string | null {
  if (!node.isDirectory) return node.change ? gitChangeFilePath(node.change) : null;
  const repoRoot = collectNodeChanges(node)[0]?.repoRoot || "";
  return repoRoot ? gitChangeFilePath({ repoRoot, repoPath: node.path }) : null;
}

function uniqueGitChanges(changes: GitChange[]): GitChange[] {
  const unique = new Map<string, GitChange>();
  for (const change of changes) unique.set(gitChangeKey(change), change);
  return [...unique.values()];
}

type GitStageTarget = { repoRoot: string; paths: string[] };

function normalizeGitStageTargets(targets: GitStageTarget | GitStageTarget[]): GitStageTarget[] {
  return (Array.isArray(targets) ? targets : [targets]).filter((target) => target.repoRoot && target.paths.length);
}

function groupGitChangesByRepo(changes: GitChange[]): GitStageTarget[] {
  const groups = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>();
  for (const change of changes) {
    if (!change.repoRoot) continue;
    const paths = groups.get(change.repoRoot) || [];
    const used = seen.get(change.repoRoot) || new Set<string>();
    if (!used.has(change.repoPath)) {
      used.add(change.repoPath);
      paths.push(change.repoPath);
      groups.set(change.repoRoot, paths);
      seen.set(change.repoRoot, used);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([repoRoot, paths]) => ({ repoRoot, paths }));
}

function gitRepositoryLabel(git: GitStatusResult, repoRoot: string): string {
  return git.nestedRepos?.find((repository) => repository.root === repoRoot)?.displayPath || basename(repoRoot);
}

function gitRepositoryCount(git: GitStatusResult): number {
  const roots = new Set<string>();
  if (git.root) roots.add(git.root);
  git.nestedRepos?.forEach((repository) => roots.add(repository.root));
  for (const change of [...git.staged, ...git.unstaged]) {
    if (change.repoRoot) roots.add(change.repoRoot);
  }
  return roots.size;
}

function GitTreeCheckbox({
  state,
  ariaLabel,
  disabled,
  onChange
}: {
  state: boolean | "mixed";
  ariaLabel: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  const checked = state === true;
  const mixed = state === "mixed";
  return <button
    type="button"
    role="checkbox"
    className={`wb-git-check${checked ? " is-checked" : ""}${mixed ? " is-mixed" : ""}`}
    aria-checked={mixed ? "mixed" : checked}
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onChange(!(checked || mixed));
    }}
  >
    {checked ? <ThemeIcon name="check" size={11} strokeWidth={3} aria-hidden="true" /> : null}
    {mixed ? <span className="wb-git-check-dash" aria-hidden="true" /> : null}
  </button>;
}

function GitChangeTree({
  nodes,
  depth,
  staged,
  expanded,
  activeDiff,
  discarding,
  onToggleDir,
  onToggleStage,
  onOpen,
  onContextMenu,
  onDiscard,
  onDiscardDirectory,
  discardLabel
}: {
  nodes: GitTreeNode[];
  depth: number;
  staged: boolean;
  expanded: Set<string>;
  activeDiff?: ActiveGitDiff;
  discarding: Set<string>;
  onToggleDir: (path: string) => void;
  onToggleStage: (targets: GitStageTarget | GitStageTarget[], targetStaged: boolean) => void;
  onOpen: (change: GitChange) => void;
  onContextMenu: (event: React.MouseEvent, change: GitChange) => void;
  onDiscard: (change: GitChange) => void;
  onDiscardDirectory: (directoryPath: string, repoRoot: string) => void;
  discardLabel: string;
}): React.JSX.Element {
  return <>{nodes.map((node) => {
    if (node.isDirectory) {
      const nodeChanges = collectNodeChanges(node);
      const keys = nodeChanges.map(gitChangeKey);
      const repoPaths = uniqueRepoPaths(nodeChanges);
      const directoryDiscarding = keys.some((key) => discarding.has(key));
      const repoRoot = nodeChanges[0]?.repoRoot || "";
      const expandKey = gitDirectoryExpandKey(repoRoot, node.path);
      const isExpanded = expanded.has(expandKey);
      return <div key={`${repoRoot}:${node.path}`}>
        <div
          className="wb-file-tree-row wb-git-tree-row"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          draggable
          onDragStart={(event) => {
            if (!repoRoot) return;
            startWorkbenchPathDrag(event, gitChangeFilePath({ repoRoot, repoPath: node.path }));
          }}
        >
          <GitTreeCheckbox state={staged} ariaLabel={node.path} onChange={(checked) => {
            if (!repoRoot || !repoPaths.length) return;
            onToggleStage({ repoRoot, paths: repoPaths }, checked);
          }} />
          <button type="button" className="wb-git-tree-row-main" aria-expanded={isExpanded} onClick={() => onToggleDir(expandKey)}>
            <span className={`wb-file-tree-chevron${isExpanded ? " is-expanded" : ""}`}><ThemeIcon name="chevron-right" size={12} /></span>
            <ThemeIcon name="folder" size={14} className="wb-file-tree-icon" />
            <span className="wb-file-tree-label" title={node.path}>{node.name}</span>
          </button>
          <button
            type="button"
            className="wb-git-discard-btn"
            disabled={directoryDiscarding || !repoRoot}
            aria-label={`${discardLabel} ${node.path}`}
            title={discardLabel}
            onClick={() => onDiscardDirectory(node.path, repoRoot)}
          >
            {directoryDiscarding ? <ThemeIcon name="loader" size={13} className="spin" /> : <ThemeIcon name="undo" size={13} />}
          </button>
        </div>
        {isExpanded ? <div className="wb-file-tree-children"><GitChangeTree nodes={node.children} depth={depth + 1} staged={staged} expanded={expanded} activeDiff={activeDiff} discarding={discarding} onToggleDir={onToggleDir} onToggleStage={onToggleStage} onOpen={onOpen} onContextMenu={onContextMenu} onDiscard={onDiscard} onDiscardDirectory={onDiscardDirectory} discardLabel={discardLabel} /></div> : null}
      </div>;
    }
    if (!node.change) return null;
    const key = gitChangeKey(node.change);
    const active = activeDiff?.staged === staged
      && activeDiff.repoRoot === node.change.repoRoot
      && activeDiff.repoPath === node.change.repoPath;
    return <div
      className={`wb-file-tree-row wb-git-tree-file${active ? " is-selected" : ""}`}
      key={node.path}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      aria-selected={active}
      draggable
      onDragStart={(event) => {
        const path = gitNodeDragPath(node);
        if (path) startWorkbenchPathDrag(event, path);
      }}
      onContextMenu={(event) => onContextMenu(event, node.change!)}
    >
      <GitTreeCheckbox state={staged} ariaLabel={gitChangeTreePath(node.change)} onChange={(checked) => {
        if (!node.change?.repoRoot) return;
        onToggleStage({ repoRoot: node.change.repoRoot, paths: [node.change.repoPath] }, checked);
      }} />
      <button type="button" className="wb-git-tree-row-main" title={gitChangeTreePath(node.change)} onClick={() => onOpen(node.change!)}>
        <span className="wb-file-tree-chevron is-placeholder" aria-hidden="true" />
        <span className={`wb-git-file-status ${gitStatusClass(node.change.status)}`}>{gitStatusLetter(node.change.status)}</span>
        <span className="wb-file-tree-label">{node.name}</span>
      </button>
      <button
        type="button"
        className="wb-git-discard-btn"
        disabled={discarding.has(key)}
        aria-label={`${discardLabel} ${node.change.path}`}
        title={discardLabel}
        onClick={() => onDiscard(node.change!)}
      >
        {discarding.has(key) ? <ThemeIcon name="loader" size={13} className="spin" /> : <ThemeIcon name="undo" size={13} />}
      </button>
    </div>;
  })}</>;
}

function trackingForRoot(git: GitStatusResult | null, gitRoot: string): GitRepoTracking | null {
  if (!git?.tracking?.length) return null;
  if (gitRoot) {
    return git.tracking.find((item) => item.repoRoot === gitRoot) || null;
  }
  return git.tracking[0] || null;
}

const COMMIT_INPUT_MIN_HEIGHT = 96;
const COMMIT_INPUT_MAX_HEIGHT = 190;

function GitChangesPanel({
  visible,
  git,
  gitRoot,
  repositories,
  branch,
  activeDiff,
  expanded,
  discarding,
  commitMessage,
  commitBusy,
  commitSuggestion,
  canCommit,
  syncing,
  onSelectRepo,
  onSelectBranch,
  onSync,
  onToggleDir,
  onToggleStage,
  onOpenDiff,
  onOpenFile,
  onOpenExternal,
  onCopyPath,
  onDiscard,
  onDiscardDirectory,
  onCommitMessageChange,
  onSuggestCommit,
  onCommit,
  labels
}: {
  visible: boolean;
  git: GitStatusResult | null;
  gitRoot: string;
  repositories: Array<{ root: string; label: string }>;
  branch: string;
  activeDiff?: ActiveGitDiff;
  expanded: Set<string>;
  discarding: Set<string>;
  commitMessage: string;
  commitBusy: boolean;
  commitSuggestion: CommitSuggestion | null;
  canCommit: boolean;
  syncing: boolean;
  onSelectRepo: (root: string) => void;
  onSelectBranch: (selection: { branch: string; remote?: string }) => void;
  onSync: () => void;
  onToggleDir: (path: string) => void;
  onToggleStage: (targets: GitStageTarget | GitStageTarget[], targetStaged: boolean) => void;
  onOpenDiff: (change: GitChange, staged: boolean) => void;
  onOpenFile: (change: GitChange) => void;
  onOpenExternal: (change: GitChange) => void;
  onCopyPath: (change: GitChange) => void;
  onDiscard: (change: GitChange) => void;
  onDiscardDirectory: (changes: GitChange[], directoryPath: string) => void;
  onCommitMessageChange: (value: string) => void;
  onSuggestCommit: () => void;
  onCommit: (pushAfter: boolean) => void;
  labels: {
    stagedTitle: string;
    changesTitle: string;
    noChanges: string;
    unavailable: string;
    messageLabel: string;
    resizeInput: string;
    autoGenerate: string;
    commit: string;
    commitAndPush: string;
    sync: string;
    suggestedLlm: string;
    suggestedUnconfigured: string;
    suggestedFallback: string;
    openFile: string;
    openDefault: string;
    copyPath: string;
    discard: string;
  };
}): ReactPortal | null {
  const { t } = useI18n();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ change: GitChange; x: number; y: number } | null>(null);
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [commitInputHeight, setCommitInputHeight] = useState<number | null>(null);
  const [commitInputResizing, setCommitInputResizing] = useState(false);

  useEffect(() => {
    setHost(visible ? document.querySelector<HTMLElement>("#react-workbench .wb-git-panel") : null);
  }, [visible, git, gitRoot]);

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
    setContextMenu(null);
  }, [visible, gitRoot]);

  const beginCommitInputResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = commitInputHeight ?? commitInputRef.current?.offsetHeight ?? COMMIT_INPUT_MIN_HEIGHT;
    setCommitInputResizing(true);
    document.body.classList.add("is-pane-resizing");
    document.body.classList.add("is-pane-resizing-row");
    const move = (next: PointerEvent) => {
      const height = Math.round(Math.min(COMMIT_INPUT_MAX_HEIGHT, Math.max(COMMIT_INPUT_MIN_HEIGHT, startHeight + startY - next.clientY)));
      setCommitInputHeight(height);
    };
    const end = () => {
      setCommitInputResizing(false);
      document.body.classList.remove("is-pane-resizing");
      document.body.classList.remove("is-pane-resizing-row");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };

  if (!visible || !host) return null;
  if (!git?.isRepo && !git?.nestedRepos?.length) {
    return createPortal(<div className="react-git-panel"><p className="muted wb-git-empty">{labels.unavailable}</p></div>, host);
  }

  const sections = [
    { title: labels.stagedTitle, staged: true, entries: uniqueGitChanges(git.staged) },
    { title: labels.changesTitle, staged: false, entries: uniqueGitChanges(git.unstaged) }
  ];
  const allEntries = uniqueGitChanges(sections.flatMap((section) => section.entries));
  const hasEntries = sections.some((section) => section.entries.length > 0);
  const hasStagedEntries = sections.some((section) => section.staged && section.entries.length > 0);
  const showRepoGroups = gitRepositoryCount(git) > 1;
  const tracking = trackingForRoot(git, gitRoot);
  const trackingLabel = tracking?.upstream
    ? t("desktop.workbench.gitBranchTracking", tracking.ahead, tracking.behind)
    : null;
  const suggestionText = commitSuggestion
    ? commitSuggestion.source === "llm"
      ? labels.suggestedLlm
      : commitSuggestion.fallbackReason === "unconfigured"
        ? labels.suggestedUnconfigured
        : labels.suggestedFallback
    : null;

  return createPortal(<><div className="react-git-panel wb-git-panel-layout">
    <div className="wb-git-changes-scroll">
      {hasEntries ? sections.map((section) => {
        if (!section.entries.length) return null;
        const repoGroups = groupGitChangesByRepo(section.entries).map((group) => ({
          ...group,
          entries: section.entries.filter((change) => change.repoRoot === group.repoRoot)
        }));
        return <section className="wb-git-section" key={section.title}>
          <div className="wb-git-section-title">
            <GitTreeCheckbox state={section.staged} ariaLabel={section.title} onChange={(checked) => onToggleStage(repoGroups, checked)} />
            <span className="wb-git-section-title-text">{section.title}</span>
            <span className="wb-git-section-count">{section.entries.length}</span>
          </div>
          {repoGroups.map((group) => <div className="wb-git-repo-group" key={`${section.title}:${group.repoRoot}`}>
            {showRepoGroups ? <div className="wb-git-repo-group-title">
              <GitTreeCheckbox
                state={gitGroupCheckboxState(group.repoRoot, git.staged, git.unstaged)}
                ariaLabel={gitRepositoryLabel(git, group.repoRoot)}
                onChange={(checked) => onToggleStage({ repoRoot: group.repoRoot, paths: group.paths }, checked)}
              />
              <span className="wb-git-repo-group-label" title={group.repoRoot}>{gitRepositoryLabel(git, group.repoRoot)}</span>
              <span className="wb-git-section-count">{group.entries.length}</span>
            </div> : null}
            <div className="wb-git-tree" role="tree">
              <GitChangeTree
                nodes={buildGitChangeTree(group.entries)}
                depth={0}
                staged={section.staged}
                expanded={expanded}
                activeDiff={activeDiff}
                discarding={discarding}
                onToggleDir={onToggleDir}
                onToggleStage={onToggleStage}
                onOpen={(change) => onOpenDiff(change, section.staged)}
                onContextMenu={(event, change) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setContextMenu({ change, x: event.clientX, y: event.clientY });
                }}
                onDiscard={onDiscard}
                onDiscardDirectory={(directoryPath, repoRoot) => {
                  const prefix = `${directoryPath}/`;
                  const changes = allEntries.filter((change) => (
                    change.repoRoot === repoRoot && gitChangeTreePath(change).startsWith(prefix)
                  ));
                  if (changes.length) onDiscardDirectory(changes, directoryPath);
                }}
                discardLabel={labels.discard}
              />
            </div>
          </div>)}
        </section>;
      }) : <p className="muted wb-git-empty">{labels.noChanges}</p>}
    </div>
    <div className="wb-git-commit-composer">
      <div className="wb-git-commit-target">
        <GitRepositorySelector repositories={repositories} value={gitRoot} ariaLabel={t("desktop.workbench.gitRepoSelect")} onChange={onSelectRepo} />
        <GitBranchSelector repoRoot={gitRoot} value={branch} ariaLabel={t("desktop.workbench.switchBranch")} onChange={onSelectBranch} />
      </div>
      {suggestionText ? <p className={`wb-git-commit-suggestion${commitSuggestion?.source === "llm" ? " is-ai" : ""}`}>{suggestionText}</p> : null}
      <div
        className={`pane-resizer is-horizontal wb-git-commit-resizer${commitInputResizing ? " is-dragging" : ""}`}
        role="separator"
        aria-orientation="horizontal"
        aria-label={labels.resizeInput}
        onPointerDown={beginCommitInputResize}
      />
      <textarea
        ref={commitInputRef}
        className="wb-git-commit-input"
        value={commitMessage}
        disabled={commitBusy || !gitRoot}
        placeholder={labels.messageLabel}
        aria-label={labels.messageLabel}
        style={commitInputHeight ? { height: commitInputHeight } : undefined}
        onChange={(event) => onCommitMessageChange(event.target.value)}
      />
      <div className="wb-git-commit-actions">
        <button
          type="button"
          className={`wb-git-action-btn wb-git-commit-auto-btn${commitBusy ? " is-loading" : ""}`}
          disabled={commitBusy || !gitRoot || !hasStagedEntries}
          aria-busy={commitBusy}
          aria-label={labels.autoGenerate}
          title={labels.autoGenerate}
          onClick={onSuggestCommit}
        >
          {commitBusy ? <>
            <ThemeIcon name="loader" className="spin wb-git-default-loading" size={16} />
            <span className="wb-git-cyber-loading" aria-hidden="true" />
          </> : <ThemeIcon name="sparkles" size={16} />}
        </button>
        <button
          type="button"
          className="wb-git-action-btn"
          disabled={!canCommit}
          aria-label={labels.commit}
          title={labels.commit}
          onClick={() => onCommit(false)}
        >
          <ThemeIcon name="check" size={16} />
        </button>
        <button
          type="button"
          className="wb-git-action-btn primary"
          disabled={!canCommit}
          aria-label={labels.commitAndPush}
          title={labels.commitAndPush}
          onClick={() => onCommit(true)}
        >
          <ThemeIcon name="arrow-up-to-line" size={16} />
        </button>
        {trackingLabel ? <button
          type="button"
          className="muted wb-git-tracking wb-git-tracking-btn"
          title={tracking?.upstream ? `${labels.sync} · ${tracking.upstream}` : labels.sync}
          aria-label={labels.sync}
          aria-busy={syncing}
          disabled={syncing}
          onClick={onSync}
        >
          <ThemeIcon
            name={syncing ? "loader" : "refresh"}
            size={14}
            className={`wb-git-tracking-icon${syncing ? " spin" : ""}`}
            aria-hidden="true"
          />
          <span className="wb-git-tracking-label">{trackingLabel}</span>
        </button> : null}
      </div>
    </div>
  </div>
    {contextMenu ? createPortal(<div
      className="wb-context-menu wb-git-context-menu"
      role="menu"
      style={{
        left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 196)),
        top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 120))
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => { onOpenFile(contextMenu.change); setContextMenu(null); }}>{labels.openFile}</button>
      <button type="button" role="menuitem" onClick={() => { onOpenExternal(contextMenu.change); setContextMenu(null); }}>{labels.openDefault}</button>
      <button type="button" role="menuitem" onClick={() => { onCopyPath(contextMenu.change); setContextMenu(null); }}>{labels.copyPath}</button>
    </div>, document.body) : null}
  </>, host);
}

function graphColumnX(layout: GitGraphLayout, column: number): number {
  return column * layout.laneWidth + layout.laneWidth / 2;
}

function graphCurvePath(fromX: number, toX: number, rowHeight: number, side: "left" | "right"): string {
  const midY = rowHeight / 2;
  const bend = Math.max(10, Math.abs(toX - fromX) * 0.75);
  if (side === "left") return `M ${fromX} ${midY} C ${fromX - bend} ${midY + rowHeight * 0.2}, ${toX + bend * 0.35} ${midY + rowHeight * 0.3}, ${toX} ${rowHeight}`;
  return `M ${toX} ${rowHeight} C ${toX - bend * 0.35} ${midY + rowHeight * 0.3}, ${fromX + bend} ${midY + rowHeight * 0.2}, ${fromX} ${midY}`;
}

function GitGraphSvg({ row, layout }: { row: GitGraphRow; layout: GitGraphLayout }): React.JSX.Element {
  const radius = 4;
  const midY = layout.rowHeight / 2;
  const color = (column: number) => layout.columnColors[column] ?? column % 8;
  const incoming = new Set(row.incomingTracks || []);
  const outgoing = new Set(row.outgoingTracks || []);
  return <svg className="wb-git-log-graph-row-canvas" width={layout.maxColumns * layout.laneWidth} height={layout.rowHeight} viewBox={`0 0 ${layout.maxColumns * layout.laneWidth} ${layout.rowHeight}`} aria-hidden="true">
    {[...incoming].map((column) => <line key={`in-${column}`} x1={graphColumnX(layout, column)} y1={0} x2={graphColumnX(layout, column)} y2={row.commitColumn === column ? midY - radius - 1 : midY} className={`wb-git-graph-lane wb-git-graph-lane-${color(column)}`} />)}
    {[...outgoing].filter((column) => incoming.has(column)).map((column) => <line key={`out-${column}`} x1={graphColumnX(layout, column)} y1={row.commitColumn === column ? midY + radius + 1 : midY} x2={graphColumnX(layout, column)} y2={layout.rowHeight} className={`wb-git-graph-lane wb-git-graph-lane-${color(column)}`} />)}
    {(row.curves || []).map((curve, index) => {
      if (curve.side === "left" && curve.fromCol <= curve.toCol) return null;
      return <path key={`curve-${index}`} d={graphCurvePath(graphColumnX(layout, curve.fromCol), graphColumnX(layout, curve.toCol), layout.rowHeight, curve.side)} className={`wb-git-graph-lane wb-git-graph-lane-${curve.colorIndex ?? color(curve.fromCol)}`} />;
    })}
    {row.commitColumn != null ? <>{row.isHead ? <circle cx={graphColumnX(layout, row.commitColumn)} cy={midY} r={radius + 2.5} className="wb-git-graph-head-ring" /> : null}<circle cx={graphColumnX(layout, row.commitColumn)} cy={midY} r={radius} className={`wb-git-graph-node wb-git-graph-lane-${row.colorIndex ?? color(row.commitColumn)}`} /></> : null}
  </svg>;
}

function formatGitCommitDate(dateSeconds: number, locale: string): string {
  if (!Number.isFinite(dateSeconds)) return "";
  const date = new Date(dateSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return date.toLocaleDateString();
  }
}

function GitGraphPortals({ gitLog, gitShow, keepGraph }: { gitLog: GitLog | null; gitShow: GitShow | null; keepGraph: boolean }): React.JSX.Element | null {
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  useEffect(() => {
    setHosts(gitLog && (keepGraph || !gitShow) ? [...document.querySelectorAll<HTMLElement>("#react-workbench .wb-git-log-graph-row")] : []);
  }, [gitLog, gitShow, keepGraph]);
  if (!gitLog || (gitShow && !keepGraph)) return null;
  return <>{hosts.map((host, index) => {
    const row = gitLog.layout.rows[index];
    return row ? createPortal(<span className="react-git-graph-gutter wb-git-log-graph-gutter" key={gitLog.commits[index]?.hash || index}><GitGraphSvg row={row} layout={gitLog.layout} /></span>, host) : null;
  })}</>;
}

function gitCommitBranchNames(commit: GitLogCommit): string[] {
  return [...new Set([...(commit.refs.heads || []), ...(commit.refs.remotes || [])])];
}

function GitCommitBranches({ commit }: { commit: GitLogCommit }): React.JSX.Element | null {
  const branches = gitCommitBranchNames(commit);
  if (!branches.length) return null;
  const localBranches = new Set(commit.refs.heads || []);
  return <span className="wb-git-log-branches" aria-label={branches.join(", ")}>
    {branches.map((branch) => <span
      className={`wb-git-log-decoration-pill${localBranches.has(branch) ? " is-local" : " is-remote"}${commit.refs.isHead && commit.refs.primaryLabel === branch ? " is-head" : ""}`}
      data-branch-name={branch}
      title={branch}
      key={branch}
    >
      <ThemeIcon name="git-branch" size={10} aria-hidden="true" />
      <span>{branch}</span>
    </span>)}
  </span>;
}

function GitActionIcons({ visible }: { visible: boolean }): React.JSX.Element | null {
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  useEffect(() => {
    setHosts(visible ? [...document.querySelectorAll<HTMLElement>("#react-workbench .wb-git-actions button")] : []);
  }, [visible]);
  if (!visible) return null;
  const icons = [
    { label: "Git log", icon: <ThemeIcon name="history" size={16} /> },
    { label: "Refresh", icon: <ThemeIcon name="refresh" size={16} /> }
  ];
  return <>{hosts.map((host, index) => icons[index] ? createPortal(<span className="react-git-action-icon" title={icons[index].label} aria-hidden="true">{icons[index].icon}</span>, host) : null)}</>;
}

function GitRepositorySelector({
  repositories,
  value,
  ariaLabel,
  onChange
}: {
  repositories: Array<{ root: string; label: string }>;
  value: string;
  ariaLabel: string;
  onChange: (root: string) => void;
}): React.JSX.Element {
  if (repositories.length <= 1) {
    const only = repositories[0];
    return <span className="wb-git-repo-select is-static" title={only?.root || value} aria-label={ariaLabel}>{only?.label || basename(value)}</span>;
  }
  return <select className="react-git-repo-select wb-git-repo-select" value={value} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value)}>
    {repositories.map((repository) => <option value={repository.root} key={repository.root}>{repository.label}</option>)}
  </select>;
}

function GitBranchSelector({
  repoRoot,
  value,
  ariaLabel,
  onChange
}: {
  repoRoot: string;
  value: string;
  ariaLabel: string;
  onChange: (selection: { branch: string; remote?: string }) => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [branches, setBranches] = useState<TerminalGitBranches | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const requestRef = useRef(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!repoRoot) {
      setBranches(null);
      setLoading(false);
      return;
    }
    const api = desktopApi();
    if (typeof api.terminalGitBranches !== "function") {
      setBranches(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void api.terminalGitBranches({ cwd: repoRoot }).then((result) => {
      if (requestRef.current === requestId) setBranches(result);
    }).catch(() => {
      if (requestRef.current === requestId) setBranches(null);
    }).finally(() => {
      if (requestRef.current === requestId) setLoading(false);
    });
    return () => { requestRef.current += 1; };
  }, [repoRoot, value]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".react-git-branch-control")) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!repoRoot) return null;
  const localBranches = branches?.mode === "direct" ? branches.localBranches || branches.branches || [] : [];
  const remoteBranches = branches?.mode === "direct" ? branches.remoteBranches || [] : [];
  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPosition({
        top: Math.min(rect.bottom + 4, window.innerHeight - 16),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 268))
      });
    }
    setOpen((current) => !current);
  };
  const selectBranch = (selection: { branch: string; remote?: string }) => {
    setOpen(false);
    onChange(selection);
  };
  const trigger = <button
    ref={buttonRef}
    type="button"
    className="react-git-branch-control react-git-branch-trigger"
    aria-label={`${ariaLabel}: ${value || "-"}`}
    aria-haspopup="menu"
    aria-expanded={open}
    onClick={openMenu}
  >
    <ThemeIcon name="git-branch" size={12} aria-hidden="true" />
    <span>{value || "-"}</span>
    <ThemeIcon name="chevron-down" size={11} aria-hidden="true" />
  </button>;
  const menu = open ? createPortal(<div
    className="react-git-branch-control react-git-branch-popover wb-git-branch-popover"
    style={menuPosition || undefined}
    role="menu"
    aria-label={ariaLabel}
  >
    <div className="wb-git-branch-list">
      {loading && !branches ? <p className="wb-git-branch-empty muted" role="status">{t("desktop.common.loading")}</p> : <>
        <div className="wb-git-branch-repo-group">
          <div className="wb-git-branch-repo-head">{t("desktop.workbench.gitLocalBranches")}</div>
          {localBranches.length ? localBranches.map((branch) => <button
            type="button"
            role="menuitemradio"
            aria-checked={branch === value}
            className={`wb-git-branch-item${branch === value ? " active" : ""}`}
            key={branch}
            onClick={() => selectBranch({ branch })}
          >{branch}</button>) : <p className="wb-git-branch-empty muted">{t("desktop.workbench.gitNoLocalBranches")}</p>}
        </div>
        <div className="wb-git-branch-repo-group">
          <div className="wb-git-branch-repo-head">{t("desktop.workbench.gitRemoteBranches")}</div>
          {remoteBranches.length ? remoteBranches.map((branch) => <button
            type="button"
            role="menuitem"
            className="wb-git-branch-item"
            title={branch.fullName}
            key={branch.fullName}
            onClick={() => selectBranch({ branch: branch.name, remote: branch.remote })}
          >{branch.fullName}</button>) : <p className="wb-git-branch-empty muted">{t("desktop.workbench.gitNoRemoteBranches")}</p>}
        </div>
      </>}
    </div>
  </div>, document.body) : null;
  return <>{trigger}{menu}</>;
}

function BranchGraphNavigation({
  visible,
  title,
  ariaLabel,
  onBack
}: {
  visible: boolean;
  title: string;
  ariaLabel: string;
  onBack: () => void;
}): ReactPortal | null {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(visible ? document.querySelector<HTMLElement>("#react-workbench .wb-git-pane-head") : null);
  }, [visible]);
  return visible && host ? createPortal(<div className="react-branch-graph-nav">
    <button type="button" className="wb-diff-back" aria-label={ariaLabel} onClick={onBack}><ThemeIcon name="chevron-left" size={15} /></button>
    <span className="react-branch-graph-title">{title}</span>
  </div>, host) : null;
}

function ResizeHandle({ label, onDelta }: { label: string; onDelta: (delta: number) => void }): React.JSX.Element {
  const start = useRef<number | null>(null);
  return <button
    type="button"
    className="pane-resizer"
    aria-label={label}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      start.current = event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.classList.add("is-pane-resizing");
    }}
    onPointerMove={(event) => {
      if (start.current === null) return;
      const delta = event.clientX - start.current;
      start.current = event.clientX;
      onDelta(delta);
    }}
    onPointerUp={(event) => {
      start.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      document.body.classList.remove("is-pane-resizing");
    }}
    onPointerCancel={() => { start.current = null; document.body.classList.remove("is-pane-resizing"); }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      onDelta(event.key === "ArrowLeft" ? -8 : 8);
    }}
  />;
}

/**
 * OSC 52: allow apps (tmux, neovim, Claude Code, …) to write the system clipboard.
 * Prefer Electron's native clipboard so multi-byte UTF-8 (CJK) is not re-interpreted
 * as Latin-1, and so writes work without a user-gesture permission prompt.
 */
const writeOnlyClipboardProvider = createOsc52ClipboardProvider({
  writeText: (text) => {
    writeTerminalSelection(text, (value) => desktopApi().clipboardWriteText?.(value));
  }
});

const TERMINAL_SEARCH_DECORATIONS: NonNullable<ISearchOptions["decorations"]> = {
  matchBackground: "#515c6a",
  matchBorder: "#ffffff33",
  matchOverviewRuler: "#515c6a",
  activeMatchBackground: "#f5a623",
  activeMatchBorder: "#ffffff",
  activeMatchColorOverviewRuler: "#f5a623"
};

/**
 * Full-screen TUIs (claude code, prime agent, …) switch to the alternate screen
 * buffer, which has no xterm scrollback. They enable mouse tracking and scroll
 * their own viewport, so the waterdrop control emulates wheel bursts through the PTY.
 */
/** A small, controllable movement for an in-app TUI viewport. */
const TUI_WHEEL_STEP = 8;
const TUI_WHEEL_REPEAT_MS = 80;
const TUI_DRAG_DEAD_ZONE_PX = 8;
const TUI_DRAG_PIXELS_PER_TICK = 6;
const TUI_DRAG_MAX_TICKS = 32;
/** Wheel ticks sent by Home / End; TUIs scroll a few lines per tick. */
const TUI_WHEEL_JUMP = 400;
/** DEC private modes whose enablement makes the app own wheel scrolling. */
const TUI_MOUSE_TRACKING_MODES = new Set([1000, 1002, 1003]);
const MOUSE_TRACKING_SEQUENCE = /\x1b\[\?([0-9;]+)([hl])/g;

/**
 * Track DEC private mode 1000/1002/1003 (mouse tracking) per pty from the raw
 * PTY data stream. Full-screen TUIs enable these so they receive wheel events
 * and scroll their own viewport; the jump controls mirror that with a burst.
 */
function trackTerminalMouseModes(id: number, chunk: string, tracking: Map<number, boolean>): void {
  const previous = tracking.get(id) ?? false;
  let next = previous;
  for (const match of chunk.matchAll(MOUSE_TRACKING_SEQUENCE)) {
    const modes = match[1].split(";").map((mode) => Number(mode));
    if (!modes.some((mode) => TUI_MOUSE_TRACKING_MODES.has(mode))) continue;
    next = match[2] === "h";
  }
  if (next !== previous) tracking.set(id, next);
}

/**
 * Inline agent TUIs (prime agent, codex, …) repaint the transcript with a
 * synchronized full-screen clear (`\x1b[?2026h … \x1b[2J … \x1b[?2026l`)
 * whenever content above the visible viewport changes or the transcript
 * shrinks (e.g. compaction). xterm keeps the viewport at the old baseY after
 * that, so the repainted content lands at the top of the screen — the terminal
 * appears to "jump to the top" mid-output. Track those redraw bursts per
 * terminal so TerminalView can re-anchor the viewport to the bottom.
 */
type TuiRedrawTracker = {
  /** Rolling tail of the previous chunk so split escape sequences are seen whole. */
  tail: string;
  /** Inside a `\x1b[?2026h` … `\x1b[?2026l` synchronized-output block. */
  inSync: boolean;
  /** A full-screen erase happened inside the block (redraw pending). */
  pending: boolean;
  /** The synchronized block closed after a pending erase (redraw complete). */
  blockClosed: boolean;
};

/** Longest tracked sequence is `\x1b[?2026h` (7 bytes); keep a bit of slack. */
const TUI_REDRAW_TAIL_LENGTH = 10;
const tuiRedrawTrackers = new WeakMap<Terminal, TuiRedrawTracker>();

function trackTuiRedraw(chunk: string, terminal: Terminal): void {
  let tracker = tuiRedrawTrackers.get(terminal);
  if (!tracker) {
    tracker = { tail: "", inSync: false, pending: false, blockClosed: false };
    tuiRedrawTrackers.set(terminal, tracker);
  }
  const scan = tracker.tail + chunk;
  tracker.tail = scan.slice(-TUI_REDRAW_TAIL_LENGTH);
  if (scan.includes("\x1b[?2026h")) tracker.inSync = true;
  if (tracker.inSync && scan.includes("\x1b[2J")) tracker.pending = true;
  if (scan.includes("\x1b[?2026l")) {
    tracker.inSync = false;
    if (tracker.pending) tracker.blockClosed = true;
  }
}

/**
 * Re-anchor a session pane's normal-buffer viewport after the agent TUI
 * repainted the transcript from the top. `scrollToBottom` alone is not enough:
 * xterm's viewport is already at baseY, so a transcript shorter than the
 * screen renders at the top. Pull the viewport up by the trailing blank rows
 * so the transcript tail stays at the bottom of the screen.
 */
function reanchorTuiViewport(terminal: Terminal): void {
  try {
    const buffer = terminal.buffer.active;
    if (buffer.type !== "normal") return;
    terminal.scrollToBottom();
    const rows = terminal.rows;
    let lastContent = -1;
    for (let i = rows - 1; i >= 0; i -= 1) {
      const line = buffer.getLine(buffer.viewportY + i);
      if (line && line.translateToString(true).trim()) {
        lastContent = i;
        break;
      }
    }
    if (lastContent >= 0 && lastContent < rows - 1) {
      const gap = rows - 1 - lastContent;
      // The public IBuffer typings only expose viewportY/baseY getters. Set the
      // internal Buffer field directly instead of scrollLines: a negative
      // scrollLines flips xterm's "user is scrolling" flag, which would freeze
      // follow-on output instead of staying anchored.
      const internal = (terminal as unknown as {
        _core?: { _bufferService?: { buffer?: { ydisp: number; ybase: number } } };
      })._core?._bufferService?.buffer;
      if (internal) {
        internal.ydisp = Math.max(0, internal.ybase - gap);
        terminal.refresh(0, rows - 1);
      }
    }
  } catch {
    /* terminal disposed mid-redraw */
  }
}

/**
 * Check whether the terminal viewport is anchored at or following the bottom of
 * output. For normal shells, this is viewportY >= baseY. For TUI surfaces where
 * trailing blank rows were pulled up by reanchorTuiViewport, this checks whether
 * the viewport sits at or below the content anchor (baseY - gap).
 */
export function isTerminalAtBottom(terminal: Terminal): boolean {
  try {
    const buffer = terminal.buffer.active;
    if (buffer.type !== "normal") return true;
    if (buffer.viewportY >= buffer.baseY) return true;
    const rows = terminal.rows;
    let lastContent = -1;
    for (let i = rows - 1; i >= 0; i -= 1) {
      const line = buffer.getLine(buffer.baseY + i);
      if (line && line.translateToString(true).trim()) {
        lastContent = i;
        break;
      }
    }
    const gap = lastContent >= 0 && lastContent < rows - 1 ? rows - 1 - lastContent : 0;
    const targetY = Math.max(0, buffer.baseY - gap);
    return buffer.viewportY >= targetY;
  } catch {
    return true;
  }
}

type TerminalRendererMode = "webgl" | "canvas";

/**
 * Prefer WebGL for throughput; fall back to Canvas 2D, then DOM.
 * When `mode === "canvas"`, skip WebGL entirely (settings: force Canvas).
 *
 * CJK stability still depends on font stack + Unicode11 + rescaleOverlappingGlyphs.
 * On context loss (or WebGL load failure) drop to Canvas so the session stays usable.
 */
function tryLoadAcceleratedRenderer(
  terminal: Terminal,
  mode: TerminalRendererMode = "webgl"
): { dispose: () => void } {
  let active: { dispose(): void } | null = null;
  let contextLossSub: { dispose(): void } | null = null;

  const loadCanvas = (): boolean => {
    try {
      contextLossSub?.dispose();
      contextLossSub = null;
      try { active?.dispose(); } catch { /* previous renderer already gone */ }
      active = null;
      const canvas = new CanvasAddon();
      terminal.loadAddon(canvas);
      active = canvas;
      return true;
    } catch {
      active = null;
      return false;
    }
  };

  if (mode === "canvas") {
    loadCanvas();
  } else {
    try {
      const webgl = new WebglAddon();
      terminal.loadAddon(webgl);
      active = webgl;
      contextLossSub = webgl.onContextLoss(() => {
        try { webgl.dispose(); } catch { /* ignore */ }
        active = null;
        loadCanvas();
      });
    } catch {
      loadCanvas();
    }
  }

  return {
    dispose: () => {
      contextLossSub?.dispose();
      contextLossSub = null;
      try { active?.dispose(); } catch { /* ignore */ }
      active = null;
    }
  };
}

/**
 * After zoom / DPR / theme changes the WebGL glyph atlas can keep stale samples
 * (looks like scrambled CJK until hover forces a partial redraw). Rebuild atlas
 * and repaint the visible buffer.
 */
function refreshTerminalGlyphs(terminal: Terminal): void {
  try {
    terminal.clearTextureAtlas?.();
  } catch {
    /* DOM renderer has no atlas */
  }
  try {
    const last = Math.max(0, terminal.rows - 1);
    terminal.refresh(0, last);
  } catch {
    /* terminal disposed mid-fit */
  }
}

/**
 * Latin mono first (cell metrics), then CJK faces so double-width glyphs do not
 * fall back to a proportional UI font that bleeds across neighboring cells.
 */
const TERMINAL_FONT_FAMILY =
  'Menlo, Monaco, "SF Mono", Consolas, "Cascadia Mono", "Courier New", "PingFang SC", "Hiragino Sans GB", "Noto Sans Mono CJK SC", "Microsoft YaHei UI", monospace';

function resolveTransparentTerminalTheme(themeId: WorkbenchTerminalThemeId, appearance: DesktopAppearanceState) {
  // The xterm CSS parser rejects the transparent keyword and falls back to
  // its opaque default background. Use an explicit zero-alpha color instead.
  return { ...resolveTerminalTheme(themeId, appearance), background: "rgba(0, 0, 0, 0)" };
}

function TerminalView({ pane, active, themeId, appearance, rendererMode, engineType = "xterm", onPty, onDetach, onInput, onInitialPromptSubmitted, mouseTracking, registerFocus }: {
  pane: TerminalPane;
  active: boolean;
  themeId: WorkbenchTerminalThemeId;
  appearance: DesktopAppearanceState;
  /** webgl (default) or force canvas — hot-swapped without killing the PTY. */
  rendererMode: TerminalRendererMode;
  engineType?: TerminalEngineType;
  onPty: (key: string, id: number, terminal: Terminal | null) => void;
  onDetach: (id: number) => void;
  onInput: (key: string) => void;
  onInitialPromptSubmitted: (key: string) => void;
  /** Per-pty mouse-tracking state parsed from the PTY data stream (stable ref). */
  mouseTracking: { current: Map<number, boolean> };
  registerFocus: (key: string, focus: () => void) => () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const scheduleFitRef = useRef<(() => void) | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const rendererRef = useRef<{ dispose: () => void } | null>(null);
  const rendererModeRef = useRef<TerminalRendererMode>(rendererMode);
  const ptyId = useRef<number | null>(null);
  const initialPromptRef = useRef(pane.initialPrompt);
  /** Whether the user is anchored at the bottom of the normal buffer (session
   *  panes only). Updated solely from user scroll input; write-side re-anchors
   *  read it so they never fight an intentional scroll-up. */
  const followOutputRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMeta, setSearchMeta] = useState<{ index: number; count: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const tuiScrollTimer = useRef<number | null>(null);
  const tuiDragRef = useRef<{ pointerId: number; startY: number } | null>(null);
  const tuiScrollIntentRef = useRef<{ direction: "up" | "down"; ticks: number } | null>(null);
  const [tuiPull, setTuiPull] = useState<{ direction: "idle" | "up" | "down"; strength: number }>({ direction: "idle", strength: 0 });
  const [scrollState, setScrollState] = useState({ tuiMode: false, tuiInteractive: false });

  const runSearch = useCallback((direction: "next" | "prev", term: string) => {
    const addon = searchAddonRef.current;
    if (!addon) return;
    const q = term.trim();
    if (!q) {
      addon.clearDecorations();
      setSearchMeta(null);
      return;
    }
    const opts: ISearchOptions = {
      caseSensitive: false,
      decorations: TERMINAL_SEARCH_DECORATIONS
    };
    if (direction === "next") addon.findNext(q, opts);
    else addon.findPrevious(q, opts);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    searchAddonRef.current?.clearDecorations();
    setSearchMeta(null);
  }, []);

  useEffect(() => {
    if (!host.current) return;
    const hostEl = host.current;
    setReady(false);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMeta(null);
    ptyId.current = null;
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      // Keep cell metrics tight; non-zero letterSpacing skews FitAddon + CJK.
      letterSpacing: 0,
      lineHeight: 1.0,
      // Ambiguous-width / fallback glyphs otherwise spill into the next cell.
      rescaleOverlappingGlyphs: true,
      scrollback: 10_000,
      allowTransparency: true,
      theme: resolveTransparentTerminalTheme(themeId, appearance)
    });
    terminalRef.current = terminal;
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostEl);

    // Unicode widths must be active before any write / accelerated paint.
    const unicode11 = new Unicode11Addon();
    terminal.loadAddon(unicode11);
    terminal.unicode.activeVersion = "11";

    const initialMode = rendererModeRef.current;
    rendererRef.current = tryLoadAcceleratedRenderer(terminal, initialMode);

    terminal.loadAddon(new WebLinksAddon((_event, uri) => {
      void desktopApi().openExternalUrl(uri).catch(() => undefined);
    }));

    // Runtime ctor is (base64?, provider?); published .d.ts only documents provider.
    // Utf8Base64 avoids atob-as-Latin-1 mojibake for CJK OSC 52 payloads.
    terminal.loadAddon(new (ClipboardAddon as unknown as new (
      base64?: Utf8Base64,
      provider?: typeof writeOnlyClipboardProvider
    ) => ClipboardAddon)(new Utf8Base64(), writeOnlyClipboardProvider));

    // Selection copy (Cmd/Ctrl+C): also push Unicode text through Electron clipboard.
    // Some Chromium/Electron paths otherwise mishandle multi-byte clipboard data.
    const onCopySelection = (event: Event) => {
      const text = terminal.getSelection();
      if (!text) return;
      writeTerminalSelection(text, (value) => desktopApi().clipboardWriteText?.(value));
      const ce = event as ClipboardEvent;
      if (ce.clipboardData) {
        ce.clipboardData.setData("text/plain", text);
        ce.preventDefault();
      }
    };
    hostEl.addEventListener("copy", onCopySelection);

    terminal.loadAddon(new ImageAddon({
      storageLimit: 64,
      enableSizeReports: true,
      // SIXEL's decoder instantiates embedded WebAssembly, which is intentionally
      // blocked by the Desktop renderer CSP (`script-src 'self'`). Keep iTerm
      // image protocol support without weakening CSP via unsafe-eval.
      sixelSupport: false
    }));

    const searchAddon = new SearchAddon();
    terminal.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    const searchResultsSub = searchAddon.onDidChangeResults?.((event) => {
      setSearchMeta({ index: event.resultIndex, count: event.resultCount });
    });

    let alive = true;
    let lastPtySize = "";
    const syncScrollState = () => {
      if (!alive) return;
      const buffer = terminal.buffer.active;
      // Alternate-buffer activation can happen before terminalSpawn resolves.
      // Detect the buffer independently so the TUI affordance is not missed
      // during the Codex startup handshake.
      const mouseTrackingActive = ptyId.current !== null && mouseTracking.current.get(ptyId.current) === true;
      // Agent session panes are TUI surfaces even when the CLI keeps xterm's
      // normal buffer. Once their PTY exists, allow the waterdrop to send
      // wheel events; some Codex startup paths do not expose DEC mouse modes
      // in a single parseable chunk, which must not leave the control inert.
      const tuiMode = pane.group === "session" || buffer.type === "alternate";
      const tuiInteractive = tuiMode && (pane.group === "session" || mouseTrackingActive);
      const next = { tuiMode, tuiInteractive };
      setScrollState((current) => current.tuiMode === next.tuiMode && current.tuiInteractive === next.tuiInteractive ? current : next);
    };

    const resizePty = (cols: number, rows: number) => {
      if (ptyId.current === null) return;
      const sizeKey = `${cols}x${rows}`;
      if (sizeKey === lastPtySize) return;
      lastPtySize = sizeKey;
      void desktopApi().terminalResize({ id: ptyId.current, cols, rows }).catch(() => {
        if (lastPtySize === sizeKey) lastPtySize = "";
      });
    };

    // FitAddon only updates xterm cols/rows. PTY must be told separately so
    // fullscreen TUIs and shell line wrapping track window zoom / pane resize.
    const onTermResize = terminal.onResize(({ cols, rows }) => {
      resizePty(cols, rows);
    });
    followOutputRef.current = true;
    const onWriteParsed = terminal.onWriteParsed(() => {
      syncScrollState();
      if (pane.group !== "session") return;
      const buffer = terminal.buffer.active;
      if (buffer.type !== "normal") return;
      const tracker = tuiRedrawTrackers.get(terminal);
      const redrawCompleted = tracker?.pending === true && tracker?.blockClosed === true;
      if (redrawCompleted && tracker) {
        tracker.pending = false;
        tracker.blockClosed = false;
      }
      // Inline agent TUIs repaint the transcript from the top; xterm then
      // leaves the viewport at the old baseY so the content appears at the top
      // of the screen mid-output. Re-anchor the bottom for the user.
      if (!followOutputRef.current) return;
      if (redrawCompleted) {
        reanchorTuiViewport(terminal);
      } else if (buffer.viewportY < buffer.baseY) {
        terminal.scrollToBottom();
      }
    });
    const onBufferChange = terminal.buffer.onBufferChange(syncScrollState);

    let lastFitKey = "";
    const fitHost = () => {
      if (hostEl.clientWidth < 2 || hostEl.clientHeight < 2) return;
      try {
        const proposed = fitAddon.proposeDimensions();
        if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return;
        if (proposed.cols === terminal.cols && proposed.rows === terminal.rows) {
          syncScrollState();
          return;
        }
        const buffer = terminal.buffer.active;
        const wasAtNormalBufferBottom = buffer.type === "normal" && buffer.viewportY === buffer.baseY;
        fitAddon.fit();
        if (wasAtNormalBufferBottom && terminal.buffer.active.type === "normal") terminal.scrollToBottom();
        // Only rebuild the WebGL glyph atlas when geometry or DPR actually changes.
        // Continuous ResizeObserver ticks would thrash clearTextureAtlas otherwise.
        const fitKey = `${terminal.cols}x${terminal.rows}@${window.devicePixelRatio || 1}`;
        if (fitKey !== lastFitKey) {
          lastFitKey = fitKey;
          refreshTerminalGlyphs(terminal);
        }
        syncScrollState();
      } catch {
        /* hidden panes fit after activation */
      }
    };

    let fitFrame = 0;
    const scheduleFit = () => {
      if (fitFrame) return;
      fitFrame = window.requestAnimationFrame(() => {
        fitFrame = 0;
        fitHost();
      });
    };
    scheduleFitRef.current = scheduleFit;

    fitHost();
    syncScrollState();
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(hostEl);
    // Window zoom / electron zoom-factor changes do not always re-fire RO alone.
    window.addEventListener("resize", scheduleFit);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", scheduleFit);

    const input = terminal.onData((data) => {
      if (ptyId.current !== null) void desktopApi().terminalInput({ id: ptyId.current, data });
      onInput(pane.key);
    });
    // Wheel, scrollbar drags, and PageUp/PageDown move xterm's viewport. Track
    // whether the user stays anchored to the bottom so output re-anchoring
    // (above) never yanks them back while they are reading history. These run
    // in the bubble phase, after xterm's own handlers applied the scroll.
    const syncFollowState = () => {
      const buffer = terminal.buffer.active;
      if (buffer.type !== "normal") return;
      followOutputRef.current = buffer.viewportY >= buffer.baseY;
    };
    hostEl.addEventListener("wheel", syncFollowState);
    hostEl.addEventListener("pointerup", syncFollowState);
    hostEl.addEventListener("keyup", syncFollowState);

    const bindPty = (id: number, replay: string, sendInitialPrompt: boolean) => {
      if (!alive) return;
      ptyId.current = id;
      if (replay) terminal.write(replay);
      onPty(pane.key, id, terminal);
      syncScrollState();
      setReady(true);
      // Re-fit after attach in case layout settled during spawn.
      scheduleFit();
      resizePty(terminal.cols, terminal.rows);
      if (sendInitialPrompt && initialPromptRef.current) {
        window.setTimeout(() => {
          const initialPrompt = initialPromptRef.current;
          if (!alive || ptyId.current !== id || !initialPrompt) return;
          void desktopApi().terminalInput({ id, data: `${initialPrompt}\r` })
            .then(() => onInitialPromptSubmitted(pane.key))
            .catch(() => undefined);
        }, 600);
      }
    };

    const persistOrBind = (id: number, replay: string, sendInitialPrompt: boolean) => {
      if (!alive) {
        // Project switch: keep the PTY on the pane and stop forwarding.
        // Close tab: onPty destroys the orphan spawn because the pane is gone.
        onPty(pane.key, id, null);
        if (typeof desktopApi().terminalDetach === "function") {
          void desktopApi().terminalDetach({ id });
        }
        return;
      }
      bindPty(id, replay, sendInitialPrompt);
    };

    const existingId = pane.ptyId;
    const attachExisting = existingId != null && typeof desktopApi().terminalAttach === "function"
      ? desktopApi().terminalAttach({ id: existingId }).then((result) => {
          if (result.ok) {
            persistOrBind(existingId, result.replay || "", false);
            return;
          }
          throw new Error("terminal attach failed");
        })
      : existingId != null
        ? Promise.resolve().then(() => persistOrBind(existingId, "", false))
        : desktopApi().terminalSpawn({
            cwd: pane.cwd,
            command: pane.command,
            cols: terminal.cols,
            rows: terminal.rows
          }).then(async (spawned) => {
            const { id } = spawned;
            if (spawned.warnSoftLimit) {
              notifyDesktop({
                text: t("desktop.workbench.ptySoftLimit", spawned.count || spawned.softLimit || 12),
                kind: "info",
                durationMs: 5000
              });
            }
            let replay = "";
            if (typeof desktopApi().terminalAttach === "function") {
              const attached = await desktopApi().terminalAttach({ id });
              if (attached.ok) replay = attached.replay || "";
            }
            persistOrBind(id, replay, true);
          });

    void attachExisting.catch((error: unknown) => {
      if (!alive) return;
      terminal.write(`\r\n${statusError(error)}\r\n`);
      setReady(true);
    });
    return () => {
      alive = false;
      observer.disconnect();
      window.cancelAnimationFrame(fitFrame);
      if (scheduleFitRef.current === scheduleFit) scheduleFitRef.current = null;
      window.removeEventListener("resize", scheduleFit);
      viewport?.removeEventListener("resize", scheduleFit);
      hostEl.removeEventListener("copy", onCopySelection);
      hostEl.removeEventListener("wheel", syncFollowState);
      hostEl.removeEventListener("pointerup", syncFollowState);
      hostEl.removeEventListener("keyup", syncFollowState);
      if (tuiScrollTimer.current !== null) {
        window.clearInterval(tuiScrollTimer.current);
        tuiScrollTimer.current = null;
      }
      onTermResize.dispose();
      onWriteParsed.dispose();
      onBufferChange.dispose();
      input.dispose();
      searchResultsSub?.dispose();
      searchAddonRef.current = null;
      terminalRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
      const currentPtyId = ptyId.current ?? pane.ptyId ?? null;
      ptyId.current = null;
      if (currentPtyId !== null) {
        onDetach(currentPtyId);
        if (typeof desktopApi().terminalDetach === "function") {
          void desktopApi().terminalDetach({ id: currentPtyId });
        }
      }
      terminal.dispose();
    };
    // pane.ptyId is intentionally omitted: the first spawn writes it via onPty
    // and must not remount/detach the same view.
  }, [mouseTracking, onDetach, onInitialPromptSubmitted, onInput, onPty, pane.command, pane.cwd, pane.key, t]);

  // Hot-swap accelerated renderer when settings change — keep the same PTY/session.
  useEffect(() => {
    if (rendererModeRef.current === rendererMode) return;
    rendererModeRef.current = rendererMode;
    const terminal = terminalRef.current;
    if (!terminal) return;
    try { rendererRef.current?.dispose(); } catch { /* ignore */ }
    rendererRef.current = tryLoadAcceleratedRenderer(terminal, rendererMode);
    refreshTerminalGlyphs(terminal);
  }, [rendererMode]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    // Replace full theme object so ANSI colors do not leak from the previous preset.
    terminal.options.theme = resolveTransparentTerminalTheme(themeId, appearance);
    refreshTerminalGlyphs(terminal);
  }, [appearance, themeId]);

  useEffect(() => {
    if (!active) return;
    // Double rAF: wait until the pane is display:flex and has real metrics.
    let outer = 0;
    let inner = 0;
    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        try {
          scheduleFitRef.current?.();
        } catch { /* fit guard */ }
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f";
      if (isFind) {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, closeSearch, searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [searchOpen]);

  // Accept only internal Workbench path drags. On drop, write the POSIX
  // single-quote escaped absolute path to the current PTY without any trailing
  // space, newline, or Enter, so it lands at the shell prompt or the active
  // TUI input position without executing.
  useEffect(() => {
    const hostEl = host.current;
    if (!hostEl) return;
    let dragDepth = 0;
    const onDragEnter = (event: DragEvent) => {
      if (!hasWorkbenchPathDnd(event.dataTransfer)) return;
      dragDepth += 1;
      setDragOver(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasWorkbenchPathDnd(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragOver(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasWorkbenchPathDnd(event.dataTransfer)) return;
      event.preventDefault();
      dragDepth = 0;
      setDragOver(false);
      const path = event.dataTransfer?.getData(WB_PATH_DND_MIME) || "";
      const id = ptyId.current;
      if (!path || id === null) return;
      void desktopApi().terminalInput({ id, data: shellQuotePath(path) });
      terminalRef.current?.focus();
    };
    hostEl.addEventListener("dragenter", onDragEnter);
    hostEl.addEventListener("dragover", onDragOver);
    hostEl.addEventListener("dragleave", onDragLeave);
    hostEl.addEventListener("drop", onDrop);
    return () => {
      hostEl.removeEventListener("dragenter", onDragEnter);
      hostEl.removeEventListener("dragover", onDragOver);
      hostEl.removeEventListener("dragleave", onDragLeave);
      hostEl.removeEventListener("drop", onDrop);
    };
  }, []);

  const tuiControlVisible = pane.group === "session" || scrollState.tuiMode;

  const sendTuiWheel = (direction: "up" | "down", ticks: number) => {
    const hostEl = host.current;
    if (!hostEl || ticks <= 0) return;
    // Send real wheel events through xterm instead of assuming SGR mouse
    // encoding. xterm translates each event using the active TUI protocol
    // (SGR/default/pixel), or scrolls its own normal buffer when appropriate.
    const target = hostEl.querySelector<HTMLElement>(".xterm-viewport")
      || hostEl.querySelector<HTMLElement>(".xterm")
      || hostEl;
    const screen = hostEl.querySelector<HTMLElement>(".xterm-screen");
    const rect = (screen || target).getBoundingClientRect();
    const deltaY = direction === "up" ? -1 : 1;
    for (let index = 0; index < ticks; index += 1) {
      target.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        deltaY
      }));
    }
  };

  const stopTuiScroll = (resetShape = true) => {
    if (tuiScrollTimer.current !== null) {
      window.clearInterval(tuiScrollTimer.current);
      tuiScrollTimer.current = null;
    }
    tuiDragRef.current = null;
    tuiScrollIntentRef.current = null;
    if (resetShape) setTuiPull({ direction: "idle", strength: 0 });
  };

  useEffect(() => {
    if (!scrollState.tuiMode || !scrollState.tuiInteractive) stopTuiScroll();
  }, [scrollState.tuiInteractive, scrollState.tuiMode]);

  useEffect(() => {
    const onWindowBlur = () => stopTuiScroll();
    window.addEventListener("blur", onWindowBlur);
    return () => window.removeEventListener("blur", onWindowBlur);
  }, []);

  const beginTuiDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!scrollState.tuiInteractive || ptyId.current === null) return;
    event.preventDefault();
    stopTuiScroll();
    tuiDragRef.current = { pointerId: event.pointerId, startY: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    terminalRef.current?.focus();
  };

  const updateTuiDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = tuiDragRef.current;
    if (!scrollState.tuiInteractive || !drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;
    const distance = Math.abs(delta);
    if (distance <= TUI_DRAG_DEAD_ZONE_PX) {
      tuiScrollIntentRef.current = null;
      setTuiPull({ direction: "idle", strength: 0 });
      if (tuiScrollTimer.current !== null) {
        window.clearInterval(tuiScrollTimer.current);
        tuiScrollTimer.current = null;
      }
      return;
    }
    const direction = delta < 0 ? "up" : "down";
    const ticks = Math.min(TUI_DRAG_MAX_TICKS, Math.max(1, Math.ceil((distance - TUI_DRAG_DEAD_ZONE_PX) / TUI_DRAG_PIXELS_PER_TICK)));
    const previousDirection = tuiScrollIntentRef.current?.direction;
    tuiScrollIntentRef.current = { direction, ticks };
    setTuiPull({ direction, strength: ticks / TUI_DRAG_MAX_TICKS });
    if (tuiScrollTimer.current === null) {
      sendTuiWheel(direction, ticks);
      tuiScrollTimer.current = window.setInterval(() => {
        const intent = tuiScrollIntentRef.current;
        if (intent) sendTuiWheel(intent.direction, intent.ticks);
      }, TUI_WHEEL_REPEAT_MS);
    } else if (previousDirection && previousDirection !== direction) {
      sendTuiWheel(direction, ticks);
    }
    terminalRef.current?.focus();
  };

  const onTuiControlKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!scrollState.tuiInteractive) return;
    let direction: "up" | "down";
    let ticks: number;
    if (event.key === "ArrowUp") { direction = "up"; ticks = 1; }
    else if (event.key === "ArrowDown") { direction = "down"; ticks = 1; }
    else if (event.key === "PageUp") { direction = "up"; ticks = TUI_WHEEL_STEP; }
    else if (event.key === "PageDown") { direction = "down"; ticks = TUI_WHEEL_STEP; }
    else if (event.key === "Home") { direction = "up"; ticks = TUI_WHEEL_JUMP; }
    else if (event.key === "End") { direction = "down"; ticks = TUI_WHEEL_JUMP; }
    else return;
    event.preventDefault();
    sendTuiWheel(direction, ticks);
    terminalRef.current?.focus();
  };

  return <div className={`wb-terminal-pane${active ? " active" : ""}`} hidden={!active}>
    <div
      className={`wb-terminal-host${pane.group === "session" ? " is-session" : ""}${scrollState.tuiMode ? " is-tui-mode" : ""}${dragOver ? " is-drag-over" : ""}`}
      data-terminal-engine={engineType}
      ref={host}
    />
    {pane.group === "session" ? <TerminalComposer
      pane={{ key: pane.key, cwd: pane.cwd, group: pane.group, projectPath: pane.projectPath }}
      ptyId={pane.ptyId ?? null}
      active={active}
      registerFocus={registerFocus}
    /> : null}
    {tuiControlVisible ? (
      <div className={`wb-terminal-tui-nav${searchOpen ? " is-below-search" : ""}${scrollState.tuiInteractive ? "" : " is-unavailable"}`}>
        <button
          type="button"
          className="wb-terminal-jump is-top"
          aria-label={t("desktop.workbench.terminalScrollTop")}
          title={t("desktop.workbench.terminalScrollTop")}
          disabled={!scrollState.tuiInteractive}
          onClick={() => { sendTuiWheel("up", TUI_WHEEL_JUMP); terminalRef.current?.focus(); }}
        >
          <ThemeIcon name="arrow-up-to-line" size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`wb-terminal-tui-drop is-${tuiPull.direction}`}
          aria-disabled={!scrollState.tuiInteractive}
          aria-label={t("desktop.workbench.terminalTuiScrollControl")}
          title={t("desktop.workbench.terminalTuiScrollControl")}
          style={{ "--tui-pull": tuiPull.strength } as CSSProperties}
          onPointerDown={beginTuiDrag}
          onPointerMove={updateTuiDrag}
          onPointerUp={() => stopTuiScroll()}
          onPointerCancel={() => stopTuiScroll()}
          onLostPointerCapture={() => stopTuiScroll()}
          onKeyDown={onTuiControlKeyDown}
        >
          <svg className="wb-terminal-tui-drop-shape" viewBox="0 0 200 260" aria-hidden="true">
            <path d="M 100 20 C 105 50, 165 95, 165 130 C 165 165, 105 210, 100 240 C 95 210, 35 165, 35 130 C 35 95, 95 50, 100 20 Z" />
          </svg>
        </button>
        <button
          type="button"
          className="wb-terminal-jump is-bottom"
          aria-label={t("desktop.workbench.terminalScrollBottom")}
          title={t("desktop.workbench.terminalScrollBottom")}
          disabled={!scrollState.tuiInteractive}
          onClick={() => { sendTuiWheel("down", TUI_WHEEL_JUMP); terminalRef.current?.focus(); }}
        >
          <ThemeIcon name="arrow-down-to-line" size={15} aria-hidden="true" />
        </button>
      </div>
    ) : null}
    {searchOpen ? (
      <div className="wb-terminal-search" role="search">
        <ThemeIcon name="search" size={14} aria-hidden="true" />
        <input
          ref={searchInputRef}
          className="wb-terminal-search-input"
          type="search"
          value={searchQuery}
          placeholder={t("desktop.workbench.terminalSearchPlaceholder")}
          aria-label={t("desktop.workbench.terminalSearchPlaceholder")}
          onChange={(event) => {
            const value = event.target.value;
            setSearchQuery(value);
            runSearch("next", value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              runSearch(event.shiftKey ? "prev" : "next", searchQuery);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeSearch();
            }
          }}
        />
        <span className="wb-terminal-search-meta" aria-live="polite">
          {searchQuery.trim()
            ? (searchMeta && searchMeta.count > 0
              ? t("desktop.workbench.terminalSearchCount", String(searchMeta.index + 1), String(searchMeta.count))
              : t("desktop.workbench.terminalSearchNoResults"))
            : ""}
        </span>
        <button
          type="button"
          className="wb-terminal-search-btn"
          aria-label={t("desktop.workbench.terminalSearchPrev")}
          onClick={() => runSearch("prev", searchQuery)}
        >
          <ThemeIcon name="arrow-up" size={14} />
        </button>
        <button
          type="button"
          className="wb-terminal-search-btn"
          aria-label={t("desktop.workbench.terminalSearchNext")}
          onClick={() => runSearch("next", searchQuery)}
        >
          <ThemeIcon name="arrow-down" size={14} />
        </button>
        <button
          type="button"
          className="wb-terminal-search-btn"
          aria-label={t("desktop.workbench.terminalSearchClose")}
          onClick={closeSearch}
        >
          <ThemeIcon name="close" size={14} />
        </button>
      </div>
    ) : null}
    {!ready ? (
      <div className="wb-terminal-loading" role="status" aria-live="polite">
        <ThemeIcon name="loader" className="spin" size={18} aria-hidden="true" />
        <span>{t("desktop.common.loading")}</span>
      </div>
    ) : null}
  </div>;
}

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
  const [workbenchFolderData, setWorkbenchFolderData] = useState<Record<string, {
    folders: WorkbenchSessionFolder[];
    assignments: WorkbenchSessionFolderAssignment[];
  }>>({});
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [gtdStatuses, setGtdStatuses] = useState<Record<string, GtdStatus>>({});
  const [selectedProject, setSelectedProject] = useState<string | null>(storageString(PROJECT_KEY) || null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const [sidebarView, setSidebarView] = useState<WorkbenchSidebarView>(() => {
    const stored = storageString(SIDEBAR_VIEW_KEY);
    if (stored === "gtd" || stored === "tags" || stored === "projects") return stored;
    return "projects";
  });
  const [selectedGtdStatus, setSelectedGtdStatus] = useState<GtdStatus>("inbox");
  const [completedGtdExpanded, setCompletedGtdExpanded] = useState(false);
  const [tagItems, setTagItems] = useState<WorkbenchTagItem[]>([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagCategoryFilter, setTagCategoryFilter] = useState<TagCategoryFilter>("all");
  const [showObsoleteTags, setShowObsoleteTags] = useState(false);
  const [tagEntityKeys, setTagEntityKeys] = useState<Set<string>>(new Set());
  const [tagsLoading, setTagsLoading] = useState(false);
  const [pinnedProjects, setPinnedProjects] = useState<Set<string>>(loadPinnedProjects);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("all");
  const [projectQuery, setProjectQuery] = useState("");
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("all");
  const [activeSessionKey, setActiveSessionKey] = useState("");
  const [foldersCollapsed, setFoldersCollapsed] = useState(() => storageBoolean(FOLDERS_COLLAPSED_KEY));
  const [foldersWidth, setFoldersWidth] = useState(() => storedWidth(FOLDERS_WIDTH_KEY, 260, 140, 560));
  const [listWidth, setListWidth] = useState(() => storedWidth(LIST_WIDTH_KEY, 324, 240, 720));
  const [sideWidth, setSideWidth] = useState(() => storedWidth(SIDE_WIDTH_KEY, 320, 240, 840));
  const [terminals, setTerminals] = useState<TerminalPane[]>([]);
  const [pendingSessions, setPendingSessions] = useState<PendingWorkbenchSession[]>([]);
  const [terminalCreating, setTerminalCreating] = useState(false);
  const [editors, setEditors] = useState<EditorPane[]>([]);
  const [diffs, setDiffs] = useState<DiffPane[]>([]);
  const [acpChats, setAcpChats] = useState<AcpChatPane[]>([]);
  const [browsers, setBrowsers] = useState<BrowserPane[]>([]);
  const [activePanes, setActivePanes] = useState<Record<string, string>>({});
  const [side, setSide] = useState<SideView>(null);
  const lastAutoTranscriptKey = useRef("");
  const [scriptPackages, setScriptPackages] = useState<ScriptPackageView[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState("");
  const [scriptsTruncated, setScriptsTruncated] = useState(false);
  const [scriptsSectionCollapsed, setScriptsSectionCollapsed] = useState(
    () => storageBoolean("wb-scripts-collapsed")
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchCase, setSearchMatchCase] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchUseRegex, setSearchUseRegex] = useState(false);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchExpanded, setSearchExpanded] = useState<Set<string>>(() => new Set());
  const [searchSelectedKey, setSearchSelectedKey] = useState("");
  const [searchProjectMode, setSearchProjectMode] = useState(false);
  const [searchProjectQuery, setSearchProjectQuery] = useState("");
  const [searchProjectSelectionId, setSearchProjectSelectionId] = useState("");
  const [linkGraphResult, setLinkGraphResult] = useState<LinkGraphAnalyzeResult | null>(null);
  const [linkGraphProgress, setLinkGraphProgress] = useState<LinkGraphProgressEvent | null>(null);
  const [linkGraphBusy, setLinkGraphBusy] = useState(false);
  const [linkGraphError, setLinkGraphError] = useState<string | null>(null);
  const [linkGraphLanguage, setLinkGraphLanguage] = useState<LinkGraphOutputLanguage>(() => {
    const stored = storageString("wb-linkgraph-lang");
    return stored === "en" || stored === "zh-cn" || stored === "ja" || stored === "auto" ? stored : "auto";
  });
  const [editorContextMenu, setEditorContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);
  const linkGraphSeedRef = useRef<LinkGraphAnalyzeArgs | null>(null);
  const linkGraphLanguageRef = useRef(linkGraphLanguage);
  linkGraphLanguageRef.current = linkGraphLanguage;
  const [quickAccessOpen, setQuickAccessOpen] = useState(false);
  const [quickAccessMode, setQuickAccessMode] = useState<QuickAccessMode>("files");
  const [quickAccessQuery, setQuickAccessQuery] = useState("");
  const [quickAccessFiles, setQuickAccessFiles] = useState<QuickAccessFile[]>([]);
  const [quickAccessSearchFiles, setQuickAccessSearchFiles] = useState<QuickAccessFile[]>([]);
  const [quickAccessSearchTruncated, setQuickAccessSearchTruncated] = useState(false);
  const [quickAccessLoading, setQuickAccessLoading] = useState(false);
  const [quickAccessTruncated, setQuickAccessTruncated] = useState(false);
  const [quickAccessError, setQuickAccessError] = useState("");
  const [pendingExplorerReveal, setPendingExplorerReveal] = useState<{ rootPath: string; path: string } | null>(null);
  const searchSeqRef = useRef(0);
  const searchTimerRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchProjectOptionRefs = useRef(new Map<string, HTMLButtonElement>());
  const quickAccessCacheRef = useRef(new Map<string, { files: QuickAccessFile[]; truncated: boolean }>());
  const quickAccessRequestRef = useRef(0);
  const quickAccessSearchRequestRef = useRef(0);
  const quickAccessProjectContextRef = useRef<{
    mode: Exclude<QuickAccessMode, "projects">;
    query: string;
    closeOnSelect: boolean;
  }>({ mode: "files", query: "", closeOnSelect: false });
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const [editorFindOpen, setEditorFindOpen] = useState(false);
  const [editorFindQuery, setEditorFindQuery] = useState("");
  const [editorFindResult, setEditorFindResult] = useState<CodeEditorSearchResult | null>(null);
  const editorFindInputRef = useRef<HTMLInputElement | null>(null);
  const editorFindQueryRef = useRef("");
  const previousEditorKeyRef = useRef("");
  const pendingRevealRef = useRef<SearchReveal | null>(null);
  const [git, setGit] = useState<GitStatusResult | null>(null);
  const [gitRoot, setGitRoot] = useState("");
  const [gitExpandedDirs, setGitExpandedDirs] = useState<Set<string>>(new Set());
  const gitExpandInitializedRef = useRef(false);
  const [gitLog, setGitLog] = useState<GitLog | null>(null);
  const [gitShow, setGitShow] = useState<GitShow | null>(null);
  const [gitHistoryContext, setGitHistoryContext] = useState<GitHistoryContext | null>(null);
  const [gitLogLoading, setGitLogLoading] = useState(false);
  const [gitLogError, setGitLogError] = useState("");
  const [gitRefreshing, setGitRefreshing] = useState(false);
  const [gitSyncing, setGitSyncing] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitSuggestion, setCommitSuggestion] = useState<CommitSuggestion | null>(null);
  const [discardingGitPaths, setDiscardingGitPaths] = useState<Set<string>>(() => new Set());
  const gitStageBusyRef = useRef(false);
  const [branchPane, setBranchPane] = useState<TerminalPane | null>(null);
  const [branchMenuPosition, setBranchMenuPosition] = useState<BranchMenuPosition | null>(null);
  const [branchResult, setBranchResult] = useState<TerminalGitBranches | null>(null);

  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const setStatus = useCallback((s: { text: string; kind?: "error" | "ok" | "warning" }) => {
    if (s.text) notifyDesktop({ text: s.text, kind: (s.kind ?? "info") as "error" | "ok" | "info" });
  }, []);
  const [contextMenu, setContextMenu] = useState<WorkbenchContextMenu | null>(null);
  const [floatingNoteTarget, setFloatingNoteTarget] = useState<FloatingSessionNoteTarget | null>(null);
  const [gitLogContextMenu, setGitLogContextMenu] = useState<GitLogContextMenu | null>(null);
  const [gitLogDialog, setGitLogDialog] = useState<GitLogDialog | null>(null);
  const gitLogDialogBusyRef = useRef(false);
  const gitLogDialogInputRef = useRef<HTMLInputElement | null>(null);
  const [newSessionPicker, setNewSessionPicker] = useState<WorkbenchNewSessionPicker | null>(null);
  const [renameDialog, setRenameDialog] = useState<WorkbenchRenameDialog | null>(null);
  const [folderDialog, setFolderDialog] = useState<WorkbenchFolderDialog | null>(null);
  const [folderPickerDialog, setFolderPickerDialog] = useState<WorkbenchFolderPickerDialog | null>(null);
  const [projectPickDialog, setProjectPickDialog] = useState<ProjectPickDialog | null>(null);
  const [draggedSessionKey, setDraggedSessionKey] = useState<string | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const terminalRefs = useRef(new Map<number, Terminal>());
  const terminalMouseTrackingRef = useRef(new Map<number, boolean>());
  /** ACP chat runtime keyed by pane key (`acp:${recordId}`). */
  const [acpRuntimeByPaneKey, setAcpRuntimeByPaneKey] = useState<Record<string, SessionDotRuntime>>({});
  /** TUI session-pane runtime keyed by terminal pane key. */
  const [tuiRuntimeByPaneKey, setTuiRuntimeByPaneKey] = useState<Record<string, SessionDotRuntime>>({});
  const acpPendingRequestsRef = useRef(new Map<string, Set<string>>());
  const acpFlagsRef = useRef(new Map<string, { isRunning: boolean; isConnecting: boolean; status: string }>());
  const tuiLastOutputAtRef = useRef(new Map<string, number>());
  const tuiDebounceRef = useRef(new Map<string, TuiDebounceState>());
  const tuiSampleTimerRef = useRef(0);
  const pendingSessionsRef = useRef<PendingWorkbenchSession[]>([]);
  const draggedSessionRef = useRef<AgentSession | null>(null);
  const folderExpandTimerRef = useRef(0);
  const gitRefreshTimers = useRef(new Map<string, number>());
  const gitStatusInFlightRef = useRef(false);
  const gitFetchInFlightRef = useRef(false);
  const gitLastFetchAtRef = useRef(0);
  const gitLogRequestRef = useRef(0);
  const gitRootsRef = useRef<string[]>([]);
  const terminalsRef = useRef<TerminalPane[]>([]);
  const editorsRef = useRef<EditorPane[]>([]);
  const diffsRef = useRef<DiffPane[]>([]);
  const fileExplorerRef = useRef<WorkbenchFileExplorerHandle | null>(null);
  const selectedProjectRef = useRef<string | null>(selectedProject);
  const catalogProjectsRef = useRef<CatalogProject[]>(catalogProjects);
  const activeRef = useRef(active);
  const activePanesRef = useRef<Record<string, string>>(activePanes);
  const sessionsRef = useRef<AgentSession[]>(sessions);
  const acpChatsRef = useRef<AcpChatPane[]>(acpChats);
  const autoRenameTimersRef = useRef(new Map<string, number>());
  const deferredAutoRenameKeysRef = useRef(new Set<string>());
  const watchedRootRef = useRef("");
  const editorReconcilesRef = useRef(new Map<string, { promise: Promise<void>; queued: boolean }>());
  /** Per-project MRU of activated pane keys (newest first). Used after ⌘W / tab close. */
  const paneHistoryRef = useRef<Record<string, string[]>>({});
  const focusPaneAfterPtyRef = useRef("");
  /** Agent-session composer focus handles keyed by pane key (registered by TerminalComposer). */
  const composerFocusRefs = useRef(new Map<string, () => void>());
  const openingSessionKeysRef = useRef(new Set<string>());
  /** Latest openSession closure for the agent-resume:workbench-open-session listener. */
  const openSessionRef = useRef<(session: AgentSession) => Promise<void>>(() => Promise.resolve());
  const settingsRef = useRef<PanelSettings | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const sessionSearchInputRef = useRef<HTMLInputElement>(null);
  const sessionSearchButtonRef = useRef<HTMLButtonElement>(null);
  const sessionSearchToolbarRef = useRef<HTMLDivElement>(null);
  const newSessionButtonRef = useRef<HTMLButtonElement>(null);
  const newSessionPickerRef = useRef<HTMLDivElement>(null);

  const notifyGitSuccess = useCallback((key: string, ...args: Array<string | number>) => {
    notifyDesktop({ text: t(key, ...args), kind: "ok" });
  }, [t]);

  const notifyGitFailure = useCallback((key: string, error: unknown) => {
    const message = t(key, gitOperationError(error));
    setStatus({ text: message, kind: "error" });
    notifyDesktop({ text: message, kind: "error" });
  }, [t]);

  useEffect(() => { terminalsRef.current = terminals; }, [terminals]);
  useEffect(() => { editorsRef.current = editors; }, [editors]);
  useEffect(() => { diffsRef.current = diffs; }, [diffs]);
  useEffect(() => { selectedProjectRef.current = selectedProject; }, [selectedProject]);
  useEffect(() => { catalogProjectsRef.current = catalogProjects; }, [catalogProjects]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { activePanesRef.current = activePanes; }, [activePanes]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { acpChatsRef.current = acpChats; }, [acpChats]);
  useEffect(() => () => {
    for (const timer of autoRenameTimersRef.current.values()) window.clearTimeout(timer);
    autoRenameTimersRef.current.clear();
  }, []);
  useEffect(() => () => window.clearTimeout(folderExpandTimerRef.current), []);

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
  useEffect(() => { settingsRef.current = settings; }, [settings]);

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
  const sessionRuntimeByPaneKey = useMemo(() => {
    const map = new Map<string, SessionDotRuntime>();
    for (const [key, runtime] of Object.entries(tuiRuntimeByPaneKey)) map.set(key, runtime);
    for (const [key, runtime] of Object.entries(acpRuntimeByPaneKey)) map.set(key, runtime);
    return map;
  }, [acpRuntimeByPaneKey, tuiRuntimeByPaneKey]);
  const activeSessionDots = useMemo(
    () => collectActiveSessionDots(terminals, acpChats, sessionTitles, sessionRuntimeByPaneKey),
    [acpChats, sessionRuntimeByPaneKey, sessionTitles, terminals]
  );

  // Broadcast the live session-dot set to the nav rail (sibling component).
  // StrictMode double-invoke on mount is harmless: AppChrome just sets state
  // to an identical payload. No loop: nothing listens back to this event here.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("agent-resume:active-sessions", { detail: activeSessionDots }));
  }, [activeSessionDots]);

  // Drop runtime rows for panes that are no longer open.
  useEffect(() => {
    const openTerminalKeys = new Set(terminals.filter((pane) => pane.group === "session").map((pane) => pane.key));
    const openAcpKeys = new Set(acpChats.map((pane) => pane.key));
    setTuiRuntimeByPaneKey((current) => {
      let changed = false;
      const next: Record<string, SessionDotRuntime> = {};
      for (const [key, value] of Object.entries(current)) {
        if (openTerminalKeys.has(key)) next[key] = value;
        else changed = true;
      }
      return changed ? next : current;
    });
    setAcpRuntimeByPaneKey((current) => {
      let changed = false;
      const next: Record<string, SessionDotRuntime> = {};
      for (const [key, value] of Object.entries(current)) {
        if (openAcpKeys.has(key)) next[key] = value;
        else {
          changed = true;
          const recordId = key.startsWith("acp:") ? key.slice(4) : "";
          if (recordId) {
            acpPendingRequestsRef.current.delete(recordId);
            acpFlagsRef.current.delete(recordId);
          }
        }
      }
      return changed ? next : current;
    });
    for (const key of [...tuiLastOutputAtRef.current.keys()]) {
      if (!openTerminalKeys.has(key)) {
        tuiLastOutputAtRef.current.delete(key);
        tuiDebounceRef.current.delete(key);
      }
    }
  }, [acpChats, terminals]);

  const publishAcpRuntime = useCallback((recordId: string) => {
    const paneKey = `acp:${recordId}`;
    const flags = acpFlagsRef.current.get(recordId) || { isRunning: false, isConnecting: false, status: "ready" };
    const pendingRequestCount = acpPendingRequestsRef.current.get(recordId)?.size ?? 0;
    const status = acpRuntimeToStatus({ ...flags, pendingRequestCount });
    const runtime: SessionDotRuntime = {
      status,
      awaitingConfidence: status === "awaiting_user" ? "confirmed" : undefined
    };
    setAcpRuntimeByPaneKey((current) => {
      const prev = current[paneKey];
      if (prev?.status === runtime.status && prev?.awaitingConfidence === runtime.awaitingConfidence) return current;
      return { ...current, [paneKey]: runtime };
    });
  }, []);

  useEffect(() => {
    if (typeof desktopApi().onAcpStream !== "function") return;
    const off = desktopApi().onAcpStream((raw) => {
      const event = raw as {
        type?: string;
        chatId?: string;
        requestId?: string;
        status?: string;
        isRunning?: boolean;
        isConnecting?: boolean;
        init?: { status?: string; isRunning?: boolean; isConnecting?: boolean };
      };
      const chatId = typeof event.chatId === "string" ? event.chatId : "";
      if (!chatId) return;
      const open = acpChatsRef.current.some((pane) => pane.recordId === chatId);
      // Still track flags for chats that may open momentarily; publish only when present.
      const ensurePending = () => {
        let set = acpPendingRequestsRef.current.get(chatId);
        if (!set) {
          set = new Set();
          acpPendingRequestsRef.current.set(chatId, set);
        }
        return set;
      };

      switch (event.type) {
        case "status": {
          acpFlagsRef.current.set(chatId, {
            isRunning: Boolean(event.isRunning),
            isConnecting: Boolean(event.isConnecting),
            status: event.status || "ready"
          });
          if (open) publishAcpRuntime(chatId);
          break;
        }
        case "init": {
          if (event.init) {
            acpFlagsRef.current.set(chatId, {
              isRunning: Boolean(event.init.isRunning),
              isConnecting: Boolean(event.init.isConnecting),
              status: event.init.status || "ready"
            });
            if (open) publishAcpRuntime(chatId);
          }
          break;
        }
        case "permissionRequest":
        case "userQuestion": {
          if (event.requestId) ensurePending().add(event.requestId);
          if (open) publishAcpRuntime(chatId);
          break;
        }
        case "permissionResolved":
        case "userQuestionResolved": {
          if (event.requestId) ensurePending().delete(event.requestId);
          if (open) publishAcpRuntime(chatId);
          break;
        }
        default:
          break;
      }
    });
    return () => off();
  }, [publishAcpRuntime]);

  const sampleTuiSessionStatus = useCallback(() => {
    const now = Date.now();
    const updates: Record<string, SessionDotRuntime> = {};
    for (const pane of terminalsRef.current) {
      if (pane.group !== "session" || pane.ptyId == null) continue;
      const terminal = terminalRefs.current.get(pane.ptyId);
      if (!terminal) continue;
      const buffer = terminal.buffer.active;
      // Read the bottom of the visible viewport (permission dialogs sit near the prompt).
      const rows = Math.min(30, terminal.rows);
      const start = Math.max(0, buffer.viewportY + terminal.rows - rows);
      const lines: string[] = [];
      for (let i = 0; i < rows; i += 1) {
        const line = buffer.getLine(start + i);
        if (line) lines.push(line.translateToString(true));
      }
      const lastOutputAt = tuiLastOutputAtRef.current.get(pane.key) ?? now;
      const sample = detectTuiSessionStatus({
        visibleText: lines.join("\n"),
        lastOutputAt,
        now,
        isAlternateBuffer: buffer.type === "alternate",
        isSessionPane: true
      });
      const debounced = applyTuiDebounce(tuiDebounceRef.current.get(pane.key) || createTuiDebounceState(), sample);
      tuiDebounceRef.current.set(pane.key, debounced.state);
      updates[pane.key] = {
        status: debounced.status,
        awaitingConfidence: debounced.awaitingConfidence
      };
    }
    if (!Object.keys(updates).length) return;
    setTuiRuntimeByPaneKey((current) => {
      let changed = false;
      const next = { ...current };
      for (const [key, runtime] of Object.entries(updates)) {
        const prev = current[key];
        if (prev?.status !== runtime.status || prev?.awaitingConfidence !== runtime.awaitingConfidence) {
          next[key] = runtime;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);

  const scheduleTuiSample = useCallback(() => {
    if (tuiSampleTimerRef.current) return;
    tuiSampleTimerRef.current = window.setTimeout(() => {
      tuiSampleTimerRef.current = 0;
      sampleTuiSessionStatus();
    }, 500);
  }, [sampleTuiSessionStatus]);

  useEffect(() => {
    // Keep idle/awaiting timers advancing even without further PTY output.
    if (!active) return;
    const timer = window.setInterval(() => sampleTuiSessionStatus(), 2_000);
    return () => {
      window.clearInterval(timer);
      if (tuiSampleTimerRef.current) {
        window.clearTimeout(tuiSampleTimerRef.current);
        tuiSampleTimerRef.current = 0;
      }
    };
  }, [active, sampleTuiSessionStatus]);

  const sessionQueryRequest = useCallback((cursor?: { updatedAt: number; provider: string; id: string }) => {
    const request: NonNullable<Parameters<DesktopApi["querySessionsPage"]>[0]> = {
      limit: 100,
      cursor,
      search: sessionQuery.trim() || undefined
    };
    if (sidebarView === "gtd") request.gtdStatus = selectedGtdStatus;
    else if (sidebarView === "tags" && selectedTag) request.tag = selectedTag;
    else {
      const selected = selectedProjectRef.current;
      if (selected) {
        const catalog = catalogProjectsRef.current.find((item) =>
          item.localPath === selected
          || item.projectId === selected
          || item.portableKey === selected
        );
        // Count uses project_id. A missing local folder falls back to portableKey
        // as the selection key, which is not an exact project_path match.
        // Without a catalog row the sidebar is derived from the loaded session
        // list, so do not filter the query down to the current selection.
        if (catalog?.projectId) request.projectId = catalog.projectId;
        else if (catalog && (selected.includes("/") || selected.includes("\\"))) request.projectPath = selected;
      }
    }
    if (sidebarView === "projects" && selectedFolderId && selectedFolderId !== UNCLASSIFIED_FOLDER_ID) {
      const keys = Object.values(workbenchFolderData).flatMap((data) => data.assignments
        .filter((assignment) => assignment.folderId === selectedFolderId)
        .map((assignment) => ({ provider: assignment.provider, id: assignment.agentSessionId })));
      if (keys.length) request.keys = keys;
    }
    return request;
  }, [catalogProjects, selectedFolderId, selectedGtdStatus, selectedProject, selectedTag, sessionQuery, sidebarView, workbenchFolderData]);

  const loadProjectMetadata = useCallback(async () => {
    const listProjects = typeof desktopApi().listProjects === "function"
      ? desktopApi().listProjects()
      : Promise.resolve([] as CatalogProject[]);
    const listFolderData = (projects: CatalogProject[]) => {
      if (typeof desktopApi().listAllWorkbenchSessionFolders === "function") {
        return desktopApi().listAllWorkbenchSessionFolders();
      }
      if (typeof desktopApi().listWorkbenchSessionFolders !== "function") {
        return Promise.resolve({} as Record<string, {
          folders: WorkbenchSessionFolder[];
          assignments: WorkbenchSessionFolderAssignment[];
        }>);
      }
      return Promise.all(projects.map(async (project) => {
        const result = await desktopApi().listWorkbenchSessionFolders({ projectId: project.projectId });
        return [project.projectId, result] as const;
      })).then((entries) => Object.fromEntries(entries));
    };
    const [nextAliases, nextSettings, nextProjects, nextGtdStatuses] = await Promise.all([
      desktopApi().listProjectAliases(),
      desktopApi().getSettings(),
      listProjects,
      typeof desktopApi().listSessionGtdStatuses === "function"
        ? desktopApi().listSessionGtdStatuses()
        : Promise.resolve({} as Record<string, GtdStatus>)
    ]);
    const nextFolderData = await listFolderData(nextProjects || []);
    setAliases(nextAliases);
    setSettings(nextSettings);
    catalogProjectsRef.current = nextProjects || [];
    setCatalogProjects(nextProjects || []);
    setWorkbenchFolderData(nextFolderData);
    setGtdStatuses(nextGtdStatuses || {});
    const withSessions = (nextProjects || []).filter((item) => (item.sessionCount || 0) > 0);
    const current = selectedProjectRef.current;
    let next = current;
    if (current) {
      const match = (nextProjects || []).find((item) => item.localPath === current || item.projectId === current || item.portableKey === current);
      if (match) next = match.localPath || match.portableKey || current;
      else if (pendingSessionsRef.current.some((pending) => projectPathKey(pending.projectPath) === projectPathKey(current))) next = current;
      else if (
        terminalsRef.current.some((pane) => pane.projectPath === current)
        || acpChatsRef.current.some((pane) => pane.projectPath === current)
        || editorsRef.current.some((pane) => pane.projectPath === current)
        || diffsRef.current.some((pane) => pane.projectPath === current)
      ) next = current;
      else {
        const firstProject = withSessions.find((item) => item.localPath || item.portableKey);
        next = firstProject?.localPath || firstProject?.portableKey || current || null;
      }
    } else {
      const firstProject = withSessions.find((item) => item.localPath || item.portableKey);
      next = firstProject?.localPath || firstProject?.portableKey || current || null;
    }
    selectedProjectRef.current = next;
    setSelectedProject(next);
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
    // The Workbench can become active directly (for example, from a Flow
    // launch) without a tab-change event. Load aggregates once in that case.
    if (!projectMetadataLoadedRef.current) {
      void reloadWorkbench();
      return;
    }
    const timer = window.setTimeout(() => { void loadSessions(); }, 250);
    return () => window.clearTimeout(timer);
  }, [active, loadSessions, reloadWorkbench, selectedFolderId, selectedGtdStatus, selectedProject, selectedTag, sessionQuery, sidebarView, workbenchFolderData]);

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
    if (activeRef.current) setStatus({ text: t("desktop.workbench.autoRenaming"), kind: "ok" });
    try {
      const projectName = session.projectPath ? basename(session.projectPath) : "";
      const folderPath = sessionFolderPath(workbenchFolderData, provider, id);
      let result: { title: string; nativeRenamed: boolean; nativeError?: string };
      if (projectName) {
        // Sessions get " · project / folder / subfolder" (unclassified: " · project") appended
        // to the LLM-suggested title so the project / folder context survives outside the tree.
        const suggested = await desktopApi().autoRenameSession({ provider, id, persist: false });
        const title = composeSessionTitle(suggested.title, projectName, folderPath);
        const renamed = await desktopApi().renameSession({ provider, id, title });
        result = { title, nativeRenamed: renamed.nativeRenamed, nativeError: renamed.nativeError };
      } else {
        result = await desktopApi().autoRenameSession({ provider, id, persist: true });
      }
      await loadSessions();
      let text = t("desktop.sessions.renamed", result.title);
      if (!result.nativeRenamed && result.nativeError) text += t("desktop.sessions.renamedNativeError", result.nativeError);
      if (activeRef.current) {
        setStatus({ text, kind: result.nativeRenamed || !result.nativeError ? "ok" : "error" });
      }
      window.dispatchEvent(new CustomEvent("agent-resume:sessions-mutated", { detail: { kind: "session-title" } }));
    } catch (error) {
      const message = statusError(error);
      // Session was hidden/deleted while the delayed rename was pending — treat as a no-op.
      if (/Session not found/.test(message)) return;
      if (activeRef.current) setStatus({ text: message, kind: "error" });
    }
  }, [loadSessions, setStatus, t, workbenchFolderData]);

  const cancelSessionAutoRename = useCallback((key: string) => {
    const timer = autoRenameTimersRef.current.get(key);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      autoRenameTimersRef.current.delete(key);
    }
  }, []);

  const isSessionPaneActive = useCallback((key: string) => {
    if (!activeRef.current) return false;
    const activePaneKey = activePanesRef.current[paneProjectKey(selectedProjectRef.current || "")] || "";
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
    const activePaneKey = active ? activePanes[paneProjectKey(selectedProject || "")] || "" : "";
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

  useEffect(() => {
    if (!pendingSessions.length) return;
    const timers = [300, 800, 1_500, 3_000, 5_000, 8_000].map((delay) =>
      window.setTimeout(() => { void loadSessions(); }, delay)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [loadSessions, pendingSessions.length]);

  useEffect(() => {
    if (!pendingSessions.length || !sessions.length) return;
    const claimed = new Set(terminals.flatMap((pane) => pane.sessionKey ? [pane.sessionKey] : []));
    const assignments = new Map<string, string>();

    for (const pending of [...pendingSessions].sort((a, b) => a.createdAt - b.createdAt)) {
      const known = new Set(pending.knownSessionKeys);
      // Flow launches: match same project first; prefer provider, but allow
      // any new CLI session in that project (catalog indexing can lag / rename paths).
      const candidates = sessions
        .filter((session) => {
          const key = sessionKey(session);
          if (session.provider === "chat") return false;
          const noteMatch = Boolean(pending.noteId && session.title?.includes(pending.noteId));
          if ((known.has(key) || claimed.has(key)) && !noteMatch) return false;
          if (projectPathKey(session.projectPath) !== projectPathKey(pending.projectPath) && !noteMatch) return false;
          // Wider window for Flow-driven launches (CLI agents can take a while to register).
          const windowMs = pending.flowRequestId ? 180_000 : 15_000;
          if (session.updatedAt < pending.createdAt - windowMs && !noteMatch) return false;
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
      const colon = sessionKeyValue.indexOf(":");
      const catalogProvider = colon > 0 ? sessionKeyValue.slice(0, colon) : pending.provider;
      const sessionId = colon > 0 ? sessionKeyValue.slice(colon + 1) : sessionKeyValue;
      if (pending.folderProjectId && pending.folderId && typeof desktopApi().assignWorkbenchSessionToFolder === "function") {
        void desktopApi().assignWorkbenchSessionToFolder({
          projectId: pending.folderProjectId,
          provider: catalogProvider,
          agentSessionId: sessionId,
          folderId: pending.folderId
        }).then(() => reloadWorkbench())
          .catch((error) => {
            if (activeRef.current) setStatus({ text: statusError(error), kind: "error" });
          });
      }
      if (!pending.flowRequestId) continue;
      const binding = pending.flowId && pending.flowNodeId
        ? desktopApi().flowBindSession({
            flowId: pending.flowId,
            nodeId: pending.flowNodeId,
            provider: catalogProvider,
            sessionId
          })
        : Promise.resolve();
      void binding.then(() => {
        emitWorkbenchSessionLaunched({
          requestId: pending.flowRequestId!,
          ok: true,
          catalogProvider,
          sessionId
        });
      }).catch((error) => {
        emitWorkbenchSessionLaunched({
          requestId: pending.flowRequestId!,
          ok: false,
          error: statusError(error)
        });
      });
    }
    setPendingSessions((current) => current.filter((pending) => !assignments.has(pending.terminalKey)));
    // The active pending terminal just bound to a catalog session: move the
    // list highlight from the (now removed) pending row to the bound row.
    const activePaneKey = activePanesRef.current[paneProjectKey(selectedProjectRef.current || "")] || "";
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
    const api = desktopApi();
    if (typeof api.onLinkGraphProgress !== "function") return;
    return api.onLinkGraphProgress((event) => {
      setLinkGraphProgress(event);
    });
  }, []);

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
    if (!gitLogContextMenu) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".wb-git-log-context-menu")) setGitLogContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGitLogContextMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [gitLogContextMenu]);

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

  useEffect(() => {
    if (!renameDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRenameDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [renameDialog?.projectPath, renameDialog?.projectId]);

  useEffect(() => {
    if (!folderDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !folderDialog.busy) setFolderDialog(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [folderDialog?.mode, folderDialog?.folderId, folderDialog?.busy]);

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
        const folderData = workbenchFolderData[project.projectId] || { folders: [], assignments: [] };
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
          folders: folderData.folders,
          folderAssignments: folderData.assignments,
          pendingCount,
          label: project.alias || aliases[path] || aliases[project.projectId] || basename(path),
          active: pendingCount > 0 || group.some((session) => openSessionKeys.has(sessionKey(session))),
          pinned: project.pinned === true || pinnedProjects.has(path) || pinnedProjects.has(project.projectId),
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
        folders: [],
        folderAssignments: [],
        pendingCount: pending.length,
        label: aliases[path] || basename(path),
        active: true,
        pinned: pinnedProjects.has(path),
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
      pinned: pinnedProjects.has(path),
      updatedAt: group.updatedAt
    })).sort((a, b) => Number(b.pinned) - Number(a.pinned)
      || b.updatedAt - a.updatedAt
      || a.label.localeCompare(b.label)
      || a.path.localeCompare(b.path)
      || a.id.localeCompare(b.id));
  }, [aliases, catalogProjects, openSessionKeys, pendingSessions, pinnedProjects, sessions, workbenchFolderData]);

  const projects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    return allProjects.filter((project) =>
      (!query || `${project.label} ${project.path} ${project.portableKey}`.toLowerCase().includes(query))
      && (projectFilter === "all" || (projectFilter === "pinned" ? project.pinned : project.active))
    );
  }, [allProjects, projectFilter, projectQuery]);

  const selectedProjectMeta = useMemo(
    () => allProjects.find((project) => project.path === selectedProject || project.id === selectedProject) || null,
    [allProjects, selectedProject]
  );
  const selectedFolder = useMemo(
    () => selectedProjectMeta?.folders.find((folder) => folder.folderId === selectedFolderId) || null,
    [selectedFolderId, selectedProjectMeta]
  );

  const selectedSessions = useMemo(() => {
    if (sidebarView === "gtd") {
      const query = projectQuery.trim().toLowerCase();
      return sessions.filter((session) => {
        const matchesQuery = !query || `${session.title} ${session.projectPath} ${session.provider}`.toLowerCase().includes(query);
        return matchesQuery && effectiveGtdStatus(gtdStatuses, session) === selectedGtdStatus;
      });
    }
    if (sidebarView === "tags") {
      if (!selectedTag || tagEntityKeys.size === 0) return [];
      return sessions.filter((session) => tagEntityKeys.has(sessionKey(session)));
    }
    if (!selectedProject) return sessions;
    let projectSessions: AgentSession[];
    if (selectedProjectMeta) {
      projectSessions = sessions.filter((session) =>
        (session.projectId && session.projectId === selectedProjectMeta.id)
        || session.projectPath === selectedProjectMeta.path
        || session.projectPath === selectedProject
      );
    } else {
      projectSessions = sessions.filter((session) => session.projectPath === selectedProject);
    }
    if (!selectedFolderId || !selectedProjectMeta) return projectSessions;
    const assignments = new Map(
      selectedProjectMeta.folderAssignments.map((assignment) => [
        folderAssignmentKey(assignment.provider, assignment.agentSessionId),
        assignment.folderId
      ])
    );
    return projectSessions.filter((session) => selectedFolderId === UNCLASSIFIED_FOLDER_ID
      ? !assignments.has(sessionKey(session))
      : assignments.get(sessionKey(session)) === selectedFolderId);
  }, [gtdStatuses, projectQuery, selectedFolderId, selectedGtdStatus, selectedProject, selectedProjectMeta, selectedTag, sessions, sidebarView, tagEntityKeys]);
  const gtdStatusCounts = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    const counts = new Map<GtdStatus, number>(GTD_STATUSES.map((status) => [status, 0] as const));
    for (const session of sessions) {
      const matchesQuery = !query || `${session.title} ${session.projectPath} ${session.provider}`.toLowerCase().includes(query);
      if (matchesQuery) {
        const status = effectiveGtdStatus(gtdStatuses, session);
        counts.set(status, (counts.get(status) || 0) + 1);
      }
    }
    return counts;
  }, [gtdStatuses, projectQuery, sessions]);
  const selectedSessionScope = sidebarView === "gtd"
    ? t(`desktop.workbench.gtdStatus.${selectedGtdStatus}`)
    : sidebarView === "tags"
      ? (selectedTag || t("desktop.workbench.tagsView"))
      : selectedFolderId === UNCLASSIFIED_FOLDER_ID
        ? t("desktop.workbench.unclassifiedSessions")
        : selectedFolder?.name || (selectedProject ? basename(selectedProject) : t("desktop.workbench.allSessions"));
  const visibleSessions = useMemo(() => selectedSessions.filter((session) => {
    const matchesQuery = `${session.title} ${session.id} ${session.provider}`.toLowerCase().includes(sessionQuery.trim().toLowerCase());
    return matchesQuery && (sessionFilter === "all" || openSessionKeys.has(sessionKey(session)));
  }).sort((a, b) => b.updatedAt - a.updatedAt), [openSessionKeys, selectedSessions, sessionFilter, sessionQuery]);
  const selectedPendingSessions = useMemo(() => pendingSessions.filter((pending) => {
    if (sidebarView === "gtd" || sidebarView === "tags") return false;
    if (!selectedProject) return true;
    const selectedPath = selectedProjectMeta?.path || selectedProject;
    return projectPathKey(pending.projectPath) === projectPathKey(selectedPath);
  }), [pendingSessions, selectedProject, selectedProjectMeta, sidebarView]);
  const visiblePendingSessions = useMemo(() => selectedPendingSessions.filter((pending) =>
    `${pending.title} ${pending.provider}`.toLowerCase().includes(sessionQuery.trim().toLowerCase())
  ).sort((a, b) => b.createdAt - a.createdAt), [selectedPendingSessions, sessionQuery]);
  const visibleSessionRows = useMemo<WorkbenchSessionRow[]>(() => [
    ...visiblePendingSessions.map((pending) => ({ kind: "pending" as const, pending })),
    ...visibleSessions.map((session) => ({ kind: "session" as const, session }))
  ], [visiblePendingSessions, visibleSessions]);
  const activeSessionRowIndex = useMemo(() => visibleSessionRows.findIndex((row) =>
    row.kind === "pending" ? row.pending.key === activeSessionKey : sessionKey(row.session) === activeSessionKey
  ), [activeSessionKey, visibleSessionRows]);
  const currentTerminals = terminals.filter((pane) => pane.projectPath === selectedProject);
  const currentSessionTerminals = currentTerminals.filter((pane) => pane.group === "session");
  const currentShellTerminals = currentTerminals.filter((pane) => pane.group === "terminal");
  const currentEditors = editors.filter((pane) => pane.projectPath === selectedProject);
  const currentDiffs = diffs.filter((pane) => pane.projectPath === selectedProject);
  const currentAcpChats = acpChats.filter((pane) => pane.projectPath === selectedProject);
  const currentBrowsers = browsers.filter((pane) => pane.projectPath === selectedProject);
  const activePane = activePanes[paneProjectKey(selectedProject)] || "";
  const activeTerminal = currentTerminals.find((pane) => pane.key === activePane);
  const currentEditor = currentEditors.find((pane) => pane.key === activePane);
  const currentDiff = currentDiffs.find((pane) => pane.key === activePane);
  const currentFilePath = workbenchActiveFilePath(selectedProject, currentEditor?.path, currentDiff);
  const currentAcpChat = currentAcpChats.find((pane) => pane.key === activePane);
  const currentBrowser = currentBrowsers.find((pane) => pane.key === activePane);
  const activeTranscriptTarget = useMemo(() => {
    if (currentAcpChat) {
      return { provider: "chat", sessionId: currentAcpChat.recordId, iconProvider: currentAcpChat.provider };
    }
    const identity = sessionIdentityFromKey(activeTerminal?.sessionKey);
    return identity ? { ...identity, iconProvider: identity.provider } : null;
  }, [activeTerminal?.sessionKey, currentAcpChat]);
  useEffect(() => {
    if (!activeTranscriptTarget) {
      lastAutoTranscriptKey.current = "";
      if (side === "transcript") setSide(null);
      return;
    }
    const key = `${activeTranscriptTarget.provider}:${activeTranscriptTarget.sessionId}`;
    if (lastAutoTranscriptKey.current === key) return;
    lastAutoTranscriptKey.current = key;
    if (sideWidth === DEFAULT_SIDE_WIDTH) {
      setSideWidth(TRANSCRIPT_SIDE_WIDTH);
      localStorage.setItem(SIDE_WIDTH_KEY, String(TRANSCRIPT_SIDE_WIDTH));
    }
    setSide("transcript");
  }, [activeTranscriptTarget, sideWidth]);
  const workbenchPaneGroups: Array<{ group: WorkbenchPaneGroup; keys: string[] }> = [
    {
      group: "session",
      keys: [
        ...currentSessionTerminals.map((pane) => pane.key),
        ...currentAcpChats.map((pane) => pane.key)
      ]
    },
    { group: "terminal", keys: currentShellTerminals.map((pane) => pane.key) },
    {
      group: "code",
      keys: [
        ...currentEditors.map((pane) => pane.key),
        ...currentDiffs.map((pane) => pane.key)
      ]
    },
    { group: "browser", keys: currentBrowsers.map((pane) => pane.key) }
  ];
  /** Prefer the active terminal's git info; fall back to any project terminal or status tracking. */
  const branchStatusTerminal = activeTerminal
    || currentTerminals.find((pane) => Boolean(pane.branch) || pane.gitMode === "nested")
    || null;
  const projectTracking = trackingForRoot(git, gitRoot);
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
    const projectKey = paneProjectKey(projectPath);
    if (paneKey) {
      const previous = paneHistoryRef.current[projectKey] || [];
      paneHistoryRef.current[projectKey] = [paneKey, ...previous.filter((key) => key !== paneKey)].slice(0, 32);
    }
    setActivePanes((current) => current[projectKey] === paneKey ? current : { ...current, [projectKey]: paneKey });
    setActiveSessionKey(workbenchPaneSessionKey(paneKey));
  }, [activePane, closeEditorFind, selectedProject, workbenchPaneSessionKey]);

  const registerComposerFocus = useCallback((key: string, focus: () => void) => {
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

  const navigateToWorkbenchPane = useCallback((paneKey: string) => {
    if (!paneKey) return;
    setActivePane(paneKey, selectedProject);
    focusWorkbenchPane(paneKey);
  }, [focusWorkbenchPane, selectedProject, setActivePane]);

  const navigateWorkbenchPanes = useCallback((direction: WorkbenchArrowDirection) => {
    const currentGroupIndex = workbenchPaneGroups.findIndex((group) => group.keys.includes(activePane));
    const nonEmptyGroups = workbenchPaneGroups.filter((group) => group.keys.length > 0);
    let nextPaneKey = "";

    if (direction === "left" || direction === "right") {
      const currentGroup = currentGroupIndex >= 0 ? workbenchPaneGroups[currentGroupIndex] : null;
      if (!currentGroup || !currentGroup.keys.length) return;
      const currentIndex = currentGroup.keys.indexOf(activePane);
      const offset = direction === "left" ? -1 : 1;
      const nextIndex = (currentIndex + offset + currentGroup.keys.length) % currentGroup.keys.length;
      nextPaneKey = currentGroup.keys[nextIndex];
    } else if (nonEmptyGroups.length) {
      if (currentGroupIndex < 0) {
        nextPaneKey = direction === "down"
          ? nonEmptyGroups[0].keys[0]
          : nonEmptyGroups[nonEmptyGroups.length - 1].keys[0];
      } else {
        const offset = direction === "down" ? 1 : -1;
        let candidateIndex = (currentGroupIndex + offset + workbenchPaneGroups.length) % workbenchPaneGroups.length;
        while (candidateIndex !== currentGroupIndex && !workbenchPaneGroups[candidateIndex].keys.length) {
          candidateIndex = (candidateIndex + offset + workbenchPaneGroups.length) % workbenchPaneGroups.length;
        }
        const targetGroup = workbenchPaneGroups[candidateIndex];
        if (targetGroup.keys.length) {
          const history = paneHistoryRef.current[paneProjectKey(selectedProject)] || [];
          nextPaneKey = history.find((key) => targetGroup.keys.includes(key)) || targetGroup.keys[0];
        }
      }
    }

    if (nextPaneKey) navigateToWorkbenchPane(nextPaneKey);
  }, [activePane, navigateToWorkbenchPane, selectedProject, workbenchPaneGroups]);

  const selectProject = (project: string | null, options?: { keepSessionKey?: boolean; keepSide?: boolean }) => {
    const projectChanged = selectedProjectRef.current !== project;
    selectedProjectRef.current = project;
    setSelectedProject((current) => {
      if (current === project) return current;
      return project;
    });
    setSelectedFolderId(null);
    try {
      if (project) {
        localStorage.setItem(PROJECT_KEY, project);
        localStorage.setItem(QUICK_ACCESS_PROJECT_KEY, project);
      }
      else localStorage.removeItem(PROJECT_KEY);
    } catch { /* persistence is optional */ }
    if (!options?.keepSessionKey) setActiveSessionKey("");
    if (!options?.keepSide && projectChanged) setSide(null);
    setGit(null);
    setGitLog(null);
    setGitShow(null);
    setGitHistoryContext(null);
    setGitLogLoading(false);
    setGitLogError("");
    gitLogRequestRef.current += 1;
  };

  const addProject = useCallback(async () => {
    try {
      if (typeof desktopApi().addProject !== "function") return;
      const result = await desktopApi().addProject({ title: t("desktop.workbench.addProjectTitle") });
      if (!result.ok) return; // canceled — silent no-op
      selectProject(result.project.localPath || result.project.portableKey);
      await reloadWorkbench();
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [reloadWorkbench, selectProject, setStatus, t]);

  const selectProjectFolder = useCallback((project: WorkbenchProject, folderId: string | null) => {
    selectProject(project.path, { keepSessionKey: true });
    setSelectedFolderId(folderId);
  }, [selectProject]);

  const focusPendingSession = useCallback((pending: PendingWorkbenchSession) => {
    selectProject(pending.projectPath, { keepSessionKey: true });
    setActivePane(pending.terminalKey, pending.projectPath);
    setActiveSessionKey(pending.key);
  }, [setActivePane]);

  const selectSidebarView = (view: WorkbenchSidebarView) => {
    setSidebarView(view);
    try { localStorage.setItem(SIDEBAR_VIEW_KEY, view); } catch { /* persistence is optional */ }
    if (view === "tags") {
      void loadTagItems();
    }
  };

  const loadTagItems = useCallback(async () => {
    setTagsLoading(true);
    try {
      const api = desktopApi();
      if (!api.listTags) {
        setTagItems([]);
        return;
      }
      const rows = await api.listTags({
        status: showObsoleteTags ? "all" : "active",
        entityType: "session",
        category: tagCategoryFilter === "all" ? undefined : tagCategoryFilter,
        query: projectQuery.trim() || undefined,
        sortBy: "weight",
        limit: 200
      });
      setTagItems((rows || []) as WorkbenchTagItem[]);
    } catch {
      setTagItems([]);
    } finally {
      setTagsLoading(false);
    }
  }, [projectQuery, showObsoleteTags, tagCategoryFilter]);

  const selectTag = useCallback(async (tag: WorkbenchTagItem) => {
    setSelectedTag(tag.normalizedTag || tag.tag);
    try {
      const api = desktopApi();
      if (!api.listTagEntities) {
        setTagEntityKeys(new Set());
        return;
      }
      const entities = await api.listTagEntities({
        tag: tag.normalizedTag || tag.tag,
        entityType: "session",
        includeObsolete: showObsoleteTags,
        limit: 500
      });
      const keys = new Set<string>();
      for (const entity of entities || []) {
        const id = String(entity.entityId || "");
        const colon = id.indexOf(":");
        if (colon > 0) {
          keys.add(`${id.slice(0, colon)}:${id.slice(colon + 1)}`);
        }
      }
      setTagEntityKeys(keys);
    } catch {
      setTagEntityKeys(new Set());
    }
  }, [showObsoleteTags]);

  useEffect(() => {
    if (sidebarView !== "tags") return;
    void loadTagItems();
  }, [loadTagItems, sidebarView]);

  const togglePinnedProject = async (path: string, projectId?: string) => {
    const currentlyPinned = pinnedProjects.has(path)
      || (projectId ? pinnedProjects.has(projectId) : false)
      || catalogProjects.some((item) => item.projectId === projectId && item.pinned);
    const nextPinned = !currentlyPinned;
    setPinnedProjects((current) => {
      const next = new Set(current);
      if (nextPinned) {
        next.add(path);
        if (projectId) next.add(projectId);
      } else {
        next.delete(path);
        if (projectId) next.delete(projectId);
      }
      savePinnedProjects(next);
      return next;
    });
    if (projectId && typeof desktopApi().setProjectPinned === "function") {
      try {
        await desktopApi().setProjectPinned({ projectId, pinned: nextPinned });
        setCatalogProjects((current) =>
          current.map((item) => item.projectId === projectId ? { ...item, pinned: nextPinned } : item)
        );
      } catch (error) {
        setStatus({ text: statusError(error), kind: "error" });
      }
    }
  };

  const addTerminal = useCallback((
    title: string,
    cwd: string,
    command?: string,
    projectPath = selectedProject || cwd,
    openedSessionKey?: string,
    group: Exclude<WorkbenchPaneGroup, "code" | "browser"> = openedSessionKey ? "session" : "terminal",
    launch?: { noteId?: string; initialPrompt?: string }
  ): string => {
    const key = `terminal:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const pane = { key, title, group, cwd, command, projectPath, sessionKey: openedSessionKey, ...launch };
    terminalsRef.current = [...terminalsRef.current, pane];
    setTerminals((current) => [...current, pane]);
    setActivePane(key, projectPath);
    return key;
  }, [selectedProject, setActivePane]);

  const addPendingSession = useCallback((
    terminalKey: string,
    provider: AgentProvider,
    projectPath: string,
    title: string,
    flow?: { requestId: string; flowId?: string; nodeId?: string; noteId?: string },
    folder?: { projectId?: string; folderId?: string | null }
  ) => {
    const pending: PendingWorkbenchSession = {
      key: `pending:${terminalKey}`,
      terminalKey,
      provider,
      projectPath,
      title,
      createdAt: Date.now(),
      knownSessionKeys: sessions.map(sessionKey),
      flowRequestId: flow?.requestId,
      flowId: flow?.flowId,
      flowNodeId: flow?.nodeId,
      noteId: flow?.noteId,
      folderProjectId: folder?.projectId,
      folderId: folder?.folderId || undefined
    };
    pendingSessionsRef.current = [...pendingSessionsRef.current, pending];
    setPendingSessions((current) => [...current, pending]);
  }, [sessions]);

  // Must sit after addTerminal / addPendingSession / selectProject (TDZ if deps are read earlier).
  // Dedupe re-dispatched launch events (Notes sends a follow-up frame for remount races).
  const handledLaunchRequestIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    return onWorkbenchLaunchSession((request: LaunchSessionRequest) => {
      if (handledLaunchRequestIdsRef.current.has(request.requestId)) return;
      handledLaunchRequestIdsRef.current.add(request.requestId);
      // Keep set bounded.
      if (handledLaunchRequestIdsRef.current.size > 40) {
        const first = handledLaunchRequestIdsRef.current.values().next().value;
        if (first) handledLaunchRequestIdsRef.current.delete(first);
      }

      void (async () => {
        try {
          const cwd = request.cwd?.trim();
          if (!cwd) {
            emitWorkbenchSessionLaunched({
              requestId: request.requestId,
              ok: false,
              error: "Working directory is required."
            });
            return;
          }
          selectProject(cwd);
          setActive(true);

          // Flow runs only launch CLI sessions (ACP is ignored).
          if (request.channel === "acp") {
            emitWorkbenchSessionLaunched({
              requestId: request.requestId,
              ok: false,
              error: "Flow nodes use CLI sessions only (ACP is disabled)."
            });
            return;
          }

          const knownKeys = new Set(sessions.map(sessionKey));
          const startedAt = Date.now();

          const result = await desktopApi().workbenchNewSession({
            cwd,
            provider: request.provider as AgentProvider,
            executionMode: request.executionMode,
            noteId: request.noteId,
            initialPrompt: request.initialPrompt
          });
          if (result.unsupportedYolo || result.warning) {
            notifyDesktop({
              text: t("desktop.workbench.yoloNotSupported", request.provider),
              kind: "info"
            });
          }
          if (result.mode === "xterm" && result.command) {
            const title = request.title || t("desktop.workbench.newSessionTitle", basename(cwd));
            const terminalKey = addTerminal(
              title,
              result.cwd,
              result.command,
              cwd,
              undefined,
              "session",
              { noteId: request.noteId, initialPrompt: request.initialPrompt }
            );
            addPendingSession(
              terminalKey,
              request.provider as AgentProvider,
              cwd,
              title,
              { requestId: request.requestId, flowId: request.flowId, nodeId: request.flowNodeId, noteId: request.noteId }
            );
            // Do not only wait for pending-session assignment (can miss path/provider).
            // Actively poll catalog and resolve Notes as soon as a session appears.
            void loadSessions();
            const found = await waitForCatalogSession({
              cwd,
              provider: request.provider,
              noteId: request.noteId,
              knownKeys,
              notBeforeMs: startedAt - 30_000,
              timeoutMs: 120_000
            });
            if (found) {
              emitWorkbenchSessionLaunched({
                requestId: request.requestId,
                ok: true,
                catalogProvider: found.catalogProvider,
                sessionId: found.sessionId
              });
              // Attach catalog key onto the terminal pane when possible.
              setTerminals((current) =>
                current.map((pane) =>
                  pane.key === terminalKey
                    ? { ...pane, sessionKey: `${found.catalogProvider}:${found.sessionId}` }
                    : pane
                )
              );
              setPendingSessions((current) => current.filter((pending) => pending.terminalKey !== terminalKey));
              return;
            }
            emitWorkbenchSessionLaunched({
              requestId: request.requestId,
              ok: false,
              error:
                "Terminal opened, but catalog has no new session to bind yet. Wait for session sync, then click Start session."
            });
            return;
          }

          emitWorkbenchSessionLaunched({
            requestId: request.requestId,
            ok: false,
            error: "Note execution requires an internal Workbench terminal."
          });
        } catch (error) {
          emitWorkbenchSessionLaunched({
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })();
    });
  }, [addPendingSession, addTerminal, loadSessions, selectProject, sessions, t]);

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

  const onTerminalInput = useCallback((key: string) => {
    const existing = gitRefreshTimers.current.get(key);
    if (existing) window.clearTimeout(existing);
    gitRefreshTimers.current.set(key, window.setTimeout(() => {
      gitRefreshTimers.current.delete(key);
      void refreshTerminalGit(key);
    }, 500));
    // User typing into a session TUI: treat as active, clear weak awaiting promptly.
    const pane = terminalsRef.current.find((item) => item.key === key);
    if (pane?.group === "session") {
      tuiLastOutputAtRef.current.set(key, Date.now());
      tuiDebounceRef.current.set(key, createTuiDebounceState());
      setTuiRuntimeByPaneKey((current) => {
        if (current[key]?.status === "running" && !current[key]?.awaitingConfidence) return current;
        return { ...current, [key]: { status: "running" } };
      });
    }
  }, [refreshTerminalGit]);

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
    if (terminal) terminalRefs.current.set(id, terminal);
    else terminalRefs.current.delete(id);
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
    projectPath: string,
    closedKey: string,
    options?: {
      remainingTerminals?: TerminalPane[];
      remainingAcp?: AcpChatPane[];
      remainingEditors?: EditorPane[];
      remainingDiffs?: DiffPane[];
      remainingBrowsers?: BrowserPane[];
    }
  ) => {
    const projectKey = paneProjectKey(projectPath);
    const history = (paneHistoryRef.current[projectKey] || []).filter((item) => item !== closedKey);
    paneHistoryRef.current[projectKey] = history;
    const remainingTerminals =
      options?.remainingTerminals ??
      terminals.filter((item) => item.projectPath === projectPath && item.key !== closedKey);
    const remainingAcp =
      options?.remainingAcp ?? acpChats.filter((item) => item.projectPath === projectPath && item.key !== closedKey);
    const projectEditors = options?.remainingEditors
      ?? editors.filter((item) => item.projectPath === projectPath && item.key !== closedKey);
    const projectDiffs = options?.remainingDiffs
      ?? diffs.filter((item) => item.projectPath === projectPath && item.key !== closedKey);
    const remainingBrowsers = options?.remainingBrowsers
      ?? browsers.filter((item) => item.projectPath === projectPath && item.key !== closedKey);
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
      paneHistoryRef.current[projectKey] = [nextPane, ...history.filter((item) => item !== nextPane)].slice(0, 32);
    }
    const wasActive = activePanesRef.current[paneProjectKey(selectedProjectRef.current || "")] === closedKey;
    setActivePanes((current) => (current[projectKey] === closedKey ? { ...current, [projectKey]: nextPane } : current));
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
    setPendingSessions((current) => current.filter((pending) => pending.terminalKey !== key));
    if (pane) {
      deferSessionPaneAutoRename(pane);
      nextPaneAfterClose(pane.projectPath, key, {
        remainingTerminals: remaining.filter((item) => item.projectPath === pane.projectPath)
      });
    }
  }, [deferSessionPaneAutoRename, nextPaneAfterClose]);

  const closeAcpChat = useCallback((key: string) => {
    const pane = acpChats.find((item) => item.key === key);
    setAcpChats((current) => current.filter((item) => item.key !== key));
    if (pane) {
      deferSessionPaneAutoRename(pane);
      void desktopApi().acpDisconnect({ chatId: pane.recordId });
      nextPaneAfterClose(pane.projectPath, key, {
        remainingAcp: acpChats.filter((item) => item.projectPath === pane.projectPath && item.key !== key)
      });
    }
  }, [acpChats, deferSessionPaneAutoRename, nextPaneAfterClose]);

  const closeEditor = useCallback((key: string) => {
    const pane = editors.find((item) => item.key === key);
    if (!pane) return;
    if (pane.dirty && !window.confirm(t("desktop.workbench.fileDiscardConfirm", basename(pane.path)))) return;
    if (activePane === key) closeEditorFind();
    const remainingEditors = editors.filter((item) => item.key !== key);
    setEditors(remainingEditors);
    nextPaneAfterClose(pane.projectPath, key, { remainingEditors });
  }, [activePane, closeEditorFind, editors, nextPaneAfterClose, t]);

  const closeDiff = useCallback((key: string) => {
    const pane = diffs.find((item) => item.key === key);
    if (!pane) return;
    const remainingDiffs = diffs.filter((item) => item.key !== key);
    setDiffs(remainingDiffs);
    nextPaneAfterClose(pane.projectPath, key, { remainingDiffs });
  }, [diffs, nextPaneAfterClose]);

  const addAcpChat = useCallback((record: {
    id: string;
    title: string;
    provider: string;
    projectPath: string;
  }) => {
    const key = `acp:${record.id}`;
    const projectPath = record.projectPath;
    setAcpChats((current) => {
      if (current.some((pane) => pane.key === key)) return current;
      return [
        ...current,
        {
          key,
          recordId: record.id,
          title: record.title || t("desktop.workbench.acpChat"),
          provider: record.provider,
          projectPath
        }
      ];
    });
    setActivePane(key, projectPath);
  }, [setActivePane, t]);

  const closeBrowser = useCallback((key: string) => {
    const pane = browsers.find((item) => item.key === key);
    if (!pane) return;
    setBrowsers((current) => current.filter((item) => item.key !== key));
    void desktopApi().browserDestroy({ browserId: pane.browserId }).catch(() => undefined);
    nextPaneAfterClose(pane.projectPath, key, {
      remainingBrowsers: browsers.filter((item) => item.projectPath === pane.projectPath && item.key !== key)
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

  const closeActivePane = useCallback(() => {
    if (!activePane) return;
    if (activePane.startsWith("terminal:")) {
      closeTerminal(activePane);
    } else if (activePane.startsWith("acp:")) {
      closeAcpChat(activePane);
    } else if (activePane.startsWith("editor:")) {
      closeEditor(activePane);
    } else if (activePane.startsWith("browser:")) {
      closeBrowser(activePane);
    } else {
      closeDiff(activePane);
    }
  }, [activePane, closeAcpChat, closeBrowser, closeDiff, closeEditor, closeTerminal]);

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

  const launchNewSession = useCallback(async (
    target: WorkbenchNewSessionTarget,
    targetProject?: string,
    projectId?: string
  ) => {
    if (terminalCreating) return;
    setTerminalCreating(true);
    try {
      let cwd = targetProject || selectedProject || await desktopApi().createScratchDir();
      if (projectId && typeof desktopApi().resolveProjectCwd === "function") {
        const resolved = await desktopApi().resolveProjectCwd({ projectId });
        if (resolved.source === "missing" || !resolved.cwd) {
          setStatus({ text: t("desktop.workbench.pathMissingHint"), kind: "error" });
          return;
        }
        cwd = resolved.cwd;
      }
      if (!selectedProject) selectProject(cwd);
      else if (targetProject && projectPathKey(selectedProject) !== projectPathKey(cwd)) selectProject(cwd);
      // When the projects sidebar focuses a subfolder of the launch project,
      // associate the new session with that folder automatically.
      const focusedFolder = selectedProject && selectedFolderId && selectedFolderId !== UNCLASSIFIED_FOLDER_ID && selectedProjectMeta
        && projectPathKey(cwd) === projectPathKey(selectedProject)
        ? { projectId: selectedProjectMeta.id, folderId: selectedFolderId }
        : null;
      if (target.channel === "acp") {
        const record = await desktopApi().acpCreateSession({ projectPath: cwd, provider: target.provider });
        addAcpChat(record);
        if (focusedFolder && typeof desktopApi().assignWorkbenchSessionToFolder === "function") {
          try {
            await desktopApi().assignWorkbenchSessionToFolder({
              projectId: focusedFolder.projectId,
              provider: "chat",
              agentSessionId: record.id,
              folderId: focusedFolder.folderId
            });
          } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
        }
        await reloadWorkbench();
      } else {
        const result = await desktopApi().workbenchNewSession({
          cwd,
          provider: target.provider as AgentProvider,
          executionMode: "standard"
        });
        if (result.unsupportedYolo || result.warning) {
          notifyDesktop({
            text: t("desktop.workbench.yoloNotSupported", target.provider),
            kind: "info"
          });
        }
        if (result.external || result.mode === "external-system") {
          setStatus({
            text: result.copied
              ? t("desktop.workbench.externalCommandCopied")
              : result.command || t("desktop.workbench.externalTerminalHint"),
            kind: "ok"
          });
          await loadSessions();
          return;
        }
        if (result.mode === "xterm" && result.command) {
          const title = t("desktop.workbench.newSessionTitle", basename(cwd));
          const terminalKey = addTerminal(title, result.cwd, result.command, cwd, undefined, "session");
          addPendingSession(terminalKey, target.provider, cwd, title, undefined, focusedFolder || undefined);
        }
        await loadSessions();
      }
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { setTerminalCreating(false); }
  }, [addAcpChat, addPendingSession, addTerminal, loadSessions, reloadWorkbench, selectedFolderId, selectedProject, selectedProjectMeta, t, terminalCreating]);

  const requestNewSession = useCallback(async (targetProject?: string, projectId?: string) => {
    if (terminalCreating) return;
    const target = resolveNewSessionTarget();
    if (!target) {
      setNewSessionPicker({ projectPath: targetProject, projectId });
      return;
    }
    await launchNewSession(target, targetProject, projectId);
  }, [launchNewSession, resolveNewSessionTarget, terminalCreating]);

  const newSession = useCallback(() => requestNewSession(), [requestNewSession]);
  const newSessionForProject = useCallback(
    (cwd: string, projectId?: string) => requestNewSession(cwd, projectId),
    [requestNewSession]
  );

  const chooseNewSessionTarget = useCallback(async (rawTarget: string) => {
    const target = parseNewSessionTarget(rawTarget);
    const picker = newSessionPicker;
    if (!target || !picker) return;
    setNewSessionPicker(null);
    await launchNewSession(target, picker.projectPath, picker.projectId);
  }, [launchNewSession, newSessionPicker, parseNewSessionTarget]);

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

  const openSessionSearch = () => {
    setSessionSearchOpen(true);
    window.requestAnimationFrame(() => {
      sessionSearchInputRef.current?.focus();
      if (sessionSearchInputRef.current?.value) sessionSearchInputRef.current.select();
    });
  };

  const closeSessionSearch = () => {
    setSessionSearchOpen(false);
    window.requestAnimationFrame(() => sessionSearchButtonRef.current?.focus());
  };

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

  // Track modal state (⌘P palette and all aria-modal dialogs) so main can suppress
  // the ⌘+Arrow pane navigation while a modal is on screen.
  useEffect(() => startModalOpenReporter(), []);

  useEffect(() => desktopApi().onWorkbenchCmdW(() => {
    if (active) closeActivePane();
  }), [active, closeActivePane]);

  useEffect(() => {
    const unsubscribe =
      typeof desktopApi().onWorkbenchCmdArrow === "function"
        ? desktopApi().onWorkbenchCmdArrow((direction) => {
            if (active) navigateWorkbenchPanes(direction);
          })
        : () => undefined;
    return unsubscribe;
  }, [active, navigateWorkbenchPanes]);

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
      // Box-primary: an agent session pane lands text entry in its composer
      // (deferred until the PTY spawns). Shell panes keep raw xterm focus.
      focusWorkbenchPane(terminalKey);
      setActiveSessionKey(key);
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

  useEffect(() => {
    const onFocusSession = (event: Event) => {
      const detail = (event as CustomEvent<{ paneKey?: string; projectPath?: string }>).detail;
      if (!detail?.paneKey) return;
      focusWorkbenchSessionFromRail(detail.paneKey, detail.projectPath || selectedProjectRef.current || "");
    };
    window.addEventListener("agent-resume:workbench-focus-session", onFocusSession);
    return () => window.removeEventListener("agent-resume:workbench-focus-session", onFocusSession);
  }, [focusWorkbenchSessionFromRail]);

  const projectMenu = (event: React.MouseEvent, project: WorkbenchProject) => {
    event.preventDefault();
    const menu: WorkbenchContextMenu = {
      kind: "project",
      projectPath: project.path,
      projectId: project.id,
      x: event.clientX,
      y: event.clientY
    };
    setContextMenu(menu);
    void desktopApi().workbenchGetProjectEditor().then((info) => {
      if (!info.editor || (!info.available && info.selected === "auto")) return;
      setContextMenu((current) => current === menu ? { ...current, editorLabel: info.editor!.label } : current);
    }).catch(() => undefined);
  };

  const folderMenu = (event: React.MouseEvent, project: WorkbenchProject, folder: WorkbenchSessionFolder) => {
    event.preventDefault();
    setContextMenu({
      kind: "folder",
      projectPath: project.path,
      projectId: project.id,
      folderId: folder.folderId,
      parentId: folder.parentId,
      folderName: folder.name,
      x: event.clientX,
      y: event.clientY
    });
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
    const menu: WorkbenchContextMenu = { kind: "session", session, x: event.clientX, y: event.clientY };
    setContextMenu(menu);
    refreshFloatingNoteAvailability(sessionNoteTarget(session, aliases[session.projectPath] || basename(session.projectPath)), menu);
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

  const openNoteInNotesTab = (noteId: string) => {
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
    window.dispatchEvent(new CustomEvent("agent-resume:open-note", { detail: noteId }));
  };

  const openMountedNote = async (owner: { scope: "project" | "session"; projectPath: string; provider?: string; sessionId?: string }) => {
    try {
      // Project mount: jump to first root note when any exist; only create when empty.
      if (owner.scope === "project" && typeof desktopApi().notesListRoot === "function") {
        const roots = await desktopApi().notesListRoot();
        const projectRoots = roots
          .filter((note) => note.scope === "project" && note.projectPath === owner.projectPath)
          .sort((left, right) =>
            (right.updatedAtMs || 0) - (left.updatedAtMs || 0)
            || (right.createdAtMs || 0) - (left.createdAtMs || 0)
          );
        if (projectRoots[0]) {
          openNoteInNotesTab(projectRoots[0].noteId);
          return;
        }
      }
      const result = await desktopApi().notesCreate(owner);
      openNoteInNotesTab(result.noteId);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  };

  const openCreateFolderDialog = (project: WorkbenchProject, parentId: string | null = null) => {
    setFolderDialog({
      mode: "create",
      projectId: project.id,
      parentId,
      title: "",
      status: "",
      busy: false
    });
  };

  const openRenameFolderDialog = (project: WorkbenchProject, folder: WorkbenchSessionFolder) => {
    setFolderDialog({
      mode: "rename",
      projectId: project.id,
      folderId: folder.folderId,
      parentId: folder.parentId,
      title: folder.name,
      status: "",
      busy: false
    });
  };

  const openMoveSessionDialog = (session: AgentSession) => {
    const project = allProjects.find((item) =>
      (session.projectId && item.id === session.projectId)
      || item.path === session.projectPath
    );
    if (!project || !project.id || project.id === project.path) {
      setStatus({ text: t("desktop.workbench.folderProjectUnavailable"), kind: "error" });
      return;
    }
    setFolderPickerDialog({
      projectId: project.id,
      projectPath: project.path,
      session,
      folders: project.folders,
      query: "",
      busy: false,
      status: ""
    });
  };

  const sessionProjectIdentity = (session: AgentSession) => {
    const project = allProjects.find((item) =>
      (session.projectId && item.id === session.projectId)
      || item.path === session.projectPath
    );
    return {
      project,
      sourceId: session.projectId || project?.id || "",
      sourcePath: session.projectPath || project?.path || ""
    };
  };

  const openMoveSessionToProjectDialog = (session: AgentSession) => {
    const { project, sourceId, sourcePath } = sessionProjectIdentity(session);
    const options = allProjects
      .filter((item) => {
        if (sourceId && item.id === sourceId) return false;
        if (sourcePath && item.path === sourcePath) return false;
        return Boolean(item.path);
      })
      .map((item) => ({ id: item.id, label: item.label, path: item.path }));
    if (!options.length) {
      setStatus({ text: t("desktop.workbench.moveToProjectNoTargets"), kind: "error" });
      return;
    }
    setProjectPickDialog({
      kind: "moveSession",
      session,
      sourceLabel: project?.label || aliases[session.projectPath] || basename(session.projectPath),
      options,
      query: "",
      busy: false,
      status: ""
    });
  };

  const followSessionPanesToProject = (session: AgentSession, nextProjectPath: string) => {
    const key = sessionKey(session);
    const acpKey = isAcpSession(session) ? acpListSessionKey(session.id) : "";
    const previousProjectPath = session.projectPath;
    const movedPaneKeys = new Set<string>();
    for (const pane of terminalsRef.current) {
      if (pane.sessionKey === key) movedPaneKeys.add(pane.key);
    }
    for (const pane of acpChatsRef.current) {
      if (acpKey && acpListSessionKey(pane.recordId) === acpKey) movedPaneKeys.add(pane.key);
    }
    if (movedPaneKeys.size) {
      setTerminals((current) => current.map((pane) =>
        movedPaneKeys.has(pane.key) ? { ...pane, projectPath: nextProjectPath } : pane
      ));
      setAcpChats((current) => current.map((pane) =>
        movedPaneKeys.has(pane.key) ? { ...pane, projectPath: nextProjectPath } : pane
      ));
    }
    if (!previousProjectPath || previousProjectPath === nextProjectPath || !movedPaneKeys.size) return;
    const previousKey = paneProjectKey(previousProjectPath);
    const nextKey = paneProjectKey(nextProjectPath);
    setActivePanes((current) => {
      const paneKey = current[previousKey];
      if (!paneKey || !movedPaneKeys.has(paneKey)) return current;
      const next = { ...current, [nextKey]: paneKey };
      if (next[previousKey] === paneKey) delete next[previousKey];
      return next;
    });
  };

  const applyMoveSessionToProject = async (target: { id: string; label: string; path: string }) => {
    if (!projectPickDialog || projectPickDialog.kind !== "moveSession") return;
    const session = projectPickDialog.session;
    setProjectPickDialog((current) => current ? { ...current, busy: true, status: t("desktop.workbench.moveToProjectRunning") } : current);
    try {
      const result = await desktopApi().moveSessionToProject({
        provider: session.provider,
        id: session.id,
        targetProjectPath: target.path
      });
      const nextPath = result.newPath || target.path;
      followSessionPanesToProject(session, nextPath);
      setProjectPickDialog(null);
      setStatus({ text: t("desktop.workbench.moveToProjectDone", target.label) });
      selectProject(nextPath, { keepSessionKey: true });
      setActiveSessionKey(sessionKey(session));
      await reloadWorkbench();
      window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
    } catch (error) {
      setProjectPickDialog((current) => current ? { ...current, busy: false, status: statusError(error) } : current);
    }
  };

  const applyFolderDialog = async () => {
    if (!folderDialog) return;
    const name = folderDialog.title.trim();
    if (!name) {
      setFolderDialog((current) => current ? { ...current, status: t("desktop.workbench.folderNameEmpty") } : current);
      return;
    }
    setFolderDialog((current) => current ? { ...current, busy: true, status: "" } : current);
    try {
      if (folderDialog.mode === "create") {
        await desktopApi().createWorkbenchSessionFolder({
          projectId: folderDialog.projectId,
          parentId: folderDialog.parentId,
          name
        });
        if (folderDialog.parentId) {
          setExpandedFolderIds((current) => new Set(current).add(folderDialog.parentId!));
        }
      } else if (folderDialog.folderId) {
        await desktopApi().renameWorkbenchSessionFolder({ folderId: folderDialog.folderId, name });
      }
      setFolderDialog(null);
      await reloadWorkbench();
    } catch (error) {
      setFolderDialog((current) => current ? { ...current, busy: false, status: statusError(error) } : current);
    }
  };

  const assignFolderFromPicker = async (folderId: string | null) => {
    if (!folderPickerDialog) return;
    setFolderPickerDialog((current) => current ? { ...current, busy: true, status: "" } : current);
    try {
      if (folderId) {
        await desktopApi().assignWorkbenchSessionToFolder({
          projectId: folderPickerDialog.projectId,
          provider: folderPickerDialog.session.provider,
          agentSessionId: folderPickerDialog.session.id,
          folderId
        });
      } else {
        await desktopApi().removeWorkbenchSessionFromFolder({
          provider: folderPickerDialog.session.provider,
          agentSessionId: folderPickerDialog.session.id
        });
      }
      setFolderPickerDialog(null);
      await reloadWorkbench();
    } catch (error) {
      setFolderPickerDialog((current) => current ? { ...current, busy: false, status: statusError(error) } : current);
    }
  };

  const applyRename = async () => {
    if (!renameDialog) return;
    const title = renameDialog.title.trim();
    if (!title) {
      setRenameDialog((current) => current ? { ...current, status: t("desktop.workbench.nameEmpty") } : current);
      return;
    }
    try {
      const base = basename(renameDialog.projectPath);
      await desktopApi().setProjectAlias({ projectPath: renameDialog.projectPath, alias: title === base ? "" : title });
      setAliases(await desktopApi().listProjectAliases());
      setRenameDialog(null);
    } catch (error) { setRenameDialog((current) => current ? { ...current, status: statusError(error) } : current); }
  };

  const runContextAction = async (action: string) => {
    const menu = contextMenu;
    setContextMenu(null);
    if (!menu) return;
    if (menu.kind === "project" && menu.projectPath) {
      if (action === "pin" || action === "unpin") await togglePinnedProject(menu.projectPath, menu.projectId);
      if (action === "new") await newSessionForProject(menu.projectPath, menu.projectId);
      if (action === "newFolder" && menu.projectId) {
        const project = allProjects.find((item) => item.id === menu.projectId);
        if (project && project.id !== project.path) openCreateFolderDialog(project);
      }
      if (action === "editor") {
        try {
          let projectPath = menu.projectPath;
          if (menu.projectId && typeof desktopApi().resolveProjectCwd === "function") {
            const resolved = await desktopApi().resolveProjectCwd({ projectId: menu.projectId });
            if (resolved.source === "missing" || !resolved.cwd) {
              setStatus({ text: t("desktop.workbench.pathMissingHint"), kind: "error" });
              return;
            }
            projectPath = resolved.cwd;
          }
          await desktopApi().workbenchOpenProjectInEditor({ projectPath });
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "note") await openMountedNote({ scope: "project", projectPath: menu.projectPath });
      if (action === "rename") setRenameDialog({
        projectPath: menu.projectPath,
        projectId: menu.projectId,
        title: aliases[menu.projectPath] || basename(menu.projectPath),
        status: ""
      });
      if (action === "setLocalPath" && menu.projectId && typeof desktopApi().pickProjectLocalPath === "function") {
        try {
          const result = await desktopApi().pickProjectLocalPath({
            projectId: menu.projectId,
            title: t("desktop.workbench.setLocalFolderTitle")
          });
          if (!result.ok) return;
          selectProject(result.absolutePath);
          setStatus({ text: t("desktop.workbench.localPathSet", result.absolutePath) });
          await reloadWorkbench();
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "copyPath" && typeof desktopApi().copyProjectLocalPath === "function") {
        try {
          const result = await desktopApi().copyProjectLocalPath({
            projectId: menu.projectId,
            projectPath: menu.projectPath
          });
          setStatus({ text: t("desktop.workbench.pathCopied", result.path) });
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "reveal" && typeof desktopApi().revealProjectInFinder === "function") {
        try {
          await desktopApi().revealProjectInFinder({
            projectId: menu.projectId,
            projectPath: menu.projectPath
          });
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "merge" && menu.projectId && typeof desktopApi().mergeProjects === "function") {
        const options = projects
          .filter((project) => project.id !== menu.projectId)
          .map((project) => ({ id: project.id, label: project.label, path: project.path }));
        if (!options.length) {
          setStatus({ text: t("desktop.workbench.mergeNoTargets"), kind: "error" });
          return;
        }
        setProjectPickDialog({
          kind: "merge",
          sourceId: menu.projectId,
          sourceLabel: aliases[menu.projectPath] || basename(menu.projectPath),
          options,
          query: "",
          busy: false,
          status: ""
        });
      }
      if (action === "split" && menu.projectId && typeof desktopApi().listProjectPathVariants === "function") {
        try {
          const variants = await desktopApi().listProjectPathVariants({ projectId: menu.projectId });
          const options = variants.filter((item) => item.absolutePath);
          if (options.length < 2) {
            setStatus({ text: t("desktop.workbench.splitNeedVariants"), kind: "error" });
            return;
          }
          setProjectPickDialog({
            kind: "split",
            sourceId: menu.projectId,
            sourceLabel: aliases[menu.projectPath] || basename(menu.projectPath),
            options,
            query: "",
            busy: false,
            status: ""
          });
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      if (action === "remove") {
        const label = aliases[menu.projectPath] || basename(menu.projectPath);
        const sessionCount = allProjects.find((project) => project.id === menu.projectId || project.path === menu.projectPath)?.sessionCount || 0;
        if (!window.confirm(t("desktop.workbench.removeProjectConfirm", label, sessionCount))) return;
        try {
          if (typeof desktopApi().hideProject === "function") {
            await desktopApi().hideProject({ projectId: menu.projectId, projectPath: menu.projectPath });
          }
          if (selectedProject === menu.projectPath || selectedProject === menu.projectId) {
            selectProject(null);
          }
          setPinnedProjects((current) => {
            const next = new Set(current);
            next.delete(menu.projectPath!);
            if (menu.projectId) next.delete(menu.projectId);
            savePinnedProjects(next);
            return next;
          });
          await reloadWorkbench();
          window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
        } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
      }
      return;
    }
    if (menu.kind === "folder") {
      const project = allProjects.find((item) => item.id === menu.projectId);
      const folder = project?.folders.find((item) => item.folderId === menu.folderId);
      if (!project || !folder || !menu.folderId) return;
      if (action === "newFolder") openCreateFolderDialog(project, folder.folderId);
      if (action === "renameFolder") openRenameFolderDialog(project, folder);
      if (action === "deleteFolder") {
        if (!window.confirm(t("desktop.workbench.deleteFolderConfirm", folder.name))) return;
        try {
          await desktopApi().deleteWorkbenchSessionFolder({ folderId: folder.folderId });
          if (selectedFolderId === folder.folderId) {
            setSelectedFolderId(folder.parentId || UNCLASSIFIED_FOLDER_ID);
          }
          await reloadWorkbench();
        } catch (error) {
          setStatus({ text: statusError(error), kind: "error" });
        }
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
    const session = menu.session;
    if (!session) return;
    if (action === "moveFolder") {
      openMoveSessionDialog(session);
      return;
    }
    if (action === "moveProject") {
      openMoveSessionToProjectDialog(session);
      return;
    }
    if (action === "removeFolder") {
      try {
        await desktopApi().removeWorkbenchSessionFromFolder({
          provider: session.provider,
          agentSessionId: session.id
        });
        await reloadWorkbench();
      } catch (error) {
        setStatus({ text: statusError(error), kind: "error" });
      }
      return;
    }
    if (action.startsWith("gtd:")) {
      const status = action === "gtd:clear"
        ? null
        : GTD_STATUSES.includes(action.slice(4) as GtdStatus)
          ? action.slice(4) as GtdStatus
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
    if (action === "preview") window.dispatchEvent(new CustomEvent("agent-resume:sessions-preview", { detail: session }));
    if (action === "autoRename") {
      cancelSessionAutoRename(sessionKey(session));
      await performAutoRenameSession(session.provider, session.id);
    }
    if (action === "remove" && window.confirm(t("desktop.workbench.removeConfirm", session.title || session.id))) {
      const removeKey = sessionKey(session);
      cancelSessionAutoRename(removeKey);
      deferredAutoRenameKeysRef.current.delete(removeKey);
      try {
        await desktopApi().hideSession({ provider: session.provider, id: session.id });
        await reloadWorkbench();
        window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
      } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    }
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

  const loadScripts = useCallback(async (rootPath: string) => {
    setScriptsLoading(true);
    setScriptsError("");
    try {
      const result = await desktopApi().workbenchListScripts({ rootPath });
      setScriptPackages(result.packages);
      setScriptsTruncated(Boolean(result.truncated));
    } catch (error) {
      setScriptPackages([]);
      setScriptsTruncated(false);
      setScriptsError(statusError(error));
    } finally {
      setScriptsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || !selectedProject) {
      setScriptPackages([]);
      setScriptsError("");
      setScriptsTruncated(false);
      return;
    }
    if (side === "files" || side === "scripts") {
      void loadScripts(selectedProject);
    }
  }, [active, loadScripts, selectedProject, side]);

  const runScript = useCallback((script: ScriptEntryView, _pkg: ScriptPackageView) => {
    const projectPath = selectedProject || script.run.cwd;
    addTerminal(script.name, script.run.cwd, script.run.command, projectPath);
  }, [addTerminal, selectedProject]);

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
        const next = [...current, { ...inspected, key, path, projectPath: targetProject, content: inspected.content, dirty: false, view }];
        editorsRef.current = next;
        return next;
      });
      if (reveal) pendingRevealRef.current = { ...reveal, path };
      setActivePane(key, targetProject);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
  };

  const runLinkGraph = useCallback(async (args: LinkGraphAnalyzeArgs) => {
    const api = desktopApi();
    if (typeof api.linkGraphAnalyze !== "function") {
      setLinkGraphError(t("desktop.workbench.linkGraphFailed", "unavailable"));
      setSide("linkgraph");
      return;
    }
    linkGraphSeedRef.current = { ...args, outputLanguage: linkGraphLanguageRef.current };
    setSide("linkgraph");
    setLinkGraphBusy(true);
    setLinkGraphError(null);
    setLinkGraphProgress(null);
    try {
      const result = await api.linkGraphAnalyze({
        ...args,
        outputLanguage: args.outputLanguage || linkGraphLanguageRef.current
      });
      setLinkGraphResult(result);
      if (result.stopReason === "invalid_seed" || result.stopReason === "empty_seed") {
        setLinkGraphError(t("desktop.workbench.linkGraphNeedSelection"));
      } else {
        setLinkGraphError(null);
      }
    } catch (error) {
      setLinkGraphError(t("desktop.workbench.linkGraphFailed", statusError(error)));
    } finally {
      setLinkGraphBusy(false);
    }
  }, [t]);

  const refreshLinkGraph = useCallback(() => {
    const seed = linkGraphSeedRef.current;
    if (!seed) return;
    void runLinkGraph({ ...seed, outputLanguage: linkGraphLanguageRef.current });
  }, [runLinkGraph]);

  const changeLinkGraphLanguage = useCallback((value: LinkGraphOutputLanguage) => {
    setLinkGraphLanguage(value);
    localStorage.setItem("wb-linkgraph-lang", value);
    linkGraphLanguageRef.current = value;
    const seed = linkGraphSeedRef.current;
    if (seed && (linkGraphResult?.primaryChain.length || linkGraphResult?.hits.length)) {
      void runLinkGraph({ ...seed, outputLanguage: value });
    }
  }, [linkGraphResult?.hits.length, linkGraphResult?.primaryChain.length, runLinkGraph]);

  const openLinkGraphFromEditor = useCallback(() => {
    if (!selectedProject || !currentEditor) return;
    const selection = editorRef.current?.getSelectionRange();
    const text = selection?.text.trim() || editorRef.current?.getSelectedText().trim() || "";
    if (!text) {
      setStatus({ text: t("desktop.workbench.linkGraphNeedSelection"), kind: "error" });
      return;
    }
    void runLinkGraph({
      projectPath: selectedProject,
      filePath: currentEditor.path,
      selection: text,
      startLine: selection?.startLine || 1,
      endLine: selection?.endLine || selection?.startLine || 1,
      outputLanguage: linkGraphLanguageRef.current
    });
  }, [currentEditor, runLinkGraph, selectedProject, t]);

  const quickAccessRoot = selectedProject || storageString(QUICK_ACCESS_PROJECT_KEY) || "";
  const quickAccessProjectLabel = quickAccessRoot
    ? `${aliases[quickAccessRoot] || basename(quickAccessRoot)} — ${quickAccessRoot}`
    : "";

  const loadQuickAccessFiles = useCallback(async (rootPath: string) => {
    if (!rootPath) return;
    quickAccessSearchRequestRef.current += 1;
    setQuickAccessSearchFiles([]);
    setQuickAccessSearchTruncated(false);
    const cacheKey = projectPathKey(rootPath);
    const cached = quickAccessCacheRef.current.get(cacheKey);
    if (cached) {
      setQuickAccessFiles(cached.files);
      setQuickAccessTruncated(cached.truncated);
    } else {
      setQuickAccessFiles([]);
      setQuickAccessTruncated(false);
    }
    const sequence = ++quickAccessRequestRef.current;
    setQuickAccessLoading(!cached);
    setQuickAccessError("");
    try {
      const api = desktopApi();
      if (typeof api.workbenchListFiles !== "function") throw new Error(t("desktop.workbench.quickAccessUnavailable"));
      const result = await api.workbenchListFiles({ rootPath });
      if (quickAccessRequestRef.current !== sequence) return;
      quickAccessCacheRef.current.set(cacheKey, { files: result.files, truncated: result.truncated });
      setQuickAccessFiles(result.files);
      setQuickAccessTruncated(result.truncated);
    } catch (error) {
      if (quickAccessRequestRef.current !== sequence || (error as Error)?.name === "AbortError") return;
      setQuickAccessError(statusError(error));
    } finally {
      if (quickAccessRequestRef.current === sequence) setQuickAccessLoading(false);
    }
  }, [t]);

  const openQuickAccess = useCallback((mode: QuickAccessMode) => {
    if (!quickAccessOpen && document.querySelector('[aria-modal="true"]')) return;
    setContextMenu(null);
    setBranchPane(null);
    setProjectPickDialog(null);
    quickAccessProjectContextRef.current = { mode: "files", query: "", closeOnSelect: false };
    setQuickAccessMode(mode);
    setQuickAccessQuery("");
    setQuickAccessSearchFiles([]);
    setQuickAccessSearchTruncated(false);
    setQuickAccessOpen(true);
  }, [quickAccessOpen]);

  useEffect(() => {
    if (quickAccessOpen && quickAccessMode === "files" && quickAccessRoot) {
      void loadQuickAccessFiles(quickAccessRoot);
    }
  }, [loadQuickAccessFiles, quickAccessMode, quickAccessOpen, quickAccessRoot]);

  useEffect(() => {
    const api = desktopApi();
    const query = quickAccessQuery.trim();
    if (!quickAccessOpen || quickAccessMode !== "files" || !quickAccessRoot || !quickAccessTruncated || !query
      || typeof api.workbenchSearchPaths !== "function") {
      quickAccessSearchRequestRef.current += 1;
      setQuickAccessSearchFiles([]);
      setQuickAccessSearchTruncated(false);
      if (typeof api.workbenchSearchPathsCancel === "function") {
        void api.workbenchSearchPathsCancel().catch(() => undefined);
      }
      return;
    }

    const sequence = ++quickAccessSearchRequestRef.current;
    const timer = window.setTimeout(() => {
      void api.workbenchSearchPaths({ rootPath: quickAccessRoot, query }).then((result) => {
        if (quickAccessSearchRequestRef.current !== sequence) return;
        setQuickAccessSearchFiles(result.files);
        setQuickAccessSearchTruncated(result.truncated);
      }).catch((error) => {
        if (quickAccessSearchRequestRef.current !== sequence || (error as Error)?.name === "AbortError") return;
        setQuickAccessSearchFiles([]);
        setQuickAccessSearchTruncated(false);
      });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      if (typeof api.workbenchSearchPathsCancel === "function") {
        void api.workbenchSearchPathsCancel().catch(() => undefined);
      }
    };
  }, [quickAccessMode, quickAccessOpen, quickAccessQuery, quickAccessRoot, quickAccessTruncated]);

  const closeQuickAccess = useCallback(() => {
    quickAccessRequestRef.current += 1;
    quickAccessSearchRequestRef.current += 1;
    setQuickAccessOpen(false);
    const api = desktopApi();
    if (typeof api.workbenchListFilesCancel === "function") void api.workbenchListFilesCancel().catch(() => undefined);
    if (typeof api.workbenchSearchPathsCancel === "function") void api.workbenchSearchPathsCancel().catch(() => undefined);
  }, []);

  const enterQuickAccessProjectMode = useCallback((closeOnSelect = false) => {
    quickAccessProjectContextRef.current = {
      mode: quickAccessMode === "commands" ? "commands" : "files",
      query: quickAccessQuery,
      closeOnSelect
    };
    setQuickAccessMode("projects");
    setQuickAccessQuery("");
  }, [quickAccessMode, quickAccessQuery]);

  const leaveQuickAccessProjectMode = useCallback(() => {
    const context = quickAccessProjectContextRef.current;
    setQuickAccessMode(context.mode);
    setQuickAccessQuery(context.query);
  }, []);

  useEffect(() => {
    const api = desktopApi();
    const offCmdP = typeof api.onWorkbenchCmdP === "function"
      ? api.onWorkbenchCmdP(() => openQuickAccess("files"))
      : () => undefined;
    const offCmdShiftP = typeof api.onWorkbenchCmdShiftP === "function"
      ? api.onWorkbenchCmdShiftP(() => openQuickAccess("commands"))
      : () => undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      event.stopPropagation();
      openQuickAccess(event.shiftKey ? "commands" : "files");
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      offCmdP();
      offCmdShiftP();
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [openQuickAccess]);

  const openQuickAccessFile = useCallback(async (file: QuickAccessFile) => {
    const rootPath = quickAccessRoot;
    if (!rootPath) return;
    closeQuickAccess();
    selectProject(rootPath);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    await openFile(file.path, undefined, rootPath);
  }, [closeQuickAccess, quickAccessRoot, syncEditorFromDisk]);

  const openQuickAccessDirectory = useCallback((directory: QuickAccessFile) => {
    const rootPath = quickAccessRoot;
    if (!rootPath) return;
    closeQuickAccess();
    selectProject(rootPath);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    setPendingExplorerReveal({ rootPath, path: directory.path });
    setSide("files");
  }, [closeQuickAccess, quickAccessRoot]);

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
    if (!active || !selectedProject) {
      watchedRootRef.current = "";
      void api.workbenchSetFileWatch({ rootPath: null }).catch(() => undefined);
      return;
    }
    watchedRootRef.current = "";
    void api.workbenchSetFileWatch({ rootPath: selectedProject })
      .then((result) => {
        if (projectPathKey(selectedProjectRef.current || "") !== projectPathKey(selectedProject)) return;
        watchedRootRef.current = result.rootPath || "";
        void fileExplorerRef.current?.refresh();
        return reconcileProjectEditors(selectedProject);
      })
      .catch((error) => setStatus({ text: statusError(error), kind: "error" }));
    return () => {
      watchedRootRef.current = "";
      void api.workbenchSetFileWatch({ rootPath: null }).catch(() => undefined);
    };
  }, [active, reconcileProjectEditors, selectedProject]);

  useEffect(() => {
    const api = desktopApi();
    if (typeof api.onWorkbenchFileSystemChanged !== "function") return;
    const unsubscribe = api.onWorkbenchFileSystemChanged((event) => {
      quickAccessCacheRef.current.delete(projectPathKey(event.rootPath));
      if (event.type === "error") {
        if (projectPathKey(event.rootPath) === projectPathKey(watchedRootRef.current)) {
          setStatus({ text: event.message, kind: "error" });
        }
        return;
      }
      if (!activeRef.current || projectPathKey(event.rootPath) !== projectPathKey(watchedRootRef.current)) return;
      void fileExplorerRef.current?.refresh();
      void reconcileProjectEditors(selectedProjectRef.current!);
    });
    return unsubscribe;
  }, [reconcileProjectEditors]);

  useEffect(() => {
    const onFocus = () => {
      if (!activeRef.current || !selectedProjectRef.current) return;
      void fileExplorerRef.current?.refresh();
      void reconcileProjectEditors(selectedProjectRef.current);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reconcileProjectEditors]);

  const runProjectSearch = useCallback(async (query: string, options?: { matchCase?: boolean; wholeWord?: boolean; useRegex?: boolean }) => {
    const trimmed = query.trim();
    if (!selectedProject || !trimmed) {
      searchSeqRef.current += 1;
      setSearchMatches([]);
      setSearchTruncated(false);
      setSearchError("");
      setSearchLoading(false);
      void desktopApi().workbenchSearchTextCancel().catch(() => undefined);
      return;
    }
    if (trimmed.length < 2 && !options?.useRegex && !searchUseRegex) {
      setSearchMatches([]);
      setSearchTruncated(false);
      setSearchError("");
      setSearchLoading(false);
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearchLoading(true);
    setSearchError("");
    try {
      const result = await desktopApi().workbenchSearchText({
        rootPath: selectedProject,
        query: trimmed,
        matchCase: options?.matchCase ?? searchMatchCase,
        wholeWord: options?.wholeWord ?? searchWholeWord,
        useRegex: options?.useRegex ?? searchUseRegex
      });
      if (seq !== searchSeqRef.current) return;
      setSearchMatches(result.matches);
      setSearchTruncated(result.truncated);
      const firstFiles = new Set<string>();
      for (const match of result.matches) {
        if (firstFiles.size >= 20) break;
        firstFiles.add(match.path);
      }
      setSearchExpanded(firstFiles);
    } catch (error) {
      if (seq !== searchSeqRef.current) return;
      if ((error as Error)?.name === "AbortError" || /cancel/i.test(String((error as Error)?.message || ""))) {
        setSearchLoading(false);
        return;
      }
      setSearchMatches([]);
      setSearchTruncated(false);
      setSearchError(t("desktop.workbench.searchFailed", statusError(error)));
    } finally {
      if (seq === searchSeqRef.current) setSearchLoading(false);
    }
  }, [searchMatchCase, searchUseRegex, searchWholeWord, selectedProject, t]);

  useEffect(() => {
    if (side !== "search") return;
    window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      void runProjectSearch(searchQuery);
    }, 300);
    return () => window.clearTimeout(searchTimerRef.current);
  }, [runProjectSearch, searchMatchCase, searchQuery, searchUseRegex, searchWholeWord, side, selectedProject]);

  useEffect(() => {
    if (side === "search") {
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
      return;
    }
    setSearchProjectMode(false);
    setSearchProjectQuery("");
  }, [side]);

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

  const collectGitRoots = useCallback((result: GitStatusResult, preferredRoot = ""): string[] => {
    const roots = new Set<string>();
    if (preferredRoot) roots.add(preferredRoot);
    if (result.root) roots.add(result.root);
    (result.nestedRepos || []).forEach((repo) => roots.add(repo.root));
    [...result.staged, ...result.unstaged].forEach((change) => {
      if (change.repoRoot) roots.add(change.repoRoot);
    });
    (result.tracking || []).forEach((item) => {
      if (item.repoRoot) roots.add(item.repoRoot);
    });
    return [...roots].filter(Boolean);
  }, []);

  const refreshGit = useCallback(async (withNotification = false) => {
    if (!selectedProject) return;
    if (gitStatusInFlightRef.current) {
      if (!withNotification) return;
      // Manual refresh waits for the in-flight call to finish, then runs once more.
      while (gitStatusInFlightRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
    }
    gitStatusInFlightRef.current = true;
    if (withNotification) setGitRefreshing(true);
    try {
      const result = await desktopApi().terminalGitStatus({
        cwd: selectedProject,
        nestedScan: {
          maxDepth: settings?.workbench?.gitNestedScanMaxDepth,
          ignoreDirs: settings?.workbench?.gitNestedScanIgnoreDirs
        }
      });
      setGit(result);
      const roots = collectGitRoots(result);
      gitRootsRef.current = roots;
      setGitRoot((current) => {
        if (current && roots.includes(current)) return current;
        return result.root || result.nestedRepos?.[0]?.root || roots[0] || "";
      });
      const nextChanges = [...result.staged, ...result.unstaged];
      setGitExpandedDirs((current) => {
        if (!gitExpandInitializedRef.current) {
          gitExpandInitializedRef.current = true;
          return expandedGitDirectories(nextChanges);
        }
        return reconcileExpandedGitDirectories(current, nextChanges);
      });
    } catch (error) {
      if (withNotification) notifyGitFailure("desktop.workbench.gitStatusRefreshFailed", error);
      else if (side === "git") setStatus({ text: gitOperationError(error), kind: "error" });
      // Silent background polls: ignore transient failures (no toast / status spam).
    } finally {
      gitStatusInFlightRef.current = false;
      if (withNotification) setGitRefreshing(false);
    }
  }, [collectGitRoots, notifyGitFailure, selectedProject, settings?.workbench?.gitNestedScanIgnoreDirs, settings?.workbench?.gitNestedScanMaxDepth, side]);

  // Re-fetch content for open diff panes whose underlying file changed on disk
  // so the diff stays live alongside the git tree. `changedPaths` holds the
  // absolute paths reported by the watcher; pass null to refresh every live
  // (non-commit) diff pane for the current project.
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
          // The working-tree/staged change is gone; close the now-empty pane.
          setDiffs((current) => current.filter((item) => item.key !== pane.key));
          setActivePanes((current) => {
            const projectKey = paneProjectKey(selectedProject);
            return current[projectKey] === pane.key ? { ...current, [projectKey]: "" } : current;
          });
        } else if (refreshed.oldText !== pane.oldText || refreshed.newText !== pane.newText) {
          // Skip state updates when the content is unchanged (e.g. a save that
          // wrote identical bytes) so the diff pane is not re-parsed and
          // re-highlighted on every filesystem event.
          setDiffs((current) => current.map((item) => item.key === pane.key ? { ...item, ...refreshed } : item));
        }
      } catch {
        // Transient failure (file briefly unavailable, repo churn): keep the
        // last rendered diff; the next change event re-attempts.
      }
    }));
  }, [selectedProject]);

  // Refresh the git tree promptly when project files change on disk (saves,
  // external edits, checkouts, discards) instead of waiting for the poll.
  const gitRefreshDebounceRef = useRef(0);
  // Absolute paths (normalized) of files changed within the debounce window,
  // so an open diff pane is re-fetched even when several change events coalesce.
  const gitDiffRefreshPendingRef = useRef<{ paths: Set<string>; fullRescan: boolean }>({
    paths: new Set(),
    fullRescan: false
  });
  useEffect(() => {
    const api = desktopApi();
    if (typeof api.onWorkbenchFileSystemChanged !== "function") return;
    const unsubscribe = api.onWorkbenchFileSystemChanged((event) => {
      if (event.type !== "change") return;
      if (!activeRef.current || projectPathKey(event.rootPath) !== projectPathKey(watchedRootRef.current)) return;
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

  const autoFetchGit = useCallback(async (force = false) => {
    if (!selectedProject || gitFetchInFlightRef.current) return;
    const now = Date.now();
    if (!force && now - gitLastFetchAtRef.current < GIT_AUTO_FETCH_MS) return;
    gitFetchInFlightRef.current = true;
    try {
      // Always refresh once when forcing so roots match the current project.
      if (force || !gitRootsRef.current.length) {
        await refreshGit(false);
      }
      const roots = gitRootsRef.current.slice(0, GIT_AUTO_FETCH_MAX_ROOTS);
      for (const root of roots) {
        try {
          await desktopApi().terminalGitFetch({ repoRoot: root });
        } catch {
          // Soft-fail per root (offline remotes, auth prompts, etc.).
        }
      }
      gitLastFetchAtRef.current = Date.now();
      await refreshGit(false);
    } finally {
      gitFetchInFlightRef.current = false;
    }
  }, [refreshGit, selectedProject]);

  // Reset cached roots/fetch clock when the selected project changes.
  useEffect(() => {
    gitRootsRef.current = [];
    gitLastFetchAtRef.current = 0;
    gitExpandInitializedRef.current = false;
    setGit(null);
    setGitRoot("");
    setGitExpandedDirs(new Set());
  }, [selectedProject]);

  // Keep status fresh while Workbench is active (Git side panel need not be open).
  useEffect(() => {
    if (!active || !selectedProject) return;
    void refreshGit(false);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshGit(false);
    }, GIT_STATUS_POLL_MS);
    return () => window.clearInterval(poll);
  }, [active, refreshGit, selectedProject]);

  // Periodic remote fetch while Workbench is active.
  useEffect(() => {
    if (!active || !selectedProject) return;
    void autoFetchGit(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void autoFetchGit(false);
    }, GIT_AUTO_FETCH_MS);
    return () => window.clearInterval(timer);
  }, [active, autoFetchGit, selectedProject]);

  // Focus / visibility: status immediately; fetch only if stale.
  useEffect(() => {
    if (!active || !selectedProject) return;
    const onFocus = () => {
      void refreshGit(false);
      void autoFetchGit(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, autoFetchGit, refreshGit, selectedProject]);

  const openDiff = async (change: GitChange, staged: boolean) => {
    if (!selectedProject) return;
    const key = `diff:${change.repoRoot}:${change.repoPath}:${staged}`;
    if (diffs.some((item) => item.key === key)) { setActivePane(key); return; }
    try {
      const result = await desktopApi().terminalGitDiffSides({ cwd: change.repoRoot, path: change.repoPath, staged });
      const source = staged ? "staged" : change.status === "?" ? "untracked" : "working-tree";
      setDiffs((current) => [...current, {
        key,
        projectPath: selectedProject,
        repoRoot: change.repoRoot,
        repoPath: change.repoPath,
        path: change.path,
        source,
        ...result
      }]);
      setActivePane(key);
    } catch (error) { notifyGitFailure("desktop.workbench.sidePanelDiffFailed", error); }
  };

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
    if (!window.confirm(confirmMessage)) return;
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
    if (!window.confirm(confirmMessage)) return;
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
    if (!window.confirm(confirmMessage)) return;
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
        repoRoot,
        repoPath: path,
        path,
        source: "commit",
        ...result
      }]);
      setActivePane(key);
    } catch (error) { notifyGitFailure("desktop.workbench.sidePanelDiffFailed", error); }
  };

  const toggleGitDirectory = (path: string) => {
    setGitExpandedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const gitRepositories = useMemo(() => {
    const roots = new Set<string>();
    if (git?.root) roots.add(git.root);
    git?.nestedRepos?.forEach((repository) => roots.add(repository.root));
    [...(git?.staged || []), ...(git?.unstaged || [])].forEach((change) => roots.add(change.repoRoot));
    return [...roots].filter(Boolean).sort((left, right) => left.localeCompare(right)).map((root) => ({
      root,
      label: git?.nestedRepos?.find((repository) => repository.root === root)?.displayPath || basename(root)
    }));
  }, [git]);

  // IDEA-style sync: pull remote changes when behind, push local commits when
  // ahead, and fetch to check for updates when the branch is already in sync.
  const syncGitBranch = async () => {
    const root = trackingForRoot(git, gitRoot);
    const repoRoot = gitRoot || root?.repoRoot;
    if (!repoRoot) return;
    setGitSyncing(true);
    try {
      if (root && root.behind > 0) await desktopApi().terminalGitPull({ repoRoot });
      if (root && root.ahead > 0) await desktopApi().terminalGitPush({ repoRoot });
      if (!root || (root.ahead <= 0 && root.behind <= 0)) await desktopApi().terminalGitFetch({ repoRoot });
      notifyGitSuccess("desktop.workbench.gitSyncSucceeded");
      await refreshGit();
      currentTerminals.forEach((pane) => void refreshTerminalGit(pane.key));
    } catch (error) { notifyGitFailure("desktop.workbench.gitSyncFailed", error); }
    finally { setGitSyncing(false); }
  };

  const checkoutGitPanelBranch = async (selection: { branch: string; remote?: string }) => {
    if (!gitRoot || !selection.branch) return;
    try {
      await desktopApi().terminalGitCheckout({ cwd: gitRoot, ...selection, repoRoot: gitRoot });
      await refreshGit();
      currentTerminals.forEach((pane) => void refreshTerminalGit(pane.key));
      const displayBranch = selection.remote ? `${selection.remote}/${selection.branch}` : selection.branch;
      notifyGitSuccess("desktop.workbench.checkoutBranchSucceeded", displayBranch);
    } catch (error) { notifyGitFailure("desktop.workbench.checkoutBranchFailed", error); }
  };

  const toggleGitStage = useCallback(async (targets: GitStageTarget | GitStageTarget[], targetStaged: boolean) => {
    const groups = normalizeGitStageTargets(targets);
    if (!groups.length || gitStageBusyRef.current) return;
    gitStageBusyRef.current = true;
    try {
      for (const group of groups) {
        if (targetStaged) await desktopApi().terminalGitStage({ repoRoot: group.repoRoot, paths: group.paths });
        else await desktopApi().terminalGitUnstage({ repoRoot: group.repoRoot, paths: group.paths });
      }
      await refreshGit();
      currentTerminals.forEach((pane) => void refreshTerminalGit(pane.key));
    } catch (error) {
      notifyGitFailure(targetStaged ? "desktop.workbench.gitStageFailed" : "desktop.workbench.gitUnstageFailed", error);
      await refreshGit();
    } finally {
      gitStageBusyRef.current = false;
    }
  }, [notifyGitFailure, refreshGit]);

  const stagedCommitPaths = useMemo(() => {
    if (!gitRoot || !git) return [] as string[];
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const change of git.staged) {
      if (change.repoRoot !== gitRoot || seen.has(change.repoPath)) continue;
      seen.add(change.repoPath);
      paths.push(change.repoPath);
    }
    return paths;
  }, [git, gitRoot]);

  const canCommit = Boolean(gitRoot && commitMessage.trim() && stagedCommitPaths.length && !commitBusy);

  const suggestCommit = async () => {
    if (!gitRoot || !stagedCommitPaths.length) return;
    try {
      setCommitBusy(true);
      setCommitSuggestion(null);
      const result = await desktopApi().terminalGitSuggestCommit({ repoRoot: gitRoot, paths: stagedCommitPaths });
      setCommitMessage(result.message);
      setCommitSuggestion(result);
    } catch (error) { notifyGitFailure("desktop.workbench.gitCommitGenerateFailed", error); }
    finally { setCommitBusy(false); }
  };

  const notifySkippedSubmodules = (result: { ok: boolean; skipped?: string[] } | undefined) => {
    if (!result?.skipped?.length) return;
    const text = t("desktop.workbench.gitCommitSkippedSubmodules", result.skipped.join(", "));
    setStatus({ text, kind: "warning" });
    notifyDesktop({ text, kind: "info" });
  };

  const commit = async (pushAfter = false) => {
    if (!gitRoot || !commitMessage.trim() || !stagedCommitPaths.length) return;
    let result: { ok: boolean; skipped?: string[] } | undefined;
    try {
      setCommitBusy(true);
      result = await desktopApi().terminalGitCommit({
        repoRoot: gitRoot,
        message: commitMessage.trim(),
        paths: stagedCommitPaths
      });
    } catch (error) {
      notifyGitFailure("desktop.workbench.gitCommitFailed", error);
      setCommitBusy(false);
      return;
    }
    setCommitSuggestion(null);
    if (pushAfter) {
      try {
        await desktopApi().terminalGitPush({ repoRoot: gitRoot });
        notifySkippedSubmodules(result);
        notifyGitSuccess("desktop.workbench.gitCommitAndPushSucceeded");
        setCommitMessage("");
      } catch (error) { notifyGitFailure("desktop.workbench.gitCommitSucceededPushFailed", error); }
    } else {
      notifySkippedSubmodules(result);
      notifyGitSuccess("desktop.workbench.gitCommitSucceeded");
      setCommitMessage("");
    }
    await refreshGit();
    currentTerminals.forEach((pane) => void refreshTerminalGit(pane.key));
    setCommitBusy(false);
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
    if (!selectedProject) return;
    const projectRoot = selectedProject;
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

  const openGitLogContextMenu = (event: React.MouseEvent, commit: GitLogCommit) => {
    event.preventDefault();
    const branchTarget = event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-branch-name]")
      : null;
    setGitLogContextMenu({
      x: event.clientX,
      y: event.clientY,
      commit,
      branchName: branchTarget?.dataset.branchName || gitCommitBranchNames(commit)[0] || null
    });
  };

  const copyGitLogValue = (value: string) => {
    desktopApi().clipboardWriteText?.(value);
    setGitLogContextMenu(null);
  };

  const revertGitLogCommit = async (commit: GitLogCommit) => {
    const repoRoot = gitHistoryContext?.repoRoot || gitRoot;
    if (!repoRoot) return;
    const label = commit.subject || commit.shortHash;
    if (!window.confirm(t("desktop.workbench.gitRevertConfirm", label))) return;
    setGitLogContextMenu(null);
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
    if (!window.confirm(t("desktop.workbench.gitMergeConfirm", label))) return;
    setGitLogContextMenu(null);
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
    if (!window.confirm(t("desktop.workbench.gitCherryPickConfirm", label))) return;
    setGitLogContextMenu(null);
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
    if (!window.confirm(t("desktop.workbench.gitCheckoutCommitConfirm", label))) return;
    setGitLogContextMenu(null);
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
    if (!window.confirm(t("desktop.workbench.gitResetConfirm", label, t(`desktop.workbench.gitResetMode${mode === "soft" ? "Soft" : mode === "mixed" ? "Mixed" : "Hard"}`)))) return;
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
    setGitLogContextMenu(null);
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
      const pane = terminalsRef.current.find((item) => item.ptyId === id);
      if (pane?.group === "session") {
        tuiLastOutputAtRef.current.set(pane.key, Date.now());
        scheduleTuiSample();
      }
    });
    const exited = desktopApi().onTerminalExit(({ id }) => {
      terminalRefs.current.get(id)?.write(`\r\n${t("desktop.workbench.terminalClosed")}\r\n`);
      const pane = terminalsRef.current.find((item) => item.ptyId === id);
      if (pane) scheduleSessionPaneAutoRename(pane);
    });
    const respawned = desktopApi().onTerminalRespawned(({ id }) => terminalRefs.current.get(id)?.write(`\r\n${t("desktop.workbench.shellRestored")}\r\n`));
    return () => { data(); exited(); respawned(); };
  }, [scheduleSessionPaneAutoRename, scheduleTuiSample, t]);

  const changes = git ? [{ title: t("desktop.workbench.sidePanelStaged"), staged: true, entries: git.staged }, { title: t("desktop.workbench.sidePanelChanges"), staged: false, entries: git.unstaged }] : [];
  const searchGroups = useMemo(() => {
    const groups: Array<{ path: string; relativePath: string; matches: SearchMatch[] }> = [];
    const indexByPath = new Map<string, number>();
    for (const match of searchMatches) {
      const existing = indexByPath.get(match.path);
      if (existing === undefined) {
        indexByPath.set(match.path, groups.length);
        groups.push({ path: match.path, relativePath: match.relativePath, matches: [match] });
      } else {
        groups[existing].matches.push(match);
      }
    }
    return groups;
  }, [searchMatches]);
  const searchFileCount = searchGroups.length;
  const searchMatchCount = searchMatches.length;
  const openTranscriptSide = (forceOpen = false) => {
    if (!forceOpen && side === "transcript") {
      setSide(null);
      return;
    }
    if (sideWidth === DEFAULT_SIDE_WIDTH) {
      setSideWidth(TRANSCRIPT_SIDE_WIDTH);
      localStorage.setItem(SIDE_WIDTH_KEY, String(TRANSCRIPT_SIDE_WIDTH));
    }
    setSide("transcript");
  };
  const setWidth = (kind: "folders" | "list" | "side", delta: number) => {
    const current = kind === "folders" ? foldersWidth : kind === "list" ? listWidth : sideWidth;
    const limits = kind === "folders" ? [140, 560] : kind === "list" ? [240, 720] : [240, 840];
    const next = Math.max(limits[0], Math.min(limits[1], current + delta));
    if (kind === "folders") { setFoldersWidth(next); localStorage.setItem(FOLDERS_WIDTH_KEY, String(next)); }
    else if (kind === "list") { setListWidth(next); localStorage.setItem(LIST_WIDTH_KEY, String(next)); }
    else { setSideWidth(next); localStorage.setItem(SIDE_WIDTH_KEY, String(next)); }
  };

  const contextMenuWidth = contextMenu?.kind === "session" || contextMenu?.kind === "session-tab" ? 210 : 240;
  const contextMenuHeight = contextMenu?.kind === "session-tab" || contextMenu?.kind === "editor-tab"
    ? 64
    : contextMenu?.kind === "session"
        ? 462
        : contextMenu?.kind === "folder"
          ? 160
          : 320;
  const contextMenuLeft = contextMenu
    ? Math.max(8, Math.min(contextMenu.x, window.innerWidth - contextMenuWidth - 8))
    : 8;

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
          if (!currentEditor.dirty || window.confirm(t("desktop.workbench.fileReloadConfirm"))) {
            void reloadEditorFromDisk(currentEditor.key);
          }
        }}>{t("desktop.workbench.fileReload")}</button>
        <button type="button" disabled={editorSettings?.editable === false} onClick={() => void saveEditor(currentEditor.key, true)}>{t("desktop.workbench.fileOverwrite")}</button>
      </> : currentEditor.diskState === "deleted" ?
        <button type="button" disabled={editorSettings?.editable === false} onClick={() => {
          if (window.confirm(t("desktop.workbench.fileRecreateConfirm", basename(currentEditor.path)))) {
            void recreateEditorFile(currentEditor.key);
          }
        }}>{t("desktop.workbench.fileRecreate")}</button>
        : <button type="button" onClick={() => void desktopApi().workbenchOpenPath({
          rootPath: currentEditor.projectPath,
          filePath: currentEditor.path
        })}>{t("desktop.workbench.fileOpenDefault")}</button>}
    </div>
  </div> : null;

  const quickAccessRecentPaths = (paneHistoryRef.current[paneProjectKey(quickAccessRoot)] || [])
    .filter((key) => key.startsWith("editor:"))
    .map((key) => key.slice("editor:".length));
  const quickAccessVisibleFiles = useMemo(() => {
    if (!quickAccessSearchFiles.length) return quickAccessFiles;
    const byPath = new Map(quickAccessFiles.map((entry) => [entry.path, entry]));
    for (const entry of quickAccessSearchFiles) byPath.set(entry.path, entry);
    return [...byPath.values()];
  }, [quickAccessFiles, quickAccessSearchFiles]);
  const quickAccessProjects = useMemo<QuickAccessProject[]>(() => allProjects.map((project) => ({
    id: project.id,
    path: project.path,
    label: project.label,
    detail: project.pathMissing
      ? t("desktop.workbench.pathMissingLabel", project.portableKey)
      : project.path,
    pinned: project.pinned,
    disabledReason: project.pathMissing ? t("desktop.workbench.pathMissingHint") : undefined
  })), [allProjects, t]);
  const searchProjectResults = useMemo(
    () => rankQuickAccessProjects(quickAccessProjects, searchProjectQuery),
    [quickAccessProjects, searchProjectQuery]
  );
  const searchProjectResultIds = searchProjectResults.map((project) => project.id);
  const searchProjectResultSignature = searchProjectResultIds.join("\0");
  const searchProjectCurrentPath = selectedProjectMeta?.path || selectedProject || "";
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
    selectProject(project.path, { keepSide: true });
    leaveSearchProjectMode();
  };
  const searchProjectLabel = selectedProjectMeta
    ? `${selectedProjectMeta.label} — ${selectedProjectMeta.path}`
    : t("desktop.workbench.quickAccessSelectProject");
  const noProjectReason = quickAccessRoot ? undefined : t("desktop.workbench.quickAccessNoProjectCommand");
  const macShortcuts = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const shortcut = (key: string) => macShortcuts ? `⌘${key}` : `Ctrl+${key}`;
  const openWorkbenchView = (view?: SideView) => {
    closeQuickAccess();
    if (quickAccessRoot) selectProject(quickAccessRoot);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    if (view) setSide(view);
    if (view === "search") {
      setSearchProjectMode(false);
      setSearchProjectQuery("");
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  };
  const navigateTo = (tab: "report" | "agent" | "workbench" | "notes") => {
    closeQuickAccess();
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: tab }));
  };
  const quickAccessCommands: QuickAccessCommand[] = [
    {
      id: "file.goToFile",
      label: t("desktop.workbench.quickAccessGoToFile"),
      keywords: "quick open file path",
      shortcut: shortcut("P"),
      disabledReason: noProjectReason,
      run: () => {
        setQuickAccessMode("files");
        setQuickAccessQuery("");
        if (quickAccessRoot) void loadQuickAccessFiles(quickAccessRoot);
      }
    },
    {
      id: "workbench.switchProject",
      label: t("desktop.workbench.quickAccessSwitchProject"),
      keywords: "project workspace switch select",
      run: () => enterQuickAccessProjectMode(true)
    },
    { id: "file.findInFiles", label: t("desktop.workbench.quickAccessFindInFiles"), keywords: "search project content", shortcut: macShortcuts ? "⌘⇧F" : "Ctrl+Shift+F", disabledReason: noProjectReason, run: () => openWorkbenchView("search") },
    { id: "file.save", label: t("desktop.workbench.quickAccessSaveCurrentFile"), keywords: "write editor", shortcut: shortcut("S"), disabledReason: currentEditor ? undefined : t("desktop.workbench.quickAccessNoActiveEditor"), run: () => { closeQuickAccess(); if (currentEditor) void saveEditor(currentEditor.key); } },
    { id: "file.closePane", label: t("desktop.workbench.quickAccessCloseActivePane"), keywords: "close tab terminal editor", shortcut: shortcut("W"), disabledReason: active && activePane ? undefined : t("desktop.workbench.quickAccessNoActivePane"), run: () => { closeQuickAccess(); closeActivePane(); } },
    { id: "workbench.newSession", label: t("desktop.workbench.quickAccessNewSession"), keywords: "agent", disabledReason: noProjectReason, run: () => { openWorkbenchView(); if (quickAccessRoot) void newSessionForProject(quickAccessRoot); } },
    { id: "workbench.newTerminal", label: t("desktop.workbench.quickAccessNewTerminal"), keywords: "shell", disabledReason: noProjectReason, run: () => { openWorkbenchView(); if (quickAccessRoot) void openBlankTerminal(quickAccessRoot); } },
    { id: "workbench.explorer", label: t("desktop.workbench.quickAccessShowExplorer"), keywords: "files sidebar", disabledReason: noProjectReason, run: () => openWorkbenchView("files") },
    { id: "workbench.scripts", label: t("desktop.workbench.quickAccessShowScripts"), keywords: "run package", disabledReason: noProjectReason, run: () => openWorkbenchView("scripts") },
    { id: "workbench.search", label: t("desktop.workbench.quickAccessShowSearch"), keywords: "find content sidebar", disabledReason: noProjectReason, run: () => openWorkbenchView("search") },
    { id: "workbench.git", label: t("desktop.workbench.quickAccessShowGit"), keywords: "changes source control", disabledReason: noProjectReason, run: () => openWorkbenchView("git") },
    { id: "view.report", label: t("desktop.workbench.quickAccessShowReport"), keywords: "navigate tab", run: () => navigateTo("report") },
    { id: "view.agent", label: t("desktop.workbench.quickAccessShowAgent"), keywords: "navigate tab", run: () => navigateTo("agent") },
    { id: "view.workbench", label: t("desktop.workbench.quickAccessShowWorkbench"), keywords: "navigate tab", run: () => navigateTo("workbench") },
    { id: "view.notes", label: t("desktop.workbench.quickAccessShowNotes"), keywords: "navigate tab", run: () => navigateTo("notes") },
    { id: "app.sessions", label: t("desktop.workbench.quickAccessOpenSessions"), keywords: "history reference", run: () => { closeQuickAccess(); window.dispatchEvent(new Event("agent-resume:sessions-open")); } },
    { id: "app.settings", label: t("desktop.workbench.quickAccessOpenSettings"), keywords: "preferences configuration", shortcut: shortcut(","), run: () => { closeQuickAccess(); void desktopApi().openSettingsWindow({ pane: "general" }); } }
  ];

  const newSessionAnchorRect = newSessionButtonRef.current?.getBoundingClientRect();
  const newSessionPickerStyle = newSessionAnchorRect
    ? {
        left: Math.max(8, Math.min(newSessionAnchorRect.left, window.innerWidth - 248)),
        top: Math.min(newSessionAnchorRect.bottom + 4, window.innerHeight - 360)
      }
    : { left: 8, top: 48 };

  const startFolderExpand = (folderId: string, hasChildren: boolean, expanded: boolean) => {
    window.clearTimeout(folderExpandTimerRef.current);
    if (!hasChildren || expanded) return;
    folderExpandTimerRef.current = window.setTimeout(() => {
      setExpandedFolderIds((current) => {
        if (current.has(folderId)) return current;
        const next = new Set(current);
        next.add(folderId);
        return next;
      });
    }, 600);
  };

  const clearWorkbenchDrag = () => {
    window.clearTimeout(folderExpandTimerRef.current);
    draggedSessionRef.current = null;
    setDraggedSessionKey(null);
    setDragTargetKey(null);
  };

  const assignDraggedSessionToFolder = async (project: WorkbenchProject, folderId: string | null) => {
    const session = draggedSessionRef.current;
    if (!session) return;
    if (!sessionBelongsToProject(session, project)) return;
    clearWorkbenchDrag();
    try {
      if (folderId) {
        await desktopApi().assignWorkbenchSessionToFolder({
          projectId: project.id,
          provider: session.provider,
          agentSessionId: session.id,
          folderId
        });
      } else {
        await desktopApi().removeWorkbenchSessionFromFolder({
          provider: session.provider,
          agentSessionId: session.id
        });
      }
      await reloadWorkbench();
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  };

  const handleFolderDragOver = (
    event: React.DragEvent,
    project: WorkbenchProject,
    folderId: string | null,
    hasChildren = false,
    expanded = false
  ) => {
    const session = draggedSessionRef.current;
    if (!session) return;
    if (!sessionBelongsToProject(session, project)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTargetKey(`${project.id}:${folderId || UNCLASSIFIED_FOLDER_ID}`);
    if (folderId && hasChildren && !expanded) startFolderExpand(folderId, true, false);
  };

  const handleFolderDragLeave = (event: React.DragEvent, project: WorkbenchProject, folderId: string | null) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    window.clearTimeout(folderExpandTimerRef.current);
    setDragTargetKey((current) => current === `${project.id}:${folderId || UNCLASSIFIED_FOLDER_ID}` ? null : current);
  };

  const handleFolderDrop = (event: React.DragEvent, project: WorkbenchProject, folderId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    void assignDraggedSessionToFolder(project, folderId);
  };

  const renderProjectFolderRows = (project: WorkbenchProject, parentId: string | null, depth = 0): ReactNode => {
    const children = project.folders
      .filter((folder) => (folder.parentId || null) === parentId)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    if (!children.length) return null;
    const assignmentCounts = new Map<string, number>();
    for (const assignment of project.folderAssignments) {
      assignmentCounts.set(assignment.folderId, (assignmentCounts.get(assignment.folderId) || 0) + 1);
    }
    return children.map((folder) => {
      const hasChildren = project.folders.some((candidate) => candidate.parentId === folder.folderId);
      const expanded = expandedFolderIds.has(folder.folderId);
      return <Fragment key={folder.folderId}>
      <button
        type="button"
        className={`wb-folder-row wb-session-folder-row${selectedProject === project.path && selectedFolderId === folder.folderId ? " active" : ""}${dragTargetKey === `${project.id}:${folder.folderId}` ? " is-drop-target" : ""}`}
        style={{ paddingLeft: `${18 + depth * 16}px` }}
        onContextMenu={(event) => folderMenu(event, project, folder)}
        onDragOver={(event) => handleFolderDragOver(event, project, folder.folderId, hasChildren, expanded)}
        onDragLeave={(event) => handleFolderDragLeave(event, project, folder.folderId)}
        onDrop={(event) => handleFolderDrop(event, project, folder.folderId)}
        onClick={() => selectProjectFolder(project, folder.folderId)}
        title={folder.name}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        <span
          className={`wb-session-folder-chevron${expanded ? " is-expanded" : ""}${hasChildren ? " has-children" : ""}`}
          onClick={(event) => {
            if (!hasChildren) return;
            event.preventDefault();
            event.stopPropagation();
            setExpandedFolderIds((current) => {
              const next = new Set(current);
              if (next.has(folder.folderId)) next.delete(folder.folderId);
              else next.add(folder.folderId);
              return next;
            });
          }}
        ><ThemeIcon name="chevron-right" size={12} aria-hidden="true" /></span>
        <ThemeIcon name="folder" size={14} aria-hidden="true" />
        <span className="wb-folder-row-label">{folder.name}</span>
        <span className="wb-folder-row-count">{assignmentCounts.get(folder.folderId) || 0}</span>
      </button>
      {expanded ? renderProjectFolderRows(project, folder.folderId, depth + 1) : null}
    </Fragment>;
    });
  };

  const paneTabGroups = <div className="wb-pane-tab-groups">
    <div className="wb-terminal-tabs is-session-group" data-pane-group="session">
      <button ref={newSessionButtonRef} type="button" className={`wb-pane-tab-group-label${terminalCreating ? " is-busy" : ""}`} disabled={terminalCreating} aria-label={t("desktop.workbench.newSession")} title={t("desktop.workbench.newSession")} aria-haspopup="menu" aria-expanded={Boolean(newSessionPicker)} onClick={() => { if (newSessionPicker) setNewSessionPicker(null); else void newSession(); }}>{terminalCreating ? <ThemeIcon name="loader" className="spin" size={13} aria-hidden="true" /> : <ThemeIcon name="bot" size={13} aria-hidden="true" />}</button>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.tabGroupSession")}>
        {currentSessionTerminals.map((pane) => <div className={`wb-terminal-tab is-session${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key} onContextMenu={(event) => sessionTabMenu(event, terminalSessionNoteTarget(pane, aliases[pane.projectPath] || basename(pane.projectPath)), pane.key)}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ProviderIcon provider={sessionIdentityFromKey(pane.sessionKey)?.provider || ""} size={13} aria-hidden="true" />{sessionTabTitle(pane, sessionTitles)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeTerminal")} onClick={() => closeTerminal(pane.key)}><ThemeIcon name="close" size={13} /></button></div>)}
        {currentAcpChats.map((pane) => <div className={`wb-terminal-tab is-session is-acp${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key} onContextMenu={(event) => sessionTabMenu(event, acpSessionNoteTarget(pane, aliases[pane.projectPath] || basename(pane.projectPath)), pane.key)}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ProviderIcon provider={pane.provider} size={13} aria-hidden="true" />{sessionTabTitle(pane, sessionTitles)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeAcpChat")} onClick={() => closeAcpChat(pane.key)}><ThemeIcon name="close" size={13} /></button></div>)}
      </div>
    </div>
    <div className="wb-terminal-tabs is-terminal-group" data-pane-group="terminal">
      <button type="button" className={`wb-pane-tab-group-label${terminalCreating ? " is-busy" : ""}`} disabled={terminalCreating} aria-label={t("desktop.workbench.newTerminal")} title={t("desktop.workbench.newTerminal")} onClick={() => void openBlankTerminal()}>{terminalCreating ? <ThemeIcon name="loader" className="spin" size={13} aria-hidden="true" /> : <ThemeIcon name="terminal" size={13} aria-hidden="true" />}</button>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.tabGroupTerminal")}>
        {currentShellTerminals.map((pane) => <div className={`wb-terminal-tab is-terminal${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="terminal" size={13} aria-hidden="true" />{pane.title}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeTerminal")} onClick={() => closeTerminal(pane.key)}><ThemeIcon name="close" size={13} /></button></div>)}
      </div>
    </div>
    {currentEditors.length || currentDiffs.length ? <div className="wb-terminal-tabs is-code-group" data-pane-group="code">
      <div className="wb-pane-tab-group-label" aria-label={t("desktop.workbench.tabGroupCode")} title={t("desktop.workbench.tabGroupCode")}><ThemeIcon name="file-code" size={13} aria-hidden="true" /></div>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.tabGroupCode")}>
        {currentEditors.map((pane) => <div className={`wb-terminal-tab is-editor${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key} onContextMenu={(event) => editorTabMenu(event, pane)}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="file-code" size={13} aria-hidden="true" />{pane.dirty ? "* " : ""}{basename(pane.path)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeFile")} onClick={() => closeEditor(pane.key)}><ThemeIcon name="close" size={13} /></button></div>)}
        {currentDiffs.map((pane) => <div className={`wb-terminal-tab is-diff${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="file-diff" size={13} aria-hidden="true" />{basename(pane.path)}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeDiff")} onClick={() => closeDiff(pane.key)}><ThemeIcon name="close" size={13} /></button></div>)}
      </div>
    </div> : null}
    <div className="wb-terminal-tabs is-browser-group" data-pane-group="browser">
      <button type="button" className="wb-pane-tab-group-label" aria-label={t("desktop.browser.newBrowser")} title={t("desktop.browser.newBrowser")} onClick={() => void openBrowser()}><ThemeIcon name="globe" size={13} aria-hidden="true" /></button>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.tabGroupBrowser")}>
        {currentBrowsers.map((pane) => <div className={`wb-terminal-tab is-browser${activePane === pane.key ? " active" : ""}${pane.surfaceKind === "window" ? " is-popped-out" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="globe" size={13} aria-hidden="true" />{pane.title}</button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.browser.closeBrowser")} onClick={() => closeBrowser(pane.key)}><ThemeIcon name="close" size={13} /></button></div>)}
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
    ><span className={`wb-git-graph-node wb-git-graph-lane-${gitLog?.layout.rows[index]?.colorIndex ?? 0}`}><ThemeIcon name="circle" size={10} fill="currentColor" /></span><span className="wb-git-log-graph-content"><GitCommitBranches commit={commit} /><span className="wb-git-log-subject">{commit.subject || t("desktop.workbench.gitLogUntitled")}</span><span className="wb-git-log-meta"><span className="wb-git-log-hash">{commit.shortHash}</span><span className="wb-git-log-meta-sep">·</span><span>{commit.author}</span><span className="wb-git-log-meta-sep">·</span><span>{formatGitCommitDate(commit.date, locale)}</span></span></span></button>;
  };

  if (!host) return null;

  // Detail head + folder-collapse toggle live in the app header while Workbench is active.
  const headerSlot = document.getElementById("app-header-slot");
  const collapseToggle = (
    <button type="button" className={`sidebar-collapse-toggle${foldersCollapsed ? " is-active" : ""}`} aria-label={t("desktop.workbench.resizeProjects")} onClick={() => setFoldersCollapsed((current) => { const next = !current; localStorage.setItem(FOLDERS_COLLAPSED_KEY, String(next)); return next; })}><ThemeIcon name="panel-right" size={17} /></button>
  );
  const detailHead = (
    <div className="wb-detail-head">
      <span className="wb-detail-project-label">
        <span className="wb-detail-project-label-text">{selectedProject ? aliases[selectedProject] || basename(selectedProject) : t("desktop.workbench.allSessions")}</span>
        {selectedProject ? <span className="wb-detail-project-path">{selectedProject}</span> : null}
      </span>
      <div className="wb-detail-head-actions">
        {branchStatusLabel && branchStatusPane ? (
          <div className="wb-terminal-status">
            <button
              type="button"
              className="wb-terminal-status-branch"
              title={branchStatusNested
                ? branchStatusPane.nestedRepos?.map((repo) => `${repo.displayPath || repo.root}: ${repo.branch || "-"}`).join(", ")
                : branchStatusLabel}
              onClick={(event) => void openBranchMenu(branchStatusPane, event.currentTarget)}
            >
              <ThemeIcon name="git-branch" size={12} aria-hidden="true" />
              <span className="wb-terminal-status-branch-label">{branchStatusLabel}</span>
            </button>
          </div>
        ) : null}
        <div className="wb-detail-tools">
          <button type="button" className={`wb-detail-tool${side === "files" ? " active" : ""}`} aria-pressed={side === "files"} aria-label={t("desktop.workbench.sidePanelExplorer")} title={t("desktop.workbench.sidePanelExplorer")} onClick={() => setSide((current) => current === "files" ? null : "files")}><ThemeIcon name="folder-tree" size={16} /></button>
          <button type="button" className={`wb-detail-tool${side === "scripts" ? " active" : ""}`} aria-pressed={side === "scripts"} aria-label={t("desktop.workbench.sidePanelScripts")} title={t("desktop.workbench.sidePanelScripts")} onClick={() => setSide((current) => current === "scripts" ? null : "scripts")}><ThemeIcon name="play" size={16} /></button>
          <button type="button" className={`wb-detail-tool${side === "search" ? " active" : ""}`} aria-pressed={side === "search"} aria-label={t("desktop.workbench.sidePanelSearch")} title={t("desktop.workbench.sidePanelSearch")} onClick={() => setSide((current) => current === "search" ? null : "search")}><ThemeIcon name="search" size={16} /></button>
          <button type="button" className={`wb-detail-tool${side === "linkgraph" ? " active" : ""}`} aria-pressed={side === "linkgraph"} aria-label={t("desktop.workbench.sidePanelLinkGraph")} title={t("desktop.workbench.sidePanelLinkGraph")} onClick={() => setSide((current) => current === "linkgraph" ? null : "linkgraph")}><ThemeIcon name="waypoints" size={16} /></button>
          {activeTranscriptTarget ? <button type="button" className={`wb-detail-tool${side === "transcript" ? " active" : ""}`} aria-pressed={side === "transcript"} aria-label={t("desktop.workbench.sidePanelTranscript")} title={t("desktop.workbench.sidePanelTranscript")} onClick={() => openTranscriptSide()}><ThemeIcon name="history" size={16} /></button> : null}
          <button type="button" className={`wb-detail-tool${side === "git" ? " active" : ""}`} aria-pressed={side === "git"} aria-label={t("desktop.workbench.sidePanelGit")} title={t("desktop.workbench.sidePanelGit")} onClick={() => setSide((current) => current === "git" ? null : "git")}><ThemeIcon name="git-branch" size={16} /></button>
        </div>
      </div>
    </div>
  );

  return createPortal(<><section className="panel workbench-panel react-workbench-panel" hidden={!active}>
    <div className="workbench-layout" style={{ "--sidebar-folders-width": `${foldersCollapsed ? 0 : foldersWidth}px`, "--wb-list-width": `${listWidth}px`, "--wb-side-panel-width": `${sideWidth}px` } as React.CSSProperties}>
      <aside className={`sidebar-folders-pane wb-folders-pane${foldersCollapsed ? " is-collapsed" : ""}`}>
        <div className="sidebar-project-filter-wrap">
          <SegmentedControl aria-label={t("desktop.workbench.sidebarView")} value={sidebarView} options={["projects", "gtd", "tags"] as const satisfies readonly WorkbenchSidebarView[]} onChange={selectSidebarView} getLabel={(view) => t(view === "projects" ? "desktop.workbench.projectsView" : view === "gtd" ? "desktop.workbench.gtdView" : "desktop.workbench.tagsView")} className="sidebar-project-filter-segmented wb-sidebar-view-segmented" />
          <div className="sidebar-project-search-wrap"><input type="search" className="sidebar-project-search" aria-label={t(sidebarView === "projects" ? "desktop.workbench.filterProjects" : sidebarView === "gtd" ? "desktop.workbench.filterGtdSessions" : "desktop.workbench.filterTags")} placeholder={t(sidebarView === "projects" ? "desktop.workbench.filterProjects" : sidebarView === "gtd" ? "desktop.workbench.filterGtdSessions" : "desktop.workbench.filterTags")} value={projectQuery} autoComplete="off" spellCheck={false} onChange={(event) => setProjectQuery(event.target.value)} /></div>
          {sidebarView === "projects" ? <SegmentedControl
              aria-label={t("desktop.notes.projectFilter")}
              value={projectFilter}
              options={["all", "pinned", "active"] as const satisfies readonly ProjectFilter[]}
              onChange={setProjectFilter}
              getLabel={(filter) => t(`desktop.common.${filter}`)}
            /> : null}
          {sidebarView === "tags" ? <div className="wb-tag-category-pills" role="listbox" aria-label={t("desktop.workbench.allTagCategories")}>
            {TAG_CATEGORY_FILTERS.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`wb-tag-category-pill${tagCategoryFilter === cat ? " active" : ""}`}
                onClick={() => setTagCategoryFilter(cat)}
              >
                {cat === "all" ? t("desktop.workbench.allTagCategories") : t(`desktop.tagging.category.${cat}`)}
              </button>
            ))}
          </div> : null}
        </div>
        <div className="wb-folders">
          {sidebarView === "projects" ? <>
            <button type="button" className={`wb-folder-row${!selectedProject ? " active" : ""}`} onClick={() => selectProject(null)}><span className="wb-folder-row-label">{t("desktop.workbench.allSessions")}</span></button>
            <div className="wb-folder-section">
              <div className="wb-folder-section-head">
                <div className="wb-folder-section-label">{t("desktop.notes.projectFilter")}</div>
                <button type="button" className="wb-icon-btn wb-add-project-btn" aria-label={t("desktop.workbench.addProject")} title={t("desktop.workbench.addProject")} onClick={() => void addProject()}><ThemeIcon name="plus" size={14} /></button>
              </div>
              {projects.length ? projects.map((project) => {
              const assignedCount = new Set(project.folderAssignments.map((assignment) => folderAssignmentKey(assignment.provider, assignment.agentSessionId))).size;
              const unclassifiedCount = Math.max(0, project.sessionCount - assignedCount) + project.pendingCount;
              const projectExpanded = expandedProjectIds.has(project.id);
              return <Fragment key={project.id}>
                <button type="button" className={`wb-folder-row${selectedProject === project.path || selectedProject === project.id ? " active" : ""}${project.pinned ? " is-pinned" : ""}${project.active ? " has-wb-activity" : ""}${project.pathMissing ? " is-path-missing" : ""}`} title={project.pathMissing ? t("desktop.workbench.pathMissingHint") : project.path} aria-expanded={projectExpanded} onContextMenu={(event) => projectMenu(event, project)} onClick={() => selectProject(project.path)}><span className={`wb-session-folder-chevron has-children${projectExpanded ? " is-expanded" : ""}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setExpandedProjectIds((current) => { const next = new Set(current); if (next.has(project.id)) next.delete(project.id); else next.add(project.id); return next; }); }}><ThemeIcon name="chevron-right" size={12} aria-hidden="true" /></span>{project.pinned ? <ThemeIcon name="pin" className="project-pin-icon" size={12} aria-hidden="true" /> : null}{project.active ? <span className="wb-folder-activity-dot" aria-hidden="true" /> : null}<span className="wb-folder-row-text"><span className="wb-folder-row-label">{project.label}</span><span className="wb-folder-row-desc">{project.pathMissing ? t("desktop.workbench.pathMissingLabel", project.portableKey) : project.path}</span></span><span className="wb-folder-row-count">{project.sessionCount + project.pendingCount}</span></button>
                {projectExpanded ? <>
                <button
                  type="button"
                  className={`wb-folder-row wb-session-folder-root${selectedProject === project.path && selectedFolderId === UNCLASSIFIED_FOLDER_ID ? " active" : ""}${dragTargetKey === `${project.id}:${UNCLASSIFIED_FOLDER_ID}` ? " is-drop-target" : ""}`}
                  onDragOver={(event) => handleFolderDragOver(event, project, null)}
                  onDragLeave={(event) => handleFolderDragLeave(event, project, null)}
                  onDrop={(event) => handleFolderDrop(event, project, null)}
                  onClick={() => selectProjectFolder(project, UNCLASSIFIED_FOLDER_ID)}
                ><ThemeIcon name="folder-open" size={14} aria-hidden="true" /><span className="wb-folder-row-label">{t("desktop.workbench.unclassifiedSessions")}</span><span className="wb-folder-row-count">{unclassifiedCount}</span></button>
                {renderProjectFolderRows(project, null)}
                </> : null}
              </Fragment>;
              }) : <p className="muted wb-folders-empty">{t("desktop.workbench.noProjects")}</p>}
            </div>
          </> : sidebarView === "gtd" ? <div className="wb-folder-section wb-gtd-folder-section"><div className="wb-folder-section-label">{t("desktop.workbench.gtdView")}</div>{GTD_ACTIVE_STATUSES.map((gtdStatus) => <button type="button" className={`wb-folder-row wb-gtd-folder-row${selectedGtdStatus === gtdStatus ? " active" : ""}`} key={gtdStatus} onClick={() => setSelectedGtdStatus(gtdStatus)}><span className={`wb-gtd-status-dot is-${gtdStatus}`} aria-hidden="true" /><span className="wb-folder-row-label">{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</span><span className="wb-folder-row-count">{gtdStatusCounts.get(gtdStatus) || 0}</span></button>)}<div className="wb-gtd-completed-group"><button type="button" className="wb-folder-row wb-gtd-folder-row wb-gtd-completed-toggle" aria-expanded={completedGtdExpanded} onClick={() => setCompletedGtdExpanded((value) => !value)}><ThemeIcon name="chevron-right" className={completedGtdExpanded ? "is-expanded" : ""} size={14} aria-hidden="true" /><span className="wb-folder-row-label">{t("desktop.workbench.gtdCompleted")}</span><span className="wb-folder-row-count">{gtdStatusCounts.get("done") || 0}</span></button>{completedGtdExpanded ? <button type="button" className={`wb-folder-row wb-gtd-folder-row wb-gtd-completed-child${selectedGtdStatus === "done" ? " active" : ""}`} onClick={() => setSelectedGtdStatus("done")}><span className="wb-gtd-status-dot is-done" aria-hidden="true" /><span className="wb-folder-row-label">{t("desktop.workbench.gtdStatus.done")}</span><span className="wb-folder-row-count">{gtdStatusCounts.get("done") || 0}</span></button> : null}</div></div>
          : <div className="wb-folder-section wb-tags-folder-section">
            <div className="wb-folder-section-label">{t("desktop.workbench.tagsView")}</div>
            <label className="wb-tags-obsolete-toggle">
              <input type="checkbox" checked={showObsoleteTags} onChange={(event) => setShowObsoleteTags(event.target.checked)} />
              <span>{t("desktop.workbench.showObsoleteTags")}</span>
            </label>
            {tagsLoading ? <p className="muted wb-folders-empty">{t("desktop.common.loading")}</p>
              : tagItems.length ? tagItems.map((tag) => (
                <button
                  type="button"
                  key={tag.normalizedTag}
                  className={`wb-folder-row wb-tag-row${selectedTag === tag.normalizedTag ? " active" : ""}${tag.status === "obsolete" ? " is-obsolete" : ""}`}
                  onClick={() => void selectTag(tag)}
                  title={t("desktop.tagging.consensusBadge", tag.activeEntityCount)}
                >
                  <span className={`wb-tag-category-dot is-${tag.category}`} aria-hidden="true" />
                  <span className="wb-folder-row-text">
                    <span className="wb-folder-row-label">#{tag.tag}</span>
                    <span className="wb-folder-row-desc">
                      {t(`desktop.tagging.category.${tag.category}`)}
                      {tag.activeEntityCount > 1 ? ` · 🔗${tag.activeEntityCount}` : ""}
                      {tag.globalWeight >= 2 ? " · 🔥" : ""}
                    </span>
                  </span>
                  <span className="wb-folder-row-count">{tag.sessionCount}</span>
                </button>
              )) : <p className="muted wb-folders-empty">{t("desktop.workbench.noTags")}</p>}
          </div>}
        </div>
      </aside>
      <ResizeHandle label={t("desktop.workbench.resizeProjects")} onDelta={(delta) => setWidth("folders", delta)} />
      <aside className="wb-list-pane">
        <div ref={sessionSearchToolbarRef} className={`sidebar-project-filter-wrap wb-session-filter-wrap${sessionSearchOpen ? " is-search-open" : ""}`}>
          <button ref={sessionSearchButtonRef} type="button" className={`wb-icon-btn wb-session-search-btn${sessionQuery && !sessionSearchOpen ? " has-query" : ""}`} aria-label={t("desktop.common.search")} title={t("desktop.common.search")} aria-expanded={sessionSearchOpen} aria-controls="wb-session-search" onClick={openSessionSearch}><ThemeIcon name="search" size={15} /></button>
          <input ref={sessionSearchInputRef} id="wb-session-search" type="search" className="wb-search wb-session-search-input" aria-label={t("desktop.common.search")} placeholder={t("desktop.common.search")} value={sessionQuery} hidden={!sessionSearchOpen} autoComplete="off" spellCheck={false} onChange={(event) => setSessionQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (sessionQuery.trim()) { setSessionQuery(""); return; }
            closeSessionSearch();
          }} onBlur={() => {
            window.setTimeout(() => {
              if (!sessionSearchToolbarRef.current?.contains(document.activeElement)) setSessionSearchOpen(false);
            }, 0);
          }} />
          <SegmentedControl
            aria-label={t("desktop.workbench.sessionFilter")}
            value={sessionFilter}
            options={["all", "active"] as const satisfies readonly SessionFilter[]}
            onChange={setSessionFilter}
            getLabel={(filter) => t(`desktop.common.${filter}`)}
          />
        </div>
        <div className="wb-list-meta-row"><p className="wb-list-meta">{sessionQuery ? t("desktop.workbench.listMetaSearch", selectedSessionScope, sessionQuery, visibleSessions.length + visiblePendingSessions.length) : `${visibleSessions.length + visiblePendingSessions.length} / ${sessionsTotal + selectedPendingSessions.length}`}</p><button type="button" className="wb-icon-btn" aria-label={t("desktop.common.refresh")} title={t("desktop.common.refresh")} onClick={() => void reloadWorkbench()}><ThemeIcon name="refresh" size={15} /></button></div>
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
            const isOpen = openSessionKeys.has(sessionKey(session));
            const otherMachine = isOtherMachineSession(session, selectedProjectMeta?.path || selectedProject);
            const gtdStatus = effectiveGtdStatus(gtdStatuses, session);
            return <button
              type="button"
              draggable
              className={`wb-list-item${activeSessionKey === sessionKey(session) ? " active" : ""}${isOpen ? " has-wb-activity" : ""}${otherMachine ? " is-other-machine" : ""}${draggedSessionKey === sessionKey(session) ? " is-drag-source" : ""}`}
              onDragStart={(event) => {
                clearWorkbenchDrag();
                draggedSessionRef.current = session;
                setDraggedSessionKey(sessionKey(session));
                event.dataTransfer.setData("text/plain", session.title || session.id);
                event.dataTransfer.setData("application/x-agent-resume-workbench-session", JSON.stringify({
                  provider: session.provider,
                  agentSessionId: session.id
                }));
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={clearWorkbenchDrag}
              onContextMenu={(event) => sessionMenu(event, session)}
              onClick={() => void openSession(session)}
              title={otherMachine ? t("desktop.workbench.otherMachineSessionHint", session.projectPath) : undefined}
            ><span className="wb-list-item-top"><span className="wb-session-title-wrap">{isOpen ? <span className="wb-session-activity-dot" aria-hidden="true" /> : null}<span className="wb-list-item-title" ref={(el) => syncTruncationTitle(el)}>{session.title || session.id}</span>{otherMachine ? <span className="wb-other-machine-badge" aria-label={t("desktop.workbench.otherMachineBadge")}>{t("desktop.workbench.otherMachineBadge")}</span> : null}</span></span><span className="wb-list-item-preview" ref={(el) => syncTruncationTitle(el)}><span className="wb-list-item-date">{formatDateTime(session.updatedAt)}</span><span className="s-provider-tag" data-provider={session.acpProvider || session.provider}>{session.acpProvider ? `acp/${session.acpProvider}` : session.provider}</span><span className={`wb-gtd-status-badge is-${gtdStatus}`} aria-label={t("desktop.workbench.gtdStatusLabel", t(`desktop.workbench.gtdStatus.${gtdStatus}`))}>{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</span>{" · "}{aliases[session.projectPath] || basename(session.projectPath)}</span></button>;
          }}
        /> : <div className="wb-list"><p className="muted wb-list-empty">{sessionFilter === "active" ? t("desktop.workbench.noFilterSessions") : sessionQuery ? t("desktop.workbench.noMatchingSessions") : t("desktop.workbench.noSessionsInProject")}</p></div>}
      </aside>
      <ResizeHandle label={t("desktop.workbench.resizeSessions")} onDelta={(delta) => setWidth("list", delta)} />
      <main className="wb-detail">
        {active && headerSlot ? createPortal(<>{collapseToggle}{detailHead}</>, headerSlot) : null}
        <div className="wb-detail-body">
          <div className="wb-terminal-shell">{paneTabGroups}<div className="wb-terminal-stack">{terminals.filter((pane) => pane.projectPath === selectedProject && pane.key === activePane).map((pane) => {
            return <div key={pane.key} className="wb-terminal-pane-wrap"><TerminalView pane={pane} active={active} themeId={terminalThemeId} appearance={desktopAppearance} rendererMode={terminalRendererMode} engineType={terminalEngine} onPty={onPty} onDetach={onPtyDetach} onInput={onTerminalInput} onInitialPromptSubmitted={onInitialPromptSubmitted} mouseTracking={terminalMouseTrackingRef} registerFocus={registerComposerFocus} /></div>;
          })}{editorFindOpen && currentEditor ? <div className="wb-editor-find-bar app-inline-search" role="search">
            <ThemeIcon name="search" size={14} aria-hidden="true" />
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
            <button type="button" className="wb-editor-find-btn app-inline-search-btn" aria-label={t("desktop.common.findPrev")} onClick={() => runEditorFind("backward")}><ThemeIcon name="arrow-up" size={14} /></button>
            <button type="button" className="wb-editor-find-btn app-inline-search-btn" aria-label={t("desktop.common.findNext")} onClick={() => runEditorFind("forward")}><ThemeIcon name="arrow-down" size={14} /></button>
            <button type="button" className="wb-editor-find-btn app-inline-search-btn" aria-label={t("desktop.common.closeFind")} onClick={closeEditorFind}><ThemeIcon name="close" size={14} /></button>
          </div> : null}{currentEditor ? <div className="wb-editor-pane" onContextMenu={(event) => { event.preventDefault(); const hasSelection = Boolean(editorRef.current?.getSelectedText().trim()); setEditorContextMenu({ x: event.clientX, y: event.clientY, hasSelection }); }}>{editorDiskAlert}{currentEditor.view === "preview" ? <div className="wb-editor-preview markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(currentEditor.content) }} /> : <CodeEditor ref={editorRef} className="wb-editor-host" value={currentEditor.content} onChange={(value) => updateEditorContent(currentEditor.key, value)} onBlur={() => { if (currentEditor.dirty) void saveEditor(currentEditor.key); }} ariaLabel={currentEditor.path} filePath={currentEditor.path} readOnly={editorSettings?.editable === false} fontSize={editorSettings?.fontSize ?? 13} wordWrap={editorSettings?.wordWrap ?? false} tabSize={editorSettings?.tabSize ?? 4} appearance={editorAppearance} />}<div className="wb-editor-status"><span className="wb-editor-status-path">{currentEditor.path}</span><span className="wb-editor-status-state">{currentEditor.saving ? t("desktop.workbench.fileSaving") : currentEditor.diskState === "changed" ? t("desktop.workbench.fileConflict") : currentEditor.diskState === "deleted" ? t("desktop.workbench.fileDeletedOnDisk") : currentEditor.diskState === "external" ? t("desktop.workbench.fileUnavailableOnDisk") : currentEditor.dirty ? t("desktop.workbench.fileModified") : t("desktop.workbench.fileSaved")}</span><button type="button" className="wb-git-action-btn" disabled={!currentEditor.dirty || currentEditor.saving || Boolean(currentEditor.diskState) || editorSettings?.editable === false} onClick={() => void saveEditor(currentEditor.key)} aria-label={t("desktop.common.save")}><ThemeIcon name="save" size={15} /></button></div></div> : null}{currentDiff ? <div className="wb-git-diff-pane"><div className="wb-diff-head"><strong className="wb-diff-title">{currentDiff.path}</strong><button type="button" className="wb-git-action-btn wb-diff-open" aria-label={t("desktop.workbench.fileOpen")} title={t("desktop.workbench.fileOpen")} onClick={() => void openFile(gitChangeFilePath(currentDiff))}><ThemeIcon name="file" size={14} /></button></div><div className="wb-diff-labels"><span className="wb-diff-label">{currentDiff.oldLabel}</span><span className="wb-diff-label">{currentDiff.newLabel}</span></div><WorkbenchDiffView diff={currentDiff} appearance={editorAppearance} onDiscardHunk={(target) => void discardGitHunk(currentDiff, target)} onDiscardLine={(target) => void discardGitLine(currentDiff, target)} onStageHunk={(target) => void stageGitHunk(currentDiff, target)} onUnstageHunk={(target) => void unstageGitHunk(currentDiff, target)} onStageLine={(target) => void stageGitLine(currentDiff, target)} onUnstageLine={(target) => void unstageGitLine(currentDiff, target)} /></div> : null}{acpChats.map((pane) => {
            const visible = pane.projectPath === selectedProject && activePane === pane.key;
            return <AcpChatView
              key={pane.key}
              recordId={pane.recordId}
              provider={pane.provider}
              projectPath={pane.projectPath}
              title={pane.title}
              active={active && visible}
              onTitleChange={(nextTitle) => {
                setAcpChats((current) => current.map((item) => item.key === pane.key ? { ...item, title: nextTitle } : item));
                setSessions((current) => current.map((item) =>
                  sessionKey(item) === acpListSessionKey(pane.recordId) ? { ...item, title: nextTitle } : item
                ));
              }}
              onSessionReady={refreshSessionsAfterAcpConnect}
            />;
          })}{browsers.map((pane) => {
            const visible = pane.projectPath === selectedProject && activePane === pane.key;
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
          })}{terminalCreating && !currentTerminals.some((pane) => pane.projectPath === selectedProject && !pane.ptyId) && !currentAcpChat ? <div className="wb-terminal-loading wb-terminal-loading-stack" role="status" aria-live="polite"><ThemeIcon name="loader" className="spin" size={18} aria-hidden="true" /><span>{t("desktop.common.loading")}</span></div> : null}{!terminalCreating && !currentTerminals.length && !currentEditors.length && !currentDiffs.length && !currentAcpChats.length && !currentBrowsers.length ? <p className="muted wb-terminal-hint">{selectedProject ? t("desktop.workbench.selectSessionHint") : t("desktop.workbench.selectProjectHint")}</p> : null}</div></div>
          {side ? <><ResizeHandle label={t("desktop.workbench.resizeSidePanel")} onDelta={(delta) => setWidth("side", -delta)} /><aside className="wb-side-panel">{side === "files" ? <div className="wb-side-pane wb-explorer-side-pane"><WorkbenchFileExplorer ref={fileExplorerRef} rootPath={selectedProject || ""} activePath={currentFilePath} onOpenFile={(path) => void openFile(path)} onOpenPreview={(path) => void openFile(path, undefined, selectedProject, "preview")} onShowGitHistory={(path) => void loadGitFileHistory(path)} onError={(message) => setStatus({ text: message, kind: "error" })} /><div className={`wb-explorer-scripts${scriptsSectionCollapsed ? " is-collapsed" : ""}`}><div className="wb-explorer-scripts-head"><button type="button" className="wb-explorer-scripts-toggle" aria-expanded={!scriptsSectionCollapsed} onClick={() => setScriptsSectionCollapsed((current) => { const next = !current; localStorage.setItem("wb-scripts-collapsed", String(next)); return next; })}><span className={`wb-file-tree-chevron${scriptsSectionCollapsed ? "" : " is-expanded"}`}><ThemeIcon name="chevron-right" size={12} /></span><span className="wb-side-pane-title">{t("desktop.workbench.sidePanelScripts")}</span></button>{selectedProject ? <button type="button" className="wb-git-action-btn" disabled={scriptsLoading} onClick={() => void loadScripts(selectedProject)} aria-label={t("desktop.workbench.scriptsRefresh")} title={t("desktop.workbench.scriptsRefresh")}><ThemeIcon name="refresh" size={14} className={scriptsLoading ? "spin" : undefined} /></button> : null}</div>{!scriptsSectionCollapsed ? <ScriptsTree packages={scriptPackages} loading={scriptsLoading} error={scriptsError || null} truncated={scriptsTruncated} hasProject={Boolean(selectedProject)} compact emptyHint={t("desktop.workbench.scriptsEmpty")} noRootHint={t("desktop.workbench.sidePanelNoRoot")} onRun={runScript} /> : null}</div></div> : side === "scripts" ? <div className="wb-side-pane"><ScriptsTree packages={scriptPackages} loading={scriptsLoading} error={scriptsError || null} truncated={scriptsTruncated} hasProject={Boolean(selectedProject)} emptyHint={t("desktop.workbench.scriptsEmpty")} noRootHint={t("desktop.workbench.sidePanelNoRoot")} onRefresh={selectedProject ? () => void loadScripts(selectedProject) : undefined} onRun={runScript} /></div> : side === "search" ? <div className="wb-side-pane">
            <div className="wb-side-pane-head"><span className="wb-side-pane-title">{t("desktop.workbench.sidePanelSearch")}</span></div>
            <div className="wb-search-pane">
              <div className="wb-search-form" role="search">
                <input
                  ref={searchInputRef}
                  type="search"
                  role={searchProjectMode ? "combobox" : undefined}
                  className="wb-search-input"
                  value={searchProjectMode ? searchProjectQuery : searchQuery}
                  placeholder={t(searchProjectMode ? "desktop.workbench.quickAccessProjectPlaceholder" : "desktop.workbench.searchPlaceholder")}
                  aria-label={t(searchProjectMode ? "desktop.workbench.quickAccessSelectProject" : "desktop.workbench.sidePanelSearch")}
                  aria-expanded={searchProjectMode ? true : undefined}
                  aria-controls={searchProjectMode ? "wb-search-project-results" : undefined}
                  aria-activedescendant={searchProjectMode && searchProjectActive ? searchProjectOptionId(searchProjectActive.id) : undefined}
                  aria-autocomplete={searchProjectMode ? "list" : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => searchProjectMode
                    ? setSearchProjectQuery(event.target.value)
                    : setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (searchProjectMode) {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        leaveSearchProjectMode();
                      } else if (event.key === "ArrowDown") {
                        event.preventDefault();
                        moveSearchProjectSelection(1);
                      } else if (event.key === "ArrowUp") {
                        event.preventDefault();
                        moveSearchProjectSelection(-1);
                      } else if (event.key === "Home") {
                        event.preventDefault();
                        setSearchProjectSelectionId(searchProjectResults[0]?.id || "");
                      } else if (event.key === "End") {
                        event.preventDefault();
                        setSearchProjectSelectionId(searchProjectResults[searchProjectResults.length - 1]?.id || "");
                      } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        activateSearchProject();
                      }
                      return;
                    }
                    if (event.key === "ArrowLeft"
                      && event.currentTarget.selectionStart === 0
                      && event.currentTarget.selectionEnd === 0) {
                      event.preventDefault();
                      enterSearchProjectMode();
                    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      window.clearTimeout(searchTimerRef.current);
                      void runProjectSearch(searchQuery);
                    }
                  }}
                />
                {!searchProjectMode ? <>
                  <button
                    type="button"
                    className="wb-search-scope"
                    aria-label={t("desktop.workbench.quickAccessSelectProject")}
                    title={searchProjectLabel}
                    onClick={enterSearchProjectMode}
                  ><ThemeIcon name="chevron-left" size={13} aria-hidden="true" /><span>{searchProjectLabel}</span></button>
                  <div className="wb-search-options" role="group" aria-label={t("desktop.workbench.searchOptions")}>
                    <button type="button" className={`wb-search-option${searchMatchCase ? " active" : ""}`} aria-pressed={searchMatchCase} title={t("desktop.workbench.searchMatchCase")} onClick={() => setSearchMatchCase((v) => !v)}>Aa</button>
                    <button type="button" className={`wb-search-option${searchWholeWord ? " active" : ""}`} aria-pressed={searchWholeWord} title={t("desktop.workbench.searchWholeWord")} onClick={() => setSearchWholeWord((v) => !v)}>Ab</button>
                    <button type="button" className={`wb-search-option${searchUseRegex ? " active" : ""}`} aria-pressed={searchUseRegex} title={t("desktop.workbench.searchUseRegex")} onClick={() => setSearchUseRegex((v) => !v)}>.*</button>
                  </div>
                </> : null}
              </div>
              {searchProjectMode ? <div className="wb-search-project-results" id="wb-search-project-results" role="listbox">
                {searchProjectResults.length ? searchProjectResults.map((project, index) => {
                  const disabled = Boolean(project.disabledReason);
                  const selected = index === searchProjectActiveIndex;
                  return <button
                    ref={(node) => { if (node) searchProjectOptionRefs.current.set(project.id, node); else searchProjectOptionRefs.current.delete(project.id); }}
                    type="button"
                    role="option"
                    id={searchProjectOptionId(project.id)}
                    aria-selected={selected}
                    aria-disabled={disabled}
                    className={`wb-search-project-row${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
                    key={project.id}
                    onMouseMove={() => setSearchProjectSelectionId(project.id)}
                    onClick={() => activateSearchProject(project)}
                  >
                    <ThemeIcon name="folder" size={15} aria-hidden="true" />
                    <span className="wb-search-project-copy"><span className="wb-search-project-label">{project.label}</span><span className="wb-search-project-detail">{project.disabledReason || project.detail}</span></span>
                    {project.pinned ? <ThemeIcon name="pin" size={12} aria-hidden="true" /> : null}
                  </button>;
                }) : <p className="muted wb-search-status">{t("desktop.workbench.quickAccessNoProjects")}</p>}
              </div> : !selectedProject ? <p className="muted wb-file-tree-empty">{t("desktop.workbench.sidePanelNoRoot")}</p> : searchLoading ? <p className="muted wb-search-status" role="status">{t("desktop.workbench.searchSearching")}</p> : searchError ? <p className="muted wb-search-status is-error" role="alert">{searchError}</p> : !searchQuery.trim() ? <p className="muted wb-search-status">{t("desktop.workbench.searchHint")}</p> : !searchMatchCount ? <p className="muted wb-search-status">{t("desktop.workbench.searchNoResults")}</p> : <><p className="wb-search-meta" aria-live="polite">{t("desktop.workbench.searchResultSummary", String(searchMatchCount), String(searchFileCount))}{searchTruncated ? ` · ${t("desktop.workbench.searchTruncated")}` : ""}</p><div className="wb-search-results" role="tree">{searchGroups.map((group) => { const expanded = searchExpanded.has(group.path); const toggle = () => setSearchExpanded((current) => { const next = new Set(current); if (next.has(group.path)) next.delete(group.path); else next.add(group.path); return next; }); return <div className="wb-search-file-group" key={group.path} role="treeitem" aria-expanded={expanded}><button type="button" className="wb-search-file-row" onClick={toggle}><span className={`wb-file-tree-chevron${expanded ? " is-expanded" : ""}`}><ThemeIcon name="chevron-right" size={12} /></span><ThemeIcon name="file-code" size={14} className="wb-file-tree-icon" /><span className="wb-search-file-label" title={group.path}>{group.relativePath}</span><span className="wb-search-file-count">{group.matches.length}</span></button>{expanded ? <div className="wb-search-match-list" role="group">{group.matches.map((match, index) => { const key = `${match.path}:${match.line}:${match.column}:${index}`; return <button type="button" className={`wb-search-match-row${searchSelectedKey === key ? " is-selected" : ""}`} key={key} onClick={() => { setSearchSelectedKey(key); void openFile(match.path, { path: match.path, line: match.line, column: match.column, endColumn: match.endColumn }); }}><span className="wb-search-match-line">{match.line}</span><span className="wb-search-match-preview">{match.preview}</span></button>; })}</div> : null}</div>; })}</div></>}
            </div>
          </div> : side === "linkgraph" ? <LinkGraphSidePane result={linkGraphResult} progress={linkGraphProgress} busy={linkGraphBusy} error={linkGraphError} outputLanguage={linkGraphLanguage} onOutputLanguageChange={changeLinkGraphLanguage} onRefresh={linkGraphResult ? refreshLinkGraph : undefined} onCancel={() => { void desktopApi().linkGraphCancel().catch(() => undefined); setLinkGraphBusy(false); }} onOpen={(target) => {
              const root = selectedProject || "";
              const raw = target.path.replaceAll("\\", "/");
              const isAbs = raw.startsWith("/") || /^[A-Za-z]:\//.test(raw);
              const hit = linkGraphResult?.hits.find((item) => item.path === target.path || item.relativePath === raw);
              const absolute = isAbs
                ? target.path
                : hit?.path || (root ? `${root.replace(/\/+$/, "")}/${raw.replace(/^\/+/, "")}` : target.path);
              void openFile(absolute, {
                path: absolute,
                line: target.line,
                column: target.column || 1,
                endColumn: target.endColumn || (target.column || 1) + 1
              });
            }} /> : side === "transcript" ? <SessionTranscriptPane provider={activeTranscriptTarget?.provider || ""} sessionId={activeTranscriptTarget?.sessionId || ""} iconProvider={activeTranscriptTarget?.iconProvider || activeTranscriptTarget?.provider || ""} active={active && side === "transcript"} fontSize={settings?.workbench?.transcriptFontSize ?? 14} /> : <div className="wb-side-pane">
            <div className="wb-side-pane-head wb-git-pane-head">
              <span className="wb-side-pane-title">{gitHistoryContext ? gitHistoryTitle : t("desktop.workbench.sidePanelGit")}</span>
              <div className="wb-git-actions">{gitHistoryContext ? <>
                <button type="button" className="wb-git-action-btn" onClick={closeGitHistory} aria-label={gitHistoryBackLabel}><ThemeIcon name="chevron-left" size={15} /></button>
                <button type="button" className="wb-git-action-btn" disabled={gitLogLoading} onClick={retryGitHistory} aria-label={t("desktop.common.refresh")}><ThemeIcon name="refresh" size={15} className={gitLogLoading ? "spin" : undefined} /></button>
              </> : <>
                <button type="button" className="wb-git-action-btn" disabled={!gitRoot} onClick={() => void loadGitLog()} aria-label={t("desktop.workbench.gitLog")}><ThemeIcon name="history" size={15} /></button>
                <button type="button" className="wb-git-action-btn" disabled={gitRefreshing} onClick={() => void refreshGit(true)} aria-label={t("desktop.common.refresh")}><ThemeIcon name="refresh" size={15} className={gitRefreshing ? "spin" : undefined} /></button>
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
                            <button type="button" className="wb-git-log-detail-close" onClick={() => setGitShow(null)} aria-label={t("desktop.workbench.gitHistoryDetailClose")}><ThemeIcon name="close" size={13} /></button>
                          </div>
                          <p className="wb-git-log-meta"><span className="wb-git-log-hash">{gitShow.shortHash}</span><span className="wb-git-log-meta-sep">·</span><span>{gitShow.author}</span><span className="wb-git-log-meta-sep">·</span><span>{formatGitCommitDate(gitShow.date, locale)}</span></p>
                        </div>
                        <pre className="wb-git-log-detail-body">{gitShow.body}</pre>
                        <div className="wb-git-log-files">{gitShow.files.length ? gitShow.files.map((file) => <button type="button" className="wb-git-log-file" key={file.path} onClick={() => void openGitShowFileDiff(gitShow.hash, file.path)}><span className="wb-git-file-status">{file.status}</span>{file.oldPath ? t("desktop.workbench.gitLogRename", file.oldPath, file.path) : file.path}</button>) : <p className="muted wb-git-empty">{t("desktop.workbench.gitLogNoFiles")}</p>}</div>
                      </div> : null}
                    </div>
                    : gitShow ? <>
                    <button type="button" className="wb-diff-back" onClick={() => setGitShow(null)} aria-label={t("desktop.workbench.gitLogBackToList")}><ThemeIcon name="chevron-left" size={15} /></button>
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
            </> : <p className="muted wb-git-empty">{selectedProject ? t("desktop.workbench.sidePanelGitUnavailable") : t("desktop.workbench.sidePanelNoRoot")}</p>}</div>}
          </div>}</aside></> : null}
        </div>
      </main>
    </div>
    {branchPane ? <div className="wb-git-branch-popover" style={branchMenuPosition || undefined}>{branchResult?.mode === "nested" ? <div className="wb-git-branch-list">{renderBranchMenu()}</div> : <><div className="wb-git-branch-repo-head">{branchResult?.repoRoot || branchPane.repoRoot || branchPane.cwd}</div><div className="wb-git-branch-list">{renderBranchMenu()}</div></>}</div> : null}
    {editorContextMenu ? <div className="wb-context-menu" role="menu" style={{ left: Math.max(8, Math.min(editorContextMenu.x, window.innerWidth - 200)), top: Math.max(8, Math.min(editorContextMenu.y, window.innerHeight - 80)) }} onContextMenu={(event) => event.preventDefault()}>
      <button type="button" role="menuitem" disabled={!editorContextMenu.hasSelection} onClick={() => { setEditorContextMenu(null); openLinkGraphFromEditor(); }}>{t("desktop.workbench.linkGraphView")}</button>
    </div> : null}
    {gitLogContextMenu ? <div
      className="wb-context-menu wb-git-log-context-menu"
      role="menu"
      style={{
        left: Math.max(8, Math.min(gitLogContextMenu.x, window.innerWidth - 220)),
        top: Math.max(8, Math.min(gitLogContextMenu.y, window.innerHeight - (gitLogContextMenu.branchName ? 336 : 292)))
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => copyGitLogValue(gitLogContextMenu.commit.hash)}>{t("desktop.workbench.gitCopyCommitHash")}</button>
      {gitLogContextMenu.branchName ? <button type="button" role="menuitem" title={gitLogContextMenu.branchName} onClick={() => copyGitLogValue(gitLogContextMenu.branchName!)}>{t("desktop.workbench.gitCopyBranchName")}</button> : null}
      <div className="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" onClick={() => void cherryPickGitLogCommit(gitLogContextMenu.commit)}>{t("desktop.workbench.gitCherryPick")}</button>
      <button type="button" role="menuitem" onClick={() => { setGitLogDialog({ kind: "branch", commit: gitLogContextMenu.commit }); setGitLogContextMenu(null); }}>{t("desktop.workbench.gitNewBranchFromCommit")}</button>
      <button type="button" role="menuitem" onClick={() => void checkoutGitLogCommit(gitLogContextMenu.commit)}>{t("desktop.workbench.gitCheckoutCommit")}</button>
      <button type="button" role="menuitem" onClick={() => { setGitLogDialog({ kind: "reset", commit: gitLogContextMenu.commit }); setGitLogContextMenu(null); }}>{t("desktop.workbench.gitReset")}</button>
      <div className="context-menu-separator" role="separator" />
      <button type="button" role="menuitem" onClick={() => void mergeGitLogCommit(gitLogContextMenu.commit)}>{t("desktop.workbench.gitMerge")}</button>
      <button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => void revertGitLogCommit(gitLogContextMenu.commit)}>{t("desktop.workbench.gitRevert")}</button>
    </div> : null}
    {gitLogDialog ? <div className="wb-git-log-dialog" role="dialog" aria-modal="true">
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
    {newSessionPicker ? <div ref={newSessionPickerRef} className="wb-context-menu wb-new-session-picker" role="menu" aria-label={t("desktop.settings.defaultAgent")} style={newSessionPickerStyle} onKeyDown={handleNewSessionPickerKeyDown}>
      <span className="wb-context-menu-label">{t("desktop.settings.newSessionGroupCli")}</span>
      {WORKBENCH_NEW_SESSION_TARGET_OPTIONS.filter((option) => option.group === "cli").map((option) => <button type="button" role="menuitem" key={option.value} onClick={() => void chooseNewSessionTarget(option.value)}>{t(`desktop.settings.newSessionTarget.${option.value.replace(":", "_")}`)}</button>)}
      <div className="context-menu-separator" role="separator" />
      <span className="wb-context-menu-label">{t("desktop.settings.newSessionGroupAcp")}</span>
      {WORKBENCH_NEW_SESSION_TARGET_OPTIONS.filter((option) => option.group === "acp").map((option) => <button type="button" role="menuitem" key={option.value} onClick={() => void chooseNewSessionTarget(option.value)}>{t(`desktop.settings.newSessionTarget.${option.value.replace(":", "_")}`)}</button>)}
    </div> : null}
    {contextMenu ? <div className={`wb-context-menu${contextMenu.kind === "session" || contextMenu.kind === "session-tab" ? " wb-session-context-menu" : ""}`} role="menu" style={{ left: contextMenuLeft, top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - contextMenuHeight)) }} onContextMenu={(event) => event.preventDefault()}>
      {contextMenu.kind === "project" ? (() => {
        const enabled = enabledProjectMenuActions(settings);
        const isPinned = (contextMenu.projectId && catalogProjects.some((item) => item.projectId === contextMenu.projectId && item.pinned))
          || pinnedProjects.has(contextMenu.projectPath || "")
          || (contextMenu.projectId ? pinnedProjects.has(contextMenu.projectId) : false);
        const groups: ReactNode[][] = [];
        const group1: ReactNode[] = [];
        if (enabled.has("pin")) {
          group1.push(<button type="button" role="menuitem" key="pin" onClick={() => void runContextAction(isPinned ? "unpin" : "pin")}>{t(isPinned ? "desktop.workbench.unpinProject" : "desktop.workbench.pinProject")}</button>);
        }
        if (group1.length) groups.push(group1);
        const group2: ReactNode[] = [];
        if (enabled.has("newSession")) {
          group2.push(<button type="button" role="menuitem" key="new" onClick={() => void runContextAction("new")}>{t("desktop.workbench.newSession")}</button>);
        }
        if (contextMenu.projectId) {
          group2.push(<button type="button" role="menuitem" key="newFolder" onClick={() => void runContextAction("newFolder")}>{t("desktop.workbench.newFolder")}</button>);
        }
        if (enabled.has("editor") && contextMenu.editorLabel) {
          group2.push(<button type="button" role="menuitem" key="editor" onClick={() => void runContextAction("editor")}>{t("desktop.workbench.openInApp", contextMenu.editorLabel)}</button>);
        }
        if (enabled.has("note")) {
          group2.push(<button type="button" role="menuitem" key="note" onClick={() => void runContextAction("note")}>{t("desktop.workbench.mountNote")}</button>);
        }
        if (group2.length) groups.push(group2);
        const group3: ReactNode[] = [];
        if (enabled.has("rename")) {
          group3.push(<button type="button" role="menuitem" key="rename" onClick={() => void runContextAction("rename")}>{t("desktop.workbench.renameProject")}</button>);
        }
        if (enabled.has("setLocalPath")) {
          group3.push(<button type="button" role="menuitem" key="setLocalPath" onClick={() => void runContextAction("setLocalPath")}>{t("desktop.workbench.setLocalFolder")}</button>);
        }
        if (enabled.has("copyPath")) {
          group3.push(<button type="button" role="menuitem" key="copyPath" onClick={() => void runContextAction("copyPath")}>{t("desktop.workbench.copyLocalPath")}</button>);
        }
        if (enabled.has("reveal")) {
          group3.push(<button type="button" role="menuitem" key="reveal" onClick={() => void runContextAction("reveal")}>{t("desktop.common.revealInFinder")}</button>);
        }
        if (group3.length) groups.push(group3);
        const group4: ReactNode[] = [];
        if (enabled.has("merge")) {
          group4.push(<button type="button" role="menuitem" key="merge" onClick={() => void runContextAction("merge")}>{t("desktop.workbench.mergeIntoProject")}</button>);
        }
        if (enabled.has("split")) {
          group4.push(<button type="button" role="menuitem" key="split" onClick={() => void runContextAction("split")}>{t("desktop.workbench.splitProjectPath")}</button>);
        }
        if (group4.length) groups.push(group4);
        const group5: ReactNode[] = [];
        if (enabled.has("remove")) {
          group5.push(<button type="button" role="menuitem" key="remove" className="context-menu-item-danger" onClick={() => void runContextAction("remove")}>{t("desktop.workbench.removeProjectFromPanel")}</button>);
        }
        if (group5.length) groups.push(group5);
        if (!groups.length) {
          return <p className="muted" style={{ margin: 0, padding: "8px 12px", fontSize: 12 }}>{t("desktop.settings.projectContextMenuEmpty")}</p>;
        }
        return groups.map((group, index) => (
          <Fragment key={index}>
            {index > 0 ? <div className="context-menu-separator" role="separator" /> : null}
            {group}
          </Fragment>
        ));
      })() : contextMenu.kind === "folder" ? <>
        <button type="button" role="menuitem" onClick={() => void runContextAction("newFolder")}>{t("desktop.workbench.newSubfolder")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("renameFolder")}>{t("desktop.common.rename")}</button>
        <div className="context-menu-separator" role="separator" />
        <button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => void runContextAction("deleteFolder")}>{t("desktop.workbench.deleteFolder")}</button>
      </> : contextMenu.kind === "session-tab" ? <button type="button" role="menuitem" onClick={() => void runContextAction("floatingNote")}>{t(contextMenu.hasFloatingNote ? "desktop.workbench.openFloatingNote" : "desktop.workbench.addFloatingNote")}</button> : contextMenu.kind === "editor-tab" ? <button type="button" role="menuitem" onClick={() => void runContextAction("toggleEditorPreview")}>{t(contextMenu.editorPreview ? "desktop.common.edit" : "desktop.workbench.preview")}</button> : <>
        {contextMenu.session?.provider === "codex" ? <button type="button" role="menuitem" onClick={() => void runContextAction("codex")}>{t("desktop.workbench.openInChatGpt")}</button> : null}
        <button type="button" role="menuitem" onClick={() => void runContextAction("preview")}>{t("desktop.workbench.preview")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("floatingNote")}>{t(contextMenu.hasFloatingNote ? "desktop.workbench.openFloatingNote" : "desktop.workbench.addFloatingNote")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("note")}>{t("desktop.workbench.mountNote")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("autoRename")}>{t("desktop.workbench.autoRename")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("moveFolder")}>{t("desktop.workbench.moveToFolder")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("moveProject")}>{t("desktop.workbench.moveToProject")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("removeFolder")}>{t("desktop.workbench.removeFromFolder")}</button>
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
    {renameDialog ? <div className="wb-note-created-overlay"><div className="wb-note-created-backdrop" onClick={() => setRenameDialog(null)} /><form className="wb-note-created-panel" role="dialog" aria-modal="true" aria-label={t("desktop.workbench.renameProject")} onSubmit={(event) => { event.preventDefault(); void applyRename(); }}><div className="wb-rename-head"><p className="wb-note-created-title">{t("desktop.workbench.renameProject")}</p></div>{renameDialog.status ? <p className="wb-rename-status muted">{renameDialog.status}</p> : null}<input ref={renameInputRef} type="text" className="wb-rename-input" value={renameDialog.title} autoComplete="off" spellCheck={false} aria-label={t("desktop.workbench.renameProjectDisplay")} onChange={(event) => setRenameDialog((current) => current ? { ...current, title: event.target.value, status: "" } : current)} /><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" onClick={() => setRenameDialog(null)}>{t("desktop.common.cancel")}</button><button type="submit" className="wb-note-created-btn primary">{t("desktop.common.confirm")}</button></div></form></div> : null}
    {folderDialog ? <div className="wb-note-created-overlay"><div className="wb-note-created-backdrop" onClick={() => !folderDialog.busy && setFolderDialog(null)} /><form className="wb-note-created-panel" role="dialog" aria-modal="true" aria-label={t(folderDialog.mode === "create" ? "desktop.workbench.newFolder" : "desktop.workbench.renameFolder")} onSubmit={(event) => { event.preventDefault(); void applyFolderDialog(); }}><p className="wb-note-created-title">{t(folderDialog.mode === "create" ? "desktop.workbench.newFolder" : "desktop.workbench.renameFolder")}</p>{folderDialog.status ? <p className="wb-rename-status muted">{folderDialog.status}</p> : null}<input ref={renameInputRef} type="text" className="wb-rename-input" value={folderDialog.title} disabled={folderDialog.busy} autoComplete="off" spellCheck={false} aria-label={t("desktop.workbench.folderName")} placeholder={t("desktop.workbench.folderName")} onChange={(event) => setFolderDialog((current) => current ? { ...current, title: event.target.value, status: "" } : current)} /><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" disabled={folderDialog.busy} onClick={() => setFolderDialog(null)}>{t("desktop.common.cancel")}</button><button type="submit" className="wb-note-created-btn primary" disabled={folderDialog.busy}>{t("desktop.common.confirm")}</button></div></form></div> : null}
    {folderPickerDialog ? <div className="wb-note-created-overlay"><div className="wb-note-created-backdrop" onClick={() => !folderPickerDialog.busy && setFolderPickerDialog(null)} /><div className="wb-note-created-panel wb-project-pick-panel" role="dialog" aria-modal="true" aria-label={t("desktop.workbench.moveToFolder")}><p className="wb-note-created-title">{t("desktop.workbench.moveSessionTitle", folderPickerDialog.session.title || folderPickerDialog.session.id)}</p><p className="muted wb-rename-status">{t("desktop.workbench.moveSessionHint")}</p><input type="search" className="wb-rename-input" value={folderPickerDialog.query} placeholder={t("desktop.common.search")} autoComplete="off" spellCheck={false} disabled={folderPickerDialog.busy} onChange={(event) => setFolderPickerDialog((current) => current ? { ...current, query: event.target.value } : current)} />{folderPickerDialog.status ? <p className="wb-rename-status muted">{folderPickerDialog.status}</p> : null}<div className="wb-project-pick-list" role="listbox"><button type="button" className="wb-project-pick-item" disabled={folderPickerDialog.busy} onClick={() => void assignFolderFromPicker(null)}><span className="wb-project-pick-label">{t("desktop.workbench.unclassifiedSessions")}</span><span className="wb-project-pick-path">{folderPickerDialog.projectPath}</span></button>{folderPickerDialog.folders.filter((folder) => workbenchFolderPath(folder, folderPickerDialog.folders).toLowerCase().includes(folderPickerDialog.query.trim().toLowerCase())).map((folder) => <button type="button" className="wb-project-pick-item" key={folder.folderId} disabled={folderPickerDialog.busy} onClick={() => void assignFolderFromPicker(folder.folderId)}><span className="wb-project-pick-label">{workbenchFolderPath(folder, folderPickerDialog.folders)}</span><span className="wb-project-pick-path">{folder.name}</span></button>)}</div><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" disabled={folderPickerDialog.busy} onClick={() => setFolderPickerDialog(null)}>{t("desktop.common.cancel")}</button></div></div></div> : null}
    {projectPickDialog ? <div className="wb-note-created-overlay"><div className="wb-note-created-backdrop" onClick={() => !projectPickDialog.busy && setProjectPickDialog(null)} /><div className="wb-note-created-panel wb-project-pick-panel" role="dialog" aria-modal="true" aria-label={t(projectPickDialog.kind === "merge" ? "desktop.workbench.mergeIntoProject" : projectPickDialog.kind === "moveSession" ? "desktop.workbench.moveToProject" : "desktop.workbench.splitProjectPath")}><p className="wb-note-created-title">{projectPickDialog.kind === "merge" ? t("desktop.workbench.mergeDialogTitle", projectPickDialog.sourceLabel) : projectPickDialog.kind === "moveSession" ? t("desktop.workbench.moveToProjectTitle", projectPickDialog.session.title || projectPickDialog.session.id) : t("desktop.workbench.splitDialogTitle", projectPickDialog.sourceLabel)}</p><p className="muted wb-rename-status">{projectPickDialog.kind === "merge" ? t("desktop.workbench.mergeDialogHint") : projectPickDialog.kind === "moveSession" ? t("desktop.workbench.moveToProjectHint") : t("desktop.workbench.splitDialogHint")}</p><input type="search" className="wb-rename-input" value={projectPickDialog.query} placeholder={t("desktop.common.search")} autoComplete="off" spellCheck={false} disabled={projectPickDialog.busy} onChange={(event) => setProjectPickDialog((current) => current ? { ...current, query: event.target.value } : current)} />{projectPickDialog.status ? <p className="wb-rename-status muted">{projectPickDialog.status}</p> : null}<div className="wb-project-pick-list" role="listbox">{(projectPickDialog.kind === "split"
      ? projectPickDialog.options.filter((item) => `${item.absolutePath} ${item.portableKey}`.toLowerCase().includes(projectPickDialog.query.trim().toLowerCase()))
      : projectPickDialog.options.filter((item) => `${item.label} ${item.path}`.toLowerCase().includes(projectPickDialog.query.trim().toLowerCase()))
    ).map((item) => {
      if (projectPickDialog.kind === "moveSession" && "id" in item && "path" in item) {
        return <button type="button" className="wb-project-pick-item" key={item.id} disabled={projectPickDialog.busy} onClick={() => void applyMoveSessionToProject(item)}><span className="wb-project-pick-label">{item.label}</span><span className="wb-project-pick-path">{item.path}</span></button>;
      }
      if (projectPickDialog.kind === "merge" && "id" in item) {
        return <button type="button" className="wb-project-pick-item" key={item.id} disabled={projectPickDialog.busy} onClick={() => {
          void (async () => {
            setProjectPickDialog((current) => current ? { ...current, busy: true, status: t("desktop.workbench.mergeRunning") } : current);
            try {
              const result = await desktopApi().mergeProjects({ sourceProjectId: projectPickDialog.sourceId, targetProjectId: item.id });
              setProjectPickDialog(null);
              setStatus({ text: t("desktop.workbench.mergeDone", result.mergedSessions) });
              await reloadWorkbench();
              window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
            } catch (error) {
              setProjectPickDialog((current) => current ? { ...current, busy: false, status: statusError(error) } : current);
            }
          })();
        }}><span className="wb-project-pick-label">{item.label}</span><span className="wb-project-pick-path">{item.path}</span></button>;
      }
      if (projectPickDialog.kind === "split" && "absolutePath" in item) {
        return <button type="button" className="wb-project-pick-item" key={item.absolutePath} disabled={projectPickDialog.busy} onClick={() => {
          void (async () => {
            setProjectPickDialog((current) => current ? { ...current, busy: true, status: t("desktop.workbench.splitRunning") } : current);
            try {
              const result = await desktopApi().splitProjectPath({ sourceProjectId: projectPickDialog.sourceId, absolutePath: item.absolutePath });
              setProjectPickDialog(null);
              setStatus({ text: t("desktop.workbench.splitDone", result.movedSessions) });
              await reloadWorkbench();
              window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
            } catch (error) {
              setProjectPickDialog((current) => current ? { ...current, busy: false, status: statusError(error) } : current);
            }
          })();
        }}><span className="wb-project-pick-label">{item.portableKey}</span><span className="wb-project-pick-path">{item.absolutePath} · {item.sessionCount}</span></button>;
      }
      return null;
    })}</div><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" disabled={projectPickDialog.busy} onClick={() => setProjectPickDialog(null)}>{t("desktop.common.cancel")}</button></div></div></div> : null}
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
      onSelectRepo={(root) => { setGitRoot(root); setGitLog(null); setGitShow(null); setGitLogError(""); }}
      onSelectBranch={(selection) => void checkoutGitPanelBranch(selection)}
      onSync={() => void syncGitBranch()}
      onToggleDir={toggleGitDirectory}
      onToggleStage={(targets, targetStaged) => void toggleGitStage(targets, targetStaged)}
      onOpenDiff={(change, staged) => void openDiff(change, staged)}
      onOpenFile={(change) => void openFile(gitChangeFilePath(change))}
      onOpenExternal={(change) => {
        if (!selectedProject) return;
        void desktopApi().workbenchOpenPath({
          rootPath: selectedProject,
          filePath: gitChangeFilePath(change)
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
        unavailable: selectedProject ? t("desktop.workbench.sidePanelGitUnavailable") : t("desktop.workbench.sidePanelNoRoot"),
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
  </section>
    <QuickAccess
      open={quickAccessOpen}
      mode={quickAccessMode}
      query={quickAccessQuery}
      files={quickAccessVisibleFiles}
      projects={quickAccessProjects}
      commands={quickAccessCommands}
      recentPaths={quickAccessRecentPaths}
      loading={quickAccessLoading}
      truncated={quickAccessTruncated || quickAccessSearchTruncated}
      error={quickAccessError}
      projectLabel={quickAccessProjectLabel}
      currentProjectPath={quickAccessRoot}
      labels={{
        filePlaceholder: t("desktop.workbench.quickAccessFilePlaceholder"),
        projectPlaceholder: t("desktop.workbench.quickAccessProjectPlaceholder"),
        commandPlaceholder: t("desktop.workbench.quickAccessCommandPlaceholder"),
        loading: t("desktop.workbench.quickAccessLoading"),
        noFiles: t("desktop.workbench.quickAccessNoFiles"),
        noProjects: t("desktop.workbench.quickAccessNoProjects"),
        noCommands: t("desktop.workbench.quickAccessNoCommands"),
        noProject: t("desktop.workbench.quickAccessNoProject"),
        truncated: t("desktop.workbench.quickAccessTruncated"),
        close: t("desktop.workbench.quickAccessClose"),
        dialog: t("desktop.workbench.quickAccessDialog"),
        selectProject: t("desktop.workbench.quickAccessSelectProject")
      }}
      onModeChange={(mode) => {
        setQuickAccessMode(mode);
      }}
      onQueryChange={setQuickAccessQuery}
      onEnterProjectMode={() => enterQuickAccessProjectMode(false)}
      onLeaveProjectMode={leaveQuickAccessProjectMode}
      onClose={closeQuickAccess}
      onOpenFile={openQuickAccessFile}
      onOpenDirectory={openQuickAccessDirectory}
      onSelectProject={(project) => {
        selectProject(project.path);
        if (quickAccessProjectContextRef.current.closeOnSelect) {
          window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
          closeQuickAccess();
        }
      }}
    />
  </>, host);
}
