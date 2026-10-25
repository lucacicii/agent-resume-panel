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
  type TaskGtdRollup,
  type ThunderConversationSummary
} from "@agent-resume/core";
import {
  WORKBENCH_NEW_SESSION_TARGET_OPTIONS
} from "../settings/model";
import {
  DESKTOP_GTD_STATUSES,
  desktopGtdColumn,
  desktopGtdLabelKey,
  type DesktopGtdStatus
} from "../../gtd";
import { hueFromHex } from "../../../shared/taskColors";
import { desktopApi } from "../../bridge";
import { confirmDestructive } from "../../confirmAction";
import { contextMenuPoint, showContextMenuAt, type NativeContextMenuItem } from "../../nativeContextMenu";
import { useMenuKeyboard, useMenuPosition } from "../../components/menuOverlay";
import { CodeEditor, type CodeEditorHandle, type CodeEditorSearchResult } from "../../components/CodeEditor";
import type { CodeMirrorAppearance } from "../../components/codeMirrorThemes";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";
import { posixDirname } from "../../components/markdownImage";
import { notifyDesktop } from "../../components/Notifications";
import { useOverlayState } from "../../components/useOverlayMotion";
import { syncTruncationTitle } from "../../components/truncationTitle";
import { VirtualList } from "../../components/VirtualList";
import type { TerminalEngineType } from "./terminal";
import { useI18n } from "../../i18n";
import { AcpChatView } from "./AcpChatView";
import { ThunderChatView } from "./ThunderChatView";
import { SelectionActionItems } from "../../selection/SelectionActionItems";
import {
  SelectionActionResult,
  useSelectionActionResult
} from "../../selection/SelectionActionResult";
import { BrowserSidePanel } from "../browser/BrowserSidePanel";
import type { BrowserSessionState } from "../../../shared/browserTypes";
import type { WorkbenchFocusSessionRequest, WorkbenchSendSelectionRequest } from "../../../shared/workbenchSelection";
import { collectActiveSessionDots, type ActiveSessionDot } from "./activeSessionDots";
import { rollupDot } from "./sessionStatus/taskRollup";
import { shellQuotePath } from "./workbenchDnd";
import { sessionDotStatusClass } from "./sessionStatus/dotStatus";
import {
  useAcpStatus,
  useAgentStatus,
  type AcpStatusEvent,
  type SessionDotRuntime,
  type SessionDotStatus
} from "./sessionStatus";
import { COMPOSER_TIP_LIMIT, EMPTY_COMPOSER_WORKSPACE_PROJECTS, type ComposerSendTip, type ComposerWorkspaceProject } from "./TerminalComposer";
import { TerminalComposerStack } from "./TerminalComposerStack";
import { formatTuiSlashInput, type TuiSlashCommand } from "./tuiSlashCommands";
import {
  FloatingSessionNote,
  sessionNoteMatchesTarget,
  type FloatingSessionNoteTarget
} from "./FloatingSessionNote";
import { useWorkbenchQuickAccess } from "./quick-access/useWorkbenchQuickAccess";
import { SessionTranscriptPane } from "./SessionTranscriptPane";
import {
  QuickAccess,
  type QuickAccessCommand,
  type QuickAccessFile
} from "./QuickAccess";
import { useWorkbenchScripts } from "./scripts/useWorkbenchScripts";
import type { ScriptEntryView } from "./ScriptsTree";
import { WorkbenchScriptsPane } from "./scripts/WorkbenchScriptsPane";
import { resolveTerminalThemeId } from "./terminalThemes";
import { appearanceStateFromSettings } from "../../themes";
import { storedWidth } from "../../storage";
import {
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
import { PaneTabThumb } from "./PaneTabThumb";
import { useTabPreview } from "./tabPreview/useTabPreview";
import type { TabPreviewTarget } from "./tabPreview/types";
import { TaskSettingsSheet } from "./TaskSettingsSheet";
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

type WorkbenchDiffPane = {
  path: string;
  repoRoot: string;
  repoPath: string;
};

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
/**
 * A Thunder TUI pane whose conversation is not known yet: the TUI mints it in
 * its own process at the first turn, so the pane is bound by discovery.
 */
type UnboundThunderTuiPane = {
  terminalKey: string;
  cwd: string;
  launchedAtMs: number;
  /** A restored pane knows the conversation it was resumed with. */
  sessionIdHint?: string;
};
/** How far a Thunder conversation may predate its pane and still be its own. */
const THUNDER_TUI_BIND_SLACK_MS = 5_000;
/** The `--session <id>` a Thunder TUI command resumes, when it carries one. */
const THUNDER_SESSION_FLAG = /(?:^|\s)--session\s+(?:'([^']+)'|"([^"]+)"|(\S+))/;
/** Thunder's store is not synced by the catalog, so unbound panes poll it. */
const THUNDER_TUI_DISCOVERY_POLL_MS = 3_000;

/** The conversation a persisted Thunder TUI command resumes, if it names one. */
function thunderSessionIdFromCommand(command: string | undefined): string | undefined {
  if (!command || !/thunder/i.test(command)) return undefined;
  const match = THUNDER_SESSION_FLAG.exec(command);
  return match?.[1] || match?.[2] || match?.[3] || undefined;
}
type WorkbenchSessionRow =
  | { kind: "pending"; pending: PendingWorkbenchSession }
  | { kind: "session"; session: AgentSession }
  /** Thunder conversations live outside the catalog; they open as visual panes. */
  | { kind: "thunder"; conversation: ThunderConversationSummary };
type AcpChatPane = {
  key: string;
  recordId: string;
  title: string;
  provider: string;
  projectPath: string;
  workbenchId?: string;
  initialPrompt?: string;
};
type ThunderChatPane = {
  /** Stable React identity; survives the draft→real conversation key rebind. */
  uid: string;
  /** Pane key: `thunder:<sessionId>` once bound, `thunder:draft:<n>` before. */
  key: string;
  /** Thunder conversation id; absent until the pane mints one on first send. */
  sessionId?: string;
  title: string;
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
  surfaceKind: "workbench" | "window";
};
type SideView = "scripts" | "browser" | null;
type SearchReveal = { path: string; line: number; column: number; endColumn: number };
const GTD_STATUSES = DESKTOP_GTD_STATUSES;
/** Shared empty list so a project-less task keeps a stable array identity. */
const EMPTY_PROJECT_PATHS: string[] = [];
/** Stable empty identity for the review banner's commit scope. */
const EMPTY_COMMIT_PATHS: string[] = [];

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
  kind: "session" | "session-tab" | "editor-tab" | "task" | "note" | "thunder";
  x: number;
  y: number;
  /** Tasks / notes: the note id (and title for labels). */
  noteId?: string;
  noteTitle?: string;
  /** Task title + whether it has ever been linked to a session. */
  taskTitle?: string;
  taskHasSessions?: boolean;
  session?: AgentSession;
  /** Thunder rows are not catalog sessions: the row's own summary stands in. */
  thunderConversation?: ThunderConversationSummary;
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
  | { channel: "acp"; provider: string }
  /** Thunder: `tui` launches the native ratatui client, `visual` opens the chat pane. */
  | { channel: "thunder"; mode: "tui" | "visual" };
type ProjectPickDialog =
  | {
      kind: "moveSessionToTask";
      /** `${provider}:${id}` — Thunder rows link as `thunder:<conversation id>`. */
      sessionKey: string;
      sessionTitle: string;
      projectPath: string;
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
const PROJECT_KEY = "workbench-selected-project";
const QUICK_ACCESS_PROJECT_KEY = "workbench-quick-access-project";
const LIST_WIDTH_KEY = "wb-list-pane-width";
const SIDE_WIDTH_KEY = "wb-side-panel-width";
const SESSION_VIEW_MODE_KEY = "wb-session-view-mode";
/** Whether a diff pane shows the session transcript beside it, per workbench. */
const DIFF_SESSION_ALONGSIDE_KEY = "wb-diff-session-alongside";
const TUI_SPLIT_HEIGHT_KEY = "wb-tui-split-height";
const ALL_PROJECTS_PANE_KEY = "__all_projects__";

function effectiveGtdStatusForKey(
  statuses: Record<string, GtdStatus>,
  key: string
): GtdStatus {
  return statuses[key] || "inbox";
}

function effectiveGtdStatus(
  statuses: Record<string, GtdStatus>,
  session: AgentSession
): GtdStatus {
  return effectiveGtdStatusForKey(statuses, sessionKey(session));
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
    else if (row.kind === "thunder") keys.push(`thunder:${row.conversation.id}`);
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

/** Note target for a Thunder conversation, which the catalog does not carry. */
function thunderSessionNoteTarget(
  conversation: ThunderConversationSummary,
  projectName?: string
): FloatingSessionNoteTarget {
  const projectPath = conversation.workspace || "";
  return {
    provider: "thunder",
    sessionId: conversation.id,
    projectPath,
    projectName: projectName || basename(projectPath),
    sessionTitle: conversation.title || conversation.id
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

/** Hover-preview targets. Built at render time; live data is fetched lazily. */
function sessionPreviewTarget(pane: TerminalPane, title: string): TabPreviewTarget {
  const identity = sessionIdentityFromKey(pane.sessionKey);
  return {
    kind: "screen",
    key: pane.key,
    title,
    meta: [identity?.provider, basename(pane.projectPath)].filter(Boolean).join(" · ") || undefined,
    accent: "session",
    ptyId: pane.ptyId,
    session: identity ? { provider: identity.provider, id: identity.sessionId } : undefined
  };
}

function terminalPreviewTarget(pane: TerminalPane): TabPreviewTarget {
  return {
    kind: "screen",
    key: pane.key,
    title: pane.title,
    meta: basename(pane.cwd),
    accent: "terminal",
    ptyId: pane.ptyId
  };
}

function acpPreviewTarget(pane: AcpChatPane, title: string): TabPreviewTarget {
  return {
    kind: "acp",
    key: pane.key,
    title,
    meta: [pane.provider, basename(pane.projectPath)].filter(Boolean).join(" · ") || undefined,
    accent: "session",
    recordId: pane.recordId
  };
}

function thunderPreviewTarget(pane: ThunderChatPane, title: string): TabPreviewTarget {
  return {
    kind: "thunder",
    key: pane.key,
    title,
    meta: basename(pane.projectPath),
    accent: "session",
    sessionId: pane.sessionId
  };
}

function editorPreviewTarget(pane: EditorPane): TabPreviewTarget {
  return {
    kind: "text",
    key: pane.key,
    title: `${pane.dirty ? "* " : ""}${basename(pane.path)}`,
    meta: basename(pane.projectPath),
    accent: "code",
    text: pane.content,
    mono: true
  };
}

function notePreviewTarget(pane: NotePane, title: string): TabPreviewTarget {
  return {
    kind: "note",
    key: pane.key,
    title,
    accent: "note",
    noteId: pane.noteId
  };
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

/**
 * The root an absolute path belongs to: the longest one containing it, or "" when
 * it belongs to none. Every pane's roots are a plain list of paths — a worktree is
 * one of them for the pane that chose it — so one function answers this for all.
 */
function rootOwningPath(roots: readonly string[], targetPath: string): string {
  let best = "";
  for (const root of roots) {
    if (root.length > best.length && isWorkbenchPathWithin(targetPath, root)) best = root;
  }
  return best;
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
  /** The scoped task's template image, shown in the detail header. */
  const [taskImage, setTaskImage] = useState<string | null>(null);
  /** Left panel tab: the task's notes, or its session list. */
  const [leftTab, setLeftTab] = useState<"note" | "session">("session");
  /** The task settings dialog: folders and worktrees for this workbench. */
  const [taskSettingsOpen, setTaskSettingsOpen] = useState(false);
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
  /** Pending script run once the scoped workbench is active (task card menu). */
  const [runScriptRequest, setRunScriptRequest] = useState<{
    script: { name: string; command: string; cwd: string };
    nonce: number;
  } | null>(null);
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
  /** Last `cd` target per shell pane, for the project switcher's highlight. */
  const [terminalCdTargets, setTerminalCdTargets] = useState<Record<string, string>>({});

  const [acpChats, setAcpChats] = useState<AcpChatPane[]>([]);
  const [thunderChats, setThunderChats] = useState<ThunderChatPane[]>([]);
  const [browsers, setBrowsers] = useState<BrowserPane[]>([]);
  const [notePanes, setNotePanes] = useState<NotePane[]>([]);
  const [activePanes, setActivePanes] = useState<Record<string, string>>({});
  const [imagePreview, setImagePreview, imagePreviewClosing] = useOverlayState<string>();
  const [thunderConversations, setThunderConversations] = useState<ThunderConversationSummary[]>([]);
  const thunderConversationsRef = useRef<ThunderConversationSummary[]>(thunderConversations);
  useEffect(() => { thunderConversationsRef.current = thunderConversations; }, [thunderConversations]);
  const [unboundThunderTui, setUnboundThunderTui] = useState<UnboundThunderTuiPane[]>([]);
  const [side, setSide] = useState<SideView>(null);
  const {
    selectionResult,
    selectionResultClosing,
    runSelectionAction,
    copySelectionResult,
    clearSelectionResult
  } = useSelectionActionResult();
  const [discardingGitPaths, setDiscardingGitPaths] = useState<Set<string>>(() => new Set());
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const setStatus = useCallback((s: { text: string; kind?: "error" | "ok" | "warning" }) => {
    if (s.text) notifyDesktop({ text: s.text, kind: (s.kind ?? "info") as "error" | "ok" | "info" });
  }, []);
  const [contextMenu, setContextMenu, contextMenuClosing] = useOverlayState<WorkbenchContextMenu>();
  const [floatingNoteTarget, setFloatingNoteTarget] = useState<FloatingSessionNoteTarget | null>(null);
  const [gitLogDialog, setGitLogDialog, gitLogDialogClosing] = useOverlayState<GitLogDialog>();
  const [projectPickDialog, setProjectPickDialog, projectPickDialogClosing] = useOverlayState<ProjectPickDialog>();
  const [draggedSessionKey, setDraggedSessionKey] = useState<string | null>(null);
  const terminalRefs = useRef(new Map<number, Terminal>());
  const terminalMouseTrackingRef = useRef(new Map<number, boolean>());
  const pendingSessionsRef = useRef<PendingWorkbenchSession[]>([]);
  const unboundThunderTuiRef = useRef<UnboundThunderTuiPane[]>([]);
  /** Latest task workspace scope, for values read during session binding. */
  const taskScopeRef = useRef<{ noteId: string; primaryProject?: string } | null>(null);
  const workbenchesRef = useRef<Workbench[]>([]);
  const activeWorkbenchIdRef = useRef<string | null>(null);
  /** A workbench explicitly requested by a deep-link (GTD chip), honored over the stored one. */
  const pendingWorkbenchIdRef = useRef<string | null>(null);
  const draggedSessionRef = useRef<AgentSession | null>(null);
  const terminalsRef = useRef<TerminalPane[]>([]);
  const refreshTerminalGitRef = useRef<(key: string) => Promise<void>>(async () => {});
  const notePanesRef = useRef<NotePane[]>([]);
  /** Workbenches whose persisted layout was already adopted in this panel instance. */
  const restoredWorkbenchesRef = useRef<Set<string>>(new Set());
  const selectedProjectRef = useRef<string | null>(selectedProject);
  const catalogProjectsRef = useRef<CatalogProject[]>(catalogProjects);
  const activeRef = useRef(active);
  const activePanesRef = useRef<Record<string, string>>(activePanes);
  const sessionsRef = useRef<AgentSession[]>(sessions);
  const acpChatsRef = useRef<AcpChatPane[]>(acpChats);
  const thunderChatsRef = useRef<ThunderChatPane[]>(thunderChats);
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
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const liveTaskEarly = taskScope
    ? tasks.find((item) => item.noteId === taskScope.noteId)
    : undefined;
  const sideRootProjects = liveTaskEarly?.projects ?? taskScope?.projects ?? EMPTY_PROJECT_PATHS;
  const activeScopeKey = workbenchScope(activeWorkbenchId) ?? paneProjectKey(selectedProject);
  const activePane = activePanes[activeScopeKey] || "";
  const activePaneCwd = useMemo(() => {
    if (!activePane) return null;
    const terminal = terminals.find((p) => paneScopeKey(p) === activeScopeKey && p.key === activePane);
    if (terminal?.cwd) return terminal.cwd;
    const acp = acpChats.find((p) => paneScopeKey(p) === activeScopeKey && p.key === activePane);
    if (acp?.projectPath) return acp.projectPath;
    const thunder = thunderChats.find((p) => paneScopeKey(p) === activeScopeKey && p.key === activePane);
    if (thunder?.projectPath) return thunder.projectPath;
    return null;
  }, [activePane, activeScopeKey, terminals, acpChats, thunderChats]);

  const sideRepoRoot = taskScope
    ? (sessionTarget
      || liveTaskEarly?.primaryProject
      || taskScope.primaryProject
      || sideRootProjects[0]
      || null)
    : null;
  /**
   * The task's repositories as they are checked out on disk — the identity every
   * root below is derived from. A pane that shows a worktree shows a different
   * path for one of these, never a different set of repositories.
   */
  const sideRepoRoots = useMemo(() => {
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
  /**
   * The panes that carry their own checkout selector resolve their roots
   * separately from the shared default, which is what lets one of them be pinned
   * to a worktree while the others follow the workbench.
   */
  /**
   * Roots the explorer and git panels span. A focused project (a chip click)
   * narrows to that one; a shared task workspace shows every referenced
   * project; a plain project selection stays itself.
   */
  const sideRoots = sideRepoRoots;
  const sideRoot = sideRepoRoot;
  /** Stable identity of the root set, for effects that must reset when it changes. */
  const sideRootsKey = sideRoots.map(projectPathKey).join("\0");
  const sideRootsRef = useRef<string[]>(sideRoots);
  sideRootsRef.current = sideRoots;
  /** The root an absolute path belongs to (longest match), or "" when outside every root. */
  const projectForPath = useCallback(
    (targetPath: string): string => rootOwningPath(sideRootsRef.current, targetPath),
    []
  );


  useEffect(() => { terminalsRef.current = terminals; }, [terminals]);
  useEffect(() => { notePanesRef.current = notePanes; }, [notePanes]);
  useEffect(() => { selectedProjectRef.current = selectedProject; }, [selectedProject]);

  useEffect(() => { catalogProjectsRef.current = catalogProjects; }, [catalogProjects]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { activePanesRef.current = activePanes; }, [activePanes]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { acpChatsRef.current = acpChats; }, [acpChats]);
  useEffect(() => { thunderChatsRef.current = thunderChats; }, [thunderChats]);
  useEffect(() => { browsersRef.current = browsers; }, [browsers]);
  useEffect(() => () => {
    for (const timer of autoRenameTimersRef.current.values()) window.clearTimeout(timer);
    autoRenameTimersRef.current.clear();
  }, []);

  useEffect(() => { pendingSessionsRef.current = pendingSessions; }, [pendingSessions]);
  useEffect(() => { sessionTargetRef.current = sessionTarget; }, [sessionTarget]);
  useEffect(() => { taskScopeRef.current = taskScope ? { noteId: taskScope.noteId, primaryProject: taskScope.primaryProject } : null; }, [taskScope]);
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
      && taskScope.accent?.customColor === record.accent.customColor
      && taskScope.accent?.shade === record.accent.shade) return;
    setTaskScope((current) => current && current.noteId === noteId ? { ...current, accent: record.accent } : current);
  }, [tasks, taskScope]);

  // The task's accent dresses the whole window: html[data-task-accent] plus
  // data-task-shade drive the CSS color-family derivation in styles.css.
  // Palette keys pick their hue from the attribute rules; an image-derived
  // custom color sets "custom" and injects its hue via the inline --task-h
  // custom property. Only task windows set it; board and standalone-note
  // windows stay neutral.
  useEffect(() => {
    const root = document.documentElement;
    const accent = taskScope?.accent;
    if (accent && root.dataset.windowMode === "task") {
      root.dataset.taskAccent = accent.colorKey ?? "custom";
      root.dataset.taskShade = String(accent.shade);
      if (accent.customColor) {
        root.style.setProperty("--task-h", String(hueFromHex(accent.customColor)));
      } else {
        root.style.removeProperty("--task-h");
      }
    } else {
      delete root.dataset.taskAccent;
      delete root.dataset.taskShade;
      root.style.removeProperty("--task-h");
    }
  }, [taskScope?.accent]);

  const openSessionKeys = useMemo(() => {
    const keys = new Set(terminals.flatMap((pane) => (pane.sessionKey ? [pane.sessionKey] : [])));
    for (const pane of acpChats) {
      keys.add(acpListSessionKey(pane.recordId));
    }
    for (const pane of thunderChats) {
      if (pane.sessionId) keys.add(pane.key);
    }
    return keys;
  }, [acpChats, terminals, thunderChats]);
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
  }, [acpChats, acpStatus.byChatId, statusView.byPaneKey, thunderChats]);
  const activeSessionDots = useMemo(
    () => collectActiveSessionDots(terminals, acpChats, sessionTitles, sessionRuntimeByPaneKey, thunderChats),
    [acpChats, sessionRuntimeByPaneKey, sessionTitles, terminals, thunderChats]
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

  /**
   * Thunder keeps its own conversation store, so its rows are fetched separately
   * from the catalog page. A missing/broken daemon is not an error for the panel.
   */
  const reloadThunderConversations = useCallback(async () => {
    if (typeof desktopApi().thunderChatListConversations !== "function") return;
    try {
      const list = await desktopApi().thunderChatListConversations();
      setThunderConversations(Array.isArray(list) ? list : []);
    } catch {
      setThunderConversations([]);
    }
  }, []);

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
    void reloadThunderConversations();
  }, [loadProjectMetadata, loadSessions, reloadThunderConversations]);

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
  /**
   * Thunder conversations are not in the catalog. When a task is scoped they are
   * limited to the task's neutral workspace (or an explicit `thunder:` link);
   * otherwise every conversation is listed, mirroring the catalog's "all" page.
   *
   * Project roots are deliberately not matched: every task sharing those
   * repositories would otherwise inherit each other's (including archived
   * tasks') conversations. Conversations started inside a task run in its
   * neutral workspace, and panes link their conversation to the task, so both
   * cases are covered without the broad path match.
   *
   * Scope and search stay separate memos: the meta row needs a denominator for
   * "how many rows could be here", which a query-filtered list cannot answer.
   */
  const scopedThunderConversations = useMemo(() => {
    const scoped = sessionFilter === "task" && taskScope && taskSessionsKnown;
    if (!scoped) return thunderConversations;
    const linkedKeys = new Set(taskSessionKeys);
    return thunderConversations.filter((conversation) => linkedKeys.has(`thunder:${conversation.id}`));
  }, [thunderConversations, sessionFilter, taskScope, taskSessionsKnown, taskSessionKeys]);

  const visibleThunderConversations = useMemo(() => {
    const q = sessionQuery.trim().toLowerCase();
    return scopedThunderConversations
      .filter((conversation) => `${conversation.title || ""} ${conversation.id} thunder`.toLowerCase().includes(q))
      .sort((a, b) => b.updated_at_ms - a.updated_at_ms);
  }, [scopedThunderConversations, sessionQuery]);

  /**
   * Catalog rows and Thunder's own rows share one timeline: both stamp ms
   * (`updatedAt` / `updated_at_ms`), so a conversation touched a minute ago
   * sorts above a session from last week. Appending Thunder after the catalog
   * is what pinned every conversation — however fresh — below every session,
   * however old. Pending rows stay on top instead: a session that has not
   * reached the catalog yet is a live terminal, not a point on the timeline.
   */
  const visibleSessionRows = useMemo<WorkbenchSessionRow[]>(() => {
    const recency = (row: WorkbenchSessionRow) => row.kind === "pending"
      ? row.pending.createdAt
      : row.kind === "thunder" ? row.conversation.updated_at_ms : row.session.updatedAt;
    const timeline = [
      ...visibleSessions.map((session) => ({ kind: "session" as const, session })),
      ...visibleThunderConversations.map((conversation) => ({ kind: "thunder" as const, conversation }))
    ].sort((a, b) => recency(b) - recency(a));
    return [
      ...visiblePendingSessions.map((pending) => ({ kind: "pending" as const, pending })),
      ...timeline
    ];
  }, [visiblePendingSessions, visibleSessions, visibleThunderConversations]);
  /**
   * What the meta row counts: every row the list holds, out of every row it
   * could hold. Thunder rows belong in both halves — leaving them out of the
   * numerator is what made a 400-row list read "3 / 120".
   */
  const sessionListCounts = useMemo(() => ({
    shown: visibleSessions.length + visiblePendingSessions.length + visibleThunderConversations.length,
    total: sessionsTotal + selectedPendingSessions.length + scopedThunderConversations.length
  }), [visibleSessions, visiblePendingSessions, visibleThunderConversations, sessionsTotal, selectedPendingSessions, scopedThunderConversations]);
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
    row.kind === "pending"
      ? row.pending.key === activeSessionKey
      : row.kind === "thunder"
        ? `thunder:${row.conversation.id}` === activeSessionKey
        : sessionKey(row.session) === activeSessionKey
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
  const currentTerminals = terminals.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const currentSessionTerminals = currentTerminals.filter((pane) => pane.group === "session");
  const currentShellTerminals = currentTerminals.filter((pane) => pane.group === "terminal");
  const currentAcpChats = acpChats.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const currentThunderChats = thunderChats.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const currentBrowsers = browsers.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const panelProject = sideRoot ?? selectedProject ?? null;
  const panelBrowsers = useMemo(
    () =>
      currentBrowsers
        .filter((pane) => !panelProject || projectPathKey(pane.projectPath) === projectPathKey(panelProject))
        .map((pane) => ({
          key: pane.key,
          browserId: pane.browserId,
          projectPath: pane.projectPath,
          title: pane.title,
          surfaceKind: pane.surfaceKind
        }))
        .reverse(),
    [currentBrowsers, panelProject]
  );
  const currentNotePanes = notePanes.filter((pane) => paneScopeKey(pane) === activeScopeKey);
  const activeTerminal = currentTerminals.find((pane) => pane.key === activePane);
  const currentAcpChat = currentAcpChats.find((pane) => pane.key === activePane);
  const currentThunderChat = currentThunderChats.find((pane) => pane.key === activePane);
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
  ;






  /** Map a workbench pane key to the catalog session row it represents, so
   *  activating a tab keeps the session-list highlight in sync (the reverse
   *  direction of clicking a wb-list-item). ACP chat panes encode their
   *  recordId in the key; session-group terminals carry their bound session,
   *  or a pending row while awaiting the catalog bind. */
  const workbenchPaneSessionKey = useCallback((paneKey: string): string => {
    if (!paneKey) return "";
    if (paneKey.startsWith("acp:")) return acpListSessionKey(paneKey.slice("acp:".length));
    if (paneKey.startsWith("thunder:")) return paneKey.startsWith("thunder:draft:") ? "" : paneKey;
    const terminalPane = terminalsRef.current.find((pane) => pane.key === paneKey);
    if (terminalPane?.sessionKey) return terminalPane.sessionKey;
    return terminalPane?.group === "session" ? `pending:${paneKey}` : "";
  }, []);


  const setActivePane = useCallback((paneKey: string, projectPath = selectedProject) => {
    if (paneKey !== activePane) focusPaneAfterPtyRef.current = "";
    const projectKey = workbenchScope(activeWorkbenchIdRef.current) ?? paneProjectKey(projectPath);
    if (paneKey) {
      const previous = paneHistoryRef.current[projectKey] || [];
      paneHistoryRef.current[projectKey] = [paneKey, ...previous.filter((key) => key !== paneKey)].slice(0, 32);
    }
    setActivePanes((current) => current[projectKey] === paneKey ? current : { ...current, [projectKey]: paneKey });
    setActiveSessionKey(workbenchPaneSessionKey(paneKey));
  }, [activePane, selectedProject, workbenchPaneSessionKey]);

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
      if (paneKey.startsWith("thunder:")) {
        document.querySelector<HTMLTextAreaElement>(".wb-thunder-chat:not([hidden]) .tb-composer-textarea")?.focus();
        return;
      }
    });
  }, []);
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

  const gitRefreshTimers = useRef(new Map<string, number>());
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
    void desktopApi().terminalInput({
      id: pane.ptyId,
      data: `${text}\r`
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
    window.requestAnimationFrame(() => {
      terminalRefs.current.get(pane.ptyId!)?.focus();
    });
  }, [composerDrafts, onTerminalInput, setActivePane]);

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
      remainingThunder?: ThunderChatPane[];
      remainingEditors?: EditorPane[];
      remainingDiffs?: DiffPane[];
    }
  ) => {
    const history = (paneHistoryRef.current[scopeKey] || []).filter((item) => item !== closedKey);
    paneHistoryRef.current[scopeKey] = history;
    const remainingTerminals =
      options?.remainingTerminals ??
      terminals.filter((item) => paneScopeKey(item) === scopeKey && item.key !== closedKey);
    const remainingAcp =
      options?.remainingAcp ?? acpChats.filter((item) => paneScopeKey(item) === scopeKey && item.key !== closedKey);
    const remainingThunder =
      options?.remainingThunder ?? thunderChats.filter((item) => paneScopeKey(item) === scopeKey && item.key !== closedKey);
    const closedGroup: WorkbenchPaneGroup | null =
      terminals.find((item) => item.key === closedKey)?.group
      ?? (acpChats.some((item) => item.key === closedKey) ? "session" : null)
      ?? (thunderChats.some((item) => item.key === closedKey) ? "session" : null);
    const groupsByKey = new Map<string, WorkbenchPaneGroup>([
      ...remainingTerminals.map((item) => [item.key, item.group] as const),
      ...remainingAcp.map((item) => [item.key, "session"] as const),
      ...remainingThunder.map((item) => [item.key, "session"] as const),
    ]);
    const liveKeys = new Set([
      ...remainingTerminals.map((item) => item.key),
      ...remainingAcp.map((item) => item.key),
      ...remainingThunder.map((item) => item.key),
    ]);
    const nextPane =
      history.find((item) => liveKeys.has(item) && groupsByKey.get(item) === closedGroup) ||
      history.find((item) => liveKeys.has(item)) ||
      remainingTerminals[remainingTerminals.length - 1]?.key ||
      remainingAcp[remainingAcp.length - 1]?.key ||
      remainingThunder[remainingThunder.length - 1]?.key ||
      "";
    if (nextPane) {
      paneHistoryRef.current[scopeKey] = [nextPane, ...history.filter((item) => item !== nextPane)].slice(0, 32);
    }
    const wasActive = activePanesRef.current[scopeKey] === closedKey;
    setActivePanes((current) => (current[scopeKey] === closedKey ? { ...current, [scopeKey]: nextPane } : current));
    // Closing the active pane switches which session row should be highlighted.
    if (wasActive) setActiveSessionKey(workbenchPaneSessionKey(nextPane));
  }, [acpChats, terminals, thunderChats, workbenchPaneSessionKey]);

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

  const closeThunderChat = useCallback((key: string) => {
    const pane = thunderChats.find((item) => item.key === key);
    setThunderChats((current) => current.filter((item) => item.key !== key));
    if (pane) {
      nextPaneAfterClose(paneScopeKey(pane), key, {
        remainingThunder: thunderChats.filter(
          (item) => paneScopeKey(item) === paneScopeKey(pane) && item.key !== key
        )
      });
    }
  }, [thunderChats, nextPaneAfterClose]);



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

  const addThunderChat = useCallback((pane: {
    sessionId?: string;
    title: string;
    projectPath: string;
  }, launch?: { initialPrompt?: string }): string => {
    const uid = `thunder:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
    const key = pane.sessionId
      ? `thunder:${pane.sessionId}`
      : `thunder:draft:${uid}`;
    const projectPath = pane.projectPath;
    const initialPrompt = launch?.initialPrompt?.trim() || undefined;
    setThunderChats((current) => {
      if (current.some((item) => item.key === key)) {
        if (!initialPrompt) return current;
        return current.map((item) =>
          item.key === key && !item.initialPrompt ? { ...item, initialPrompt } : item
        );
      }
      if (current.some((item) => item.uid === uid)) return current;
      return [
        ...current,
        {
          uid,
          key,
          sessionId: pane.sessionId,
          title: pane.title || t("desktop.workbench.thunderChat"),
          projectPath,
          workbenchId: activeWorkbenchIdRef.current ?? undefined,
          ...(initialPrompt ? { initialPrompt } : {})
        }
      ];
    });
    setActivePane(key, projectPath);
    return key;
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

  /**
   * Bind a Thunder visual pane to its real conversation once the daemon assigns
   * one, and link that conversation to the open task.
   */
  const bindThunderChatSession = useCallback((paneKey: string, sessionId: string, title?: string) => {
    if (!sessionId.trim()) return;
    const pane = thunderChatsRef.current.find((item) => item.key === paneKey);
    if (!pane) return;
    // Already bound to this conversation: nothing to rebind or relink.
    if (pane.sessionId === sessionId) return;
    const nextKey = `thunder:${sessionId}`;
    const projectPath = pane.projectPath;
    setThunderChats((current) => current.map((item) =>
      item.key === paneKey
        ? { ...item, key: nextKey, sessionId, title: title?.trim() || item.title }
        : item
    ));
    setActivePanes((current) => {
      const scope = paneScopeKey({ projectPath, workbenchId: pane.workbenchId });
      return current[scope] === paneKey ? { ...current, [scope]: nextKey } : current;
    });
    linkSessionToOpenTask(nextKey, projectPath);
    // A brand-new conversation is now listable.
    void reloadThunderConversations();
  }, [linkSessionToOpenTask, reloadThunderConversations]);

  /** Open a Thunder conversation row as a visual pane (or focus its existing pane). */
  const openThunderConversation = useCallback((conversation: ThunderConversationSummary) => {
    const key = `thunder:${conversation.id}`;
    const existing = thunderChatsRef.current.find((item) => item.sessionId === conversation.id);
    if (existing) {
      selectProject(existing.projectPath, { keepSessionKey: true });
      setActivePane(existing.key, existing.projectPath);
      setActiveSessionKey(key);
      return;
    }
    const projectPath = (conversation.workspace || selectedProject || "").trim();
    if (projectPath) selectProject(projectPath, { keepSessionKey: true });
    addThunderChat({
      sessionId: conversation.id,
      title: conversation.title || conversation.id,
      projectPath
    });
    setActiveSessionKey(key);
  }, [addThunderChat, selectProject, setActivePane]);

  /**
   * Track a Thunder TUI pane that has no conversation yet.
   *
   * Thunder mints the conversation inside the TUI process, so there is no id to
   * pass at launch: the pane is bound later, when the poll below sees the
   * conversation this workspace registered after the pane started.
   */
  const trackThunderTuiPane = useCallback((terminalKey: string, cwd: string, sessionIdHint?: string) => {
    const entry = { terminalKey, cwd, launchedAtMs: Date.now(), sessionIdHint };
    unboundThunderTuiRef.current = [...unboundThunderTuiRef.current, entry];
    setUnboundThunderTui(unboundThunderTuiRef.current);
  }, []);

  /** Launch the native Thunder TUI, optionally resuming an existing conversation. */
  const launchThunderTui = useCallback(async (conversation?: ThunderConversationSummary) => {
    const cwd = (conversation?.workspace || selectedProject || "").trim();
    if (!cwd) {
      setStatus({ text: t("desktop.workbench.selectProjectHint"), kind: "error" });
      return;
    }
    try {
      const result = await desktopApi().workbenchNewSession({
        cwd,
        provider: "thunder",
        executionMode: "standard",
        ...(conversation?.id ? { resumeSessionId: conversation.id } : {}),
        ...(taskScopeRef.current?.noteId ? { taskNoteId: taskScopeRef.current.noteId } : {})
      });
      if (result.external || result.mode === "external-system") {
        setStatus({ text: result.command || t("desktop.workbench.externalTerminalHint"), kind: "ok" });
        return;
      }
      if (result.mode === "xterm" && result.command) {
        const launchCwd = result.cwd || cwd;
        const title = conversation?.title || t("desktop.settings.newSessionTarget.cli_thunder");
        // Resuming a conversation means the pane has something to observe right
        // away; a bare TUI has to register its conversation first.
        const boundKey = conversation?.id ? `thunder:${conversation.id}` : undefined;
        const terminalKey = addTerminal(title, launchCwd, result.command, launchCwd, boundKey, "session", { env: result.env });
        if (boundKey) linkSessionToOpenTask(boundKey, launchCwd);
        else trackThunderTuiPane(terminalKey, launchCwd);
        setSessionViewMode(boundKey ? "hybrid" : "terminal");
        writeWorkbenchValue(SESSION_VIEW_MODE_KEY, activeWorkbenchIdRef.current, boundKey ? "hybrid" : "terminal");
      }
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [addTerminal, linkSessionToOpenTask, selectedProject, t, trackThunderTuiPane]);

  /**
   * AI-rename a Thunder conversation. Unlike catalog sessions this never goes
   * through `performAutoRenameSession`, which looks the session up in the
   * catalog page and would silently no-op for Thunder.
   */
  const autoRenameThunderConversation = useCallback(async (conversation: ThunderConversationSummary) => {
    const api = desktopApi();
    if (typeof api.thunderChatGenerateTitle !== "function") return;
    try {
      const result = await api.thunderChatGenerateTitle({ sessionId: conversation.id });
      if (!result?.ok) {
        setStatus({
          text: t("desktop.workbench.thunderRenameFailed", result?.error || result?.errorKind || ""),
          kind: "error"
        });
      }
      // The title lives in Thunder's own store, so the row only refreshes here.
      await reloadThunderConversations();
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [reloadThunderConversations, t]);

  /** Delete a Thunder conversation: confirm, drop its visual pane, refresh the list. */
  const deleteThunderConversation = useCallback(async (conversation: ThunderConversationSummary) => {
    const api = desktopApi();
    if (typeof api.thunderChatDeleteConversation !== "function") return;
    const key = `thunder:${conversation.id}`;
    const label = conversation.title || conversation.id;
    if (!(await confirmDestructive(
      t("desktop.workbench.deleteThunderConversationConfirm", label),
      t("desktop.common.delete")
    ))) return;
    try {
      await api.thunderChatDeleteConversation({ sessionId: conversation.id });
      // A visual pane on this conversation would be a pane on a dead id. A TUI
      // terminal bound to it is left alone: that is the user's own live process.
      if (thunderChatsRef.current.some((pane) => pane.key === key)) closeThunderChat(key);
      await reloadThunderConversations();
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [closeThunderChat, reloadThunderConversations, t]);

  // A TUI pane that was closed before its conversation appeared stops being a
  // binding target.
  useEffect(() => {
    if (!unboundThunderTuiRef.current.length) return;
    const live = unboundThunderTuiRef.current.filter((entry) =>
      terminals.some((pane) => pane.key === entry.terminalKey)
    );
    if (live.length === unboundThunderTuiRef.current.length) return;
    unboundThunderTuiRef.current = live;
    setUnboundThunderTui(live);
  }, [terminals]);

  useEffect(() => {
    if (!unboundThunderTui.length) return;
    if (typeof desktopApi().thunderChatListConversations !== "function") return;
    const timer = window.setInterval(() => { void reloadThunderConversations(); }, THUNDER_TUI_DISCOVERY_POLL_MS);
    return () => window.clearInterval(timer);
  }, [unboundThunderTui.length, reloadThunderConversations]);

  /**
   * Bind a Thunder TUI pane to the conversation its process registered: the
   * store stamps a new conversation with the TUI's start time and the pane's
   * cwd, which is how a pane with no id finds its own. A restored pane carries
   * the id it was resumed with instead.
   */
  useEffect(() => {
    if (!unboundThunderTui.length || !thunderConversations.length) return;
    // A visual chat pane owns its conversation as well, even before it has
    // rebound its pane key to it.
    const claimed = new Set([
      ...terminals.flatMap((pane) => pane.sessionKey ? [pane.sessionKey] : []),
      ...thunderChats.flatMap((pane) => pane.sessionId ? [`thunder:${pane.sessionId}`] : [])
    ]);
    const assignments = new Map<string, string>();
    const entries = [...unboundThunderTui].sort((a, b) => a.launchedAtMs - b.launchedAtMs);

    entries.forEach((entry, index) => {
      // The next pane's launch bounds this one from above: a conversation
      // stamped after it belongs to that pane, not to this one.
      const upperBound = entries[index + 1]?.launchedAtMs ?? Infinity;
      const candidate = thunderConversations
        .filter((conversation) => {
          if (claimed.has(`thunder:${conversation.id}`)) return false;
          if ((conversation.turn_count ?? 0) <= 0) return false;
          if (entry.sessionIdHint) return conversation.id === entry.sessionIdHint;
          if (projectPathKey(conversation.workspace || "") !== projectPathKey(entry.cwd)) return false;
          return conversation.created_at_ms >= entry.launchedAtMs - THUNDER_TUI_BIND_SLACK_MS
            && conversation.created_at_ms < upperBound;
        })
        .sort((a, b) => a.created_at_ms - b.created_at_ms)[0];
      if (!candidate) return;
      const bound = `thunder:${candidate.id}`;
      claimed.add(bound);
      assignments.set(entry.terminalKey, bound);
    });

    if (!assignments.size) return;
    const bindSessions = (current: TerminalPane[]) => current.map((pane) => {
      const bound = assignments.get(pane.key);
      return bound ? { ...pane, sessionKey: bound } : pane;
    });
    terminalsRef.current = bindSessions(terminalsRef.current);
    setTerminals(bindSessions);
    for (const entry of unboundThunderTui) {
      const bound = assignments.get(entry.terminalKey);
      if (bound) linkSessionToOpenTask(bound, entry.cwd);
    }
    const remaining = unboundThunderTuiRef.current.filter((entry) => !assignments.has(entry.terminalKey));
    unboundThunderTuiRef.current = remaining;
    setUnboundThunderTui(remaining);
  }, [linkSessionToOpenTask, terminals, thunderChats, thunderConversations, unboundThunderTui]);

  const closeBrowser = useCallback((key: string) => {
    const pane = browsers.find((item) => item.key === key);
    if (!pane) return;
    setBrowsers((current) => current.filter((item) => item.key !== key));
    void desktopApi().browserDestroy({ browserId: pane.browserId }).catch(() => undefined);
  }, [browsers]);

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
            surfaceKind: session.surface.kind
          }
        ];
      });
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  }, [selectedProject, t]);

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

  /** Resolve a note's display title for a pane opened or restored without one. */
  const resolveNoteTitle = useCallback((noteId: string) => {
    void desktopApi().notesRead({ noteId }).then((result) => {
      updateNotePaneTitle(noteId, result.record.title || result.record.filename.replace(/\.md$/i, "") || noteId);
    }).catch(() => undefined);
  }, [updateNotePaneTitle]);

  const setNotePaneDirty = useCallback((noteId: string, dirty: boolean) => {
    setNotePanes((current) => current.map((pane) => pane.noteId === noteId ? { ...pane, dirty } : pane));
  }, []);

  /** Open (or focus) a note as an editing tab in the pane tab groups. */
  const openNotePane = useCallback((noteId: string, title?: string) => {
    if (!noteId) return;
    const workbenchId = activeWorkbenchIdRef.current ?? undefined;
    const key = workbenchId ? `note:${workbenchId}:${noteId}` : `note:${noteId}`;
    setNotePanes((current) => {
      const existing = current.find((pane) => pane.key === key);
      if (existing) {
        // Backfill a restored pane whose title has not resolved yet.
        return existing.title || !title
          ? current
          : current.map((pane) => pane.key === key ? { ...pane, title } : pane);
      }
      return [...current, { key, noteId, projectPath: selectedProjectRef.current, title: title || "", workbenchId }];
    });
    setActivePane(key);
    if (!title) resolveNoteTitle(noteId);
  }, [setActivePane, resolveNoteTitle]);

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
    } else if (activePane.startsWith("thunder:")) {
      closeThunderChat(activePane);
    } else if (activePane.startsWith("note:")) {
      closeNotePane(activePane);
    } else {
      closeTerminal(activePane);
    }
    return true;
  }, [activePane, closeAcpChat, closeNotePane, closeTerminal, closeThunderChat]);

  const openBlankTerminal = useCallback(async (targetProject?: string) => {
    if (terminalCreating) return;
    setTerminalCreating(true);
    try {
      // A task's blank terminal follows the same rule a new session uses:
      // an explicit target, the only repository, the primary one — and a
      // zero-repository task lands in home.
      let base = targetProject;
      if (!base && taskScopeRef.current) {
        const projects = scopeProjectsRef.current;
        base = sessionTargetRef.current
          ?? (projects.length === 1 ? projects[0] : undefined)
          ?? taskScopeRef.current.primaryProject
          ?? projects[0];
      }
      base = base || selectedProject || await desktopApi().homePath();
      // Where the terminal scope points decides this, so ⌘T lands in the checkout
      // you are working in rather than always in the main one.
      const cwd = base;
      // A pane is only visible under its own project scope: when the new terminal
      // starts somewhere else than the current selection (the shared workspace of
      // a multi-repo task), the selection follows or the pane lands hidden.
      if (!selectedProject || projectPathKey(cwd) !== projectPathKey(selectedProject)) selectProject(cwd);
      addTerminal(t("desktop.workbench.terminalLabel", currentShellTerminals.length + 1), cwd, undefined, cwd);
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { setTerminalCreating(false); }
  }, [addTerminal, currentShellTerminals.length, selectedProject, t, terminalCreating]);

  const parseNewSessionTarget = useCallback((rawValue: string): WorkbenchNewSessionTarget | null => {
    const raw = rawValue.trim();
    if (raw === "thunder:visual") {
      return { channel: "thunder", mode: "visual" };
    }
    if (raw === "cli:thunder") {
      return { channel: "thunder", mode: "tui" };
    }
    if (raw.startsWith("acp:")) {
      const provider = raw.slice(4);
      if (["claude", "codex", "grok", "opencode", "pi", "prime", "omp"].includes(provider)) {
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
   * New-session cwd: an explicit target, then the task's repositories — the
   * focused folder, the only repository, else the primary one — then the
   * selected project; a zero-repository task starts in home.
   */
  const resolveNewSessionCwd = useCallback(async (targetProject?: string): Promise<string> => {
    // Whatever this resolves to, the terminal scope has the last word: it is the
    // folder the next session starts in.
    const inTerminalScope = (value: string) => value;
    if (targetProject) return inTerminalScope(targetProject);
    const scope = taskScopeRef.current;
    if (scope) {
      // An explicit chip choice always wins.
      const explicit = sessionTargetRef.current;
      if (explicit) return inTerminalScope(explicit);
      const projects = scopeProjectsRef.current;
      if (projects.length > 0) {
        return inTerminalScope(scope.primaryProject || projects[0]);
      }
    }
    if (selectedProject) return inTerminalScope(selectedProject);
    return await desktopApi().homePath();
  }, [selectedProject]);

  const launchNewSession = useCallback(async (
    target: WorkbenchNewSessionTarget,
    targetProject?: string,
    projectId?: string,
    initialPrompt?: string
  ) => {
    if (terminalCreating) return;
    setTerminalCreating(true);
    try {
      const resolvedCwd = await resolveNewSessionCwd(targetProject);
      let cwd = resolvedCwd;
      if (projectId && typeof desktopApi().resolveProjectCwd === "function") {
        const resolved = await desktopApi().resolveProjectCwd({ projectId });
        if (resolved.source === "missing" || !resolved.cwd) {
          setStatus({ text: t("desktop.workbench.pathMissingHint"), kind: "error" });
          return;
        }
        cwd = resolved.cwd;
      }
      if (taskScopeRef.current) selectProject(cwd, { keepSessionKey: true });
      const prompt = initialPrompt?.trim() || "";
      if (target.channel === "acp") {
        const record = await desktopApi().acpCreateSession({ projectPath: cwd, provider: target.provider });
        addAcpChat(record, prompt ? { initialPrompt: prompt } : undefined);
        linkSessionToOpenTask(acpListSessionKey(record.id), cwd);
        await reloadWorkbench();
      } else if (target.channel === "thunder" && target.mode === "visual") {
        addThunderChat(
          { title: t("desktop.workbench.thunderChat"), projectPath: cwd },
          prompt ? { initialPrompt: prompt } : undefined
        );
        await reloadWorkbench();
      } else {
        const provider = target.channel === "thunder" ? "thunder" : target.provider;
        const result = await desktopApi().workbenchNewSession({
          cwd,
          provider,
          executionMode: "standard",
          ...(taskScopeRef.current?.noteId ? { taskNoteId: taskScopeRef.current.noteId } : {})
        });
        if (result.unsupportedYolo || result.warning) {
          notifyDesktop({
            text: t("desktop.workbench.yoloNotSupported", provider),
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
          // Thunder's TUI keeps its own conversation store, so there is no catalog
          // session to bind a pending row to — its pane is bound by discovery.
          if (target.channel === "thunder") trackThunderTuiPane(terminalKey, launchCwd);
          else addPendingSession(terminalKey, target.provider, launchCwd, title);
          // A brand-new session has nothing to observe yet, so it opens in the
          // fullscreen terminal; the transcript split stays one toggle away.
          setSessionViewMode("terminal");
          writeWorkbenchValue(SESSION_VIEW_MODE_KEY, activeWorkbenchIdRef.current, "terminal");
        }
        await loadSessions();
      }
    } catch (error) { setStatus({ text: statusError(error), kind: "error" }); }
    finally { setTerminalCreating(false); }
  }, [addAcpChat, addPendingSession, addTerminal, addThunderChat, linkSessionToOpenTask, loadSessions, reloadWorkbench, t, terminalCreating, trackThunderTuiPane]);

  /**
   * New-session picker as a native `NSMenu`.
   *
   * Lists the CLI/ACP/Thunder targets and starts the session in the current project.
   */
  const openNewSessionMenu = useCallback(async (targetProject?: string, projectId?: string) => {
    const rect = newSessionButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const items: NativeContextMenuItem[] = [];
    const actionById = new Map<string, () => void>();
    const groups: Array<{ key: "cli" | "acp" | "thunder"; label: string }> = [
      { key: "cli", label: t("desktop.settings.newSessionGroupCli") },
      { key: "acp", label: t("desktop.settings.newSessionGroupAcp") },
      { key: "thunder", label: t("desktop.settings.newSessionGroupThunder") }
    ];
    groups.forEach((group) => {
      const options = WORKBENCH_NEW_SESSION_TARGET_OPTIONS.filter((option) => option.group === group.key);
      if (!options.length) return;
      if (items.length) items.push({ type: "separator" });
      items.push({ label: group.label, enabled: false });
      options.forEach((option) => {
        actionById.set(`target:${option.value}`, () => {
          const parsed = parseNewSessionTarget(option.value);
          if (parsed) void launchNewSession(parsed, targetProject, projectId);
        });
        items.push({ id: `target:${option.value}`, label: t(`desktop.settings.newSessionTarget.${option.value.replace(":", "_")}`) });
      });
    });
    const chosen = await showContextMenuAt({ x: rect.left, y: rect.bottom + 4 }, items);
    const action = chosen ? actionById.get(chosen) : undefined;
    action?.();
  }, [launchNewSession, parseNewSessionTarget, t]);

  const requestNewSession = useCallback(async (targetProject?: string, projectId?: string) => {
    if (terminalCreating) return;
    const target = resolveNewSessionTarget();
    if (target) {
      await launchNewSession(target, targetProject, projectId);
      return;
    }
    await openNewSessionMenu(targetProject, projectId);
  }, [launchNewSession, openNewSessionMenu, resolveNewSessionTarget, terminalCreating]);

  const newSession = useCallback(() => requestNewSession(), [requestNewSession]);

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
    const thunder = thunderChatsRef.current.find((pane) => pane.key === paneKey);
    if (thunder) {
      selectProject(thunder.projectPath, { keepSessionKey: true });
      setActivePane(thunder.key, thunder.projectPath);
      setActiveSessionKey(thunder.sessionId ? thunder.key : "");
      focusWorkbenchPane(thunder.key);
      setThunderChats((current) => current.map((pane) => pane.key === paneKey ? { ...pane, initialPrompt: prompt } : pane));
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
      // Composer history comes from the catalog, which does not hold Thunder
      // conversations (they live in the daemon's own store).
      if (identity.provider === "thunder") continue;
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
  // The Quick Agent hands a conversation over: open it here as a Thunder chat
  // pane — same session id, full transcript, ready to continue.
  useEffect(() => {
    const api = desktopApi();
    if (typeof api.onQuickAgentHandoff !== "function") return;
    return api.onQuickAgentHandoff(({ sessionId }) => {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
      const existing = thunderConversations.find((item) => item.id === sessionId);
      if (existing) {
        openThunderConversation(existing);
        return;
      }
      void reloadThunderConversations().then(() => {
        const refreshed = thunderConversationsRef.current.find((item) => item.id === sessionId);
        if (refreshed) openThunderConversation(refreshed);
      });
    });
  }, [openThunderConversation, reloadThunderConversations, thunderConversations]);
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
      // Archived tasks are not part of the workbench's context switching or its
      // move-to-task targets; an open window keeps its own task through the
      // scope payload even after the task is archived.
      const items = await desktopApi().notesListTasks({ includeArchived: false });
      setTasks(items.map(taskFromRecord));
    } catch {
      /* the sidebar list is best-effort; the board remains the source of truth */
    }
  }, []);

  // Template recolors/deletes re-resolve task accents; refresh so an open
  // window re-skins (via the accent-sync effect) without being reopened.
  // The header image comes from the same event: a replaced or removed
  // template image updates the thumbnail in place.
  const loadTaskImage = useCallback(async (noteId: string) => {
    if (typeof desktopApi().taskTemplateImageForTask !== "function") return;
    try {
      const result = await desktopApi().taskTemplateImageForTask({ noteId });
      if (taskScopeRef.current?.noteId !== noteId) return; // stale response
      setTaskImage(result.imageDataUrl ?? null);
    } catch {
      if (taskScopeRef.current?.noteId === noteId) setTaskImage(null);
    }
  }, []);
  useEffect(() => {
    const stop = desktopApi().onTaskTemplatesChanged?.(() => {
      void loadTasks();
      const noteId = taskScopeRef.current?.noteId;
      if (noteId) void loadTaskImage(noteId);
    });
    return () => stop?.();
  }, [loadTaskImage, loadTasks]);

  // Fetch the scoped task's template image once per scope change.
  useEffect(() => {
    const noteId = taskScope?.noteId;
    if (!noteId) {
      setTaskImage(null);
      return;
    }
    void loadTaskImage(noteId);
  }, [taskScope?.noteId, loadTaskImage]);

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

  const discardWorkbenchPanes = useCallback((workbenchId: string) => {
    setTerminals((current) => current.filter((item) => item.workbenchId !== workbenchId));
    setAcpChats((current) => current.filter((item) => item.workbenchId !== workbenchId));
    setThunderChats((current) => current.filter((item) => item.workbenchId !== workbenchId));
    setBrowsers((current) => current.filter((item) => item.workbenchId !== workbenchId));
  }, []);
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
    // A restored Thunder TUI pane still knows the conversation it was resumed
    // with from its own command line, so its binding does not have to wait for
    // discovery to guess it.
    for (const pane of additions) {
      if (pane.group !== "session" || pane.sessionKey) continue;
      const hint = thunderSessionIdFromCommand(pane.command);
      if (hint) trackThunderTuiPane(pane.key, pane.cwd, hint);
    }
    terminalsRef.current = [...terminalsRef.current, ...additions];
    setTerminals((current) => [
      ...current,
      ...additions.filter((pane) => !current.some((item) => item.key === pane.key))
    ]);
    const scope = workbenchScope(workbenchId);
    if (scope && !activePanesRef.current[scope]) {
      setActivePane(additions[additions.length - 1]!.key, projectPath ?? selectedProject);
    }
  }, [selectedProject, setActivePane, trackThunderTuiPane]);

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
    // Restore once per workbench: afterwards the live panes are the source of
    // truth, so re-running (e.g. after the active pane changes) would resurrect
    // tabs the user closed.
    if (restoredWorkbenchesRef.current.has(workbenchId)) return;
    restoredWorkbenchesRef.current.add(workbenchId);
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
    if (additions.length) {
      setNotePanes((current) => {
        const keys = new Set(current.map((pane) => pane.key));
        const fresh = additions.filter((pane) => !keys.has(pane.key));
        return fresh.length ? [...current, ...fresh] : current;
      });
      // Restored panes carry no title; fetch each one so the tab shows the
      // note's real name even before the pane is activated.
      for (const pane of additions) resolveNoteTitle(pane.noteId);
    }
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

  // Run a requested template script once the scoped workbench is active; a
  // fresh window queues it through its task event, an open one runs it now.
  useEffect(() => {
    if (!runScriptRequest || !activeWorkbenchId) return;
    const { name, command, cwd } = runScriptRequest.script;
    const projectPath = projectForPath(cwd) || selectedProject || cwd;
    addTerminal(name, cwd, command, projectPath);
    setRunScriptRequest(null);
  }, [runScriptRequest, activeWorkbenchId, addTerminal, projectForPath, selectedProject]);

  useEffect(() => {
    const onTask = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchTask>).detail;
      if (!detail?.noteId) return;
      pendingWorkbenchIdRef.current = (detail as { workbenchId?: string }).workbenchId ?? null;
      if ((detail as { openNote?: boolean }).openNote) {
        // Opening a task shows its note: defer until the workbench is active.
        setTaskNoteRequest({ noteId: detail.noteId, title: detail.title, nonce: Date.now() });
      }
      taskScopeRef.current = { noteId: detail.noteId, primaryProject: detail.primaryProject };
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

  // A script run requested for this workbench: from this window's task event
  // (fresh window) or from the main process (already-open window).
  useEffect(() => {
    const request = (payload: { name?: unknown; command?: unknown; cwd?: unknown }) => {
      if (typeof payload?.command !== "string" || !payload.command.trim()) return;
      if (typeof payload?.cwd !== "string" || !payload.cwd.trim()) return;
      setRunScriptRequest({
        script: {
          name: typeof payload.name === "string" && payload.name.trim() ? payload.name : payload.command,
          command: payload.command,
          cwd: payload.cwd
        },
        nonce: Date.now()
      });
    };
    const onWindowRunScript = (event: Event) => {
      request((event as CustomEvent<{ name?: string; command?: string; cwd?: string }>).detail);
    };
    window.addEventListener("agent-resume:workbench-run-script", onWindowRunScript);
    const stopIpc = typeof desktopApi().onTaskWindowRunScript === "function"
      ? desktopApi().onTaskWindowRunScript(request)
      : undefined;
    return () => {
      window.removeEventListener("agent-resume:workbench-run-script", onWindowRunScript);
      stopIpc?.();
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

  /**
   * Thunder rows share the catalog sessions' overlay menu. They stay out of
   * `selectedSessionKeys` — Thunder is not part of the catalog selection model.
   */
  const thunderConversationMenu = (event: React.MouseEvent, conversation: ThunderConversationSummary) => {
    event.preventDefault();
    const workspace = conversation.workspace || "";
    const menu: WorkbenchContextMenu = {
      kind: "thunder",
      thunderConversation: conversation,
      x: event.clientX,
      y: event.clientY
    };
    setContextMenu(menu);
    refreshFloatingNoteAvailability(thunderSessionNoteTarget(conversation, aliases[workspace] || basename(workspace)), menu);
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

  const openMoveSessionToTaskDialog = (owner: { sessionKey: string; sessionTitle: string; projectPath: string }) => {
    const options = tasks
      .map((task) => ({ noteId: task.noteId, label: task.title, path: task.primaryProject || task.projects?.[0] }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!options.length) {
      setStatus({ text: t("desktop.workbench.moveToTaskNoTargets"), kind: "error" });
      return;
    }
    setProjectPickDialog({
      kind: "moveSessionToTask",
      ...owner,
      options,
      query: "",
      busy: false,
      status: ""
    });
  };

  const applyMoveSessionToTask = async (target: { noteId: string; label: string; path?: string }) => {
    if (!projectPickDialog || projectPickDialog.kind !== "moveSessionToTask") return;
    const { sessionKey: ownerKey, projectPath } = projectPickDialog;
    setProjectPickDialog((current) => current ? { ...current, busy: true, status: t("desktop.workbench.moveToTaskRunning") } : current);
    try {
      await desktopApi().notesLinkSessionToTask({
        noteId: target.noteId,
        sessionKey: ownerKey,
        projectPath
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


  /**
   * Bring the open editors back in line with the files on disk after something
   * wrote to them. By containment, not by equality: an editor opened from a
   * checkout carries that checkout, and it is still under the root it was found
   * in when a replacement reaches it through a root one level up.
   */

  /**
   * Right-click anywhere in the scripts pane. A concrete script row sends that
   * one; a package/group row (or empty space) offers the scripts it covers.
   */
  const onScriptContextMenu = useCallback(async (event: { clientX: number; clientY: number }, scripts: ScriptEntryView[]) => {
    if (!scripts.length) return;
    const payloadOf = (script: ScriptEntryView) => ({
      name: script.name,
      command: script.run.command,
      cwd: script.run.cwd
    });
    const sendToTemplate = async (templateId: string, script: ScriptEntryView) => {
      try {
        const result = await desktopApi().taskTemplatesAddScript({ templateId, script: payloadOf(script) });
        // A task with no template joins the one it just sent to: without the
        // link its own card would never offer the command it just contributed.
        let linked = false;
        const noteId = taskScope?.noteId;
        if (!taskScope?.templateId && noteId && typeof desktopApi().taskTemplatesLinkTask === "function") {
          try {
            await desktopApi().taskTemplatesLinkTask({ noteId, templateId });
            linked = true;
            setTaskScope((current) => current ? { ...current, templateId } : current);
            window.dispatchEvent(new Event("agent-resume:notes-mutated"));
          } catch {
            linked = false;
          }
        }

        setStatus({
          text: !result.added
            ? t("desktop.workbench.scriptAlreadyOnTemplate")
            : linked
              ? t("desktop.workbench.scriptSentLinkedToTemplate")
              : t("desktop.workbench.scriptSentToTemplate"),
          kind: "ok"
        });
      } catch (error) {
        setStatus({ text: statusError(error), kind: "error" });
      }
    };
    const createTemplateWith = async (script: ScriptEntryView) => {
      try {
        const template = await desktopApi().taskTemplatesCreate({
          title: script.name,
          ...(taskScope?.projects?.length ? { projectPaths: taskScope.projects } : {}),
          scripts: [payloadOf(script)]
        });
        const noteId = taskScope?.noteId;
        if (noteId && !taskScope?.templateId && typeof desktopApi().taskTemplatesLinkTask === "function") {
          try {
            await desktopApi().taskTemplatesLinkTask({ noteId, templateId: template.templateId });
            setTaskScope((current) => current ? { ...current, templateId: template.templateId } : current);
            window.dispatchEvent(new Event("agent-resume:notes-mutated"));
          } catch {
            /* the template still exists; only the link failed */
          }
        }
        setStatus({ text: t("desktop.workbench.scriptTemplateCreated", template.title), kind: "ok" });
      } catch (error) {
        setStatus({ text: statusError(error), kind: "error" });
      }
    };

    // The common case: the task came from a template, so one click is enough.
    const ownTemplateId = taskScope?.templateId;
    /**
     * Pick the template a task most likely belongs to when it has no link yet.
     * Board conventions pair names like the "天脊" template with "天脊-1012"
     * tasks, so a title prefix wins over an overlapping project.
     */
    const suggestTemplate = (templates: Array<{ templateId: string; title: string; projectPaths: string[] }>) => {
      const title = (taskScope?.title ?? "").trim();
      const projects = taskScope?.projects ?? [];
      const byTitle = templates
        .filter((template) => title && template.title && title.startsWith(template.title))
        .sort((a, b) => b.title.length - a.title.length)[0];
      if (byTitle) return byTitle;
      return templates.find((template) =>
        template.projectPaths.length > 0 && projects.some((project) => template.projectPaths.includes(project)));
    };
    const pickTemplate = async (script: ScriptEntryView) => {
      let templates: Array<{ templateId: string; title: string; projectPaths: string[] }> = [];
      try {
        if (typeof desktopApi().taskTemplatesList === "function") templates = await desktopApi().taskTemplatesList();
      } catch {
        templates = [];
      }
      if (!templates.length) {
        await showContextMenuAt(contextMenuPoint(event), [
          { id: "none", label: t("desktop.workbench.scriptNoTemplate"), enabled: false }
        ]);
        return;
      }
      const suggested = suggestTemplate(templates);
      const items: NativeContextMenuItem[] = [
        // One click for the likely template; the picker stays one item below.
        ...(suggested
          ? [{ id: `tpl:${suggested.templateId}`, label: t("desktop.workbench.scriptSendToTemplateNamed", suggested.title) }]
          : []),
        {
          id: "send",
          label: t("desktop.workbench.scriptSendToOtherTemplate"),
          submenu: [
            ...templates.map((template) => ({ id: `tpl:${template.templateId}`, label: template.title })),
            { type: "separator" as const },
            { id: "new", label: t("desktop.gtd.createTemplate") }
          ]
        }
      ];
      const choice = await showContextMenuAt(contextMenuPoint(event), items);
      if (!choice || choice === "none") return;
      if (choice === "new") await createTemplateWith(script);
      else if (choice.startsWith("tpl:")) await sendToTemplate(choice.slice("tpl:".length), script);
    };

    // A package/group/background right-click covers several scripts: choose one first.
    if (scripts.length > 1) {
      const choice = await showContextMenuAt(contextMenuPoint(event), [{
        id: "send",
        label: t("desktop.workbench.scriptSendToTemplate"),
        submenu: scripts.map((script) => ({ id: `pick:${script.id}`, label: script.name }))
      }]);
      const script = choice?.startsWith("pick:")
        ? scripts.find((entry) => entry.id === choice.slice("pick:".length))
        : undefined;
      if (!script) return;
      if (ownTemplateId) await sendToTemplate(ownTemplateId, script);
      else await pickTemplate(script);
      return;
    }

    const script = scripts[0];
    if (ownTemplateId) {
      const choice = await showContextMenuAt(contextMenuPoint(event), [
        { id: "send", label: t("desktop.workbench.scriptSendToTemplate") }
      ]);
      if (choice === "send") await sendToTemplate(ownTemplateId, script);
      return;
    }
    await pickTemplate(script);
  }, [taskScope, t, setStatus]);

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

  const terminalThemeId = resolveTerminalThemeId(settings?.workbench?.terminalTheme);
  const desktopAppearance = useMemo(() => appearanceStateFromSettings(settings || {}), [settings]);
  const terminalEngine: TerminalEngineType = "xterm";
  const terminalRendererMode: TerminalRendererMode =
    settings?.workbench?.terminalRenderer === "canvas" ? "canvas" : "webgl";

  const saveTimers = useRef(new Map<string, number>());
  useEffect(() => () => saveTimers.current.forEach((timer) => window.clearTimeout(timer)), []);


  const openFile = async (
    path: string,
    _reveal?: unknown,
    targetProject = selectedProject
  ) => {
    const rootPath = targetProject || projectForPath(path);
    if (!rootPath) return;
    try {
      await desktopApi().workbenchOpenPath({ rootPath, filePath: path });
    } catch (error) {
      setStatus({ text: t("desktop.workbench.fileOpenExternalFailed", statusError(error)), kind: "error" });
    }
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
      setProjectPickDialog(null);
    }
  });

  const openQuickAccessDirectory = useCallback((directory: QuickAccessFile) => {
    const rootPath = projectForPath(directory.path) || quickAccessRoot;
    if (!rootPath) return;
    closeQuickAccess();
    selectProject(rootPath);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    void openFile(directory.path, undefined, rootPath);
  }, [closeQuickAccess, openFile, projectForPath, quickAccessRoot]);








  /** Hands a browser pick, annotation or console error to this scope's session. */
  const sendProbePromptToSession = useCallback((text: string) => {
    const prompt = text.trim();
    if (!prompt) return;
    const sessionPane = terminalsRef.current.find((t) => paneScopeKey(t) === activeScopeKey && t.group === "session")
      || terminalsRef.current.find((t) => t.group === "session");
    const acpPane = acpChatsRef.current.find((c) => paneScopeKey(c) === activeScopeKey);
    const targetKey = sessionPane?.key || acpPane?.key;
    const targetProjectPath = sessionPane?.projectPath || acpPane?.projectPath || panelProject || "";
    if (!targetKey) {
      void requestNewSession(targetProjectPath);
      return;
    }
    setActivePane(targetKey, targetProjectPath);
    setComposerDrafts((current) => ({
      ...current,
      [targetKey]: current[targetKey] ? `${current[targetKey]}\n${prompt}` : prompt
    }));
    window.requestAnimationFrame(() => {
      composerFocusRefs.current.get(targetKey)?.({ caret: "end" });
    });
  }, [activeScopeKey, panelProject, requestNewSession, setActivePane]);
  const setWidth = (kind: "list" | "side", delta: number) => {
    const current = kind === "list" ? listWidth : sideWidth;
    const limits = kind === "list" ? [240, 720] : [240, 840];
    const next = Math.max(limits[0], Math.min(limits[1], current + delta));
    if (kind === "list") { setListWidth(next); writeWorkbenchValue(LIST_WIDTH_KEY, activeWorkbenchIdRef.current, String(next)); }
    else { setSideWidth(next); writeWorkbenchValue(SIDE_WIDTH_KEY, activeWorkbenchIdRef.current, String(next)); }
  };
  const contextMenuWidth = contextMenu?.kind === "session" || contextMenu?.kind === "session-tab" || contextMenu?.kind === "thunder" ? 210 : 240;
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
   */  const runContextAction = async (action: string) => {
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
    if (menu.kind === "thunder" && menu.thunderConversation) {
      const conversation = menu.thunderConversation;
      const workspace = conversation.workspace || "";
      const ownerKey = `thunder:${conversation.id}`;
      if (action === "openThunderChat") {
        openThunderConversation(conversation);
        return;
      }
      if (action === "thunderTui") {
        void launchThunderTui(conversation);
        return;
      }
      if (action === "floatingNote") {
        openFloatingNote(thunderSessionNoteTarget(conversation, aliases[workspace] || basename(workspace)));
        return;
      }
      if (action === "note") {
        await openMountedNote({ scope: "session", projectPath: workspace, provider: "thunder", sessionId: conversation.id });
        return;
      }
      if (action === "autoRename") {
        void autoRenameThunderConversation(conversation);
        return;
      }
      if (action === "moveTask") {
        openMoveSessionToTaskDialog({
          sessionKey: ownerKey,
          sessionTitle: conversation.title || conversation.id,
          projectPath: workspace
        });
        return;
      }
      if (action === "deleteThunderConversation") {
        await deleteThunderConversation(conversation);
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
          await desktopApi().setSessionGtdStatus({ provider: "thunder", id: conversation.id, status });
          setGtdStatuses((current) => {
            const next = { ...current };
            if (status) next[ownerKey] = status;
            else delete next[ownerKey];
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
      return;
    }
    const session = menu.session;
    if (!session) return;
    if (action === "moveTask") {
      openMoveSessionToTaskDialog({
        sessionKey: sessionKey(session),
        sessionTitle: session.title || session.id,
        projectPath: session.projectPath || ""
      });
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
const openQuickAccessFile = useCallback(async (file: QuickAccessFile) => {
    const rootPath = projectForPath(file.path) || quickAccessRoot;
    if (!rootPath) return;
    closeQuickAccess();
    selectProject(rootPath);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    await openFile(file.path, undefined, rootPath);
  }, [closeQuickAccess, projectForPath, quickAccessRoot]);
    const macShortcuts = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const shortcut = (key: string) => macShortcuts ? `⌘${key}` : `Ctrl+${key}`;
  const openWorkbenchView = (view?: SideView) => {
    closeQuickAccess();
    if (quickAccessRoot) selectProject(quickAccessRoot);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    if (view) setSide(view);
  };
  const navigateToWorkbench = () => {
    closeQuickAccess();
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
  };
  const navigateToGtd = () => {
    closeQuickAccess();
    window.dispatchEvent(new CustomEvent("agent-resume:view-gtd"));
  };
  const openQuickAccessTask = async (task: WorkbenchTask) => {
    closeQuickAccess();
    try {
      const workbenches = await ensureTaskWorkbenches(task.noteId);
      const workbenchId = workbenches[0]?.workbenchId;
      if (!workbenchId) {
        setStatus({ text: t("desktop.gtd.windowNoWorkbench"), kind: "error" });
        return;
      }
      const opened = await desktopApi().taskWindowOpen({ noteId: task.noteId, workbenchId, title: task.title });
      if (!opened.ok) setStatus({ text: t("desktop.gtd.windowLimit", opened.limit), kind: "error" });
    } catch (error) {
      setStatus({ text: statusError(error), kind: "error" });
    }
  };

  const noProjectReason = sideRoots.length ? undefined : t("desktop.workbench.quickAccessNoProjectCommand");
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
        void openBlankTerminal(sessionTarget ?? undefined);
      }
    },
    // 5. Side Panels / 侧栏面板
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
  /**
   * Switching tasks from the palette opens (or focuses) the target task's own
   * window. This window owns exactly one workbench, so it cannot host another
   * task in place.
   */

  const clearWorkbenchDrag = () => {
    draggedSessionRef.current = null;
    setDraggedSessionKey(null);
  };
  const sessionTabCount = currentSessionTerminals.length + currentAcpChats.length + currentThunderChats.length;
  const terminalTabCount = currentShellTerminals.length;
  const noteTabCount = currentNotePanes.length;
  const sessionTabListRef = useRef<HTMLDivElement | null>(null);
  const terminalTabListRef = useRef<HTMLDivElement | null>(null);
  const noteTabListRef = useRef<HTMLDivElement | null>(null);
  const tabPreview = useTabPreview();
  const paneTabGroups = <div className="wb-pane-tab-groups">
    <div className="wb-terminal-tabs is-session-group" data-pane-group="session">
      <button ref={newSessionButtonRef} type="button" className={`wb-pane-tab-group-label${terminalCreating ? " is-busy" : ""}`} disabled={terminalCreating} aria-label={t("desktop.workbench.newSession")} title={t("desktop.workbench.newSession")} aria-haspopup="menu" onClick={() => void newSession()}>{terminalCreating ? <ThemeIcon name="loader" className="spin" size={ICON_SIZE.dense} aria-hidden="true" /> : <ThemeIcon name="bot" size={ICON_SIZE.dense} aria-hidden="true" />}{sessionTabCount > 0 ? <span className="wb-pane-tab-group-count" aria-hidden="true">{sessionTabCount}</span> : null}</button>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.tabGroupSession")} ref={sessionTabListRef}>
        <PaneTabThumb listRef={sessionTabListRef} activeKey={activePane} tabCount={sessionTabCount} />
        {currentSessionTerminals.map((pane) => <div className={`wb-terminal-tab is-session${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key} {...tabPreview.bind(activePane === pane.key ? null : sessionPreviewTarget(pane, sessionTabTitle(pane, sessionTitles)))} onContextMenu={(event) => sessionTabMenu(event, terminalSessionNoteTarget(pane, aliases[pane.projectPath] || basename(pane.projectPath)), pane.key)}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ProviderIcon provider={sessionIdentityFromKey(pane.sessionKey)?.provider || ""} size={ICON_SIZE.dense} aria-hidden="true" />{sessionTabDot(sessionRuntimeByPaneKey.get(pane.key)?.status)}<span className="wb-terminal-tab-title">{sessionTabTitle(pane, sessionTitles)}</span></button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeTerminal")} onClick={() => closeTerminal(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
        {currentAcpChats.map((pane) => <div className={`wb-terminal-tab is-session is-acp${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key} {...tabPreview.bind(activePane === pane.key ? null : acpPreviewTarget(pane, sessionTabTitle(pane, sessionTitles)))} onContextMenu={(event) => sessionTabMenu(event, acpSessionNoteTarget(pane, aliases[pane.projectPath] || basename(pane.projectPath)), pane.key)}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ProviderIcon provider={pane.provider} size={ICON_SIZE.dense} aria-hidden="true" />{sessionTabDot(sessionRuntimeByPaneKey.get(pane.key)?.status)}<span className="wb-terminal-tab-title">{sessionTabTitle(pane, sessionTitles)}</span></button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeAcpChat")} onClick={() => closeAcpChat(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
        {currentThunderChats.map((pane) => <div className={`wb-terminal-tab is-session is-thunder${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.uid} {...tabPreview.bind(activePane === pane.key ? null : thunderPreviewTarget(pane, sessionTitles.get(pane.key)?.trim() || pane.title))}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ProviderIcon provider="thunder" size={ICON_SIZE.dense} aria-hidden="true" />{sessionTabDot(sessionRuntimeByPaneKey.get(pane.key)?.status)}<span className="wb-terminal-tab-title">{sessionTitles.get(pane.key)?.trim() || pane.title}</span></button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeThunderChat")} onClick={() => closeThunderChat(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
      </div>
    </div>
    <div className="wb-terminal-tabs is-terminal-group" data-pane-group="terminal">
      <button type="button" className={`wb-pane-tab-group-label${terminalCreating ? " is-busy" : ""}`} disabled={terminalCreating} aria-label={t("desktop.workbench.newTerminal")} title={t("desktop.workbench.newTerminal")} onClick={() => void openBlankTerminal()}>{terminalCreating ? <ThemeIcon name="loader" className="spin" size={ICON_SIZE.dense} aria-hidden="true" /> : <ThemeIcon name="terminal" size={ICON_SIZE.dense} aria-hidden="true" />}{terminalTabCount > 0 ? <span className="wb-pane-tab-group-count" aria-hidden="true">{terminalTabCount}</span> : null}</button>
      {/* Beside the new-terminal button, because that is what it decides: the
          folder the next terminal — and the next session — starts in. */}
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.workbench.tabGroupTerminal")} ref={terminalTabListRef}>
        <PaneTabThumb listRef={terminalTabListRef} activeKey={activePane} tabCount={terminalTabCount} />
        {currentShellTerminals.map((pane) => <div className={`wb-terminal-tab is-terminal${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key} {...tabPreview.bind(activePane === pane.key ? null : terminalPreviewTarget(pane))}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="terminal" size={ICON_SIZE.dense} aria-hidden="true" /><span className="wb-terminal-tab-title">{pane.title}</span></button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.workbench.closeTerminal")} onClick={() => closeTerminal(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
      </div>
    </div>
    
    <div className="wb-terminal-tabs is-note-group" data-pane-group="note">
      <button type="button" className="wb-pane-tab-group-label" aria-label={t("desktop.notes.newLinkedChild")} title={t("desktop.notes.newLinkedChild")} onClick={() => void addChildNote()}><ThemeIcon name="file-plus" size={ICON_SIZE.dense} aria-hidden="true" />{noteTabCount > 0 ? <span className="wb-pane-tab-group-count" aria-hidden="true">{noteTabCount}</span> : null}</button>
      <div className="wb-terminal-tabs-list" role="tablist" aria-label={t("desktop.notes.allNotes")} ref={noteTabListRef}>
        <PaneTabThumb listRef={noteTabListRef} activeKey={activePane} tabCount={noteTabCount} />
        {currentNotePanes.map((pane) => <div className={`wb-terminal-tab is-note${activePane === pane.key ? " active" : ""}`} role="tab" aria-selected={activePane === pane.key} key={pane.key} {...tabPreview.bind(activePane === pane.key ? null : notePreviewTarget(pane, pane.title || t("desktop.common.loading")))}><button type="button" className="wb-terminal-tab-label" onClick={() => setActivePane(pane.key)}><ThemeIcon name="file-text" size={ICON_SIZE.dense} aria-hidden="true" /><span className="wb-terminal-tab-title">{pane.dirty ? "* " : ""}{pane.title || t("desktop.common.loading")}</span></button><button type="button" className="wb-terminal-tab-close" aria-label={t("desktop.common.close")} onClick={() => closeNotePane(pane.key)}><ThemeIcon name="close" size={ICON_SIZE.dense} /></button></div>)}
      </div>
    </div>
  </div>;

;


  if (!host) return null;

  const headerSlot = document.getElementById("app-header-slot");
  // A workbench window has no app header to portal into, so it renders the same
  // header itself, where the window's own chrome strip is.
  const inlineHeader = document.documentElement.dataset.windowMode === "task";
  // The header names the task and points at the directory the workbench is in:
  // an explicitly activated project, the task's only project, else its primary
  // one — the same rule a new session uses for its cwd.
  const headerDirectoryBase = sessionTarget
    || (scopeProjects.length === 1 ? scopeProjects[0] : null)
    || (taskScope ? (taskScope.primaryProject || scopeProjects[0] || null) : null)
    || selectedProject
    || null;
  const headerDirectory = headerDirectoryBase;
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
        await desktopApi().workbenchRevealPath({ rootPath: target, targetPath: target });
      } catch (error) {
        notifyDesktop({ text: error instanceof Error ? error.message : String(error), kind: "error" });
      }
    })();
  };
  const workbenchTabsBar = taskScope && workbenches.length > 0 ? (
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
  ) : null;

  const detailHeader = (
    <WorkbenchDetailHeader
      title={headerTitle}
      directory={headerDirectory}
      onRevealDirectory={headerDirectory ? revealHeaderDirectory : undefined}
      imageUrl={taskScope ? taskImage : null}
      side={side}
      onToggleSide={(view) => setSide((current) => current === view ? null : view)}
      centerContent={workbenchTabsBar}
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
                onClick={() => openNotePane(taskScope.noteId, taskScope.title)}
                aria-label={t("desktop.workbench.taskOpenNote")}
                title={t("desktop.workbench.taskOpenNote")}
              >
                <ThemeIcon name="file-text" size={ICON_SIZE.default} />
              </button>
              <button
                type="button"
                className="wb-icon-btn"
                aria-label={t("desktop.workbench.taskSettings")}
                title={t("desktop.workbench.taskSettings")}
                aria-haspopup="dialog"
                onClick={() => setTaskSettingsOpen(true)}
              >
                <ThemeIcon name="settings" size={ICON_SIZE.default} />
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
                      onClick={() => {
                        // Clicking the focused chip again releases the override:
                        // new sessions fall back to the automatic rule (the only
                        // repository, else the primary one) instead of this one.
                        if (sessionTarget && projectPathKey(path) === projectPathKey(sessionTarget)) {
                          setSessionTarget(null);
                          return;
                        }
                        setSessionTarget(path);
                        selectProject(path, { keepSessionKey: true });
                      }}
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
          </section>
        )}
        <div className="wb-left-tabs" role="tablist" aria-label={t("desktop.workbench.leftPaneTabs")}>
          <button type="button" role="tab" className={`wb-left-tab${leftTab === "session" ? " active" : ""}`} aria-selected={leftTab === "session"} onClick={() => setLeftTab("session")}>{t("desktop.workbench.sessionTab")}</button>
          <button type="button" role="tab" className={`wb-left-tab${leftTab === "note" ? " active" : ""}`} aria-selected={leftTab === "note"} onClick={() => setLeftTab("note")}>{t("desktop.workbench.noteTab")}</button>
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
        <div className="wb-list-meta-row"><p className="wb-list-meta">{selectedSessionKeys.size > 1 ? t("desktop.workbench.selectedCount", selectedSessionKeys.size) : sessionQuery ? t("desktop.workbench.listMetaSearch", selectedSessionScope, sessionQuery, sessionListCounts.shown) : `${sessionListCounts.shown} / ${sessionListCounts.total}`}</p>{selectedSessionKeys.size > 1 ? <button type="button" className="wb-list-remove-btn" onClick={() => {
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
          getKey={(row) => row.kind === "pending" ? row.pending.key : row.kind === "thunder" ? `thunder:${row.conversation.id}` : sessionKey(row.session)}
          renderItem={(row) => {
            if (row.kind === "pending") {
              const pending = row.pending;
              return <button type="button" className={`wb-list-item has-wb-activity${activeSessionKey === pending.key ? " active" : ""}`} onClick={() => focusPendingSession(pending)}><span className="wb-list-item-top"><span className="wb-session-title-wrap"><span className="wb-session-activity-dot" aria-hidden="true" /><span className="wb-list-item-title" ref={(el) => syncTruncationTitle(el)}>{pending.title}</span></span></span><span className="wb-list-item-preview" ref={(el) => syncTruncationTitle(el)}><span className="wb-list-item-date">{formatDateTime(pending.createdAt)}</span><span className="s-provider-tag" data-provider={pending.provider}>{pending.provider}</span>{" · "}{aliases[pending.projectPath] || basename(pending.projectPath)}</span></button>;
            }
            if (row.kind === "thunder") {
              const conversation = row.conversation;
              const key = `thunder:${conversation.id}`;
              const gtdStatus = gtdStatuses[key];
              const isOpen = openSessionKeys.has(key);
              return <button
                type="button"
                className={`wb-list-item${activeSessionKey === key ? " active" : ""}${isOpen ? " has-wb-activity" : ""}`}
                onClick={() => {
                  setSelectedSessionKeys(new Set());
                  setSelectionAnchorKey("");
                  openThunderConversation(conversation);
                }}
                onContextMenu={(event) => thunderConversationMenu(event, conversation)}
              ><span className="wb-list-item-top"><span className="wb-session-title-wrap">{isOpen ? <span className="wb-session-activity-dot" aria-hidden="true" /> : null}<span className="wb-list-item-title" ref={(el) => syncTruncationTitle(el)}>{conversation.title || conversation.id}</span></span></span><span className="wb-list-item-preview" ref={(el) => syncTruncationTitle(el)}><span className="wb-list-item-date">{formatDateTime(conversation.updated_at_ms)}</span><span className="s-provider-tag" data-provider="thunder">thunder</span>{gtdStatus ? <span className={`wb-gtd-status-badge is-${gtdStatus}`} aria-label={t("desktop.workbench.gtdStatusLabel", t(`desktop.workbench.gtdStatus.${gtdStatus}`))}>{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</span> : <span className="wb-gtd-status-badge is-unmarked" title={t("desktop.gtd.unmarkedHint")}>{t("desktop.gtd.unmarked")}</span>}{conversation.workspace ? <>{" · "}{aliases[conversation.workspace] || basename(conversation.workspace)}</> : null}</span></button>;
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
        <div className="wb-detail-body">
          <div className="wb-terminal-shell">{paneTabGroups}<div className="wb-terminal-stack">{terminals.filter((pane) => paneScopeKey(pane) === activeScopeKey && pane.key === activePane).map((pane) => {
            const sessionIdentity = sessionIdentityFromKey(pane.sessionKey);
            const pending = pendingSessions.find((item) => item.terminalKey === pane.key);
            const isSession = pane.group === "session";
            const showSplit = isSession && sessionViewMode === "hybrid";
            const composerProjects = EMPTY_COMPOSER_WORKSPACE_PROJECTS;

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
                        {tuiCollapsed && sessionRuntimeByPaneKey.get(pane.key)?.status === "awaiting_user" ? (
                          <span className="wb-session-split-tui-awaiting">
                            <span className="session-dot is-awaiting" aria-hidden="true" />
                            <span>{t("desktop.workbench.sessionDot.awaiting")}</span>
                          </span>
                        ) : null}
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

            // The floating cd switcher belongs strictly on shell terminals
            // (pane.group === "terminal") of a multi-repository task:
            // sessions run agents (Claude, Codex, …) with their own prompt flows
            // and must never show this control.
            const isSharedTerminal = Boolean(
              pane.group === "terminal"
              && taskScope
              && scopeProjects.length > 1
            );

            const cdTerminalTo = (targetPath: string) => {
              if (pane.ptyId == null) return;
              const targetCwd = targetPath;
              void desktopApi().terminalInput({ id: pane.ptyId, data: `cd ${shellQuotePath(targetCwd)}\r` });
              onTerminalInput(pane.key);
              setTerminalCdTargets((current) => ({ ...current, [pane.key]: targetPath }));
              window.requestAnimationFrame(() => {
                terminalRefs.current.get(pane.ptyId!)?.focus();
              });
            };

            const handleCdToProject = (projectPath: string) => {
              // A pure shell `cd`: the pane stays scoped to the folder it was
              // opened in, so moving the panel selection here would just hide it.
              cdTerminalTo(projectPath);
            };

            return (
              <div key={pane.key} className="wb-terminal-pane-wrap">
                {isSession || isSharedTerminal ? (
                  <div className="wb-terminal-fullscreen-bar">
                    {isSharedTerminal ? (
                      <div className="wb-terminal-project-switcher" role="toolbar" aria-label={t("desktop.workbench.terminalSwitchProject")}>
                        <span className="wb-terminal-project-switcher-label" title={t("desktop.workbench.terminalSwitchProject")}>
                          <ThemeIcon name="folder" size={ICON_SIZE.dense} aria-hidden="true" />
                          <span>cd:</span>
                        </span>
                        <div className="wb-terminal-project-switcher-list">
                          {scopeProjects.map((path) => {
                            const label = aliases[path] || basename(path);
                            const targetCwd = path;
                            const isCdTarget = projectPathKey(terminalCdTargets[pane.key] || "") === projectPathKey(path);
                            return (
                              <button
                                key={path}
                                type="button"
                                className={`wb-terminal-project-chip${isCdTarget ? " is-active" : ""}`}
                                title={`${t("desktop.workbench.terminalCdActionTitle", label)} (${targetCwd})`}
                                aria-label={t("desktop.workbench.terminalCdProject", label)}
                                onClick={() => handleCdToProject(path)}
                              >
                                <span className="wb-terminal-project-chip-label">{label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    {isSession ? (
                      <button
                        type="button"
                        className="wb-terminal-mode-toggle-btn"
                        onClick={toggleSessionViewMode}
                        title={t("desktop.workbench.splitViewMode")}
                      >
                        <ThemeIcon name="file-text" size={ICON_SIZE.dense} />
                        <span>{t("desktop.workbench.splitViewMode")}</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <TerminalView pane={pane} active={active} themeId={terminalThemeId} appearance={desktopAppearance} rendererMode={terminalRendererMode} engineType={terminalEngine} onPty={onPty} onDetach={onPtyDetach} onInput={onTerminalInput} onInitialPromptSubmitted={onInitialPromptSubmitted} mouseTracking={terminalMouseTrackingRef} />
                {pane.group === "session" ? (
                  <>
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
                </>
                ) : null}
              </div>
            );
          })}{currentNotePane ? <NotePaneView key={currentNotePane.key} noteId={currentNotePane.noteId} active={active} onOpenNote={(noteId) => openNotePane(noteId)} onTitleChange={updateNotePaneTitle} onDirtyChange={setNotePaneDirty} onClose={() => closeNotePane(currentNotePane.key)} /> : null}{acpChats.map((pane) => {
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
          })}{thunderChats.map((pane) => {
            const visible = paneScopeKey(pane) === activeScopeKey && activePane === pane.key;
            return <ThunderChatView
              key={pane.uid}
              sessionId={pane.sessionId}
              projectPath={pane.projectPath}
              title={pane.title}
              active={active && visible}
              taskNoteId={taskScope?.noteId}
              initialPrompt={pane.initialPrompt}
              onSessionReady={(sessionId) => bindThunderChatSession(pane.key, sessionId)}
              onTitleChange={(nextTitle) => {
                setThunderChats((current) => current.map((item) => item.uid === pane.uid ? { ...item, title: nextTitle } : item));
              }}
              onInitialPromptSubmitted={() => {
                setThunderChats((current) => current.map((item) => item.uid === pane.uid ? { ...item, initialPrompt: undefined } : item));
              }}
            />;
          })}{terminalCreating && !currentTerminals.some((pane) => !pane.ptyId) && !currentAcpChat ? <div className="wb-terminal-loading wb-terminal-loading-stack" role="status" aria-live="polite"><ThemeIcon name="loader" className="spin" size={ICON_SIZE.prominent} aria-hidden="true" /><span>{t("desktop.common.loading")}</span></div> : null}{!terminalCreating && !currentTerminals.length && !currentAcpChats.length && !currentThunderChats.length && !currentBrowsers.length && !currentNotePanes.length ? <p className="muted wb-terminal-hint">{selectedProject ? t("desktop.workbench.selectSessionHint") : t("desktop.workbench.selectProjectHint")}</p> : null}</div></div>
          {side === "browser" ? <><ResizeHandle label={t("desktop.workbench.resizeSidePanel")} onDelta={(delta) => setWidth("side", -delta)} /><aside className="wb-side-panel"><BrowserSidePanel active={active} browsers={panelBrowsers} projectPath={panelProject} onRequestCreate={() => void openBrowser(panelProject ?? undefined)} onOpenSource={(path, line) => void openFile(path, { path, line: line ?? 1, column: 1, endColumn: 1 }, projectForPath(path) || undefined)} onSendToSession={sendProbePromptToSession} /></aside></> : side ? <><ResizeHandle label={t("desktop.workbench.resizeSidePanel")} onDelta={(delta) => setWidth("side", -delta)} /><aside className="wb-side-panel">{side === "scripts" ? <WorkbenchScriptsPane hasProject={sideRoots.length > 0} selectedProject={sideRoot} packages={scriptPackages} loading={scriptsLoading} error={scriptsError} truncated={scriptsTruncated} onRefresh={sideRoots.length ? () => void loadScripts() : undefined} onRun={runScript} onScriptContextMenu={onScriptContextMenu} /> : null}</aside></> : null}
        </div>
      </main>
    </div>
    
    {selectionResult ? (
      <SelectionActionResult
        result={selectionResult}
        closing={selectionResultClosing}
        onClose={clearSelectionResult}
        onCopy={copySelectionResult}
      />
    ) : null}
    
    {contextMenu && !(contextMenu.kind === "task" && contextMenu.taskHasSessions && !(contextMenu.noteId === taskScope?.noteId && taskRollup?.override)) ? <div ref={contextMenuRef} className={`wb-context-menu${contextMenu.kind === "session" || contextMenu.kind === "session-tab" || contextMenu.kind === "thunder" ? " wb-session-context-menu" : ""}${contextMenuClosing ? " is-closing" : ""}`} role="menu" style={{ left: contextMenuLeft, top: contextMenu.y, visibility: "hidden" }} onContextMenu={(event) => event.preventDefault()}>
      {contextMenu.kind === "session-tab" ? <button type="button" role="menuitem" onClick={() => void runContextAction("floatingNote")}>{t(contextMenu.hasFloatingNote ? "desktop.workbench.openFloatingNote" : "desktop.workbench.addFloatingNote")}</button> : contextMenu.kind === "editor-tab" ? <button type="button" role="menuitem" onClick={() => void runContextAction("toggleEditorPreview")}>{t(contextMenu.editorPreview ? "desktop.common.edit" : "desktop.workbench.preview")}</button> : contextMenu.kind === "note" ? <>
        <span className="wb-context-menu-label">{t("desktop.workbench.setGtdStatus")}</span>
        <div className="wb-gtd-context-tags" role="group" aria-label={t("desktop.workbench.setGtdStatus")}>
          {GTD_STATUSES.map((gtdStatus) => <button type="button" role="menuitemradio" className={`wb-gtd-context-tag is-${gtdStatus}`} aria-checked={noteItems.find((item) => item.noteId === contextMenu.noteId)?.gtdStatus === gtdStatus} key={gtdStatus} onClick={() => void runContextAction(`gtd:${gtdStatus}`)}>{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</button>)}
        </div>
        {noteItems.find((item) => item.noteId === contextMenu.noteId)?.gtdStatus ? <button type="button" role="menuitem" onClick={() => void runContextAction("gtd:clear")}>{t("desktop.workbench.clearGtdStatus")}</button> : null}
      </> : contextMenu.kind === "task" ? <>{contextMenu.noteId && contextMenu.noteId === taskScope?.noteId && taskRollup?.override ? <button type="button" role="menuitem" onClick={() => void runContextAction("followChildren")}>{t("desktop.gtd.followChildren")}</button> : null}{!contextMenu.taskHasSessions ? <><button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => void runContextAction("deleteTask")}>{t("desktop.workbench.deleteTask")}</button></> : null}</> : contextMenu.kind === "thunder" && contextMenu.thunderConversation ? <>
        <button type="button" role="menuitem" onClick={() => void runContextAction("openThunderChat")}>{t("desktop.workbench.openThunderChat")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("thunderTui")}>{t("desktop.workbench.resumeThunderTui")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("floatingNote")}>{t(contextMenu.hasFloatingNote ? "desktop.workbench.openFloatingNote" : "desktop.workbench.addFloatingNote")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("note")}>{t("desktop.workbench.mountNote")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("autoRename")}>{t("desktop.workbench.autoRename")}</button>
        <button type="button" role="menuitem" onClick={() => void runContextAction("moveTask")}>{t("desktop.workbench.moveToTask")}</button>
        <div className="context-menu-separator" role="separator" />
        <span className="wb-context-menu-label">{t("desktop.workbench.setGtdStatus")}</span>
        <div className="wb-gtd-context-tags" role="group" aria-label={t("desktop.workbench.setGtdStatus")}>
          {GTD_STATUSES.map((gtdStatus) => <button type="button" role="menuitemradio" className={`wb-gtd-context-tag is-${gtdStatus}`} aria-checked={contextMenu.thunderConversation ? effectiveGtdStatusForKey(gtdStatuses, `thunder:${contextMenu.thunderConversation.id}`) === gtdStatus : false} key={gtdStatus} onClick={() => void runContextAction(`gtd:${gtdStatus}`)}>{t(`desktop.workbench.gtdStatus.${gtdStatus}`)}</button>)}
        </div>
        {contextMenu.thunderConversation && gtdStatuses[`thunder:${contextMenu.thunderConversation.id}`] ? <button type="button" role="menuitem" onClick={() => void runContextAction("gtd:clear")}>{t("desktop.workbench.clearGtdStatus")}</button> : null}
        <div className="context-menu-separator" role="separator" />
        <button type="button" role="menuitem" className="context-menu-item-danger" onClick={() => void runContextAction("deleteThunderConversation")}>{t("desktop.workbench.deleteThunderConversation")}</button>
      </> : selectedSessionKeys.size > 1 && contextMenu.session && selectedSessionKeys.has(sessionKey(contextMenu.session)) ? <>
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
    {projectPickDialog ? <div className={`wb-note-created-overlay${projectPickDialogClosing ? " is-closing" : ""}`}><div className="wb-note-created-backdrop" onClick={() => !projectPickDialog.busy && setProjectPickDialog(null)} /><div className="wb-note-created-panel wb-project-pick-panel" role="dialog" aria-modal="true" aria-label={t("desktop.workbench.moveToTask")}><p className="wb-note-created-title">{t("desktop.workbench.moveToTaskTitle", projectPickDialog.sessionTitle)}</p><p className="muted wb-rename-status">{t("desktop.workbench.moveToTaskHint")}</p><input type="search" className="wb-rename-input" value={projectPickDialog.query} placeholder={t("desktop.common.search")} autoComplete="off" spellCheck={false} disabled={projectPickDialog.busy} onChange={(event) => setProjectPickDialog((current) => current ? { ...current, query: event.target.value } : current)} />{projectPickDialog.status ? <p className="wb-rename-status muted">{projectPickDialog.status}</p> : null}<div className="wb-project-pick-list" role="listbox">{projectPickDialog.options.filter((item) => `${item.label} ${item.path ?? ""}`.toLowerCase().includes(projectPickDialog.query.trim().toLowerCase())).map((item) => <button type="button" className="wb-project-pick-item" key={item.noteId} disabled={projectPickDialog.busy} onClick={() => void applyMoveSessionToTask(item)}><span className="wb-project-pick-label">{item.label}</span>{item.path ? <span className="wb-project-pick-path">{item.path}</span> : null}</button>)}</div><div className="wb-note-created-actions"><button type="button" className="wb-note-created-btn" disabled={projectPickDialog.busy} onClick={() => setProjectPickDialog(null)}>{t("desktop.common.cancel")}</button></div></div></div> : null}
    {taskScope ? <TaskSettingsSheet
      open={taskSettingsOpen}
      onClose={() => setTaskSettingsOpen(false)}
      title={taskScope.title || taskScope.noteId}
      statusColumn={desktopGtdColumn(taskRollup?.status ?? taskScope.status)}
      statusLabel={t(desktopGtdLabelKey(taskRollup?.status ?? taskScope.status))}
      projects={scopeProjects}
      aliases={aliases}
      onAddProject={() => void pickTaskProject()}
      onRemoveProject={(path) => void removeProject(path)}
      onRevealPath={(path) => { void desktopApi().workbenchRevealPath({ rootPath: path, targetPath: path }).catch(() => undefined); }}
    /> : null}
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
    {active ? tabPreview.card : null}
  </>, host);
}
