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
  clearReportJobsByStatus,
  autoRenameSessionAction,
  suggestSessionRenameAction,
  backfillReportDigests,
  buildNewSessionCommand,
  buildResumeCommand,
  supportsNewSessionYoloMode,
  type NewSessionExecutionMode,
  updateNativeSessionCwd,
  effectivePanelHome,
  desktopDbPath,
  estimateDigestRun,
  expandHome,
  getReportEntryById,
  getPeriodInsights,
  getSessionById,
  getUsageSummary,
  appendComposerSend,
  listComposerSends,
  listSessionsMissingComposerImport,
  importComposerSendsForSession,
  hideSessionAction,
  hideProjectAction,
  listLlmUsageEvents,
  listProjects,
  listReportEntries,
  listReportEntriesInRange,
  listReportLinks,
  listScheduleRuns,
  countSessions,
  querySessionsPage,
  listSessionsInRange,
  unhideAllSessionsInCatalog,
  unhideSessionInCatalog,
  unhideAllProjectsInCatalog,
  loadProjectAliasesMap,
  loadSessionPreview,
  loadSettings,
  setProjectAliasInCatalog,
  setProjectLocalPath,
  setProjectPinnedInCatalog,
  ensureProjectForPath,
  unhideProjectInCatalog,
  setProjectKeptVisibleInCatalog,
  resolveProjectCwd,
  resolveProjectCwdForPath,
  listProjectPathVariants,
  mergeProjectsInCatalog,
  moveSessionToProjectInCatalog,
  splitProjectPathInCatalog,
  listWorkbenchSessionFolders,
  listWorkbenchSessionFolderAssignments,
  listAllWorkbenchSessionFolders,
  listAllWorkbenchSessionFolderAssignments,
  createWorkbenchSessionFolder,
  renameWorkbenchSessionFolder,
  deleteWorkbenchSessionFolder,
  assignWorkbenchSessionToFolder,
  removeWorkbenchSessionFromFolder,
  mergeWorkbenchSessionFolders,

  openChatGptAppSession,
  openProjectInEditor,
  openCommandInSystemTerminal,
  openSessionInSystemTerminal,
  previewBackfillReportDigests,
  renameSessionAction,
  resolveProjectEditor,
  resolvePanelHome,
  resolvePreviewHomes,
  resolveScratchBaseDir,
  runDailyDigest,
  needsDailyDigestRefresh,
  needsWeeklyDigestRefresh,
  needsMonthlyDigestRefresh,
  applyReportGtdSync,
  clearSessionGtdStatus,
  isGtdStatus,
  loadSessionGtdMap,
  previewReportGtdSync,
  runMonthlyDigest,
  runWeeklyDigest,
  saveSettings,
  searchReportsByEmbedding,
  sessionSyncOptionsFromSettings,
  syncAgentSessions,
  setSessionGtdStatus,
  summarizeSessionAction,
  type AgentProvider,
  type AgentNoteAuditStatus,
  type DigestProgressEvent,
  type GtdStatus,
  type NoteRecord,
  type PanelSettings,
  type WorkbenchProjectEditor,
  type AgentSessionSyncResult
} from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";
import { registerLinkGraphIpc } from "./linkgraph/linkGraphIpc";
import {
  createExternalMcpLaunchConfig,
  listMcpClients,
  manualMcpConfig,
  migrateLegacyAgentResumeRegistrations,
  registerMcpClient,
  removeMcpClient,
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
  inspectAcpChat,
  denyAcpPermission,
  promptAcpChat,
  registerAcpIpc,
  setAcpModel,
  setAcpThoughtLevel,
  setAcpRecordProjectPath
} from "./acp/acpHost";
import { flushImStreamingMessages, registerImIpc } from "./im/ipc";
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
  disposeBrowserController,
  disposeBrowserMcpServer,
  ensureBrowserMcpReadyForExternal,
  listBrowserToolDescriptors,
  registerBrowserIpc,
  syncBrowserExternalMcpRegistration
} from "./browser";
import {
  DEFAULT_RECENT_STANDALONE_NOTE_SHORTCUT,
  DEFAULT_STANDALONE_NOTE_SHORTCUT,
  isQuickAccessShortcut,
  normalizeGlobalShortcut,
  workbenchArrowDirectionFromInput
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
  hitTestTrayDotFromScreen,
  sessionDotsTrayImage,
  trayTooltip
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
  notesCreateWorkItem,
  notesAddWorkItemProject,
  notesRemoveWorkItemProject,
  notesEnsureWorkItemWorkspace,
  notesLinkSessionToWorkItem,
  notesListWorkItemSessionLinks,
  notesListWorkItems,
  promoteAwaitingSessionsToInbox,
  notesListChildCounts,
  notesListLinkedChildIds,
  notesListLinks,
  notesListRootNotes,
  notesMove,
  notesOpenFolder,
  notesPasteImage,
  notesRead,
  notesRename,
  notesResolveLinkRoot,
  notesReveal,
  notesSetGtdStatus,
  notesSetParent,
  notesWrite,
  settingsOpenPanelHome
} from "./notesService";
import { refreshMemorySchedulerFromSettings, stopMemoryScheduler } from "./scheduler";
import {
  ensureAgentStatusDaemon,
  resolveDaemonEntryPath,
  stopAgentStatusDaemon
} from "./agentStatus/lifecycle";
import { createAgentStatusBridge, type AgentStatusBridge } from "./agentStatus/bridge";
import type { StatusTransition } from "./agentStatus/types";
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

function tryRegisterPtyIpc(): void {
  try {
    // Lazy-load so node-pty native binding issues do not block other IPC handlers.
    const { registerPtyIpc, getPtyPid } = require("./ptyHost") as typeof import("./ptyHost");
    registerPtyIpc(() => mainWindow);
    ptyPidResolver = getPtyPid;
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
    getWindow: () => mainWindow,
    bridge,
    getPanelHome: () => agentStatusPanelHome,
    execPath: process.execPath,
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath()
  });
  bridge.onTransition((transition) => {
    void promoteBlockedTransition(transition);
  });
  bridge.connect();
}

/**
 * Sessions already promoted to the board this process, so a flapping pane does
 * not create a work item per transition. The catalog is also checked, so a
 * restart never duplicates an item for the same session.
 */
const promotedBlockedSessions = new Set<string>();

function blockedDecisionText(transition: StatusTransition): string {
  const source = transition.source === "native" ? "reported by the agent" : `detected (${transition.source})`;
  const rule = transition.reason ? `: ${transition.reason}` : "";
  return `Agent is blocked and waiting on you — ${transition.agent} ${source}${rule}.`;
}

/** F-1/F-2: a pane turning blocked becomes a GTD inbox work item, with the reason captured at transition time. */
async function promoteBlockedTransition(transition: StatusTransition): Promise<void> {
  if (transition.to !== "blocked") return;
  const sessionKey = transition.sessionKey?.trim();
  if (!sessionKey || promotedBlockedSessions.has(sessionKey)) return;
  const separator = sessionKey.indexOf(":");
  if (separator <= 0 || separator === sessionKey.length - 1) return;
  const provider = sessionKey.slice(0, separator);
  const sessionId = sessionKey.slice(separator + 1);
  promotedBlockedSessions.add(sessionKey);
  try {
    const paths = await loadPanelDbPaths();
    const page = await querySessionsPage(paths.catalogDb, { keys: [{ provider, id: sessionId }], limit: 1 });
    const session = page.sessions[0];
    const projectPath = session?.projectPath?.trim();
    if (!projectPath) return;
    const known = await notesListWorkItems();
    if (known.some((item) => (item.work.sessions ?? []).includes(sessionKey))) return;
    await notesCreateWorkItem({
      title: session.title || sessionId,
      decision: blockedDecisionText(transition),
      sessions: [sessionKey],
      projects: [projectPath],
      primaryProject: projectPath
    });
  } catch {
    // Best-effort: a failed promotion must never disturb status tracking.
  }
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
    externalLaunchMode:
      settings.workbench?.externalLaunchMode || settings.ghosttyLaunchMode || "executeCommand",
    externalAutoPasteDelayMs:
      settings.workbench?.externalAutoPasteDelayMs ?? settings.ghosttyAutoPasteDelayMs
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
let settingsWindow: BrowserWindow | null = null;
let sessionDotsTray: Tray | null = null;
let pendingTrayFocus: { paneKey: string; projectPath?: string } | null = null;
let browserSettingsCache: import("@agent-resume/core").DesktopBrowserSettings | null = null;
let notifiedWaitingSessions = new Set<string>();

function flushPendingTrayFocus(): void {
  if (!pendingTrayFocus || !mainWindow || mainWindow.isDestroyed() || !mainWindowRendererReady) return;
  const payload = pendingTrayFocus;
  pendingTrayFocus = null;
  mainWindow.webContents.send("workbench:focusSession", payload);
}

function showMainWindowIfReady(): void {
  if (!mainWindowReadyToShow || !mainWindowRendererReady) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) mainWindow.show();
  flushPendingTrayFocus();
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
let awaitingPromotionDone = false;
/** Cap the quit-time work-item promotion so a slow disk can never block quitting. */
const AWAITING_PROMOTION_TIMEOUT_MS = 5_000;
let sessionSyncTimer: NodeJS.Timeout | null = null;
let sessionSyncInFlight: Promise<AgentSessionSyncResult> | null = null;
let workbenchActive = false;
let floatingNoteFocused = false;
let modalOpen = false;
let workbenchActiveSessions: ReturnType<typeof parseWorkbenchActiveSessionDots> = [];
const SESSION_SYNC_INTERVAL_MS = 60_000;

const SETTINGS_PANES = [
  "general",
  "providers",
  "sessions",
  "workbench",
  "notes",
  "report",
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

function broadcastToRenderers(channel: string, ...args: unknown[]): void {
  const windows = [
    mainWindow,
    settingsWindow,
    ...[...standaloneNoteWindows.values()].map((state) => state.window)
  ];
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  }
}

function closeSettingsWindowIfOpen(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
  settingsWindow = null;
}

function syncSessionDotsTray(): void {
  if (process.platform !== "darwin") return;
  const notes = listOpenStandaloneNotes();
  const sessions = workbenchActiveSessions;
  const items = composeTrayItems(notes, sessions);
  const extra = notes.length + sessions.length - items.length;
  const image = sessionDotsTrayImage(items);
  const tooltip = trayTooltip(items, extra);
  if (!sessionDotsTray) {
    sessionDotsTray = new Tray(image);
    sessionDotsTray.setIgnoreDoubleClickEvents(true);
    sessionDotsTray.on("click", (_event, bounds, position) => {
      const current = composeTrayItems(listOpenStandaloneNotes(), workbenchActiveSessions);
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
      pendingTrayFocus = {
        paneKey: target.paneKey,
        projectPath: target.projectPath || undefined
      };
      const window = revealMainWindow();
      if (!window || window.isDestroyed()) return;
      if (mainWindowRendererReady) flushPendingTrayFocus();
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
        pendingTrayFocus = {
          paneKey: session.paneKey,
          projectPath: projectPath || undefined
        };
        const window = revealMainWindow();
        if (!window || window.isDestroyed()) return;
        if (mainWindowRendererReady) flushPendingTrayFocus();
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
  disposeWorkbenchWatchers();
  disposeBrowserController();
  void disposeBrowserMcpServer();
  stopMemoryScheduler();
  stopNotesIndexer();
  stopSessionSummaryAuto();
  stopSessionTranscriptIndexAuto();
  stopSessionEmbeddingIndexAuto();
  void flushImStreamingMessages();
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sessions:synced", result);
  }
  if (shouldScheduleBackgroundAnalysis()) {
    scheduleSessionSummaryAuto(2_000);
    scheduleSessionTranscriptIndexAuto(3_000);
    scheduleSessionEmbeddingIndexAuto(4_000);
  }
  return result;
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

  const command = buildResumeCommand(session);

  if (mode === "external-system") {
    await openSessionInSystemTerminal(
      { ...session, projectPath: cwd },
      systemTerminalSettings(settings),
      {
        writeText: (text) => Promise.resolve(clipboard.writeText(text))
      }
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
  mainWindow?.webContents.send("sessions:syncFailed", error instanceof Error ? error.message : String(error));
}

function startDesktopNotesIndexer(): void {
  startNotesIndexer((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("notes:indexProgress", progress);
    }
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

    if (workbenchActive && !modalOpen && !floatingNoteFocused) {
      const direction = workbenchArrowDirectionFromInput(input);
      if (direction) {
        event.preventDefault();
        if (!win.isDestroyed()) {
          win.webContents.send("workbench:cmdArrow", direction);
        }
        return;
      }
    }

    if (workbenchActive && isWorkbenchCmdWInput(input)) {
      event.preventDefault();
      if (!win.isDestroyed()) {
        win.webContents.send("workbench:cmdW");
      }
    }
  });
}

/** Settings window: ⌘W / Ctrl+W closes the preferences window only. */
function registerSettingsShortcuts(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    if (isWorkbenchCmdWInput(input)) {
      event.preventDefault();
      if (!win.isDestroyed()) {
        win.close();
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
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#f5f5f7",
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
  registerWorkbenchShortcuts(mainWindow);
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.webContents.once("did-finish-load", () => resumeSessionSync());
  mainWindow.on("show", () => {
    applyAppIcon();
    resumeSessionSync();
  });
  mainWindow.on("restore", resumeSessionSync);
  mainWindow.on("hide", () => {
    void flushImStreamingMessages();
  });
  mainWindow.on("minimize", stopSessionSyncTimer);
  mainWindow.on("close", (event) => {
    if (allowAppQuit) return;
    const keepHidden = process.platform === "darwin" || standaloneNoteWindows.size > 0;
    if (!keepHidden) return;
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });
  mainWindow.on("closed", () => {
    stopSessionSyncTimer();
    void flushImStreamingMessages();
    workbenchActive = false;
    floatingNoteFocused = false;
    modalOpen = false;
    // Invariant: settings never outlives main
    closeSettingsWindowIfOpen();
    mainWindowReadyToShow = false;
    mainWindowRendererReady = false;
    mainWindow = null;
  });
}

function createSettingsWindow(options: { pane: SettingsPaneId }): void {
  const icon = loadAppIcon();
  const win = new BrowserWindow({
    ...DEFAULT_WINDOW_SIZE,
    minWidth: 640,
    minHeight: 480,
    title: "Settings",
    show: false,
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

  if (process.platform !== "darwin") {
    win.setMenuBarVisibility(false);
  }

  settingsWindow = win;
  registerSettingsShortcuts(win);
  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), {
    query: { mode: "settings", pane: options.pane }
  });
  win.once("ready-to-show", () => {
    if (!win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
  win.on("closed", () => {
    if (settingsWindow === win) {
      settingsWindow = null;
    }
  });
}

function openSettingsWindow(options?: { pane?: unknown }): void {
  const pane = normalizeSettingsPane(options?.pane);
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.show();
    settingsWindow.focus();
    // K14: do not restore/focus mainWindow
    settingsWindow.webContents.send("settings:navigate", { pane });
    return;
  }
  createSettingsWindow({ pane });
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
    click: () => openSettingsWindow({ pane: "general" })
  };

  const sessionsItem: Electron.MenuItemConstructorOptions = {
    label: sessionsLabel,
    click: () => {
      revealMainWindow();
      mainWindow?.webContents.send("sessions:open");
    }
  };

  const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
    label: checkForUpdatesLabel,
    click: () => openSettingsWindow({ pane: "about" })
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

function registerIpc(): void {
  ipcMain.on("main:rendererReady", (event) => {
    if (event.sender !== mainWindow?.webContents) return;
    mainWindowRendererReady = true;
    showMainWindowIfReady();
    flushPendingTrayFocus();
  });

  ipcMain.on("workbench:setActive", (event, active: unknown) => {
    if (event.sender === mainWindow?.webContents) {
      workbenchActive = active === true;
      setWorkbenchWatcherActive(workbenchActive);
    }
  });

  ipcMain.on("workbench:activeSessions", (event, payload: unknown) => {
    if (event.sender !== mainWindow?.webContents) return;
    workbenchActiveSessions = parseWorkbenchActiveSessionDots(payload);
    const newlyWaiting = collectNewConfirmedWaitingSessions(workbenchActiveSessions, notifiedWaitingSessions);
    syncSessionDotsTray();
    broadcastToRenderers("workbench:activeSessions", workbenchActiveSessions);
    if (newlyWaiting.length > 0) void showSessionWaitingNotifications(newlyWaiting);
  });

  safeHandle("workbench:getActiveSessions", async () => workbenchActiveSessions);

  safeHandle("workbench:focusSession", async (_event, payload: unknown) => {
    const request = parseWorkbenchFocusSessionRequest(payload);
    const target = revealMainWindow();
    if (!target || target.isDestroyed()) {
      throw new Error("Workbench window is not available.");
    }
    target.webContents.send("workbench:focusSession", request);
    return { ok: true as const };
  });

  safeHandle("workbench:sendSelection", async (_event, payload: unknown) => {
    const request = parseWorkbenchSendSelectionRequest(payload);
    const target = revealMainWindow();
    if (!target || target.isDestroyed()) {
      throw new Error("Workbench window is not available.");
    }
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
    return { ...getWorkbenchWatcherRuntimeMetrics(), pty, acp: getAcpRuntimeMetrics() };
  });

  ipcMain.on("workbench:setFloatingNoteFocused", (event, focused: unknown) => {
    if (event.sender === mainWindow?.webContents) {
      floatingNoteFocused = focused === true;
    }
  });

  ipcMain.on("workbench:setModalOpen", (event, open: unknown) => {
    if (event.sender === mainWindow?.webContents) {
      modalOpen = open === true;
    }
  });

  ipcMain.handle("panel:getHome", async () => {
    const settings = await loadSettings();
    return resolvePanelHome(settings.panelHome);
  });

  ipcMain.handle("settings:get", async () => {
    return loadSettings();
  });

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

  safeHandle("mcp:manualConfig", async () => manualMcpConfig(await externalMcpLaunch()));

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
        const saved = await loadSettings();
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
      const schedulerEnabled = await refreshMemorySchedulerFromSettings();
      const saved = await loadSettings();
      browserSettingsCache = saved.desktop?.browser || null;
      try {
        await ensureBrowserMcpReadyForExternal(saved);
        const browserMcp = await syncBrowserExternalMcpRegistration(saved);
        if (browserMcp.registered.length) {
          console.log(
            `[agent-resume] Browser MCP registered for: ${browserMcp.registered.join(", ")}`
          );
        }
        for (const failure of browserMcp.failed) {
          void recordAppError({
            source: "browser-mcp",
            message: `Browser MCP sync failed (${failure.target}): ${failure.error}`
          });
        }
      } catch (error) {
        void recordAppError({
          source: "browser-mcp",
          message: "Browser MCP external sync failed after settings save.",
          error
        });
      }
      if ((previous.report?.maxDigestLlmCalls ?? 100) !== (saved.report?.maxDigestLlmCalls ?? 100)) {
        const paths = await loadPanelDbPaths(saved);
        await clearReportJobsByStatus(paths.desktopDb, "deferred_budget");
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
      return { file, settings: saved, schedulerEnabled, sync };
    }
  );

  safeHandle("settings:openWindow", async (_event, options?: { pane?: unknown }) => {
    openSettingsWindow(options);
  });

  safeHandle("settings:closeWindow", async () => {
    closeSettingsWindowIfOpen();
    return { ok: true as const };
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
      gtdStatus: args?.gtdStatus?.trim() || undefined
    };
    return querySessionsPage(paths.catalogDb, request);
  });

  ipcMain.handle("gtd:listSessionStatuses", async () => {
    const paths = await loadPanelDbPaths();
    return loadSessionGtdMap(paths.catalogDb);
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
    "sessions:listInRange",
    async (
      _event,
      args?: { fromMs?: number; toMs?: number; limit?: number }
    ) => {
      const paths = await loadPanelDbPaths();
      const fromMs = Number(args?.fromMs);
      const toMs = Number(args?.toMs);
      // NaN is not null — must use isFinite or SQLite gets "updated_at_ms >= NaN"
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
        return [];
      }
      return listSessionsInRange(paths.catalogDb, fromMs, toMs, args?.limit ?? 2000);
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

  ipcMain.handle(
    "sessions:moveToProject",
    async (_event, args: { provider: AgentProvider; id: string; targetProjectPath: string }) => {
      const provider = args.provider;
      const id = String(args.id || "").trim();
      const targetProjectPath = String(args.targetProjectPath || "").trim();
      if (!provider || !id || !targetProjectPath) {
        throw new Error("provider, id, and targetProjectPath are required.");
      }
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      // Physical move first: rewrite the provider's native cwd so the next sync
      // converges native_project_path (and project_path) onto the target.
      // Best-effort — any failure falls back to the catalog-only move below and
      // the two-layer value rule keeps the user assignment sticky.
      let nativeUpdated = false;
      try {
        const homes = resolvePreviewHomes(settings);
        const native = await updateNativeSessionCwd(provider, id, targetProjectPath, homes);
        nativeUpdated = native.ok;
      } catch {
        nativeUpdated = false;
      }
      const result = await moveSessionToProjectInCatalog(
        paths.catalogDb,
        provider,
        id,
        targetProjectPath
      );
      if (provider === "chat") {
        const updatedLive = await setAcpRecordProjectPath(id, result.newPath);
        if (!updatedLive) {
          const record = await getAcpRecord(effectivePanelHome(settings), id);
          if (record && record.projectPath !== result.newPath) {
            await updateAcpRecord(effectivePanelHome(settings), {
              ...record,
              projectPath: result.newPath,
              updatedAt: Date.now()
            });
          }
        }
      }
      if (result.moved && result.fromProjectId && result.fromProjectId !== result.toProjectId) {
        try {
          await removeWorkbenchSessionFromFolder(paths.desktopDb, provider, id);
        } catch {
          // Desktop workbench tables may be absent — catalog move is already done.
        }
      }
      return { ...result, nativeUpdated };
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
    "workbench:openProjectInEditor",
    async (_event, args: { projectPath: string }) => {
      const settings = await loadSettings();
      const selected: WorkbenchProjectEditor = settings.workbench?.projectEditor || "auto";
      const editor = await openProjectInEditor(args.projectPath, selected, app.getLocale());
      return { ok: true, editor };
    }
  );

  safeHandle(
    "workbench:openSession",
    async (_event, args: { provider: AgentProvider; id: string }) => {
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
      const command = buildNewSessionCommand(args.provider, cwd, executionMode);
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
      return { mode, command, cwd, unsupportedYolo, warning };
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

  ipcMain.handle(
    "report:getPeriodInsights",
    async (_event, args?: { fromMs?: number; toMs?: number }) => {
      try {
        const settings = await loadSettings();
        const paths = await loadPanelDbPaths(settings);
        const fromMs = Number(args?.fromMs);
        const toMs = Number(args?.toMs);
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
          return null;
        }

        // Real-time sync: only parse transcripts for sessions that have no
        // `import:` rows yet (the historical backfill already covers the rest).
        // This keeps calendar-click insights cheap — a single indexed SELECT
        // decides whether any transcript parse is needed at all.
        try {
          const recentSessions = await listSessionsInRange(paths.catalogDb, fromMs, toMs, 10);
          const missing = await listSessionsMissingComposerImport(paths.desktopDb, recentSessions);
          if (missing.length) {
            const homes = resolvePreviewHomes(settings);
            const byKey = new Map(
              recentSessions.map((s) => [`${s.provider}:${s.id}`, s])
            );
            await Promise.all(
              missing.map(({ provider, id }) => {
                const session = byKey.get(`${provider}:${id}`);
                return session
                  ? importComposerSendsForSession(paths.desktopDb, session, homes).catch(() => undefined)
                  : Promise.resolve();
              })
            );
          }
        } catch {
          // best-effort sync
        }

        return await getPeriodInsights({
          catalogDb: paths.catalogDb,
          desktopDb: paths.desktopDb,
          fromMs,
          toMs
        });
      } catch (error) {
        void recordAppError({
          source: "report",
          message: "report:getPeriodInsights failed.",
          error
        });
        return null;
      }
    }
  );

  ipcMain.handle(
    "report:list",
    async (
      _event,
      opts?: { level?: string; limit?: number; fromMs?: number; toMs?: number }
    ) => {
      const paths = await loadPanelDbPaths();
      const level = opts?.level && opts.level !== "all" ? opts.level : undefined;
      if (opts?.fromMs != null && opts?.toMs != null) {
        return listReportEntriesInRange(paths.desktopDb, {
          level,
          startMs: opts.fromMs,
          endMs: opts.toMs,
          limit: opts?.limit ?? 200
        });
      }
      return listReportEntries(paths.desktopDb, {
        level,
        limit: opts?.limit ?? 50
      });
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

  ipcMain.handle("report:getLinks", async (_event, reportId?: string) => {
    const id = typeof reportId === "string" ? reportId.trim() : "";
    if (!id) {
      return [];
    }
    try {
      const paths = await loadPanelDbPaths();
      return await listReportLinks(paths.desktopDb, id);
    } catch (error) {
      void recordAppError({ source: "report", message: "report:getLinks failed.", error });
      return [];
    }
  });

  ipcMain.handle("report:listDaily", async (_event, limit?: number) => {
    const paths = await loadPanelDbPaths();
    return listReportEntries(paths.desktopDb, { level: "daily", limit: limit ?? 30 });
  });

  ipcMain.handle(
    "report:runDaily",
    async (
      event,
      args?: string | { date?: string; forceResummarize?: boolean; allowOverBudget?: boolean }
    ) => {
      const opts =
        typeof args === "string" || args === undefined
          ? { date: args }
          : args || {};
      const sendProgress = (progress: DigestProgressEvent) => {
        event.sender.send("report:digestProgress", progress);
      };
      return runDailyDigest({
        date: opts.date,
        forceResummarize: opts.forceResummarize,
        allowOverBudget: opts.allowOverBudget === true,
        trigger: "manual",
        onProgress: sendProgress,
        systemLocale: app.getLocale()
      });
    }
  );

  ipcMain.handle("report:previewRun", async (_event, args: unknown) => {
    if (!args || typeof args !== "object") {
      throw new Error("Invalid digest preview request.");
    }
    const input = args as { level?: unknown; periodKey?: unknown };
    if (input.level !== "daily" && input.level !== "weekly" && input.level !== "monthly") {
      throw new Error("Invalid digest level.");
    }
    return estimateDigestRun({
      level: input.level,
      periodKey: typeof input.periodKey === "string" ? input.periodKey : undefined
    });
  });

  ipcMain.handle("report:needsDailyRefresh", async (_event, date?: string) => {
    return needsDailyDigestRefresh({ date, systemLocale: app.getLocale() });
  });

  ipcMain.handle("report:needsWeeklyRefresh", async (_event, weekKey?: string) => {
    return needsWeeklyDigestRefresh({ weekKey, systemLocale: app.getLocale() });
  });

  ipcMain.handle("report:needsMonthlyRefresh", async (_event, monthKey?: string) => {
    return needsMonthlyDigestRefresh({ monthKey, systemLocale: app.getLocale() });
  });

  ipcMain.handle("report:runWeekly", async (event, args?: string | { weekKey?: string; allowOverBudget?: boolean }) => {
    const opts = typeof args === "string" || args === undefined ? { weekKey: args } : args;
    const sendProgress = (progress: DigestProgressEvent) => {
      event.sender.send("report:digestProgress", progress);
    };
    return runWeeklyDigest({
      weekKey: opts.weekKey,
      allowOverBudget: opts.allowOverBudget === true,
      trigger: "manual",
      onProgress: sendProgress,
      systemLocale: app.getLocale()
    });
  });

  ipcMain.handle("report:runMonthly", async (event, args?: string | { monthKey?: string; allowOverBudget?: boolean }) => {
    const opts = typeof args === "string" || args === undefined ? { monthKey: args } : args;
    const sendProgress = (progress: DigestProgressEvent) => {
      event.sender.send("report:digestProgress", progress);
    };
    return runMonthlyDigest({
      monthKey: opts.monthKey,
      allowOverBudget: opts.allowOverBudget === true,
      trigger: "manual",
      onProgress: sendProgress,
      systemLocale: app.getLocale()
    });
  });

  ipcMain.handle(
    "report:search",
    async (_event, args: { query: string; level?: string; limit?: number }) => {
      return searchReportsByEmbedding({
        query: args.query,
        level: args.level && args.level !== "all" ? args.level : undefined,
        limit: args.limit ?? 20
      });
    }
  );

  ipcMain.handle("agent:listTools", async (_event, args?: { projectPath?: string }) => {
    const coreTools = [...AGENT_TOOL_CATALOG];
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

  ipcMain.handle(
    "workflow:previewReportGtdSync",
    async (_event, args?: { ensureDigests?: boolean; reportIds?: string[] }) => {
      return previewReportGtdSync({
        ensureDigests: args?.ensureDigests,
        reportIds: args?.reportIds,
        systemLocale: app.getLocale()
      });
    }
  );

  ipcMain.handle(
    "workflow:applyReportGtdSync",
    async (
      _event,
      args: {
        items: Array<{
          provider: string;
          sessionId: string;
          gtd: string;
          reason: string;
          tasks: string[];
          sourceReportIds: string[];
          title?: string;
          projectPath?: string;
          previousGtd?: string | null;
          todolistMarkdown?: string;
        }>;
      }
    ) => {
      return applyReportGtdSync({
        items: (args?.items || []).map((it) => ({
          ...it,
          previousGtd: (it.previousGtd as "inbox" | "next" | "waiting" | "someday" | "reference" | null) ?? null,
          todolistMarkdown: it.todolistMarkdown
        }))
      });
    }
  );

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

  ipcMain.handle(
    "workflow:previewBackfillDigests",
    async (
      _event,
      args?: { maxDays?: number; skipExisting?: boolean; minSessionsPerDay?: number }
    ) => {
      return previewBackfillReportDigests({
        maxDays: args?.maxDays,
        skipExisting: args?.skipExisting,
        minSessionsPerDay: args?.minSessionsPerDay
      });
    }
  );

  ipcMain.handle(
    "workflow:backfillDigests",
    async (
      _event,
      args?: {
        maxDays?: number;
        skipExisting?: boolean;
        skipEmbedding?: boolean;
        minSessionsPerDay?: number;
      }
    ) => {
      return backfillReportDigests({
        maxDays: args?.maxDays,
        skipExisting: args?.skipExisting,
        skipEmbedding: args?.skipEmbedding,
        minSessionsPerDay: args?.minSessionsPerDay,
        allowOverBudget: true
      });
    }
  );

  ipcMain.handle("notes:list", async () => notesList());
  ipcMain.handle("notes:listWorkItems", async () => notesListWorkItems());
  ipcMain.handle("notes:removeWorkItemProject", async (_event, args: { noteId?: unknown; projectPath?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A work item note id is required.");
    }
    if (typeof args?.projectPath !== "string" || !args.projectPath.trim()) {
      throw new Error("A project path is required.");
    }
    return notesRemoveWorkItemProject({ noteId: args.noteId, projectPath: args.projectPath });
  });
  ipcMain.handle("notes:ensureWorkItemWorkspace", async (_event, args: { noteId?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A work item note id is required.");
    }
    return notesEnsureWorkItemWorkspace(args.noteId);
  });
  ipcMain.handle("notes:listWorkItemSessionLinks", async () => notesListWorkItemSessionLinks());
  ipcMain.handle("notes:addWorkItemProject", async (_event, args: { noteId?: unknown; projectPath?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A work item note id is required.");
    }
    if (typeof args?.projectPath !== "string" || !args.projectPath.trim()) {
      throw new Error("A project path is required.");
    }
    return notesAddWorkItemProject({ noteId: args.noteId, projectPath: args.projectPath });
  });
  ipcMain.handle("notes:linkSessionToWorkItem", async (_event, args: { noteId?: unknown; sessionKey?: unknown; projectPath?: unknown }) => {
    if (typeof args?.noteId !== "string" || !args.noteId.trim()) {
      throw new Error("A work item note id is required.");
    }
    if (typeof args?.sessionKey !== "string" || !args.sessionKey.trim()) {
      throw new Error("A session key is required.");
    }
    return notesLinkSessionToWorkItem({
      noteId: args.noteId,
      sessionKey: args.sessionKey,
      projectPath: typeof args.projectPath === "string" ? args.projectPath : undefined
    });
  });
  ipcMain.handle("notes:createWorkItem", async (_event, args: { title?: unknown; next?: unknown; decision?: unknown; sessions?: unknown; projects?: unknown; primaryProject?: unknown }) => {
    const stringList = (value: unknown): string[] | undefined =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        : undefined;
    return notesCreateWorkItem({
      title: typeof args?.title === "string" ? args.title : undefined,
      next: typeof args?.next === "string" ? args.next : undefined,
      decision: typeof args?.decision === "string" ? args.decision : undefined,
      sessions: stringList(args?.sessions),
      projects: stringList(args?.projects),
      primaryProject: typeof args?.primaryProject === "string" ? args.primaryProject : undefined
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
            broadcastToRenderers("workbench:resumeFromAgent", payload);
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
        scope: "library" | "project" | "session";
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
  ipcMain.handle(
    "notes:move",
    async (_event, args: { noteId: string; owner: import("@agent-resume/core").NoteOwner }) => {
      const result = await notesMove(args.noteId, args.owner);
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

  ipcMain.handle(
    "projects:setAlias",
    async (_event, args: { projectPath: string; alias: string }) => {
      const paths = await loadPanelDbPaths();
      await setProjectAliasInCatalog(paths.catalogDb, args.projectPath, args.alias);
      return { ok: true };
    }
  );

  ipcMain.handle("projects:list", async (_event, opts?: { includeHidden?: boolean }) => {
    const paths = await loadPanelDbPaths();
    return listProjects(paths.catalogDb, opts);
  });

  ipcMain.handle(
    "projects:addProject",
    async (_event, args: { title?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: args.title || "Select project folder"
      });
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false as const, canceled: true as const };
      }
      const absolutePath = result.filePaths[0];
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
    "projects:hide",
    async (_event, args: { projectId?: string; projectPath?: string }) => {
      return hideProjectAction(args);
    }
  );

  ipcMain.handle(
    "projects:setLocalPath",
    async (_event, args: { projectId: string; absolutePath: string }) => {
      const paths = await loadPanelDbPaths();
      await setProjectLocalPath(paths.catalogDb, args.projectId, args.absolutePath);
      return { ok: true };
    }
  );

  ipcMain.handle(
    "projects:pickLocalPath",
    async (_event, args: { projectId: string; title?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
        title: args.title || "Select local project folder"
      });
      if (result.canceled || !result.filePaths[0]) {
        return { ok: false as const, canceled: true as const };
      }
      const absolutePath = result.filePaths[0];
      const paths = await loadPanelDbPaths();
      await setProjectLocalPath(paths.catalogDb, args.projectId, absolutePath);
      const resolved = await resolveProjectCwd(paths.catalogDb, args.projectId);
      return { ok: true as const, absolutePath, resolved };
    }
  );

  ipcMain.handle(
    "projects:setPinned",
    async (_event, args: { projectId: string; pinned: boolean }) => {
      const paths = await loadPanelDbPaths();
      await setProjectPinnedInCatalog(paths.catalogDb, args.projectId, args.pinned === true);
      return { ok: true };
    }
  );

  async function resolveProjectPathForDesktop(args: {
    projectId?: string;
    projectPath?: string;
  }): Promise<{ cwd: string; source: string }> {
    const paths = await loadPanelDbPaths();
    let resolved;
    if (args.projectId?.trim()) {
      resolved = await resolveProjectCwd(paths.catalogDb, args.projectId.trim());
    } else if (args.projectPath?.trim()) {
      resolved = await resolveProjectCwdForPath(paths.catalogDb, args.projectPath.trim());
    } else {
      throw new Error("projectId or projectPath is required.");
    }
    if (resolved.source === "missing" || !resolved.cwd?.trim()) {
      throw new Error(
        "Local project folder was not found on this machine. Use “Set local folder…” first."
      );
    }
    try {
      const stat = await fs.stat(resolved.cwd);
      if (!stat.isDirectory()) {
        throw new Error("Local project path is not a directory.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("not a directory")) throw error;
      throw new Error(
        "Local project folder was not found on this machine. Use “Set local folder…” first."
      );
    }
    const real = await fs.realpath(resolved.cwd).catch(() => path.resolve(resolved.cwd));
    return { cwd: real, source: resolved.source };
  }

  ipcMain.handle(
    "projects:revealInFinder",
    async (_event, args: { projectId?: string; projectPath?: string }) => {
      const { cwd } = await resolveProjectPathForDesktop(args);
      // showItemInFolder selects the item in its parent; works for files and directories.
      shell.showItemInFolder(cwd);
      return { ok: true, path: cwd };
    }
  );

  ipcMain.handle(
    "projects:copyLocalPath",
    async (_event, args: { projectId?: string; projectPath?: string }) => {
      const { cwd } = await resolveProjectPathForDesktop(args);
      clipboard.writeText(cwd);
      return { ok: true, path: cwd };
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

  ipcMain.handle(
    "projects:listPathVariants",
    async (_event, args: { projectId: string }) => {
      const paths = await loadPanelDbPaths();
      return listProjectPathVariants(paths.catalogDb, args.projectId);
    }
  );

  ipcMain.handle(
    "projects:merge",
    async (_event, args: { sourceProjectId: string; targetProjectId: string }) => {
      const paths = await loadPanelDbPaths();
      const result = await mergeProjectsInCatalog(paths.catalogDb, args.sourceProjectId, args.targetProjectId);
      await mergeWorkbenchSessionFolders(paths.desktopDb, args.sourceProjectId, args.targetProjectId);
      return result;
    }
  );

  ipcMain.handle(
    "projects:splitPath",
    async (_event, args: { sourceProjectId: string; absolutePath: string }) => {
      const paths = await loadPanelDbPaths();
      return splitProjectPathInCatalog(paths.catalogDb, args.sourceProjectId, args.absolutePath);
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
  registerImIpc({
    getMainWindow: () => mainWindow,
    acp: {
      connect: (chatId) => connectAcpChat(chatId),
      prompt: (chatId, text, images) => promptAcpChat(chatId, text, images ?? []),
      cancel: (chatId) => cancelAcpChat(chatId),
      inspect: (chatId) => inspectAcpChat(chatId),
      denyPermission: (requestId) => denyAcpPermission(requestId),
      setModel: (chatId, modelId) => setAcpModel(chatId, modelId),
      setThoughtLevel: (chatId, thoughtLevel) => setAcpThoughtLevel(chatId, thoughtLevel)
    }
  });
  registerWorkbenchFsIpc();
  registerWorkbenchWatcherIpc(() => mainWindow);
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
  registerLinkGraphIpc(() => mainWindow, () => app.getLocale());
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
  syncSessionDotsTray();
  nativeTheme.on("updated", () => syncSessionDotsTray());

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

      // Publish browser MCP endpoint + register TUI/CLI stdio proxy when enabled.
      try {
        browserSettingsCache = settings.desktop?.browser || null;
        await ensureBrowserMcpReadyForExternal(settings);
        const browserMcp = await syncBrowserExternalMcpRegistration(settings);
        if (browserMcp.registered.length) {
          console.log(
            `[agent-resume] Browser MCP registered for: ${browserMcp.registered.join(", ")}`
          );
        }
        for (const failure of browserMcp.failed) {
          void recordAppError({
            source: "browser-mcp",
            message: `Browser MCP sync failed (${failure.target}): ${failure.error}`
          });
        }
      } catch (error) {
        void recordAppError({
          source: "browser-mcp",
          message: "Browser MCP external startup failed.",
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
      // Invariant fallback: settings must not outlive main
      closeSettingsWindowIfOpen();
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
  if (!allowAppQuit && standaloneNoteWindows.size > 0) {
    event.preventDefault();
    void beginAppQuit().catch((error) => {
      void recordAppError({ source: "standalone-note", message: "Application quit coordination failed.", error });
    });
    return;
  }
  // Promote sessions that are waiting on the user into GTD inbox work items, so
  // "the agent needs me" survives the process without caching runtime state.
  if (!allowAppQuit && !awaitingPromotionDone) {
    const awaiting = workbenchActiveSessions
      .filter((dot) => dot.status === "awaiting_user" && dot.sessionKey && dot.projectPath)
      .map((dot) => ({ sessionKey: dot.sessionKey, title: dot.title, projectPath: dot.projectPath }));
    if (awaiting.length > 0) {
      event.preventDefault();
      void Promise.race([
        promoteAwaitingSessionsToInbox(awaiting),
        new Promise<void>((resolve) => setTimeout(resolve, AWAITING_PROMOTION_TIMEOUT_MS))
      ]).catch(() => undefined).finally(() => {
        awaitingPromotionDone = true;
        allowAppQuit = true;
        app.quit();
      });
      return;
    }
  }
  allowAppQuit = true;
  performQuitCleanup();
});

app.on("window-all-closed", () => {
  const notesOpen = standaloneNoteWindows.size > 0;
  // macOS: app stays in Dock without windows — keep scheduler/notes indexer running so
  // scheduled digests still fire. Hide-on-close also keeps the hidden main window alive.
  if (process.platform !== "darwin" && !notesOpen) {
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
