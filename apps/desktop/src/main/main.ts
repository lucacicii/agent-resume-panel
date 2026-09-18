import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerMonitor, screen, shell, Tray } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  AGENT_TOOL_CATALOG,
  type AgentToolDescriptor,
  discoverSkills,
  readSkillContent,
  skillToToolDescriptor,
  autoRenameSessionAction,
  suggestSessionRenameAction,
  buildNewSessionCommand,
  buildResumeCommand,
  supportsNewSessionYoloMode,
  MCP_SESSION_ENV,
  type NewSessionExecutionMode,
  effectivePanelHome,
  expandHome,
  listTaskGtdRollups,
  resolveTaskGtdRollup,
  getReportEntryById,
  getSessionById,
  getUsageSummary,
  appendComposerSend,
  listComposerSends,
  importComposerSendsForSession,
  hideSessionAction,
  listLlmUsageEvents,
  listProjects,
  listScheduleRuns,
  countSessions,
  querySessionsPage,
  unhideAllSessionsInCatalog,
  unhideSessionInCatalog,
  unhideAllProjectsInCatalog,
  loadProjectAliasesMap,
  loadSessionPreview,
  loadSettings,
  ensureProjectForPath,
  unhideProjectInCatalog,
  setProjectKeptVisibleInCatalog,
  resolveProjectCwd,
  resolveProjectCwdForPath,
  listWorkbenchSessionFolders,
  listWorkbenchSessionFolderAssignments,
  listAllWorkbenchSessionFolders,
  listAllWorkbenchSessionFolderAssignments,
  createWorkbenchSessionFolder,
  renameWorkbenchSessionFolder,
  deleteWorkbenchSessionFolder,
  assignWorkbenchSessionToFolder,
  removeWorkbenchSessionFromFolder,
  listTaskWorkbenches,
  listAllTaskWorkbenches,
  createTaskWorkbench,
  ensureTaskWorkbench,
  renameTaskWorkbench,
  setTaskWorkbenchProject,
  setTaskWorkbenchLayout,
  reorderTaskWorkbenches,
  deleteTaskWorkbench,
  listTaskWorkbenchSessionLinks,
  assignSessionToTaskWorkbench,
  removeSessionFromTaskWorkbench,

  openChatGptAppSession,
  openProjectInEditor,
  openCommandInSystemTerminal,
  openSessionInSystemTerminal,
  renameSessionAction,
  resolveProjectEditor,
  resolvePanelHome,
  resolvePreviewHomes,
  resolveScratchBaseDir,
  clearSessionGtdStatus,
  clearSessionLastExitWaiting,
  isGtdStatus,
  loadSessionGtdMap,
  recordLastExitWaitingSessions,
  saveSettings,
  sessionSyncOptionsFromSettings,
  syncAgentSessions,
  setSessionGtdStatus,
  setSessionLastExitWaiting,
  summarizeSessionAction,
  type AgentProvider,
  type GtdStatus,
  type NoteRecord,
  type PanelSettings,
  type AgentSessionSyncResult
} from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";
import { installArpmShell, installArpmShim, resolveArpmCliPath } from "./arpmInstall";
import {
  createExternalBrowserMcpLaunchConfig,
  createExternalMcpLaunchConfig,
  listMcpClients,
  manualMcpConfig,
  migrateLegacyAgentResumeRegistrations,
  registerMcpClient,
  removeMcpClient,
  resolveExternalBrowserMcpCliPath,
  resolveExternalMcpCliPath,
  type McpClientId
} from "./mcpRegistration";
import {
  fetchProviderModelsFromDraft,
  testProviderConnectionFromDraft,
  type ProviderTestConnectionArgs
} from "./providerSettings";
import {
  disposeAcpController,
  disposeAllAcpControllers,
  getAcpRuntimeMetrics,
  connectAcpChat,
  cancelAcpChat,
  denyAcpPermission,
  promptAcpChat,
  registerAcpIpc,
  setAcpModel,
  setAcpThoughtLevel
} from "./acp/acpHost";
import { registerSelectionIpc } from "./selection/ipc";
import { getAcpRecord, updateAcpRecord } from "./acp/store";
import { registerWorkbenchFsIpc } from "./workbenchFs";
import {
  disposeWorkbenchWatchers,
  getWorkbenchWatcherRuntimeMetrics,
  registerWorkbenchWatcherIpc,
  setWorkbenchWatcherActive
} from "./workbenchWatcher";
import { registerWorkbenchGitIpc } from "./workbenchGit";
import { registerWorkbenchScriptsIpc } from "./workbenchScripts";
import {
  closeAllTaskWindows,
  focusTaskWindow,
  focusedOrRecentTaskWindow,
  isTaskWindowSender,
  listTaskWindows,
  MAX_TASK_WINDOWS,
  openTaskWindow,
  openTaskWindowCount,
  setTaskWindowTitle,
  summarizeTaskWindows,
  taskWindowOpenTimings,
  taskWindowStateForSender,
  type TaskWindowDeps
} from "./taskWindows";
import { applyWindowBackgrounds, windowBackgroundColor } from "./windowAppearance";
import { loadStoredTaskWindows, saveStoredTaskWindows, taskWindowStatePath } from "./taskWindowStore";
import {
  disposeBrowserController,
  disposeBrowserMcpServer,
  listBrowserToolDescriptors,
  registerBrowserIpc
} from "./browser";
import { syncExternalMcpRegistration } from "./externalMcp";
import {
  DEFAULT_RECENT_STANDALONE_NOTE_SHORTCUT,
  DEFAULT_STANDALONE_NOTE_SHORTCUT,
  isQuickAccessShortcut,
  normalizeGlobalShortcut
} from "./desktopShortcuts";
import { STANDALONE_NOTE_INITIAL_CONTENT } from "../shared/standaloneNote";
import {
  type WorkbenchActiveSessionDot,
  parseWorkbenchActiveSessionDots,
  parseWorkbenchFocusSessionRequest,
  parseWorkbenchSendSelectionRequest
} from "../shared/workbenchSelection";
import {
  composeTrayItems,
  composeWorkbenchRows,
  hitTestTrayDotFromScreen,
  sessionDotsTrayImage,
  trayTooltip,
  type TrayWorkbench
} from "./sessionDotsTray";
import { collectNewConfirmedWaitingSessions } from "./sessionWaitingNotifications";
import { checkForDesktopUpdate, getAppVersion } from "./updateCheck";
import { loadPanelDbPaths } from "./panelDatabases";
import { buildI18nBundle, desktopT, initI18nService } from "./i18nService";
import { shouldSyncSessionsAfterSettingsSave, type SaveSettingsOptions } from "./sessionSettingsSync";
import {
  invalidateNotesStore,
  notesCopyPath,
  notesCreate,
  notesCreateLinkedChild,
  notesDelete,
  notesGetParent,
  notesGetSubtree,
  notesImport,
  notesList,
  notesCreateTask,
  notesAddTaskProject,
  notesRemoveTaskProject,
  notesEnsureTaskWorkspace,
  notesLinkSessionToTask,
  notesListTaskSessionLinks,
  notesListTasks,
  notesOpenTaskWorkspace,
  notesTaskWorkspace,
  notesTaskNoteIdForSession,
  notesTaskSessionContext,
  notesListChildCounts,
  notesListLinkedChildIds,
  notesListLinks,
  notesListRootNotes,
  notesOpenFolder,
  notesPasteImage,
  notesRead,
  notesRename,
  notesRenameTask,
  notesResolveLinkRoot,
  notesReveal,
  notesSetGtdStatus,
  notesSetParent,
  notesWrite,
  settingsOpenPanelHome
} from "./notesService";
import { showDirectoryPicker } from "./directoryPicker";
import {
  createTaskTemplate,
  deleteTaskTemplate,
  listTaskTemplates,
  updateTaskTemplate
} from "./taskTemplates";
import { refreshMemorySchedulerFromSettings, stopMemoryScheduler } from "./scheduler";
import {
  ensureAgentStatusDaemon,
  resolveDaemonEntryPath,
  stopAgentStatusDaemon
} from "./agentStatus/lifecycle";
import { createAgentStatusBridge, type AgentStatusBridge } from "./agentStatus/bridge";
import { registerAgentStatusIpc } from "./agentStatus/ipc";
import { AgentStatusSensor } from "./agentStatus/sensor";
import { setAgentStatusSensor } from "./agentStatus/runtime";
import { scheduleNotesIndex, startNotesIndexer, stopNotesIndexer } from "./noteIndexer";
import {
  scheduleSessionSummaryAuto,
  startSessionSummaryAuto,
  stopSessionSummaryAuto
} from "./sessionSummaryAuto";
import {
  scheduleSessionTranscriptIndexAuto,
  startSessionTranscriptIndexAuto,
  stopSessionTranscriptIndexAuto
} from "./sessionTranscriptIndexAuto";
import {
  scheduleSessionEmbeddingIndexAuto,
  startSessionEmbeddingIndexAuto,
  stopSessionEmbeddingIndexAuto
} from "./sessionEmbeddingIndexAuto";
import {
  exportBackup,
  exportIcloudBackup,
  getBackupStorageTargetStatus,
  importBackup,
  listIcloudBackups,
  selectBackupForImport,
  selectIcloudBackupForImport
} from "./backupService";
import {
  clearAppErrors,
  installProcessErrorHandlers,
  listAppErrors,
  openAppErrorLogDir,
  recordAppError,
  type AppErrorLogLevel
} from "./appErrorLog";
import type { StatusSnapshot } from "../shared/agentStatusTypes";

installProcessErrorHandlers();

/**
 * Agent-status runtime: one bridge and one sensor for the whole process.
 *
 * The daemon is replaceable (upgrade, panel-home change), the in-process pieces
 * are not — they keep publishing and reconnect on their own.
 */
let agentStatusPanelHome = resolvePanelHome(undefined);
let agentStatusBridge: AgentStatusBridge | null = null;
let agentStatusSensor: AgentStatusSensor | null = null;
/** Resolved lazily by `tryRegisterPtyIpc`; absent when node-pty failed to load. */
let ptyPidResolver: ((id: number) => number | null) | null = null;
/** Panes a window renders; the rest keep running unwatched. */
let ptyAttachedResolver: (() => number[]) | null = null;
/** Workbench behind a pty, so a window-less pane still has an owner. */
let ptyWorkbenchResolver: ((id: number) => string | null) | null = null;

function tryRegisterPtyIpc(): void {
  try {
    // Lazy-load so node-pty native binding issues do not block other IPC handlers.
    const { registerPtyIpc, getPtyPid, getAttachedPtyIds, getPtyWorkbenchId } = require("./ptyHost") as typeof import("./ptyHost");
    registerPtyIpc();
    ptyPidResolver = getPtyPid;
    ptyAttachedResolver = getAttachedPtyIds;
    ptyWorkbenchResolver = getPtyWorkbenchId;
  } catch (error) {
    void recordAppError({
      source: "pty-host",
      message: "node-pty unavailable — embedded terminal disabled.",
      error
    });
  }
}

function tryDestroyPtyOnQuit(): void {
  try {
    const { destroyPtyOnQuit } = require("./ptyHost") as typeof import("./ptyHost");
    destroyPtyOnQuit();
  } catch {
    // ignore
  }
}

/**
 * Start the background agent-status daemon and the in-process sensor.
 *
 * Packaged builds always run the daemon: pane state must survive the window
 * closing, and installed agent hooks report to it while the app is gone. Dev
 * builds run it too (the UI needs real status while developing) and stop it on
 * quit, so no stray process is left behind. Set
 * `AGENT_RESUME_AGENT_STATUS_DAEMON=0` to run without one.
 */
function startAgentStatus(panelHome: string): void {
  if (process.env.AGENT_RESUME_AGENT_STATUS_DAEMON === "0") {
    console.log("[agent-resume] agent-status daemon disabled by AGENT_RESUME_AGENT_STATUS_DAEMON=0");
    return;
  }
  agentStatusPanelHome = panelHome;
  void (async () => {
    try {
      const result = await ensureAgentStatusDaemon({
        panelHome,
        execPath: process.execPath,
        entryPath: resolveDaemonEntryPath({
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          appPath: app.getAppPath()
        }),
        appVersion: app.getVersion(),
        // Notifications matter exactly when the app is closed, which is a
        // packaged-build situation; dev runs would spam the developer.
        notify: app.isPackaged
      });
      ensureAgentStatusRuntime();
      agentStatusBridge?.reconnect();
      console.log(
        `[agent-resume] agent-status daemon ${result.started ? "started" : "already running"} ` +
          `(pid ${result.endpoint.pid}, api v${result.endpoint.apiVersion})`
      );
    } catch (error) {
      void recordAppError({
        source: "agent-status",
        message: "Background status daemon could not be started.",
        error
      });
    }
  })();
}

/** Create the bridge, the sensor, and the renderer IPC exactly once. */
function ensureAgentStatusRuntime(): void {
  if (agentStatusSensor) return;
  const bridge = createAgentStatusBridge({
    getPanelHome: () => agentStatusPanelHome,
    appVersion: app.getVersion(),
    log: (message) => console.log(`[agent-resume] ${message}`)
  });
  agentStatusBridge = bridge;
  setAgentStatusSensor(
    new AgentStatusSensor({
      bridge,
      getPtyPid: (id) => ptyPidResolver?.(id) ?? null
    })
  );
  registerAgentStatusIpc({
    broadcast: (channel, payload) => broadcastToRenderers(channel, payload),
    bridge,
    getPanelHome: () => agentStatusPanelHome,
    execPath: process.execPath,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath()
  });
  bridge.subscribe((snapshot) => {
    latestAgentSnapshot = snapshot;
    refreshWorkbenchActiveSessions();
  });
  bridge.onTransition((transition) => {
    const sessionKey = transition.sessionKey?.trim();
    if (sessionKey) {
      const colon = sessionKey.indexOf(":");
      if (colon > 0 && colon < sessionKey.length - 1) {
        const provider = sessionKey.slice(0, colon);
        const id = sessionKey.slice(colon + 1);
        void loadPanelDbPaths().then((paths) => {
          if (transition.to === "blocked") {
            return setSessionLastExitWaiting(paths.catalogDb, provider, id, true);
          }
          if (transition.from === "blocked") {
            return setSessionLastExitWaiting(paths.catalogDb, provider, id, false);
          }
        }).catch(() => undefined);
      }
    }
  });
  bridge.connect();
}

/** Follow a panel-home change: the daemon and its socket live under that path. */
function refreshAgentStatusSettings(next: PanelSettings): void {
  const nextHome = effectivePanelHome(next);
  if (nextHome === agentStatusPanelHome) return;
  const previousHome = agentStatusPanelHome;
  void (async () => {
    await stopAgentStatusDaemon(previousHome).catch(() => undefined);
    startAgentStatus(nextHome);
  })();
}

function resolveWorkbenchTerminalMode(settings: PanelSettings): "xterm" | "external-system" {
  const mode = settings.workbench?.terminalMode;
  if (mode === "external-system" || mode === "external-ghostty") {
    return "external-system";
  }
  return "xterm";
}

function systemTerminalSettings(settings: PanelSettings) {
  return {
    externalLaunchMode: settings.workbench?.externalLaunchMode || "executeCommand",
    externalAutoPasteDelayMs: settings.workbench?.externalAutoPasteDelayMs
  };
}

async function resolveSessionCwd(
  projectPath: string | undefined,
  settings: PanelSettings,
  projectId?: string
): Promise<string> {
  try {
    const paths = await loadPanelDbPaths(settings);
    if (projectId?.trim()) {
      const resolved = await resolveProjectCwd(paths.catalogDb, projectId.trim());
      if (resolved.source !== "missing" && resolved.cwd) {
        return resolved.cwd;
      }
    }
    if (projectPath?.trim()) {
      const resolved = await resolveProjectCwdForPath(paths.catalogDb, projectPath.trim());
      if (resolved.source !== "missing" && resolved.cwd) {
        return resolved.cwd;
      }
    }
  } catch {
    // fall through
  }
  const raw = projectPath?.trim() || "";
  if (raw) {
    const expanded = expandHome(raw);
    try {
      const stat = await fs.stat(expanded);
      if (stat.isDirectory()) return expanded;
    } catch {
      // fall through to panel home
    }
  }
  return effectivePanelHome(settings);
}

function appResourcesDir(): string {
  return path.join(app.getAppPath(), "dist", "resources");
}

function appIconCandidates(): string[] {
  const resourcesDir = appResourcesDir();
  const png = path.join(resourcesDir, "icon.png");
  if (process.platform === "darwin") {
    const icns = path.join(resourcesDir, "icon.icns");
    // electron . dev runs often fail to decode .icns; prefer .png there.
    if (process.env.AGENT_RESUME_DEV === "1") {
      return [png, icns];
    }
    return [icns, png];
  }
  return [png];
}

function isBrokenPipe(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPIPE";
}

function safeWarn(...args: unknown[]): void {
  try {
    console.warn(...args);
  } catch (error) {
    if (!isBrokenPipe(error)) {
      throw error;
    }
  }
}

function loadIconFromPath(iconPath: string): Electron.NativeImage | undefined {
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    try {
      image = nativeImage.createFromBuffer(readFileSync(iconPath));
    } catch {
      return undefined;
    }
  }
  return image.isEmpty() ? undefined : image;
}

function loadAppIcon(): Electron.NativeImage | undefined {
  for (const iconPath of appIconCandidates()) {
    if (!existsSync(iconPath)) {
      continue;
    }
    const image = loadIconFromPath(iconPath);
    if (image) {
      return image;
    }
    safeWarn("[desktop] App icon could not be loaded:", iconPath);
  }
  safeWarn("[desktop] App icon not found under", appResourcesDir());
  return undefined;
}

function applyAppIcon(): void {
  const icon = loadAppIcon();
  if (!icon) return;
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(icon);
  }
}

let mainWindow: BrowserWindow | null = null;
let mainWindowReadyToShow = false;
let mainWindowRendererReady = false;
let sessionDotsTray: Tray | null = null;
let browserSettingsCache: import("@agent-resume/core").DesktopBrowserSettings | null = null;
let notifiedWaitingSessions = new Set<string>();
/** Display data per workbench, so a tray dot for a closed window still has a name. */
let workbenchMetaById = new Map<string, { noteId: string; label: string }>();

function workbenchLabel(name: string, projectPath: string): string {
  const explicit = name.trim();
  if (explicit) return explicit;
  return projectPath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || "Workbench";
}

/** Refresh the workbench name / note cache behind the tray and the focus fallback. */
async function loadWorkbenchMeta(): Promise<void> {
  try {
    const paths = await loadPanelDbPaths();
    const workbenches = await listAllTaskWorkbenches(paths.desktopDb);
    const next = new Map<string, { noteId: string; label: string }>();
    for (const workbench of workbenches) {
      next.set(workbench.workbenchId, {
        noteId: workbench.taskNoteId,
        label: workbenchLabel(workbench.name, workbench.projectPath ?? "")
      });
    }
    workbenchMetaById = next;
    syncSessionDotsTray();
  } catch {
    /* keep the previous names; a later mutation or window change retries */
  }
}

/**
 * One tray row per workbench: every open window (even an empty one, which gets a
 * gray dot), plus workbenches whose window is gone but whose sessions still run.
 *
 * The rollup is the same function the GTD board uses, so a workbench reads the
 * same on both surfaces.
 */
function workbenchStatusRows(): TrayWorkbench[] {
  return composeWorkbenchRows(workbenchActiveSessions, summarizeTaskWindows(), workbenchMetaById);
}

/**
 * Focus a workbench's window, or open it when there is none.
 *
 * The board hosts no workbench, so this is the only way a tray dot can reach the
 * panes; a workbench that no longer exists anywhere falls back to the board.
 */
async function revealWorkbench(target: { workbenchId: string; noteId: string }): Promise<void> {
  if (!target.workbenchId) {
    revealMainWindow();
    return;
  }
  if (focusTaskWindow(target.workbenchId)) return;
  let noteId = target.noteId || workbenchMetaById.get(target.workbenchId)?.noteId || "";
  if (!noteId) {
    await loadWorkbenchMeta();
    noteId = workbenchMetaById.get(target.workbenchId)?.noteId || "";
  }
  if (!noteId) {
    revealMainWindow();
    return;
  }
  // No title: the renderer resolves the task title once the workspace loads,
  // and a workbench label would only flash the wrong name first.
  const opened = openTaskWindow(taskWindowDeps(), {
    noteId,
    workbenchId: target.workbenchId
  });
  if (!opened.ok) {
    notifyTaskWindowLimit(opened.limit);
    revealMainWindow();
  }
}

/** Tell the user why a workbench window could not be opened. */
function notifyTaskWindowLimit(limit: number): void {
  const window = revealMainWindow();
  if (!window || window.isDestroyed()) return;
  window.webContents.send("task-window:limit", { limit });
}

function showMainWindowIfReady(): void {
  if (!mainWindowReadyToShow || !mainWindowRendererReady) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
}
type StandaloneNoteWindowState = {
  noteId: string;
  title: string;
  window: BrowserWindow;
  allowClose: boolean;
  closeRequest?: {
    resolve: (closed: boolean) => void;
    timer: NodeJS.Timeout;
  };
  closePromise?: Promise<boolean>;
};
type OpenStandaloneNoteDot = { noteId: string; title: string };
const standaloneNoteWindows = new Map<string, StandaloneNoteWindowState>();
const STANDALONE_NOTE_CLOSE_TIMEOUT_MS = 15_000;
const STANDALONE_NOTE_WINDOW_SIZE = { width: 560, height: 640 } as const;
const RECENT_STANDALONE_NOTES_LIMIT = 15;
let registeredStandaloneNoteShortcut = "";
let registeredRecentStandaloneNoteShortcut = "";
let appQuitInFlight: Promise<void> | null = null;
let allowAppQuit = false;
let quitCleanupDone = false;
let sessionSyncTimer: NodeJS.Timeout | null = null;
let sessionSyncInFlight: Promise<AgentSessionSyncResult> | null = null;
/**
 * Windows whose workbench surface is currently the visible one. Per window, not
 * global: several workbench windows can be open at once, and each one owns its
 * own ⌘W / file-watch semantics.
 */
const workbenchActiveSenders = new Set<number>();
/**
 * Session dots per reporting window. Each workbench window publishes the panes
 * it is showing, so the tray and the notifications describe the whole app
 * instead of one window.
 */
const workbenchActiveSessionsBySender = new Map<number, WorkbenchActiveSessionDot[]>();
let workbenchActiveSessions: WorkbenchActiveSessionDot[] = [];
const SESSION_SYNC_INTERVAL_MS = 60_000;

const SETTINGS_PANES = [
  "general",
  "providers",
  "sessions",
  "workbench",
  "notes",
  "storage",
  "usage",
  "about"
] as const;
type SettingsPaneId = (typeof SETTINGS_PANES)[number];

function normalizeSettingsPane(value: unknown): SettingsPaneId {
  return typeof value === "string" && (SETTINGS_PANES as readonly string[]).includes(value)
    ? (value as SettingsPaneId)
    : "general";
}

/** Keep only non-empty strings from an IPC list payload. */
function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;
}

function broadcastToRenderers(channel: string, ...args: unknown[]): void {
  const windows = [
    mainWindow,
    ...[...standaloneNoteWindows.values()].map((state) => state.window),
    ...listTaskWindows().map((state) => state.window)
  ];
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

/** True while `win` is showing its workbench surface. */
function workbenchIsActive(win: BrowserWindow | null): boolean {
  if (!win || win.isDestroyed()) return false;
  return workbenchActiveSenders.has(win.webContents.id);
}

function anyWorkbenchActive(): boolean {
  return workbenchActiveSenders.size > 0;
}

/** Drop senders whose window is gone; call whenever the window set changes. */
function pruneWorkbenchActiveSenders(): void {
  const alive = new Set(BrowserWindow.getAllWindows().map((win) => win.webContents.id));
  for (const id of [...workbenchActiveSenders]) {
    if (!alive.has(id)) workbenchActiveSenders.delete(id);
  }
  for (const id of [...workbenchActiveSessionsBySender.keys()]) {
    if (!alive.has(id)) workbenchActiveSessionsBySender.delete(id);
  }
}

/** Latest daemon snapshot: the only view of panes whose window is gone. */
let latestAgentSnapshot: StatusSnapshot | null = null;
let workbenchActiveSessionsSignature = "";

/**
 * Panes no window is rendering.
 *
 * Their agents keep running after the window closes, and the daemon keeps
 * tracking them, so the tray can still reach them.
 */
function unwatchedPaneDots(): WorkbenchActiveSessionDot[] {
  const snapshot = latestAgentSnapshot;
  if (!snapshot) return [];
  const attached = new Set(ptyAttachedResolver?.() ?? []);
  const dots: WorkbenchActiveSessionDot[] = [];
  for (const pane of Object.values(snapshot.byPaneId)) {
    if (attached.has(pane.paneId)) continue;
    if (pane.state !== "blocked" && pane.state !== "working") continue;
    dots.push({
      paneKey: `pane:${pane.paneId}`,
      projectPath: "",
      title: pane.agent,
      sessionKey: pane.sessionKey?.trim() ?? "",
      status: pane.state === "blocked" ? "awaiting_user" : "running",
      workbenchId: ptyWorkbenchResolver?.(pane.paneId) ?? ""
    });
  }
  return dots;
}

/**
 * Every window's dots, merged by session key (else pane key).
 *
 * Window reports come last because a window knows the session title and project
 * path; the daemon view covers panes whose window is gone.
 */
function mergedWorkbenchActiveSessions(): WorkbenchActiveSessionDot[] {
  const byKey = new Map<string, WorkbenchActiveSessionDot>();
  for (const dot of unwatchedPaneDots()) byKey.set(dot.sessionKey || dot.paneKey, dot);
  for (const dots of workbenchActiveSessionsBySender.values()) {
    for (const dot of dots) byKey.set(dot.sessionKey || dot.paneKey, dot);
  }
  return [...byKey.values()];
}

/** Recompute the app-wide dot list; nothing else happens when it is unchanged. */
function refreshWorkbenchActiveSessions(): void {
  const next = mergedWorkbenchActiveSessions();
  const signature = next
    .map((dot) => `${dot.paneKey}|${dot.sessionKey}|${dot.status}`)
    .sort()
    .join(",");
  if (signature === workbenchActiveSessionsSignature) return;
  workbenchActiveSessionsSignature = signature;
  workbenchActiveSessions = next;
  const newlyWaiting = collectNewConfirmedWaitingSessions(workbenchActiveSessions, notifiedWaitingSessions);
  syncSessionDotsTray();
  broadcastToRenderers("workbench:activeSessions", workbenchActiveSessions);
  if (newlyWaiting.length > 0) void showSessionWaitingNotifications(newlyWaiting);
}

/** The window that reported a pane, so session events reach the right place. */
function windowForPaneKey(paneKey: string): BrowserWindow | null {
  for (const [senderId, dots] of workbenchActiveSessionsBySender) {
    if (!dots.some((dot) => dot.paneKey === paneKey)) continue;
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === senderId);
    if (win && !win.isDestroyed()) return win;
  }
  return null;
}

function syncSessionDotsTray(): void {
  if (process.platform !== "darwin") return;
  const notes = listOpenStandaloneNotes();
  const workbenches = workbenchStatusRows();
  const items = composeTrayItems(notes, workbenches);
  const extra = notes.length + workbenches.length - items.length;
  const image = sessionDotsTrayImage(items);
  const tooltip = trayTooltip(items, extra);
  if (!sessionDotsTray) {
    sessionDotsTray = new Tray(image);
    sessionDotsTray.setIgnoreDoubleClickEvents(true);
    sessionDotsTray.on("click", (_event, bounds, position) => {
      const current = composeTrayItems(listOpenStandaloneNotes(), workbenchStatusRows());
      if (current.length === 0) {
        revealMainWindow();
        return;
      }
      const trayBounds = sessionDotsTray?.getBounds() || bounds;
      const cursor = screen.getCursorScreenPoint();
      const index = hitTestTrayDotFromScreen(cursor.x, trayBounds, current.length, position);
      const target = index == null ? current[0] : current[index];
      if (!target) {
        revealMainWindow();
        return;
      }
      if (target.kind === "note") {
        void openStandaloneNoteById(target.noteId).catch((error) => {
          void recordAppError({ source: "session-dots", message: "Could not focus floating note from tray.", error });
        });
        return;
      }
      void revealWorkbench({ workbenchId: target.workbenchId, noteId: target.noteId });
    });
  } else {
    sessionDotsTray.setImage(image);
  }
  sessionDotsTray.setToolTip(tooltip);
}

function destroySessionDotsTray(): void {
  if (!sessionDotsTray) return;
  sessionDotsTray.destroy();
  sessionDotsTray = null;
}

async function showSessionWaitingNotifications(sessions: readonly WorkbenchActiveSessionDot[]): Promise<void> {
  if (!Notification.isSupported()) return;
  let notificationSettings: PanelSettings | undefined;
  try {
    notificationSettings = await loadSettings();
  } catch (error) {
    void recordAppError({
      source: "session-dots",
      message: "Could not load settings for waiting-session notification.",
      error
    });
  }
  const waitingLabel = desktopT(notificationSettings, "desktop.workbench.sessionDot.awaiting");
  for (const session of sessions) {
    try {
      const projectPath = session.projectPath.trim();
      const body = projectPath ? `${path.basename(projectPath)}: ${waitingLabel}` : waitingLabel;
      const notification = new Notification({
        title: session.title.trim() || desktopT(notificationSettings, "desktop.agent.sessionLevel"),
        body
      });
      notification.on("click", () => {
        void revealWorkbench({ workbenchId: session.workbenchId, noteId: "" });
      });
      notification.show();
    } catch (error) {
      void recordAppError({
        source: "session-dots",
        message: "Could not show waiting-session notification.",
        error
      });
    }
  }
}

function revealMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return mainWindow;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}

function configuredStandaloneNoteShortcut(settings: PanelSettings): string {
  const raw = settings.notes?.newStandaloneNoteShortcut;
  return normalizeGlobalShortcut(
    raw === undefined ? DEFAULT_STANDALONE_NOTE_SHORTCUT : raw,
    DEFAULT_STANDALONE_NOTE_SHORTCUT
  );
}

function configuredRecentStandaloneNoteShortcut(settings: PanelSettings): string {
  const raw = settings.notes?.recentStandaloneNoteShortcut;
  return normalizeGlobalShortcut(
    raw === undefined ? DEFAULT_RECENT_STANDALONE_NOTE_SHORTCUT : raw,
    DEFAULT_RECENT_STANDALONE_NOTE_SHORTCUT
  );
}

function recentStandaloneNoteMenuLabel(note: { title?: string; filename: string }): string {
  const title = note.title?.trim();
  return title || note.filename;
}

function standaloneNoteStateForSender(sender: Electron.WebContents): StandaloneNoteWindowState | undefined {
  return [...standaloneNoteWindows.values()].find((state) => state.window.webContents === sender);
}

function listOpenStandaloneNotes(): OpenStandaloneNoteDot[] {
  const open: OpenStandaloneNoteDot[] = [];
  for (const state of standaloneNoteWindows.values()) {
    if (state.window.isDestroyed()) continue;
    open.push({ noteId: state.noteId, title: state.title });
  }
  return open;
}

function broadcastOpenStandaloneNotes(): void {
  broadcastToRenderers("standalone-note:changed", listOpenStandaloneNotes());
  syncSessionDotsTray();
}

function settleStandaloneNoteCloseRequest(state: StandaloneNoteWindowState, closed: boolean): void {
  const request = state.closeRequest;
  if (!request) return;
  clearTimeout(request.timer);
  state.closeRequest = undefined;
  state.closePromise = undefined;
  request.resolve(closed);
}

function requestStandaloneNoteClose(state: StandaloneNoteWindowState): Promise<boolean> {
  if (state.window.isDestroyed()) return Promise.resolve(true);
  if (state.closePromise) return state.closePromise;
  let resolveRequest: (closed: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => {
    resolveRequest = resolve;
  });
  state.closePromise = promise;
  const timer = setTimeout(() => settleStandaloneNoteCloseRequest(state, false), STANDALONE_NOTE_CLOSE_TIMEOUT_MS);
  state.closeRequest = { resolve: resolveRequest, timer };
  try {
    state.window.webContents.send("standalone-note:requestClose");
  } catch {
    settleStandaloneNoteCloseRequest(state, false);
  }
  return promise;
}

function setStandaloneNoteAlwaysOnTop(state: StandaloneNoteWindowState, pinned: boolean): boolean {
  if (state.window.isDestroyed()) return false;
  if (process.platform === "darwin") {
    state.window.setAlwaysOnTop(pinned, "floating");
    state.window.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: pinned });
  } else {
    state.window.setAlwaysOnTop(pinned);
  }
  return state.window.isAlwaysOnTop();
}

function createStandaloneNoteWindow(record: NoteRecord): StandaloneNoteWindowState {
  const icon = loadAppIcon();
  const title = recentStandaloneNoteMenuLabel(record) || desktopT(undefined, "desktop.standaloneNote.title");
  const win = new BrowserWindow({
    ...STANDALONE_NOTE_WINDOW_SIZE,
    minWidth: 420,
    minHeight: 360,
    title,
    show: false,
    // Electron's default background is white, and a window composites it while its
    // webContents is torn down — leaving it unset flashes white on close.
    backgroundColor: windowBackgroundColor(),
    ...(icon ? { icon } : {}),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.platform !== "darwin") win.setMenuBarVisibility(false);

  const state: StandaloneNoteWindowState = { noteId: record.noteId, title, window: win, allowClose: false };
  standaloneNoteWindows.set(record.noteId, state);
  broadcastOpenStandaloneNotes();
  win.on("close", (event) => {
    if (state.allowClose || allowAppQuit) return;
    event.preventDefault();
    void requestStandaloneNoteClose(state);
  });
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  win.on("closed", () => {
    settleStandaloneNoteCloseRequest(state, true);
    if (standaloneNoteWindows.get(record.noteId) === state) standaloneNoteWindows.delete(record.noteId);
    broadcastOpenStandaloneNotes();
  });
  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), {
    query: { mode: "standalone-note", noteId: record.noteId }
  }).catch((error) => {
    void recordAppError({ source: "standalone-note", message: "Standalone note window failed to load.", error });
  });
  return state;
}

async function openStandaloneNoteWindow(): Promise<void> {
  try {
    const created = await notesCreate({
      scope: "library",
      body: STANDALONE_NOTE_INITIAL_CONTENT
    });
    const record = await notesSetGtdStatus(created.noteId, "inbox");
    scheduleNotesIndex();
    createStandaloneNoteWindow(record);
  } catch (error) {
    let settings: PanelSettings | undefined;
    try {
      settings = await loadSettings();
    } catch {
      // Use the catalog fallback when settings are unavailable.
    }
    try {
      await dialog.showMessageBox({
        type: "error",
        title: desktopT(settings, "desktop.standaloneNote.title"),
        message: desktopT(settings, "desktop.standaloneNote.createFailed", error instanceof Error ? error.message : String(error)),
        buttons: ["OK"]
      });
    } catch {
      // The error is also recorded by the global shortcut callback below.
    }
    throw error;
  }
}

function positionStandaloneNoteWindow(
  win: BrowserWindow,
  point?: { x?: number; y?: number }
): void {
  if (win.isDestroyed()) return;
  if (typeof point?.x !== "number" || typeof point?.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return;
  }
  const { width, height } = STANDALONE_NOTE_WINDOW_SIZE;
  const display = screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) });
  const work = display.workArea;
  const x = Math.min(
    Math.max(Math.round(point.x - width / 2), work.x),
    Math.max(work.x, work.x + work.width - width)
  );
  const y = Math.min(
    Math.max(Math.round(point.y - 24), work.y),
    Math.max(work.y, work.y + work.height - height)
  );
  win.setPosition(x, y);
}

function isScreenPointOutsideMainWindow(x: number, y: number): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return true;
  const bounds = mainWindow.getBounds();
  return x < bounds.x || y < bounds.y || x > bounds.x + bounds.width || y > bounds.y + bounds.height;
}

async function openStandaloneNoteById(
  noteId: string,
  options?: { x?: number; y?: number; requireOutsideMainWindow?: boolean }
): Promise<{ ok: true } | { ok: false; reason: "inside-window" }> {
  if (
    options?.requireOutsideMainWindow === true
    && typeof options.x === "number"
    && typeof options.y === "number"
    && !isScreenPointOutsideMainWindow(options.x, options.y)
  ) {
    return { ok: false, reason: "inside-window" };
  }

  const existing = standaloneNoteWindows.get(noteId);
  if (existing && !existing.window.isDestroyed()) {
    positionStandaloneNoteWindow(existing.window, options);
    if (existing.window.isMinimized()) existing.window.restore();
    existing.window.show();
    existing.window.focus();
    return { ok: true };
  }
  try {
    const { record } = await notesRead(noteId);
    const state = createStandaloneNoteWindow(record);
    positionStandaloneNoteWindow(state.window, options);
    return { ok: true };
  } catch (error) {
    let settings: PanelSettings | undefined;
    try {
      settings = await loadSettings();
    } catch {
      // Use the catalog fallback when settings are unavailable.
    }
    try {
      await dialog.showMessageBox({
        type: "error",
        title: desktopT(settings, "desktop.standaloneNote.title"),
        message: desktopT(settings, "desktop.standaloneNote.loadError", error instanceof Error ? error.message : String(error)),
        buttons: ["OK"]
      });
    } catch {
      // The error is also recorded by the global shortcut callback below.
    }
    throw error;
  }
}

async function showRecentStandaloneNotesMenu(): Promise<void> {
  let settings: PanelSettings | undefined;
  try {
    settings = await loadSettings();
  } catch {
    // Use the catalog fallback when settings are unavailable.
  }
  let notes: Awaited<ReturnType<typeof notesList>> = [];
  try {
    notes = await notesList();
  } catch (error) {
    void recordAppError({ source: "standalone-note", message: "Could not list recent notes.", error });
    try {
      await dialog.showMessageBox({
        type: "error",
        title: desktopT(settings, "desktop.standaloneNote.title"),
        message: desktopT(settings, "desktop.standaloneNote.loadFailed"),
        buttons: ["OK"]
      });
    } catch {
      // Listing failure is already recorded above.
    }
    return;
  }
  const recent = notes.slice(0, RECENT_STANDALONE_NOTES_LIMIT);
  const template: Electron.MenuItemConstructorOptions[] = recent.length
    ? recent.map((note) => ({
        label: recentStandaloneNoteMenuLabel(note),
        click: () => {
          void openStandaloneNoteById(note.noteId).catch((error) => {
            void recordAppError({ source: "standalone-note", message: "Could not open standalone note.", error });
          });
        }
      }))
    : [{ label: desktopT(settings, "desktop.standaloneNote.noRecent"), enabled: false }];
  const menu = Menu.buildFromTemplate(template);
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  menu.popup(owner ? { window: owner } : undefined);
}

async function closeAllStandaloneNoteWindows(): Promise<boolean> {
  const states = [...standaloneNoteWindows.values()].filter((state) => !state.window.isDestroyed());
  const results = await Promise.all(states.map((state) => requestStandaloneNoteClose(state)));
  return results.every(Boolean);
}

function applyStandaloneNoteShortcut(value: unknown): void {
  const next = normalizeGlobalShortcut(value, DEFAULT_STANDALONE_NOTE_SHORTCUT);
  const previous = registeredStandaloneNoteShortcut;
  if (next === previous) return;
  if (previous) globalShortcut.unregister(previous);
  if (!next) {
    registeredStandaloneNoteShortcut = "";
    return;
  }
  try {
    const registered = globalShortcut.register(next, () => {
      void openStandaloneNoteWindow().catch((error) => {
        void recordAppError({ source: "standalone-note", message: "Could not create standalone note.", error });
      });
    });
    if (!registered) throw new Error(`Global shortcut is unavailable: ${next}`);
    registeredStandaloneNoteShortcut = next;
  } catch (error) {
    if (previous) {
      try {
        if (globalShortcut.register(previous, () => {
          void openStandaloneNoteWindow().catch((retryError) => {
            void recordAppError({ source: "standalone-note", message: "Could not create standalone note.", error: retryError });
          });
        })) {
          registeredStandaloneNoteShortcut = previous;
        }
      } catch {
        registeredStandaloneNoteShortcut = "";
      }
    }
    throw error;
  }
}

function applyRecentStandaloneNoteShortcut(value: unknown): void {
  const next = normalizeGlobalShortcut(value, DEFAULT_RECENT_STANDALONE_NOTE_SHORTCUT);
  const previous = registeredRecentStandaloneNoteShortcut;
  if (next === previous) return;
  if (previous) globalShortcut.unregister(previous);
  if (!next) {
    registeredRecentStandaloneNoteShortcut = "";
    return;
  }
  try {
    const registered = globalShortcut.register(next, () => {
      void showRecentStandaloneNotesMenu().catch((error) => {
        void recordAppError({ source: "standalone-note", message: "Could not open recent notes menu.", error });
      });
    });
    if (!registered) throw new Error(`Global shortcut is unavailable: ${next}`);
    registeredRecentStandaloneNoteShortcut = next;
  } catch (error) {
    if (previous) {
      try {
        if (globalShortcut.register(previous, () => {
          void showRecentStandaloneNotesMenu().catch((retryError) => {
            void recordAppError({ source: "standalone-note", message: "Could not open recent notes menu.", error: retryError });
          });
        })) {
          registeredRecentStandaloneNoteShortcut = previous;
        }
      } catch {
        registeredRecentStandaloneNoteShortcut = "";
      }
    }
    throw error;
  }
}

function initializeStandaloneNoteShortcut(settings: PanelSettings): void {
  try {
    applyStandaloneNoteShortcut(configuredStandaloneNoteShortcut(settings));
  } catch (error) {
    void recordAppError({ source: "standalone-note", message: "Global standalone note shortcut could not be registered.", error });
  }
  try {
    applyRecentStandaloneNoteShortcut(configuredRecentStandaloneNoteShortcut(settings));
  } catch (error) {
    void recordAppError({ source: "standalone-note", message: "Global recent standalone note shortcut could not be registered.", error });
  }
}

function performQuitCleanup(): void {
  if (quitCleanupDone) return;
  quitCleanupDone = true;
  destroySessionDotsTray();
  if (registeredStandaloneNoteShortcut) {
    globalShortcut.unregister(registeredStandaloneNoteShortcut);
    registeredStandaloneNoteShortcut = "";
  }
  if (registeredRecentStandaloneNoteShortcut) {
    globalShortcut.unregister(registeredRecentStandaloneNoteShortcut);
    registeredRecentStandaloneNoteShortcut = "";
  }
  closeAllTaskWindows();
  disposeWorkbenchWatchers();
  disposeBrowserController();
  void disposeBrowserMcpServer();
  stopMemoryScheduler();
  stopNotesIndexer();
  stopSessionSummaryAuto();
  stopSessionTranscriptIndexAuto();
  stopSessionEmbeddingIndexAuto();
  disposeAllAcpControllers();
  tryDestroyPtyOnQuit();
  // Packaged builds deliberately keep the daemon alive: it holds the status
  // snapshot and the hook endpoint while the app is closed. Dev builds would
  // otherwise leave an orphan behind on every reload.
  if (!app.isPackaged) void stopAgentStatusDaemon(agentStatusPanelHome);
}

async function beginAppQuit(): Promise<void> {
  if (appQuitInFlight) return appQuitInFlight;
  appQuitInFlight = (async () => {
    const closed = await closeAllStandaloneNoteWindows();
    if (!closed) {
      const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      let settings: PanelSettings | undefined;
      try {
        settings = await loadSettings();
      } catch {
        // Use the catalog fallback while the app is shutting down.
      }
      const messageBox: Electron.MessageBoxOptions = {
        type: "error",
        title: desktopT(settings, "desktop.standaloneNote.title"),
        message: desktopT(settings, "desktop.standaloneNote.quitSaveFailed"),
        buttons: ["OK"]
      };
      if (owner) await dialog.showMessageBox(owner, messageBox);
      else await dialog.showMessageBox(messageBox);
      return;
    }
    allowAppQuit = true;
    app.quit();
  })().finally(() => {
    appQuitInFlight = null;
  });
  return appQuitInFlight;
}

function syncSessions(): Promise<AgentSessionSyncResult> {
  if (sessionSyncInFlight) return sessionSyncInFlight;
  sessionSyncInFlight = loadSettings()
    .then((settings) => syncAgentSessions(sessionSyncOptionsFromSettings(settings)))
    .finally(() => {
      sessionSyncInFlight = null;
    });
  return sessionSyncInFlight;
}

function shouldScheduleBackgroundAnalysis(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return true;
  if (mainWindow.isMinimized()) return false;
  if (mainWindow.isFocused()) {
    try {
      return powerMonitor.getSystemIdleTime() >= 30;
    } catch {
      return false;
    }
  }
  return true;
}

async function syncAndNotify(): Promise<AgentSessionSyncResult> {
  const result = await syncSessions();
  // Every window lists sessions, so every window refreshes when the catalog moves.
  broadcastToRenderers("sessions:synced", result);
  if (shouldScheduleBackgroundAnalysis()) {
    scheduleSessionSummaryAuto(2_000);
    scheduleSessionTranscriptIndexAuto(3_000);
    scheduleSessionEmbeddingIndexAuto(4_000);
  }
  return result;
}

/**
 * A task's context block for a session that keeps `cwd` as its working
 * directory. Best-effort: a missing block must never block the session.
 */
async function taskContextFile(
  noteId: string | undefined,
  cwd: string
): Promise<string | undefined> {
  const id = noteId?.trim();
  if (!id || !cwd.trim()) return undefined;
  try {
    const { file } = await notesTaskSessionContext({ noteId: id, cwd });
    return file;
  } catch {
    return undefined;
  }
}

/**
 * The context block a resumed session carries: a session linked to a task
 * is told which task it serves, so single-repository sessions are not the
 * odd one out. Best-effort.
 */
async function taskContextFileForSession(session: {
  provider: string;
  id: string;
}, cwd: string): Promise<string | undefined> {
  try {
    const noteId = await notesTaskNoteIdForSession({
      provider: session.provider,
      sessionId: session.id
    });
    return await taskContextFile(noteId, cwd);
  } catch {
    return undefined;
  }
}

async function resumeCatalogSession(
  provider: AgentProvider,
  id: string
): Promise<{
  mode: string;
  command: string;
  cwd: string;
  external?: boolean;
  /** ACP visual chat resume (Workbench opens AcpChatView). */
  acp?: { chatId: string; provider: string; title?: string };
  session?: Awaited<ReturnType<typeof getSessionById>>;
}> {
  const settings = await loadSettings();
  const paths = await loadPanelDbPaths(settings);
  const panelHome = effectivePanelHome(settings);

  // ACP chats: catalog indexes metadata; JSONL holds messages. Resume opens AcpChatView.
  if (provider === "chat") {
    const record = await getAcpRecord(panelHome, id);
    const catalogSession = await getSessionById(paths.catalogDb, "chat", id);
    if (record || catalogSession) {
      return {
        mode: "acp",
        command: "",
        cwd: record?.projectPath || catalogSession?.projectPath || "",
        acp: {
          chatId: record?.id || catalogSession!.id,
          provider: record?.provider || catalogSession?.acpProvider || "claude",
          title: record?.title || catalogSession?.title
        },
        session: catalogSession || {
          provider: "chat",
          id: record!.id,
          title: record!.title,
          projectPath: record!.projectPath,
          updatedAt: record!.updatedAt,
          messageCount: record!.messageCount,
          source: "acp",
          acpProvider: record!.provider
        }
      };
    }
  }

  const session = await getSessionById(paths.catalogDb, provider, id);
  if (!session) {
    throw new Error(`Session not found: ${provider} ${id}`);
  }
  const mode = resolveWorkbenchTerminalMode(settings);
  const cwd = await resolveSessionCwd(session.projectPath, settings);

  // Only provider "chat" is ACP. Do not use source/acpProvider alone — that must never hijack CLI resume.
  if (session.provider === "chat") {
    const acpProvider = session.acpProvider || "claude";
    const record = await getAcpRecord(panelHome, session.id);
    return {
      mode: "acp",
      command: "",
      cwd: record?.projectPath || cwd,
      acp: {
        chatId: session.id,
        provider: record?.provider || acpProvider,
        title: record?.title || session.title
      },
      session
    };
  }

  if (session.provider === "cursor-ide") {
    await openProjectInEditor(cwd, "cursor", app.getLocale());
    return { mode, external: true, command: "", cwd, session };
  }

  const contextFile = await taskContextFileForSession(session, cwd);
  const command = buildResumeCommand(session, contextFile);

  if (mode === "external-system") {
    await openSessionInSystemTerminal(
      { ...session, projectPath: cwd },
      systemTerminalSettings(settings),
      {
        writeText: (text) => Promise.resolve(clipboard.writeText(text))
      },
      contextFile
    );
    return { mode, external: true, command, cwd, session };
  }
  return { mode, command, cwd, session };
}

function stopSessionSyncTimer(): void {
  if (sessionSyncTimer) clearInterval(sessionSyncTimer);
  sessionSyncTimer = null;
}

function startSessionSyncTimer(): void {
  stopSessionSyncTimer();
  if (!mainWindow || !mainWindow.isVisible() || mainWindow.isMinimized()) return;
  sessionSyncTimer = setInterval(() => void syncAndNotify().catch(notifySessionSyncFailure), SESSION_SYNC_INTERVAL_MS);
}

function notifySessionSyncFailure(error: unknown): void {
  broadcastToRenderers("sessions:syncFailed", error instanceof Error ? error.message : String(error));
}

function startDesktopNotesIndexer(): void {
  startNotesIndexer((progress) => {
    broadcastToRenderers("notes:indexProgress", progress);
  });
}

function resumeSessionSync(): void {
  startSessionSyncTimer();
  void syncAndNotify().catch(notifySessionSyncFailure);
}

function isWorkbenchCmdTInput(input: Electron.Input): boolean {
  if (input.type !== "keyDown") {
    return false;
  }
  if (!(input.control || input.meta) || input.alt || input.shift) {
    return false;
  }
  const key = input.key?.toLowerCase();
  return key === "t" || input.code === "KeyT";
}

function isWorkbenchCmdWInput(input: Electron.Input): boolean {
  if (input.type !== "keyDown") {
    return false;
  }
  if (!(input.control || input.meta) || input.alt || input.shift) {
    return false;
  }
  const key = input.key?.toLowerCase();
  return key === "w" || input.code === "KeyW";
}

/** VS Code-style Find in Files: ⌘⇧F / Ctrl+Shift+F */
function isWorkbenchCmdShiftFInput(input: Electron.Input): boolean {
  if (input.type !== "keyDown") {
    return false;
  }
  if (!(input.control || input.meta) || !input.shift || input.alt) {
    return false;
  }
  const key = input.key?.toLowerCase();
  return key === "f" || input.code === "KeyF";
}

function registerWorkbenchShortcuts(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    if (isQuickAccessShortcut(input, true)) {
      event.preventDefault();
      if (!win.isDestroyed()) win.webContents.send("workbench:cmdShiftP");
      return;
    }

    if (isQuickAccessShortcut(input, false)) {
      event.preventDefault();
      if (!win.isDestroyed()) win.webContents.send("workbench:cmdP");
      return;
    }

    if (isWorkbenchCmdTInput(input)) {
      event.preventDefault();
      if (!win.isDestroyed()) {
        win.webContents.send("workbench:cmdT");
      }
      return;
    }

    if (isWorkbenchCmdShiftFInput(input)) {
      event.preventDefault();
      if (!win.isDestroyed()) {
        win.webContents.send("workbench:cmdShiftF");
      }
      return;
    }

    if (workbenchIsActive(win) && isWorkbenchCmdWInput(input)) {
      event.preventDefault();
      if (!win.isDestroyed()) {
        win.webContents.send("workbench:cmdW");
      }
    }
  });
}

const DEFAULT_WINDOW_SIZE = {
  width: 1120,
  height: 780
} as const;

function createWindow(): void {
  mainWindowReadyToShow = false;
  mainWindowRendererReady = false;
  const icon = loadAppIcon();
  mainWindow = new BrowserWindow({
    ...DEFAULT_WINDOW_SIZE,
    minWidth: 860,
    minHeight: 600,
    title: "Agent Resume Desktop",
    // Keep the main window hidden until Chromium and the renderer have painted the initial loading shell.
    show: false,
    // Match the system fallback surface in case the native window is exposed before the renderer paint.
    backgroundColor: windowBackgroundColor(),
    ...(icon ? { icon } : {}),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: process.platform === "darwin" ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // BrowserWindow#maximize() implicitly shows hidden macOS windows. Size it to the
  // display work area instead, so the first visible frame is already full-sized.
  const display = screen.getDisplayMatching(mainWindow.getBounds());
  mainWindow.setBounds(display.workArea);
  mainWindow.once("ready-to-show", () => {
    mainWindowReadyToShow = true;
    showMainWindowIfReady();
  });
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => resumeSessionSync());
  mainWindow.on("show", () => {
    applyAppIcon();
    resumeSessionSync();
  });
  mainWindow.on("restore", resumeSessionSync);
  mainWindow.on("minimize", stopSessionSyncTimer);
  mainWindow.on("close", (event) => {
    if (allowAppQuit) return;
    const keepHidden = process.platform === "darwin"
      || standaloneNoteWindows.size > 0
      || openTaskWindowCount() > 0;
    if (!keepHidden) return;
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });
  mainWindow.on("closed", () => {
    stopSessionSyncTimer();
    // Other windows may still be showing a workbench; only their own senders count.
    pruneWorkbenchActiveSenders();
    mainWindowReadyToShow = false;
    mainWindowRendererReady = false;
    mainWindow = null;
  });
}

function openSettingsInMainWindow(options?: { pane?: unknown }): void {
  const pane = normalizeSettingsPane(options?.pane);
  const win = revealMainWindow();
  win?.webContents.send("settings:navigate", { pane });
}

/** Application menu: Settings… with ⌘,/Ctrl+, (macOS app menu / File on other platforms). */
async function installApplicationMenu(): Promise<void> {
  const settings = await loadSettings();
  const settingsLabel = desktopT(settings, "desktop.menu.settings");
  const sessionsLabel = desktopT(settings, "desktop.menu.sessions");
  const checkForUpdatesLabel = desktopT(settings, "desktop.menu.checkForUpdates");
  const isMac = process.platform === "darwin";

  const settingsItem: Electron.MenuItemConstructorOptions = {
    label: settingsLabel,
    accelerator: "CommandOrControl+,",
    click: () => openSettingsInMainWindow({ pane: "general" })
  };

  const sessionsItem: Electron.MenuItemConstructorOptions = {
    label: sessionsLabel,
    click: () => {
      // Sessions live in their task's window now; the board is where you pick one.
      revealMainWindow();
    }
  };

  const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
    label: checkForUpdatesLabel,
    click: () => openSettingsInMainWindow({ pane: "about" })
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              settingsItem,
              sessionsItem,
              checkForUpdatesItem,
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const }
            ]
          }
        ]
      : [
          {
            label: "File",
            submenu: [
              settingsItem,
              sessionsItem,
              checkForUpdatesItem,
              { type: "separator" as const },
              { role: "quit" as const }
            ]
          }
        ]),
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Windows waiting on a renderer answer before they may close.
 *
 * A workbench window can hold unsaved editor buffers, so closing asks the
 * renderer to flush them first — the bargain the floating note windows make.
 */
const pendingTaskWindowCloses = new Map<number, { settle: (closed: boolean) => void }>();
const TASK_WINDOW_CLOSE_TIMEOUT_MS = 15_000;

function registerTaskWindowCloseGuard(win: BrowserWindow): void {
  const senderId = win.webContents.id;
  let allowClose = false;
  win.on("close", (event) => {
    if (allowClose || allowAppQuit || win.webContents.isDestroyed()) return;
    event.preventDefault();
    if (pendingTaskWindowCloses.has(senderId)) return;
    const timer = setTimeout(() => {
      pendingTaskWindowCloses.delete(senderId);
      allowClose = true;
      if (!win.isDestroyed()) win.close();
    }, TASK_WINDOW_CLOSE_TIMEOUT_MS);
    timer.unref?.();
    pendingTaskWindowCloses.set(senderId, {
      settle: (closed: boolean) => {
        clearTimeout(timer);
        pendingTaskWindowCloses.delete(senderId);
        if (!closed || win.isDestroyed()) return;
        allowClose = true;
        win.close();
      }
    });
    win.webContents.send("task-window:requestClose");
  });
  win.on("closed", () => {
    pendingTaskWindowCloses.get(senderId)?.settle(false);
  });
}

/**
 * Dependencies for workbench windows. Preload and renderer paths mirror the main
 * window's so every window loads the same bridge and bundle, and each workbench
 * window keeps the workbench window's ⌘T / ⌘⇧F / ⌘P / ⌘W: those act on the
 * workbench that window hosts.
 */
function taskWindowDeps(): TaskWindowDeps {
  const icon = loadAppIcon();
  return {
    preloadPath: path.join(__dirname, "..", "preload", "preload.js"),
    rendererIndex: path.join(__dirname, "..", "renderer", "index.html"),
    ...(icon ? { icon } : {}),
    onCreated: (win) => {
      registerWorkbenchShortcuts(win);
      registerTaskWindowCloseGuard(win);
      void loadWorkbenchMeta();
    },
    onChange: (windows) => {
      pruneWorkbenchActiveSenders();
      refreshWorkbenchActiveSessions();
      // The tray now lists open workbenches too, so a window set change matters
      // even when no pane reported a dot (a freshly opened, session-less one).
      syncSessionDotsTray();
      broadcastToRenderers("task-window:changed", windows);
      persistOpenTaskWindows();
    }
  };
}

/** Remember the open workbench windows so the next launch can restore them. */
function persistOpenTaskWindows(): void {
  const entries = summarizeTaskWindows().map(({ workbenchId, noteId, title }) => ({ workbenchId, noteId, title }));
  void loadPanelDbPaths()
    .then((paths) => saveStoredTaskWindows(taskWindowStatePath(paths.desktopDb), entries))
    .catch(() => undefined);
}

/** Reopen the workbench windows that were open when the app last ran. */
async function restoreTaskWindows(): Promise<void> {
  try {
    const paths = await loadPanelDbPaths();
    const stored = await loadStoredTaskWindows(taskWindowStatePath(paths.desktopDb));
    for (const entry of stored) {
      if (openTaskWindowCount() >= MAX_TASK_WINDOWS) break;
      openTaskWindow(taskWindowDeps(), {
        noteId: entry.noteId,
        workbenchId: entry.workbenchId,
        ...(entry.title ? { title: entry.title } : {})
      });
    }
  } catch (error) {
    void recordAppError({ source: "task-window", message: "Could not restore workbench windows.", error });
  }
}

function registerIpc(): void {
  ipcMain.on("main:rendererReady", (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    mainWindowRendererReady = true;
    showMainWindowIfReady();
  });

  ipcMain.on("workbench:setActive", (event, active: unknown) => {
    if (active === true) workbenchActiveSenders.add(event.sender.id);
    else workbenchActiveSenders.delete(event.sender.id);
    setWorkbenchWatcherActive(event.sender.id, active === true);
  });

  ipcMain.on("workbench:activeSessions", (event, payload: unknown) => {
    const dots = parseWorkbenchActiveSessionDots(payload);
    if (dots.length) workbenchActiveSessionsBySender.set(event.sender.id, dots);
    else workbenchActiveSessionsBySender.delete(event.sender.id);
    refreshWorkbenchActiveSessions();
  });

  safeHandle("workbench:getActiveSessions", async () => workbenchActiveSessions);

  /** The window that owns a pane, else the workbench window in front. */
  function workbenchWindowFor(paneKey?: string): BrowserWindow | null {
    const owner = paneKey ? windowForPaneKey(paneKey) : null;
    const target = owner ?? focusedOrRecentTaskWindow();
    if (!target || target.isDestroyed()) return null;
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
    return target;
  }

  safeHandle("workbench:focusSession", async (_event, payload: unknown) => {
    const request = parseWorkbenchFocusSessionRequest(payload);
    const target = workbenchWindowFor(request.paneKey);
    if (!target) throw new Error("No workbench window is open.");
    target.webContents.send("workbench:focusSession", request);
    return { ok: true as const };
  });

  safeHandle("workbench:sendSelection", async (_event, payload: unknown) => {
    const request = parseWorkbenchSendSelectionRequest(payload);
    // An existing session is focused where it lives; a new agent needs any
    // workbench window, since only a workbench can host the pane.
    const target = workbenchWindowFor(request.kind === "existing-session" ? request.paneKey : undefined);
    if (!target) throw new Error("No workbench window is open.");
    target.webContents.send("workbench:sendSelection", request);
    return { ok: true as const };
  });

  safeHandle("workbench:getRuntimeMetrics", async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("无效的窗口来源");
    const pty = (() => {
      try {
        const host = require("./ptyHost") as typeof import("./ptyHost");
        return host.getPtyRuntimeMetrics();
      } catch {
        return {
          count: 0,
          attachedCount: 0,
          replayBytes: 0,
          outputBytes: 0,
          forwardedBytes: 0
        };
      }
    })();
    return { ...getWorkbenchWatcherRuntimeMetrics(), pty, acp: getAcpRuntimeMetrics(), windows: { count: openTaskWindowCount(), limit: MAX_TASK_WINDOWS, timings: taskWindowOpenTimings() } };
  });

  ipcMain.handle("panel:getHome", async () => {
    const settings = await loadSettings();
    return resolvePanelHome(settings.panelHome);
  });

  ipcMain.handle("settings:get", async () => {
    return loadSettings();
  });

  ipcMain.handle(
    "dialog:pickDirectory",
    async (_event, args?: { title?: string }) => showDirectoryPicker({ title: args?.title })
  );

  safeHandle(
    "providers:testConnection",
    async (_event, args?: ProviderTestConnectionArgs | null) => {
      return testProviderConnectionFromDraft(args || {});
    }
  );

  safeHandle(
    "providers:fetchModels",
    async (_event, args?: { baseUrl?: unknown; apiKey?: unknown } | null) => {
      return fetchProviderModelsFromDraft(args || {});
    }
  );

  const externalMcpLaunch = async () => {
    const settings = await loadSettings();
    return createExternalMcpLaunchConfig({
      executablePath: process.execPath,
      cliPath: resolveExternalMcpCliPath({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath()
      }),
      panelHome: resolvePanelHome(settings.panelHome)
    });
  };

  safeHandle("mcp:listClients", async () => {
    try {
      await migrateLegacyAgentResumeRegistrations(await externalMcpLaunch());
    } catch (error) {
      void recordAppError({
        source: "mcp-migrate",
        message: "MCP legacy migration failed.",
        error
      });
    }
    return listMcpClients();
  });

  safeHandle("mcp:manualConfig", async () => {
    const settings = await loadSettings();
    const browser = settings.desktop?.browser;
    const coreLaunch = await externalMcpLaunch();
    const browserLaunch =
      Boolean(browser?.enabled) && browser?.exposeExternalMcp !== false
        ? createExternalBrowserMcpLaunchConfig({
            executablePath: process.execPath,
            cliPath: resolveExternalBrowserMcpCliPath({
              isPackaged: app.isPackaged,
              resourcesPath: process.resourcesPath,
              appPath: app.getAppPath()
            }),
            panelHome: effectivePanelHome(settings)
          })
        : undefined;
    return manualMcpConfig(coreLaunch, browserLaunch);
  });

  safeHandle(
    "mcp:register",
    async (_event, args: { clientId?: unknown; replace?: unknown }) => {
      const clientId = String(args?.clientId || "") as McpClientId;
      await registerMcpClient(clientId, await externalMcpLaunch(), args?.replace === true);
      return { ok: true as const };
    }
  );

  safeHandle("mcp:remove", async (_event, args: { clientId?: unknown }) => {
    const clientId = String(args?.clientId || "") as McpClientId;
    await removeMcpClient(clientId);
    return { ok: true as const };
  });

  safeHandle("mcp:registerAll", async (_event, args?: { replace?: unknown }) => {
    const launch = await externalMcpLaunch();
    const clients = await listMcpClients();
    const registered: string[] = [];
    const failed: Array<{ clientId: string; error: string }> = [];
    for (const client of clients) {
      if (!client.detected || client.mode !== "automatic") continue;
      try {
        await registerMcpClient(client.id, launch, args?.replace === true);
        registered.push(client.id);
      } catch (error) {
        failed.push({
          clientId: client.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    return { registered, failed };
  });

  ipcMain.handle("i18n:getBundle", async () => {
    const settings = await loadSettings();
    return buildI18nBundle(settings);
  });

  ipcMain.handle("shell:openExternal", async (_event, url: string) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      throw new Error("Invalid external URL");
    }
    await shell.openExternal(url);
  });

  safeHandle("app:getVersion", async () => ({ version: getAppVersion() }));

  safeHandle("backup:targetStatus", async () => getBackupStorageTargetStatus());
  safeHandle("backup:listIcloud", async () => listIcloudBackups());

  safeHandle(
    "backup:export",
    async (event, args?: { target?: unknown; includeCredentials?: unknown; includeNativeConversations?: unknown; password?: unknown }) => {
      const settings = await loadSettings();
      const target = args?.target === "icloud-drive" ? "icloud-drive" : "local-file";
      const includeCredentials = args?.includeCredentials === true;
      const includeNativeConversations = args?.includeNativeConversations !== false;
      const password = typeof args?.password === "string" ? args.password : undefined;
      const options = {
        includeCredentials,
        includeNativeConversations,
        password,
        onProgress: (progress: import("./backupService").BackupProgressEvent) => event.sender.send("backup:progress", progress)
      };
      if (target === "icloud-drive") return exportIcloudBackup(settings, getAppVersion(), options);
      const selected = await dialog.showSaveDialog({
        defaultPath: `agent-resume-backup-${new Date().toISOString().slice(0, 10)}.zip`,
        filters: [{ name: "Agent Resume backup", extensions: ["zip"] }]
      });
      if (selected.canceled || !selected.filePath) return { canceled: true };
      return exportBackup(settings, selected.filePath, getAppVersion(), options);
    }
  );

  safeHandle("backup:selectImport", async () => {
    const selected = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Agent Resume local backup", extensions: ["zip"] }]
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return selectBackupForImport(selected.filePaths[0]);
  });

  safeHandle("backup:selectIcloudImport", async (_event, args?: { backupId?: unknown; password?: unknown }) => {
    const backupId = typeof args?.backupId === "string" ? args.backupId : "";
    const password = typeof args?.password === "string" ? args.password : "";
    if (!backupId) throw new Error("An iCloud backup must be selected.");
    return selectIcloudBackupForImport(backupId, password);
  });

  safeHandle(
    "backup:import",
    async (event, args?: { importToken?: unknown; includeCredentials?: unknown; restoreNativeConversations?: unknown; password?: unknown }) => {
      const importToken = typeof args?.importToken === "string" ? args.importToken : "";
      if (!importToken) throw new Error("A selected backup is required.");
      stopMemoryScheduler();
      stopNotesIndexer();
      stopSessionSummaryAuto();
      stopSessionTranscriptIndexAuto();
      stopSessionEmbeddingIndexAuto();
      try {
        const result = await importBackup(await loadSettings(), importToken, getAppVersion(), {
          includeCredentials: args?.includeCredentials === true,
          password: typeof args?.password === "string" ? args.password : undefined,
          restoreNativeConversations: args?.restoreNativeConversations === true,
          recoveryDir: path.join(app.getPath("userData"), "import-recovery"),
          onProgress: (progress: import("./backupService").BackupProgressEvent) => event.sender.send("backup:progress", progress)
        });
        invalidateNotesStore();
        const saved = await loadSettings();
        const bundle = buildI18nBundle(saved);
        await refreshMemorySchedulerFromSettings();
        startNotesIndexer((progress) => broadcastToRenderers("notes:indexProgress", progress));
        startSessionSummaryAuto();
        startSessionTranscriptIndexAuto();
        startSessionEmbeddingIndexAuto();
        refreshAgentStatusSettings(saved);
        broadcastToRenderers("settings:changed", { settings: saved, section: "storage" });
        broadcastToRenderers("i18n:localeChanged", bundle);
        broadcastToRenderers("backup:imported", result);
        void installApplicationMenu();
        return result;
      } catch (error) {
        await refreshMemorySchedulerFromSettings();
        startNotesIndexer((progress) => broadcastToRenderers("notes:indexProgress", progress));
        startSessionSummaryAuto();
        startSessionTranscriptIndexAuto();
        startSessionEmbeddingIndexAuto();
        throw error;
      }
    }
  );

  safeHandle("update:check", async (_event, options?: { force?: boolean }) => {
    return checkForDesktopUpdate(options);
  });

  ipcMain.handle(
    "settings:save",
    async (_event, settings: PanelSettings, options?: SaveSettingsOptions) => {
      const previous = await loadSettings();
      const prevLocale = buildI18nBundle(previous).locale;
      const normalizedShortcut = configuredStandaloneNoteShortcut(settings);
      const normalizedRecentShortcut = configuredRecentStandaloneNoteShortcut(settings);
      const settingsToSave: PanelSettings = {
        ...settings,
        notes: {
          ...settings.notes,
          newStandaloneNoteShortcut: normalizedShortcut,
          recentStandaloneNoteShortcut: normalizedRecentShortcut
        }
      };
      const previousShortcut = configuredStandaloneNoteShortcut(previous);
      const previousRecentShortcut = configuredRecentStandaloneNoteShortcut(previous);
      const shortcutChanged = normalizedShortcut !== previousShortcut;
      const recentShortcutChanged = normalizedRecentShortcut !== previousRecentShortcut;
      if (shortcutChanged) {
        applyStandaloneNoteShortcut(normalizedShortcut);
      }
      if (recentShortcutChanged) {
        applyRecentStandaloneNoteShortcut(normalizedRecentShortcut);
      }
      let file: string;
      try {
        file = await saveSettings(settingsToSave);
      } catch (error) {
        if (shortcutChanged) {
          try {
            applyStandaloneNoteShortcut(previousShortcut);
          } catch {
            // Keep the already-registered shortcut when the settings write fails.
          }
        }
        if (recentShortcutChanged) {
          try {
            applyRecentStandaloneNoteShortcut(previousRecentShortcut);
          } catch {
            // Keep the already-registered shortcut when the settings write fails.
          }
        }
        throw error;
      }
      invalidateNotesStore();
      await refreshMemorySchedulerFromSettings();
      const saved = await loadSettings();
      browserSettingsCache = saved.desktop?.browser || null;
      try {
        const mcp = await syncExternalMcpRegistration(saved);
        if (mcp.registered.length) {
          console.log(
            `[agent-resume] External MCP registered for: ${mcp.registered.join(", ")}`
          );
        }
        for (const failure of mcp.failed) {
          void recordAppError({
            source: "external-mcp",
            message: `External MCP sync failed (${failure.target}): ${failure.error}`
          });
        }
      } catch (error) {
        void recordAppError({
          source: "external-mcp",
          message: "External MCP sync failed after settings save.",
          error
        });
      }
      const bundle = buildI18nBundle(saved);
      const sync = shouldSyncSessionsAfterSettingsSave(previous, saved, options)
        ? await syncAndNotify()
        : undefined;
      // Reconfigure background services so disabled features own no timers and
      // newly enabled features start immediately after settings are saved.
      startDesktopNotesIndexer();
      startSessionSummaryAuto();
      startSessionTranscriptIndexAuto();
      startSessionEmbeddingIndexAuto();
      refreshAgentStatusSettings(saved);
      broadcastToRenderers("settings:changed", {
        settings: saved,
        section: options?.section,
        sync
      });
      if (bundle.locale !== prevLocale) {
        broadcastToRenderers("i18n:localeChanged", bundle);
        void installApplicationMenu();
      }
      return { file, settings: saved, sync };
    }
  );

  safeHandle("settings:openWindow", async (_event, options?: { pane?: unknown }) => {
    openSettingsInMainWindow(options);
  });

  ipcMain.handle("sessions:sync", async () => syncAndNotify());

  ipcMain.handle("sessions:count", async () => {
    const paths = await loadPanelDbPaths();
    return countSessions(paths.catalogDb);
  });

  ipcMain.handle("sessions:unhideAll", async () => {
    const paths = await loadPanelDbPaths();
    const restored = await unhideAllSessionsInCatalog(paths.catalogDb);
    const restoredProjects = await unhideAllProjectsInCatalog(paths.catalogDb);
    const counts = await countSessions(paths.catalogDb);
    return { restored, restoredProjects, counts };
  });

  ipcMain.handle("sessions:queryPage", async (_event, args?: {
    limit?: number;
    cursor?: { updatedAt: number; provider: string; id: string };
    search?: string;
    provider?: string;
    fromMs?: number;
    toMs?: number;
    projectPath?: string;
    projectId?: string;
    gtdStatus?: string;
    keys?: Array<{ provider: string; id: string }>;
    unassignedOnly?: boolean;
  }) => {
    const settings = await loadSettings();
    const paths = await loadPanelDbPaths(settings);
    const provider = args?.provider?.trim();
    const validProviders = new Set<AgentProvider>(["codex", "claude", "agy", "grok", "opencode", "pi", "prime", "cursor", "cursor-ide", "chat"]);
    if (provider && !validProviders.has(provider as AgentProvider)) throw new Error("Invalid session provider.");
    if (args?.gtdStatus && !isGtdStatus(args.gtdStatus)) throw new Error("Invalid GTD status.");
    const request = {
      ...args,
      keys: args?.keys,
      provider: provider as AgentProvider | undefined,
      search: args?.search?.trim() || undefined,
      projectPath: args?.projectPath?.trim() || undefined,
      projectId: args?.projectId?.trim() || undefined,
      gtdStatus: args?.gtdStatus?.trim() || undefined,
      unassignedOnly: args?.unassignedOnly === true || undefined
    };
    return querySessionsPage(paths.catalogDb, request);
  });

  ipcMain.handle("sessions:clearLastExitWaiting", async (_event, args: { provider: string; id: string }) => {
    const paths = await loadPanelDbPaths();
    await clearSessionLastExitWaiting(paths.catalogDb, args.provider, args.id);
    return { ok: true };
  });

  ipcMain.handle("gtd:listSessionStatuses", async () => {
    const paths = await loadPanelDbPaths();
    return loadSessionGtdMap(paths.catalogDb);
  });

  ipcMain.handle("gtd:listTaskRollups", async () => {
    const paths = await loadPanelDbPaths();
    return listTaskGtdRollups(paths.catalogDb);
  });

  ipcMain.handle("gtd:taskRollup", async (_event, args: { noteId: string }) => {
    const noteId = String(args?.noteId || "").trim();
    if (!noteId) throw new Error("Task note id is required");
    const paths = await loadPanelDbPaths();
    return resolveTaskGtdRollup(paths.catalogDb, noteId);
  });

  ipcMain.handle(
    "gtd:setSessionStatus",
    async (_event, args: { provider: string; id: string; status: GtdStatus | null }) => {
      const provider = String(args?.provider || "").trim();
      const id = String(args?.id || "").trim();
      if (!provider || !id) throw new Error("Session provider and id are required");
      const paths = await loadPanelDbPaths();
      if (args?.status == null) {
        await clearSessionGtdStatus(paths.catalogDb, provider, id);
      } else if (isGtdStatus(args.status)) {
        await setSessionGtdStatus(paths.catalogDb, provider, id, args.status);
      } else {
        throw new Error("Invalid GTD status");
      }
      return { ok: true as const };
    }
  );

  ipcMain.handle(
    "sessions:preview",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      const session = await getSessionById(paths.catalogDb, args.provider, args.id);
      if (!session) {
        throw new Error(`Session not found: ${args.provider} ${args.id}`);
      }
      const homes = resolvePreviewHomes(settings);
      try {
        const preview = await loadSessionPreview(session, homes);
        return { session, preview };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          session,
          preview: {
            title: session.title,
            messages: [],
            warning: message
          }
        };
      }
    }
  );

  ipcMain.handle(
    "sessions:summarize",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      return summarizeSessionAction({
        provider: args.provider,
        id: args.id,
        systemLocale: app.getLocale()
      });
    }
  );

  ipcMain.handle(
    "sessions:autoRename",
    async (_event, args: { provider: AgentProvider; id: string; persist?: boolean }) => {
      return autoRenameSessionAction({
        provider: args.provider,
        id: args.id,
        persist: args.persist,
        systemLocale: app.getLocale()
      });
    }
  );

  ipcMain.handle(
    "sessions:suggestRename",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      return suggestSessionRenameAction({
        provider: args.provider,
        id: args.id,
        systemLocale: app.getLocale()
      });
    }
  );

  ipcMain.handle(
    "sessions:rename",
    async (_event, args: { provider: AgentProvider; id: string; title: string }) => {
      return renameSessionAction({
        provider: args.provider,
        id: args.id,
        title: args.title
      });
    }
  );

  ipcMain.handle(
    "sessions:hide",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      // Drop live ACP process before deleting store/catalog so remove cannot race reconnect.
      if (args.provider === "chat") {
        disposeAcpController(args.id);
      }
      await hideSessionAction({ provider: args.provider, id: args.id });
      return { ok: true };
    }
  );

  ipcMain.handle(
    "sessions:hideMany",
    async (_event, args: { sessions: Array<{ provider: AgentProvider; id: string }> }) => {
      const sessions = Array.isArray(args?.sessions) ? args.sessions : [];
      for (const session of sessions) {
        const provider = session?.provider;
        const id = String(session?.id || "").trim();
        if (!provider || !id) continue;
        if (provider === "chat") disposeAcpController(id);
        await hideSessionAction({ provider, id });
      }
      return { ok: true };
    }
  );

  safeHandle(
    "workbench:composerSendAppend",
    async (_event, args: {
      paneKey?: string;
      projectPath?: string;
      sessionKey?: string | null;
      provider?: string | null;
      agentSessionId?: string | null;
      text?: string;
    }) => {
      const paths = await loadPanelDbPaths();
      return appendComposerSend(paths.desktopDb, {
        paneKey: args?.paneKey || "",
        projectPath: args?.projectPath || "",
        sessionKey: args?.sessionKey,
        provider: args?.provider,
        agentSessionId: args?.agentSessionId,
        text: args?.text || ""
      });
    }
  );

  safeHandle(
    "workbench:composerSendList",
    async (_event, args?: { paneKey?: string; sessionKey?: string; agentSessionId?: string; limit?: number }) => {
      const paths = await loadPanelDbPaths();
      return listComposerSends(paths.desktopDb, {
        paneKey: args?.paneKey,
        sessionKey: args?.sessionKey,
        agentSessionId: args?.agentSessionId,
        limit: args?.limit
      });
    }
  );

  safeHandle(
    "workbench:composerSendImport",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      const session = await getSessionById(paths.catalogDb, args.provider, args.id);
      if (!session) {
        return { imported: 0, skipped: 0, found: 0 };
      }
      const homes = resolvePreviewHomes(settings);
      return importComposerSendsForSession(paths.desktopDb, session, homes);
    }
  );

  safeHandle("workbench:createScratchDir", async () => {
    const settings = await loadSettings();
    const base = resolveScratchBaseDir(settings);
    const dir = path.join(base, `session-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  });

  safeHandle("workbench:getProjectEditor", async () => {
    const settings = await loadSettings();
    const selected = settings.workbench?.projectEditor || "auto";
    const editor = await resolveProjectEditor(selected);
    return {
      selected,
      available: Boolean(editor),
      editor
    };
  });

  safeHandle(
    "workbench:openSession",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      void loadPanelDbPaths()
        .then((paths) => clearSessionLastExitWaiting(paths.catalogDb, args.provider, args.id))
        .catch(() => undefined);
      return resumeCatalogSession(args.provider, args.id);
    }
  );

  safeHandle(
    "workbench:openCodexApp",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      const session = await getSessionById(paths.catalogDb, args.provider, args.id);
      if (!session) {
        throw new Error(`Session not found: ${args.provider} ${args.id}`);
      }
      if (session.provider !== "codex") {
        throw new Error("ChatGPT 打开仅适用于 Codex 会话。");
      }

      const mode = resolveWorkbenchTerminalMode(settings);
      await openChatGptAppSession(session);
      return { mode, external: true, chatgptApp: true, codexApp: true };
    }
  );

  safeHandle(
    "workbench:newSession",
    async (
      _event,
      args: {
        cwd: string;
        provider: AgentProvider;
        executionMode: "standard" | "note-yolo";
        useSystemTerminalOnly?: boolean;
        noteId?: string;
        taskNoteId?: string;
        initialPrompt?: string;
      }
    ) => {
      const cwd = expandHome(args.cwd?.trim() || "");
      if (!cwd) {
        throw new Error("Working directory is required.");
      }
      let requestedYolo = false;
      if (args.executionMode === "note-yolo") {
        if (!args.noteId?.trim()) throw new Error("Note ID is required for Note execution.");
        if (!args.initialPrompt?.trim()) throw new Error("Initial prompt is required for Note execution.");
        requestedYolo = true;
      } else {
        const settings = await loadSettings();
        requestedYolo = settings.workbench?.newSessionYolo === true;
      }

      const yoloSupported = requestedYolo && supportsNewSessionYoloMode(args.provider);
      const executionMode: NewSessionExecutionMode = yoloSupported ? "yolo" : "standard";
      const command = buildNewSessionCommand(
        args.provider,
        cwd,
        executionMode,
        await taskContextFile(args.taskNoteId, cwd)
      );
      const unsupportedYolo = requestedYolo && !yoloSupported;
      const warning = unsupportedYolo
        ? `YOLO mode is not supported for provider: ${args.provider}. Starting in standard mode.`
        : undefined;

      if (args.executionMode === "note-yolo") {
        return { mode: "xterm", command, cwd, unsupportedYolo, warning };
      }

      const settings = await loadSettings();
      const mode = resolveWorkbenchTerminalMode(settings);
      if (args.useSystemTerminalOnly || mode === "external-system") {
        const launch = await openCommandInSystemTerminal(
          cwd,
          command,
          systemTerminalSettings(settings),
          { writeText: (text) => Promise.resolve(clipboard.writeText(text)) }
        );
        return {
          mode: "external-system",
          external: true,
          command,
          cwd,
          copied: launch.copied,
          unsupportedYolo,
          warning
        };
      }
      // MCP session identity so note operations default to this task /
      // session (see packages/core/src/mcp/sessionContext.ts).
      const env: Record<string, string> = { [MCP_SESSION_ENV.provider]: args.provider };
      if (args.taskNoteId?.trim()) {
        env[MCP_SESSION_ENV.taskNoteId] = args.taskNoteId.trim();
      }
      return { mode, command, cwd, unsupportedYolo, warning, env };
    }
  );

  safeHandle(
    "workbench:listSessionFolders",
    async (_event, args: { projectId: string }) => {
      const paths = await loadPanelDbPaths();
      const projectId = String(args?.projectId || "").trim();
      return {
        folders: await listWorkbenchSessionFolders(paths.desktopDb, projectId),
        assignments: await listWorkbenchSessionFolderAssignments(paths.desktopDb, projectId)
      };
    }
  );

  safeHandle("workbench:listAllSessionFolders", async () => {
    const paths = await loadPanelDbPaths();
    const [folders, assignments] = await Promise.all([
      listAllWorkbenchSessionFolders(paths.desktopDb),
      listAllWorkbenchSessionFolderAssignments(paths.desktopDb)
    ]);
    const byProject: Record<string, {
      folders: typeof folders;
      assignments: typeof assignments;
    }> = {};
    for (const folder of folders) {
      const bucket = byProject[folder.projectId] || { folders: [], assignments: [] };
      bucket.folders.push(folder);
      byProject[folder.projectId] = bucket;
    }
    for (const assignment of assignments) {
      const bucket = byProject[assignment.projectId] || { folders: [], assignments: [] };
      bucket.assignments.push(assignment);
      byProject[assignment.projectId] = bucket;
    }
    return byProject;
  });

  safeHandle(
    "workbench:createSessionFolder",
    async (_event, args: { projectId: string; parentId?: string | null; name: string }) => {
      const paths = await loadPanelDbPaths();
      return createWorkbenchSessionFolder(
        paths.desktopDb,
        String(args?.projectId || ""),
        args?.parentId == null ? null : String(args.parentId),
        String(args?.name || "")
      );
    }
  );

  safeHandle(
    "workbench:renameSessionFolder",
    async (_event, args: { folderId: string; name: string }) => {
      const paths = await loadPanelDbPaths();
      return renameWorkbenchSessionFolder(
        paths.desktopDb,
        String(args?.folderId || ""),
        String(args?.name || "")
      );
    }
  );

  safeHandle(
    "workbench:deleteSessionFolder",
    async (_event, args: { folderId: string }) => {
      const paths = await loadPanelDbPaths();
      return deleteWorkbenchSessionFolder(paths.desktopDb, String(args?.folderId || ""));
    }
  );

  safeHandle(
    "workbench:assignSessionToFolder",
    async (
      _event,
      args: { projectId: string; provider: string; agentSessionId: string; folderId: string }
    ) => {
      const paths = await loadPanelDbPaths();
      return assignWorkbenchSessionToFolder(
        paths.desktopDb,
        String(args?.projectId || ""),
        String(args?.provider || ""),
        String(args?.agentSessionId || ""),
        String(args?.folderId || "")
      );
    }
  );

  safeHandle(
    "workbench:removeSessionFromFolder",
    async (_event, args: { provider: string; agentSessionId: string }) => {
      const paths = await loadPanelDbPaths();
      return removeWorkbenchSessionFromFolder(
        paths.desktopDb,
        String(args?.provider || ""),
        String(args?.agentSessionId || "")
      );
    }
  );

  // Task workbenches: a GTD task owns 0..n desktop workbenches.
  safeHandle(
    "taskWorkbenches:list",
    async (_event, args: { taskNoteId: string }) => {
      const paths = await loadPanelDbPaths();
      return listTaskWorkbenches(paths.desktopDb, String(args?.taskNoteId || ""));
    }
  );

  safeHandle("taskWorkbenches:listAll", async () => {
    const paths = await loadPanelDbPaths();
    return listAllTaskWorkbenches(paths.desktopDb);
  });

  safeHandle(
    "taskWorkbenches:ensure",
    async (_event, args: { taskNoteId: string; name?: string; projectPath?: string | null }) => {
      const paths = await loadPanelDbPaths();
      return ensureTaskWorkbench(paths.desktopDb, String(args?.taskNoteId || ""), {
        name: args?.name,
        projectPath: args?.projectPath ?? null
      });
    }
  );

  safeHandle(
    "taskWorkbenches:create",
    async (_event, args: { taskNoteId: string; name?: string; projectPath?: string | null }) => {
      const paths = await loadPanelDbPaths();
      const created = await createTaskWorkbench(paths.desktopDb, {
        taskNoteId: String(args?.taskNoteId || ""),
        name: args?.name,
        projectPath: args?.projectPath ?? null
      });
      void loadWorkbenchMeta();
      return created;
    }
  );

  safeHandle(
    "taskWorkbenches:rename",
    async (_event, args: { workbenchId: string; name: string }) => {
      const paths = await loadPanelDbPaths();
      const renamed = await renameTaskWorkbench(paths.desktopDb, String(args?.workbenchId || ""), String(args?.name || ""));
      void loadWorkbenchMeta();
      return renamed;
    }
  );

  safeHandle(
    "taskWorkbenches:setProject",
    async (_event, args: { workbenchId: string; projectPath: string | null }) => {
      const paths = await loadPanelDbPaths();
      const updated = await setTaskWorkbenchProject(
        paths.desktopDb,
        String(args?.workbenchId || ""),
        args?.projectPath == null ? null : String(args.projectPath)
      );
      void loadWorkbenchMeta();
      return updated;
    }
  );

  safeHandle(
    "taskWorkbenches:setLayout",
    async (_event, args: { workbenchId: string; layoutJson: string | null }) => {
      const paths = await loadPanelDbPaths();
      await setTaskWorkbenchLayout(
        paths.desktopDb,
        String(args?.workbenchId || ""),
        args?.layoutJson == null ? null : String(args.layoutJson)
      );
      return { ok: true as const };
    }
  );

  safeHandle(
    "taskWorkbenches:reorder",
    async (_event, args: { taskNoteId: string; orderedIds: string[] }) => {
      const paths = await loadPanelDbPaths();
      await reorderTaskWorkbenches(
        paths.desktopDb,
        String(args?.taskNoteId || ""),
        Array.isArray(args?.orderedIds) ? args.orderedIds.map(String) : []
      );
      return { ok: true as const };
    }
  );

  safeHandle(
    "taskWorkbenches:delete",
    async (_event, args: { workbenchId: string }) => {
      const paths = await loadPanelDbPaths();
      await deleteTaskWorkbench(paths.desktopDb, String(args?.workbenchId || ""));
      void loadWorkbenchMeta();
      return { ok: true as const };
    }
  );

  safeHandle(
    "taskWorkbenches:listSessionLinks",
    async (_event, args: { workbenchId: string }) => {
      const paths = await loadPanelDbPaths();
      return listTaskWorkbenchSessionLinks(paths.desktopDb, String(args?.workbenchId || ""));
    }
  );

  safeHandle(
    "taskWorkbenches:assignSession",
    async (_event, args: { workbenchId: string; provider: string; agentSessionId: string }) => {
      const paths = await loadPanelDbPaths();
      return assignSessionToTaskWorkbench(
        paths.desktopDb,
        String(args?.workbenchId || ""),
        String(args?.provider || ""),
        String(args?.agentSessionId || "")
      );
    }
  );

  safeHandle(
    "taskWorkbenches:removeSession",
    async (_event, args: { workbenchId: string; provider: string; agentSessionId: string }) => {
      const paths = await loadPanelDbPaths();
      await removeSessionFromTaskWorkbench(
        paths.desktopDb,
        String(args?.workbenchId || ""),
        String(args?.provider || ""),
        String(args?.agentSessionId || "")
      );
      return { ok: true as const };
    }
  );

  ipcMain.handle("report:getEntry", async (_event, reportId?: string) => {
    const id = typeof reportId === "string" ? reportId.trim() : "";
    if (!id) {
      return null;
    }
    try {
      const paths = await loadPanelDbPaths();
      return (await getReportEntryById(paths.desktopDb, id)) ?? null;
    } catch (error) {
      void recordAppError({ source: "report", message: "report:getEntry failed.", error });
      return null;
    }
  });

  ipcMain.handle("agent:listTools", async (_event, args?: { projectPath?: string }) => {
    const coreTools: AgentToolDescriptor[] = AGENT_TOOL_CATALOG.map((tool) => ({
      ...tool,
      kind: "core_mcp" as const
    }));
    try {
      const skills = await discoverSkills({ projectPath: args?.projectPath });
      const skillTools = skills.map(skillToToolDescriptor);

      const settings = await loadSettings();
      const browserEnabled = settings.desktop?.browser?.enabled !== false;
      const browserTools: AgentToolDescriptor[] = browserEnabled
        ? listBrowserToolDescriptors().map((tool) => ({
            name: tool.name,
            description: tool.description,
            category: "browser" as const,
            kind: "browser_mcp" as const
          }))
        : [];

      return [...coreTools, ...browserTools, ...skillTools];
    } catch {
      return coreTools;
    }
  });

  ipcMain.handle("skills:list", async (_event, args?: { projectPath?: string }) => {
    return discoverSkills({ projectPath: args?.projectPath });
  });

  ipcMain.handle("skills:read", async (_event, args: { location: string }) => {
    return readSkillContent(args.location);
  });

  ipcMain.handle("usage:summary", async (_event, args?: { days?: number }) => {
    const paths = await loadPanelDbPaths();
    return getUsageSummary(paths.desktopDb, args?.days ?? 30);
  });

  ipcMain.handle(
    "usage:listEvents",
    async (_event, args?: { limit?: number; source?: string; days?: number }) => {
      const paths = await loadPanelDbPaths();
      const days = args?.days ?? 30;
      const fromMs = Date.now() - days * 24 * 60 * 60 * 1000;
      return listLlmUsageEvents(paths.desktopDb, {
        fromMs,
        source: args?.source,
        limit: args?.limit ?? 100
      });
    }
  );

  ipcMain.handle(
    "usage:listScheduleRuns",
    async (_event, args?: { limit?: number; level?: string; days?: number }) => {
      const paths = await loadPanelDbPaths();
      const days = args?.days ?? 30;
      const fromMs = Date.now() - days * 24 * 60 * 60 * 1000;
      return listScheduleRuns(paths.desktopDb, {
        fromMs,
        level: args?.level,
        limit: args?.limit ?? 100
      });
    }
  );

  ipcMain.handle(
    "logs:list",
    async (_event, args?: { limit?: number; level?: string; source?: string }) => {
      const level =
        args?.level === "warn" || args?.level === "error"
          ? (args.level as AppErrorLogLevel)
          : undefined;
      return listAppErrors({
        limit: args?.limit,
        level,
        source: typeof args?.source === "string" ? args.source : undefined
      });
    }
  );
  ipcMain.handle("logs:clear", async () => clearAppErrors());
  ipcMain.handle("logs:openDir", async () => openAppErrorLogDir());

  ipcMain.handle("notes:list", async () => notesList());
  ipcMain.handle("notes:listTasks", async () => notesListTasks());
  ipcMain.handle("taskTemplates:list", async () => listTaskTemplates());
  ipcMain.handle("taskTemplates:create", async (_event, args: { title?: unknown; projectPaths?: unknown }) => {
    if (typeof args?.title !== "string" || !args.title.trim()) {
      throw new Error("A template name is required.");
    }
    return createTaskTemplate({
      title: args.title,
      projectPaths: stringList(args?.projectPaths)
    });
  });
  ipcMain.handle("taskTemplates:update", async (_event, args: { templateId?: unknown; title?: unknown; projectPaths?: unknown }) => {
    if (typeof args?.templateId !== "string" || !args.templateId.trim()) {
      throw new Error("A task template id is required.");
    }
    if (typeof args?.title !== "string" || !args.title.trim()) {
      throw new Error("A template name is required.");
    }
    return updateTaskTemplate({
      templateId: args.templateId,
      title: args.title,
      projectPaths: stringList(args?.projectPaths)
    });
  });
  ipcMain.handle("taskTemplates:delete", async (_event, args: { templateId?: unknown }) => {
    if (typeof args?.templateId !== "string" || !args.templateId.trim()) {
      throw new Error("A task template id is required.");
    }
    return deleteTaskTemplate(args.templateId);
  });
  ipcMain.handle("notes:removeTaskProject", async (_event, args: { noteId?: unknown; projectPath?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A task note id is required.");
    }
    if (typeof args?.projectPath !== "string" || !args.projectPath.trim()) {
      throw new Error("A project path is required.");
    }
    return notesRemoveTaskProject({ noteId: args.noteId, projectPath: args.projectPath });
  });
  ipcMain.handle("notes:ensureTaskWorkspace", async (_event, args: { noteId?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A task note id is required.");
    }
    return notesEnsureTaskWorkspace(args.noteId);
  });
  ipcMain.handle("notes:listTaskSessionLinks", async () => notesListTaskSessionLinks());
  ipcMain.handle("notes:taskWorkspace", async (_event, args: { noteId?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A task note id is required.");
    }
    return notesTaskWorkspace(args.noteId);
  });
  ipcMain.handle("notes:openTaskWorkspace", async (_event, args: { noteId?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A task note id is required.");
    }
    return notesOpenTaskWorkspace(args.noteId);
  });
  ipcMain.handle("notes:addTaskProject", async (_event, args: { noteId?: unknown; projectPath?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A task note id is required.");
    }
    if (typeof args?.projectPath !== "string" || !args.projectPath.trim()) {
      throw new Error("A project path is required.");
    }
    return notesAddTaskProject({ noteId: args.noteId, projectPath: args.projectPath });
  });
  ipcMain.handle("notes:linkSessionToTask", async (_event, args: { noteId?: unknown; sessionKey?: unknown; projectPath?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A task note id is required.");
    }
    if (typeof args?.sessionKey !== "string" || !args.sessionKey.trim()) {
      throw new Error("A session key is required.");
    }
    return notesLinkSessionToTask({
      noteId: args.noteId,
      sessionKey: args.sessionKey,
      projectPath: typeof args.projectPath === "string" ? args.projectPath : undefined
    });
  });
  ipcMain.handle("notes:createTask", async (_event, args: { title?: unknown; next?: unknown; decision?: unknown; sessions?: unknown; projects?: unknown; primaryProject?: unknown; status?: unknown }) => {
    return notesCreateTask({
      title: typeof args?.title === "string" ? args.title : undefined,
      next: typeof args?.next === "string" ? args.next : undefined,
      decision: typeof args?.decision === "string" ? args.decision : undefined,
      sessions: stringList(args?.sessions),
      projects: stringList(args?.projects),
      primaryProject: typeof args?.primaryProject === "string" ? args.primaryProject : undefined,
      status: typeof args?.status === "string" && isGtdStatus(args.status) ? args.status : undefined
    });
  });
  ipcMain.handle("notes:listRoot", async () => notesListRootNotes());
  ipcMain.handle("notes:listLinks", async () => notesListLinks());
  ipcMain.handle("notes:listLinkedChildIds", async () => notesListLinkedChildIds());
  ipcMain.handle("notes:listChildCounts", async () => notesListChildCounts());
  ipcMain.handle("notes:getParent", async (_event, args: { noteId: string }) => notesGetParent(args.noteId));
  ipcMain.handle(
    "notes:setParent",
    async (_event, args: { childNoteId: string; parentNoteId: string | null }) => {
      const result = await notesSetParent(args.childNoteId, args.parentNoteId);
      scheduleNotesIndex();
      return result;
    }
  );
  ipcMain.handle("notes:createLinkedChild", async (_event, args: { parentNoteId: string }) => {
    const result = await notesCreateLinkedChild(args.parentNoteId);
    scheduleNotesIndex();
    return result;
  });
  ipcMain.handle("notes:getSubtree", async (_event, args: { rootNoteId: string }) =>
    notesGetSubtree(args.rootNoteId)
  );
  ipcMain.handle("notes:resolveLinkRoot", async (_event, args: { noteId: string }) =>
    notesResolveLinkRoot(args.noteId)
  );
  ipcMain.handle("notes:setGtdStatus", async (_event, args: { noteId: string; status?: unknown }) => {
    const status = args?.status === null
      ? null
      : typeof args?.status === "string" && isGtdStatus(args.status)
        ? args.status
        : undefined;
    if (status === undefined) {
      throw new Error("Invalid note GTD status.");
    }
    const result = await notesSetGtdStatus(args.noteId, status);
    scheduleNotesIndex();
    return result;
  });
  ipcMain.handle("notes:read", async (_event, args: { noteId: string }) => notesRead(args.noteId));
  ipcMain.handle("notes:write", async (_event, args: { noteId: string; content: string }) => {
    const result = await notesWrite(args.noteId, args.content);
    scheduleNotesIndex();
    return result;
  });
  ipcMain.handle("standalone-note:open", async (_event, args: { noteId?: unknown; x?: unknown; y?: unknown; requireOutsideMainWindow?: unknown }) => {
    const noteId = typeof args?.noteId === "string" ? args.noteId.trim() : "";
    if (!noteId) throw new Error("Standalone note id is required.");
    const x = typeof args?.x === "number" && Number.isFinite(args.x) ? args.x : undefined;
    const y = typeof args?.y === "number" && Number.isFinite(args.y) ? args.y : undefined;
    return openStandaloneNoteById(noteId, {
      x,
      y,
      requireOutsideMainWindow: args?.requireOutsideMainWindow === true
    });
  });
  ipcMain.handle("standalone-note:list", async () => listOpenStandaloneNotes());
  ipcMain.handle("standalone-note:getState", async (event) => {
    const state = standaloneNoteStateForSender(event.sender);
    if (!state || state.window.isDestroyed()) throw new Error("Standalone note window not found.");
    return { noteId: state.noteId, pinned: state.window.isAlwaysOnTop() };
  });
  ipcMain.handle("standalone-note:setAlwaysOnTop", async (event, args: { pinned?: unknown }) => {
    const state = standaloneNoteStateForSender(event.sender);
    if (!state || state.window.isDestroyed()) throw new Error("Standalone note window not found.");
    return { pinned: setStandaloneNoteAlwaysOnTop(state, args?.pinned === true) };
  });
  ipcMain.handle("standalone-note:close", async (event) => {
    const state = standaloneNoteStateForSender(event.sender);
    if (!state || state.window.isDestroyed()) return { ok: false as const };
    state.allowClose = true;
    state.window.close();
    return { ok: true as const };
  });
  ipcMain.handle("standalone-note:closeReady", async (event, args: { ok?: unknown }) => {
    const state = standaloneNoteStateForSender(event.sender);
    if (!state || !state.closeRequest) return { ok: false as const };
    if (args?.ok !== true) {
      settleStandaloneNoteCloseRequest(state, false);
      return { ok: false as const };
    }
    state.allowClose = true;
    state.window.close();
    return { ok: true as const };
  });
  ipcMain.handle(
    "task-window:open",
    async (_event, args: { noteId?: unknown; workbenchId?: unknown; title?: unknown; x?: unknown; y?: unknown }) => {
      const noteId = typeof args?.noteId === "string" ? args.noteId.trim() : "";
      const workbenchId = typeof args?.workbenchId === "string" ? args.workbenchId.trim() : "";
      if (!noteId || !workbenchId) throw new Error("A task note id and a workbench id are required.");
      const result = openTaskWindow(taskWindowDeps(), {
        noteId,
        workbenchId,
        ...(typeof args?.title === "string" && args.title.trim() ? { title: args.title.trim() } : {}),
        ...(typeof args?.x === "number" && Number.isFinite(args.x) ? { x: args.x } : {}),
        ...(typeof args?.y === "number" && Number.isFinite(args.y) ? { y: args.y } : {})
      });
      return result;
    }
  );
  ipcMain.handle("task-window:list", async () => summarizeTaskWindows());
  ipcMain.handle("task-window:focus", async (_event, args: { workbenchId?: unknown }) => {
    const workbenchId = typeof args?.workbenchId === "string" ? args.workbenchId.trim() : "";
    return { ok: workbenchId ? focusTaskWindow(workbenchId) : false };
  });
  ipcMain.handle("task-window:getState", async (event) => {
    const state = taskWindowStateForSender(event.sender);
    if (!state || state.window.isDestroyed()) throw new Error("Task window not found.");
    return { workbenchId: state.workbenchId, noteId: state.noteId, title: state.title };
  });
  ipcMain.handle("task-window:setTitle", async (event, args: { title?: unknown }) => {
    const state = taskWindowStateForSender(event.sender);
    if (!state || state.window.isDestroyed()) return { ok: false as const };
    if (typeof args?.title === "string") {
      setTaskWindowTitle(state.workbenchId, args.title);
      broadcastToRenderers("task-window:changed", summarizeTaskWindows());
    }
    return { ok: true as const };
  });
  ipcMain.handle("task-window:close", async (event) => {
    const state = taskWindowStateForSender(event.sender);
    if (!state || state.window.isDestroyed()) return { ok: false as const };
    state.window.close();
    return { ok: true as const };
  });
  ipcMain.handle("task-window:closeReady", async (event, args: { ok?: unknown }) => {
    const pending = pendingTaskWindowCloses.get(event.sender.id);
    if (!pending) return { ok: false as const };
    pending.settle(args?.ok === true);
    return { ok: args?.ok === true } as const;
  });
  ipcMain.handle(
    "notes:resumeSession",
    async (_event, args: { provider: AgentProvider; sessionId: string; initialPrompt?: string }) => {
      const resume = async (): Promise<{
        ok: boolean;
        error?: string;
        command?: string;
        cwd?: string;
        mode?: string;
        external?: boolean;
      }> => {
        try {
          const result = await resumeCatalogSession(args.provider, args.sessionId);
          // xterm mode only returns command/cwd — Workbench must open the terminal.
          if (!result.external && result.command) {
            const payload = {
              provider: args.provider,
              id: args.sessionId,
              command: result.command,
              cwd: result.cwd,
              title: result.session?.title || args.sessionId,
              projectPath: result.session?.projectPath || result.cwd,
              mode: result.mode,
              initialPrompt: args.initialPrompt?.trim() || undefined
            };
            // Resuming a session opens a pane, so it belongs in a workbench
            // window: the board window has none.
            const target = focusedOrRecentTaskWindow();
            if (target && !target.isDestroyed()) {
              if (target.isMinimized()) target.restore();
              target.show();
              target.focus();
              target.webContents.send("workbench:resumeFromAgent", payload);
            }
          }
          return {
            ok: true,
            command: result.command,
            cwd: result.cwd,
            mode: result.mode,
            external: result.external === true
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      };

      const first = await resume();
      if (first.ok || first.error?.includes("not found")) {
        // The session may be hidden — restore visibility and retry before failing.
        const paths = await loadPanelDbPaths(await loadSettings());
        const restored = await unhideSessionInCatalog(paths.catalogDb, args.provider, args.sessionId);
        if (restored) {
          return resume();
        }
      }
      return first;
    }
  );
  ipcMain.handle(
    "notes:create",
    async (
      _event,
      args: {
        scope: "library" | "session";
        projectPath?: string;
        provider?: string;
        sessionId?: string;
        body?: string;
      }
    ) => {
      const result = await notesCreate(args);
      scheduleNotesIndex();
      return result;
    }
  );
  ipcMain.handle("notes:delete", async (_event, args: { noteId: string }) => {
    const result = await notesDelete(args.noteId);
    scheduleNotesIndex();
    return result;
  });
  ipcMain.handle("notes:rename", async (_event, args: { noteId: string; filename: string }) => {
    const result = await notesRename(args.noteId, args.filename);
    scheduleNotesIndex();
    return result;
  });
  ipcMain.handle("notes:renameTask", async (_event, args: { noteId?: unknown; title?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A task note id is required.");
    }
    if (typeof args?.title !== "string" || !args.title.trim()) {
      throw new Error("A task name is required.");
    }
    const result = await notesRenameTask(args.noteId, args.title);
    scheduleNotesIndex();
    return result;
  });
  ipcMain.handle("notes:import", async (_event, owner: import("@agent-resume/core").NoteOwner) => {
    const result = await notesImport(owner);
    scheduleNotesIndex();
    return result;
  });
  ipcMain.handle("notes:pasteImage", async (_event, args: { noteId: string }) =>
    notesPasteImage(args.noteId)
  );
  ipcMain.handle("notes:openFolder", async () => notesOpenFolder());
  ipcMain.handle("settings:openPanelHome", async () => settingsOpenPanelHome());
  ipcMain.handle("notes:reveal", async (_event, args: { noteId: string }) => notesReveal(args.noteId));
  ipcMain.handle("notes:copyPath", async (_event, args: { noteId: string }) => notesCopyPath(args.noteId));

  ipcMain.handle("projects:listAliases", async () => {
    const paths = await loadPanelDbPaths();
    return loadProjectAliasesMap(paths.catalogDb);
  });

  ipcMain.handle("projects:list", async (_event, opts?: { includeHidden?: boolean }) => {
    const paths = await loadPanelDbPaths();
    return listProjects(paths.catalogDb, opts);
  });

  ipcMain.handle(
    "projects:addProject",
    async (_event, args: { title?: string }) => {
      const result = await showDirectoryPicker({ title: args.title || "Select project folder" });
      if (!result.ok) {
        return { ok: false as const, canceled: true as const };
      }
      const absolutePath = result.path;
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat?.isDirectory()) {
        throw new Error("Selected folder is not a valid directory.");
      }
      await fs.access(absolutePath, constants.R_OK).catch(() => {
        throw new Error("Selected folder is not accessible.");
      });
      const paths = await loadPanelDbPaths();
      const projectId = await ensureProjectForPath(paths.catalogDb, absolutePath, {
        bindLocalPath: true,
        touchSeen: true
      });
      await unhideProjectInCatalog(paths.catalogDb, projectId);
      await setProjectKeptVisibleInCatalog(paths.catalogDb, projectId, true);
      const project = (await listProjects(paths.catalogDb)).find((item) => item.projectId === projectId);
      if (!project) {
        throw new Error("Added project could not be loaded.");
      }
      return { ok: true as const, project };
    }
  );

  ipcMain.handle(
    "projects:resolveCwd",
    async (_event, args: { projectId?: string; projectPath?: string }) => {
      const paths = await loadPanelDbPaths();
      if (args.projectId?.trim()) {
        return resolveProjectCwd(paths.catalogDb, args.projectId.trim());
      }
      if (args.projectPath?.trim()) {
        return resolveProjectCwdForPath(paths.catalogDb, args.projectPath.trim());
      }
      throw new Error("projectId or projectPath is required.");
    }
  );

}

// Fail closed: never open a GUI instance when an outdated MCP client still passes
// the removed --agent-resume-mcp flag (that path used to spawn Dock icons).
if (process.argv.includes("--agent-resume-mcp")) {
  void recordAppError({
    source: "startup",
    message:
      "Outdated MCP launch rejected. Agent Resume MCP is headless only " +
      "(ELECTRON_RUN_AS_NODE + packages/core dist/mcp/cli.js). " +
      "Open Desktop Settings → MCP once, or re-copy config for Grok/Cursor."
  });
  app.exit(1);
} else {
app.whenReady().then(async () => {
  initI18nService(path.join(app.getAppPath()));
  applyAppIcon();
  registerIpc();
  registerAcpIpc({
    loadSettings,
    getMainWindow: () => mainWindow
  });
  registerSelectionIpc();
  registerSelectionIpc();
  registerWorkbenchFsIpc();
  registerWorkbenchWatcherIpc(() => mainWindow, (sender) => isTaskWindowSender(sender));
  registerWorkbenchGitIpc(() => app.getLocale());
  registerWorkbenchScriptsIpc();
  registerBrowserIpc({
    getMainWindow: () => mainWindow,
    getPreloadPath: () => path.join(__dirname, "..", "preload", "preload.js"),
    getIcon: () => loadAppIcon(),
    getPartitionMode: () => browserSettingsCache?.partitionMode || "per-project",
    getDefaultPolicy: () => browserSettingsCache?.defaultPolicy,
    getDefaultSurface: () => browserSettingsCache?.defaultSurface || "workbench"
  });
  void loadSettings()
    .then((settings) => {
      browserSettingsCache = settings.desktop?.browser || null;
    })
    .catch(() => undefined);
  tryRegisterPtyIpc();
  // The daemon deliberately outlives this process — see startAgentStatus.
  void loadSettings()
    .then((settings) => startAgentStatus(effectivePanelHome(settings)))
    .catch(() => startAgentStatus(agentStatusPanelHome));
  try {
    await loadPanelDbPaths();
  } catch (error) {
    void recordAppError({
      source: "startup",
      message: "Failed to prepare panel databases on startup.",
      error
    });
  }
  createWindow();
  void loadWorkbenchMeta();
  syncSessionDotsTray();
  void restoreTaskWindows();
  nativeTheme.on("updated", () => {
    syncSessionDotsTray();
    applyWindowBackgrounds();
  });

  void (async () => {
    try {
      const settings = await loadSettings();
      initializeStandaloneNoteShortcut(settings);
      await installApplicationMenu();
      startDesktopNotesIndexer();
      startSessionSummaryAuto();
      startSessionTranscriptIndexAuto();
      startSessionEmbeddingIndexAuto();
      await refreshMemorySchedulerFromSettings();

      try {
        const installed = installArpmShim({
          execPath: process.execPath,
          cliPath: resolveArpmCliPath({
            isPackaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath()
          }),
          panelHome: resolvePanelHome(settings.panelHome)
        });
        if (installed.written) {
          console.log(`[agent-resume] Installed arpm at ${installed.path}`);
        } else if (installed.skipped) {
          void recordAppError({
            source: "arpm-install",
            message: `Skipped arpm install: ${installed.skipped}`
          });
        }
        const shell = installArpmShell({ panelHome: resolvePanelHome(settings.panelHome) });
        if (shell.rcPaths.length) {
          console.log(`[agent-resume] Wired arpm shell cd hook in ${shell.rcPaths.join(", ")}`);
        }
      } catch (error) {
        void recordAppError({
          source: "arpm-install",
          message: "Failed to install arpm on PATH.",
          error
        });
      }

      // Rewrite any client configs still pointing at the old GUI Electron MCP entry in background.
      try {
        const launch = createExternalMcpLaunchConfig({
          executablePath: process.execPath,
          cliPath: resolveExternalMcpCliPath({
            isPackaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            appPath: app.getAppPath()
          }),
          panelHome: resolvePanelHome(settings.panelHome)
        });
        const migrated = await migrateLegacyAgentResumeRegistrations(launch);
        if (migrated.migrated.length > 0) {
          console.log(`[agent-resume] Migrated MCP clients to headless CLI: ${migrated.migrated.join(", ")}`);
        }
        for (const failure of migrated.failed) {
          void recordAppError({
            source: "mcp-migrate",
            message: `MCP migrate failed (${failure.target}): ${failure.error}`
          });
        }
      } catch (error) {
        void recordAppError({
          source: "mcp-migrate",
          message: "MCP legacy migration failed.",
          error
        });
      }

      // Publish browser MCP endpoint + register both MCP services for TUI/CLI clients.
      try {
        browserSettingsCache = settings.desktop?.browser || null;
        const mcp = await syncExternalMcpRegistration(settings);
        if (mcp.registered.length) {
          console.log(
            `[agent-resume] External MCP registered for: ${mcp.registered.join(", ")}`
          );
        }
        for (const failure of mcp.failed) {
          void recordAppError({
            source: "external-mcp",
            message: `External MCP sync failed (${failure.target}): ${failure.error}`
          });
        }
      } catch (error) {
        void recordAppError({
          source: "external-mcp",
          message: "External MCP startup sync failed.",
          error
        });
      }
    } catch (error) {
      void recordAppError({
        source: "startup-background",
        message: "Background startup initialization failed.",
        error
      });
    }
  })();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      syncSessionDotsTray();
      startDesktopNotesIndexer();
      startSessionSummaryAuto();
      startSessionTranscriptIndexAuto();
      startSessionEmbeddingIndexAuto();
      // Closing the last window on macOS used to stop the scheduler; restore it with the window.
      void refreshMemorySchedulerFromSettings();
      return;
    }
    revealMainWindow();
    void refreshMemorySchedulerFromSettings();
  });
});

app.on("before-quit", (event) => {
  if (!allowAppQuit && (standaloneNoteWindows.size > 0 || openTaskWindowCount() > 0)) {
    event.preventDefault();
    void beginAppQuit().catch((error) => {
      void recordAppError({ source: "standalone-note", message: "Application quit coordination failed.", error });
    });
    return;
  }
  if (!allowAppQuit) {
    const awaitingKeys = workbenchActiveSessions
      .filter((dot) => dot.status === "awaiting_user" && dot.sessionKey)
      .map((dot) => dot.sessionKey);
    if (awaitingKeys.length > 0) {
      void loadPanelDbPaths()
        .then((paths) => recordLastExitWaitingSessions(paths.catalogDb, awaitingKeys))
        .catch(() => undefined);
    }
  }
  allowAppQuit = true;
  performQuitCleanup();
});

app.on("window-all-closed", () => {
  const backgroundWindowsOpen = standaloneNoteWindows.size > 0 || openTaskWindowCount() > 0;
  // macOS: app stays in Dock without windows — keep scheduler/notes indexer running so
  // scheduled digests still fire. Hide-on-close also keeps the hidden main window alive.
  if (process.platform !== "darwin" && !backgroundWindowsOpen) {
    stopMemoryScheduler();
    stopNotesIndexer();
    stopSessionSummaryAuto();
    stopSessionTranscriptIndexAuto();
    stopSessionEmbeddingIndexAuto();
    tryDestroyPtyOnQuit();
    app.quit();
  }
});
}
