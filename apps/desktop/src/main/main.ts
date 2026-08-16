import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  AGENT_TOOL_CATALOG,
  runAgentChat,
  clearAgentMessages,
  clearReportJobsByStatus,
  deleteAgentMessagesFromSortOrder,
  listOlderAgentMessages,
  listAgentNoteAudit,
  listRecentAgentMessages,
  listAgentThreads,
  createAgentThread,
  renameAgentThread,
  deleteAgentThread,
  autoRenameSessionAction,
  suggestSessionRenameAction,
  backfillReportDigests,
  buildNewSessionCommand,
  buildResumeCommand,
  resumeProjectPath,
  effectivePanelHome,
  estimateDigestRun,
  expandHome,
  getReportEntryById,
  getSessionById,
  getUsageSummary,
  hideSessionAction,
  hideProjectAction,
  listLlmUsageEvents,
  listProjects,
  listReportEntries,
  listReportEntriesInRange,
  listReportLinks,
  listScheduleRuns,
  countSessions,
  listSessions,
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
  resolveProjectCwd,
  resolveProjectCwdForPath,
  listProjectPathVariants,
  mergeProjectsInCatalog,
  moveSessionToProjectInCatalog,
  splitProjectPathInCatalog,
  listWorkbenchSessionFolders,
  listWorkbenchSessionFolderAssignments,
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
  listTagDefinitions,
  searchTagDefinitions,
  listEntitiesByTag,
  listEntityTags,
  addManualTag,
  removeEntityTag,
  recordEntityTagHits,
  sweepTagDecay,
  tagEntityNow,
  sessionEntityId,
  resolveAutoTaggingSettings,
  toTagStoreSettings,
  ensureDesktopDbSchema,
  type AgentProvider,
  type AgentNoteAuditStatus,
  type DigestProgressEvent,
  type GtdStatus,
  type NoteRecord,
  type PanelSettings,
  type WorkbenchProjectEditor,
  type AgentSessionSyncResult,
  type TagCategory,
  type TagEntityType,
  type TagStatus
} from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";
import { registerFlowIpc } from "./flow/flowIpc";
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
import { testModelConnectionFromDraft, type ModelsTestDraft } from "./settingsTestModel";
import { disposeAcpController, disposeAllAcpControllers, registerAcpIpc, setAcpRecordProjectPath } from "./acp/acpHost";
import { acpRecordToAgentSession, excludeCodexAcpNativeSessions, mergeCatalogAndAcpSessions } from "./acp/sessionList";
import { getAcpRecord, loadAcpRecords, updateAcpRecord } from "./acp/store";
import { registerWorkbenchFsIpc } from "./workbenchFs";
import { disposeWorkbenchWatchers, registerWorkbenchWatcherIpc } from "./workbenchWatcher";
import { registerWorkbenchGitIpc } from "./workbenchGit";
import { registerWorkbenchScriptsIpc } from "./workbenchScripts";
import {
  disposeBrowserController,
  disposeBrowserMcpServer,
  ensureBrowserMcpReadyForExternal,
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
  scheduleAutoTagging,
  startAutoTaggingService,
  stopAutoTaggingService
} from "./taggingService";
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

function tryRegisterPtyIpc(): void {
  try {
    // Lazy-load so node-pty native binding issues do not block other IPC handlers.
    const { registerPtyIpc } = require("./ptyHost") as typeof import("./ptyHost");
    registerPtyIpc(() => mainWindow);
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
let browserSettingsCache: import("@agent-resume/core").DesktopBrowserSettings | null = null;

function showMainWindowIfReady(): void {
  if (!mainWindowReadyToShow || !mainWindowRendererReady) return;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
  mainWindow.show();
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
let activeAskAbort: AbortController | null = null;
const activeAskApprovals = new Map<string, { senderId: number; resolve: (approved: boolean) => void }>();

function rejectActiveAskApprovals(): void {
  for (const pending of activeAskApprovals.values()) pending.resolve(false);
  activeAskApprovals.clear();
}
let sessionSyncTimer: NodeJS.Timeout | null = null;
let sessionSyncInFlight: Promise<AgentSessionSyncResult> | null = null;
let workbenchActive = false;
let floatingNoteFocused = false;
let modalOpen = false;
const SESSION_SYNC_INTERVAL_MS = 60_000;

const SETTINGS_PANES = [
  "general",
  "models",
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
  stopAutoTaggingService();
  disposeAllAcpControllers();
  tryDestroyPtyOnQuit();
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

async function syncAndNotify(): Promise<AgentSessionSyncResult> {
  const result = await syncSessions();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sessions:synced", result);
  }
  scheduleSessionSummaryAuto(2_000);
  scheduleSessionTranscriptIndexAuto(3_000);
  scheduleSessionEmbeddingIndexAuto(4_000);
  scheduleAutoTagging(5_000);
  return result;
}

/** Shared resume entry for Workbench IPC and Agent session_resume tool. */
async function trackSessionTagHit(provider: string, sessionId: string): Promise<void> {
  try {
    const settings = await loadSettings();
    const paths = await loadPanelDbPaths(settings);
    await ensureDesktopDbSchema(paths.desktopDb);
    const auto = resolveAutoTaggingSettings(settings);
    if (!auto.enabled) return;
    await recordEntityTagHits(
      paths.desktopDb,
      "session",
      sessionEntityId(provider, sessionId),
      toTagStoreSettings(auto)
    );
  } catch {
    // hit tracking is best-effort
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
      void trackSessionTagHit("chat", record?.id || catalogSession!.id);
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
  void trackSessionTagHit(session.provider, session.id);
  const mode = resolveWorkbenchTerminalMode(settings);
  const cwd = await resolveSessionCwd(resumeProjectPath(session), settings);

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
  mainWindow.on("hide", stopSessionSyncTimer);
  mainWindow.on("minimize", stopSessionSyncTimer);
  mainWindow.on("closed", () => {
    stopSessionSyncTimer();
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
  });

  ipcMain.on("workbench:setActive", (event, active: unknown) => {
    if (event.sender === mainWindow?.webContents) {
      workbenchActive = active === true;
    }
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
    "settings:testModel",
    async (_event, args?: { kind?: unknown; draft?: ModelsTestDraft | null }) => {
      return testModelConnectionFromDraft(args || {});
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
      stopAutoTaggingService();
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
        startAutoTaggingService();
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
        startAutoTaggingService();
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
      scheduleNotesIndex();
      scheduleSessionSummaryAuto(options?.section === "sessions" ? 0 : 2_000);
      scheduleSessionTranscriptIndexAuto(options?.section === "sessions" ? 500 : 3_000);
      scheduleSessionEmbeddingIndexAuto(options?.section === "sessions" ? 800 : 4_000);
      scheduleAutoTagging(options?.section === "sessions" ? 1_000 : 5_000);
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

  ipcMain.handle("sessions:list", async () => {
    const settings = await loadSettings();
    const paths = await loadPanelDbPaths(settings);
    const records = await loadAcpRecords(effectivePanelHome(settings));
    const catalog = excludeCodexAcpNativeSessions(await listSessions(paths.catalogDb), records);
    const acp = records.map(acpRecordToAgentSession);
    return mergeCatalogAndAcpSessions(catalog, acp);
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
    "tags:list",
    async (
      _event,
      args?: {
        category?: TagCategory;
        status?: TagStatus | "all";
        entityType?: TagEntityType | "all";
        minWeight?: number;
        query?: string;
        sortBy?: "weight" | "count" | "recency" | "alpha";
        limit?: number;
        offset?: number;
      }
    ) => {
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      await ensureDesktopDbSchema(paths.desktopDb);
      const rows = await listTagDefinitions(paths.desktopDb, {
        category: args?.category,
        status: args?.status,
        entityType: args?.entityType,
        minWeight: args?.minWeight,
        query: args?.query,
        sortBy: args?.sortBy,
        limit: args?.limit,
        offset: args?.offset
      });
      return rows.map((r) => ({
        tag: r.display_name,
        normalizedTag: r.normalized_tag,
        category: r.category as TagCategory,
        sessionCount: r.session_count,
        noteCount: r.note_count,
        activeEntityCount: r.active_entity_count,
        totalHits: r.total_hits,
        globalWeight: r.global_weight,
        status: r.status as TagStatus,
        pinned: !!r.pinned,
        updatedAtMs: r.updated_at_ms
      }));
    }
  );

  ipcMain.handle(
    "tags:search",
    async (
      _event,
      args?: { query?: string; category?: TagCategory; status?: TagStatus | "all"; limit?: number }
    ) => {
      const query = String(args?.query || "").trim();
      if (!query) return [];
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      await ensureDesktopDbSchema(paths.desktopDb);
      const rows = await searchTagDefinitions(paths.desktopDb, query, {
        category: args?.category,
        status: args?.status ?? "active",
        limit: args?.limit
      });
      return rows.map((r) => ({
        tag: r.display_name,
        normalizedTag: r.normalized_tag,
        category: r.category as TagCategory,
        activeEntityCount: r.active_entity_count,
        globalWeight: r.global_weight,
        status: r.status as TagStatus
      }));
    }
  );

  ipcMain.handle(
    "tags:listEntities",
    async (
      _event,
      args?: {
        tag?: string;
        entityType?: TagEntityType | "all";
        includeObsolete?: boolean;
        limit?: number;
      }
    ) => {
      const tag = String(args?.tag || "").trim();
      if (!tag) return [];
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      await ensureDesktopDbSchema(paths.desktopDb);
      return listEntitiesByTag(paths.desktopDb, tag, {
        entityType: args?.entityType,
        includeObsolete: args?.includeObsolete === true,
        limit: args?.limit
      });
    }
  );

  ipcMain.handle(
    "tags:getEntityTags",
    async (
      _event,
      args?: {
        entityType?: TagEntityType;
        entityId?: string;
        provider?: string;
        sessionId?: string;
        noteId?: string;
        includeObsolete?: boolean;
      }
    ) => {
      const entityType = args?.entityType;
      if (entityType !== "session" && entityType !== "note") {
        throw new Error("entityType must be session or note");
      }
      let entityId = String(args?.entityId || "").trim();
      if (!entityId) {
        if (entityType === "session") {
          const provider = String(args?.provider || "").trim();
          const sessionId = String(args?.sessionId || "").trim();
          if (!provider || !sessionId) throw new Error("provider and sessionId are required");
          entityId = sessionEntityId(provider, sessionId);
        } else {
          entityId = String(args?.noteId || "").trim();
          if (!entityId) throw new Error("noteId is required");
        }
      }
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      await ensureDesktopDbSchema(paths.desktopDb);
      return listEntityTags(paths.desktopDb, entityType, entityId, {
        includeObsolete: args?.includeObsolete === true
      });
    }
  );

  ipcMain.handle(
    "tags:addEntityTag",
    async (
      _event,
      args?: {
        entityType?: TagEntityType;
        entityId?: string;
        provider?: string;
        sessionId?: string;
        noteId?: string;
        tag?: string;
        category?: TagCategory;
      }
    ) => {
      const entityType = args?.entityType;
      if (entityType !== "session" && entityType !== "note") {
        throw new Error("entityType must be session or note");
      }
      let entityId = String(args?.entityId || "").trim();
      if (!entityId) {
        if (entityType === "session") {
          const provider = String(args?.provider || "").trim();
          const sessionId = String(args?.sessionId || "").trim();
          if (!provider || !sessionId) throw new Error("provider and sessionId are required");
          entityId = sessionEntityId(provider, sessionId);
        } else {
          entityId = String(args?.noteId || "").trim();
          if (!entityId) throw new Error("noteId is required");
        }
      }
      const tag = String(args?.tag || "").trim();
      if (!tag) throw new Error("tag is required");
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      await ensureDesktopDbSchema(paths.desktopDb);
      const auto = resolveAutoTaggingSettings(settings);
      const result = await addManualTag(
        paths.desktopDb,
        entityType,
        entityId,
        tag,
        args?.category,
        toTagStoreSettings(auto)
      );
      return { ok: true as const, tag: result };
    }
  );

  ipcMain.handle(
    "tags:removeEntityTag",
    async (
      _event,
      args?: {
        entityType?: TagEntityType;
        entityId?: string;
        provider?: string;
        sessionId?: string;
        noteId?: string;
        tag?: string;
        hardDelete?: boolean;
      }
    ) => {
      const entityType = args?.entityType;
      if (entityType !== "session" && entityType !== "note") {
        throw new Error("entityType must be session or note");
      }
      let entityId = String(args?.entityId || "").trim();
      if (!entityId) {
        if (entityType === "session") {
          const provider = String(args?.provider || "").trim();
          const sessionId = String(args?.sessionId || "").trim();
          if (!provider || !sessionId) throw new Error("provider and sessionId are required");
          entityId = sessionEntityId(provider, sessionId);
        } else {
          entityId = String(args?.noteId || "").trim();
          if (!entityId) throw new Error("noteId is required");
        }
      }
      const tag = String(args?.tag || "").trim();
      if (!tag) throw new Error("tag is required");
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      await ensureDesktopDbSchema(paths.desktopDb);
      const auto = resolveAutoTaggingSettings(settings);
      const removed = await removeEntityTag(
        paths.desktopDb,
        entityType,
        entityId,
        tag,
        args?.hardDelete === true,
        toTagStoreSettings(auto)
      );
      return { ok: true as const, removed };
    }
  );

  ipcMain.handle(
    "tags:recordHits",
    async (
      _event,
      args?: {
        entityType?: TagEntityType;
        entityId?: string;
        provider?: string;
        sessionId?: string;
        noteId?: string;
      }
    ) => {
      const entityType = args?.entityType;
      if (entityType !== "session" && entityType !== "note") {
        throw new Error("entityType must be session or note");
      }
      let entityId = String(args?.entityId || "").trim();
      if (!entityId) {
        if (entityType === "session") {
          const provider = String(args?.provider || "").trim();
          const sessionId = String(args?.sessionId || "").trim();
          if (!provider || !sessionId) throw new Error("provider and sessionId are required");
          entityId = sessionEntityId(provider, sessionId);
        } else {
          entityId = String(args?.noteId || "").trim();
          if (!entityId) throw new Error("noteId is required");
        }
      }
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      await ensureDesktopDbSchema(paths.desktopDb);
      const auto = resolveAutoTaggingSettings(settings);
      const count = await recordEntityTagHits(
        paths.desktopDb,
        entityType,
        entityId,
        toTagStoreSettings(auto)
      );
      return { ok: true as const, count };
    }
  );

  ipcMain.handle(
    "tags:retagEntity",
    async (
      _event,
      args?: {
        entityType?: TagEntityType;
        entityId?: string;
        provider?: string;
        sessionId?: string;
        noteId?: string;
      }
    ) => {
      const entityType = args?.entityType;
      if (entityType !== "session" && entityType !== "note") {
        throw new Error("entityType must be session or note");
      }
      let entityId = String(args?.entityId || "").trim();
      if (!entityId) {
        if (entityType === "session") {
          const provider = String(args?.provider || "").trim();
          const sessionId = String(args?.sessionId || "").trim();
          if (!provider || !sessionId) throw new Error("provider and sessionId are required");
          entityId = sessionEntityId(provider, sessionId);
        } else {
          entityId = String(args?.noteId || "").trim();
          if (!entityId) throw new Error("noteId is required");
        }
      }
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      const tags = await tagEntityNow({
        catalogDb: paths.catalogDb,
        desktopDb: paths.desktopDb,
        settings,
        panelHome: effectivePanelHome(settings),
        systemLocale: app.getLocale(),
        entityType,
        entityId
      });
      return { ok: true as const, tags };
    }
  );

  ipcMain.handle("tags:sweepDecay", async () => {
    const settings = await loadSettings();
    const paths = await loadPanelDbPaths(settings);
    await ensureDesktopDbSchema(paths.desktopDb);
    const auto = resolveAutoTaggingSettings(settings);
    const result = await sweepTagDecay(paths.desktopDb, toTagStoreSettings(auto));
    return { ok: true as const, ...result };
  });

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
      return result;
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
      if (args.executionMode === "note-yolo") {
        if (!args.noteId?.trim()) throw new Error("Note ID is required for Note execution.");
        if (!args.initialPrompt?.trim()) throw new Error("Initial prompt is required for Note execution.");
        const command = buildNewSessionCommand(args.provider, cwd, "yolo");
        return { mode: "xterm", command, cwd };
      }

      const settings = await loadSettings();
      const mode = resolveWorkbenchTerminalMode(settings);
      const executionMode = settings.workbench?.newSessionYolo === true ? "yolo" : "standard";
      const command = buildNewSessionCommand(args.provider, cwd, executionMode);
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
          copied: launch.copied
        };
      }
      return { mode, command, cwd };
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

  ipcMain.handle(
    "agent:ask",
    async (
      event,
      args: {
        query: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
        threadId?: string;
        enableTools?: boolean;
        /** When set and non-empty, only these MCP tool names are exposed to the model. */
        enabledTools?: string[];
        projectPath?: string;
      }
    ) => {
      activeAskAbort?.abort();
      rejectActiveAskApprovals();
      activeAskAbort = new AbortController();
      const signal = activeAskAbort.signal;
      const settings = await loadSettings();
      try {
        return await runAgentChat({
          query: args.query,
          history: args.history,
          threadId: args.threadId,
          enableTools: args.enableTools ?? true,
          enabledTools: args.enabledTools,
          projectPath: args.projectPath,
          systemLocale: app.getLocale(),
          signal,
          requestToolApproval: async (call) => {
            const alwaysAllow = settings.desktop?.alwaysAllowAgentNonDestructiveOperations === true ||
              settings.desktop?.alwaysAllowAgentWriteOperations === true;
            if (alwaysAllow && call.impact !== "delete" && call.impact !== "destructive" && call.impact !== "unknown") {
              return true;
            }
            return new Promise<boolean>((resolve) => {
                const rejectOnAbort = () => {
                  activeAskApprovals.delete(call.id);
                  resolve(false);
                };
                if (signal.aborted) {
                  rejectOnAbort();
                  return;
                }
                activeAskApprovals.set(call.id, {
                  senderId: event.sender.id,
                  resolve: (approved) => {
                    signal.removeEventListener("abort", rejectOnAbort);
                    activeAskApprovals.delete(call.id);
                    resolve(approved);
                  }
                });
                signal.addEventListener("abort", rejectOnAbort, { once: true });
                event.sender.send("agent:askStream", {
                  phase: "tool_approval_required",
                  toolCallId: call.id,
                  toolName: call.toolName,
                  toolImpact: call.impact,
                  toolArgs: call.args,
                  toolStatus: "awaiting_approval"
                });
              });
          },
          onResumeSession: async ({ provider, sessionId }) => {
            try {
              const result = await resumeCatalogSession(provider, sessionId);
              // xterm mode only returns command/cwd — Workbench must open the terminal.
              if (!result.external && result.command) {
                const payload = {
                  provider,
                  id: sessionId,
                  command: result.command,
                  cwd: result.cwd,
                  title: result.session?.title || sessionId,
                  projectPath: result.session?.projectPath || result.cwd,
                  mode: result.mode
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
          },
          onStream: async (streamEvent) => {
            event.sender.send("agent:askStream", streamEvent);
            if (streamEvent.phase === "chunk") {
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
          }
        });
      } finally {
        rejectActiveAskApprovals();
        if (activeAskAbort?.signal === signal) {
          activeAskAbort = null;
        }
      }
    }
  );

  ipcMain.handle("agent:listTools", () => AGENT_TOOL_CATALOG);

  ipcMain.handle("agent:cancelAsk", async () => {
    activeAskAbort?.abort();
    rejectActiveAskApprovals();
    activeAskAbort = null;
    return { ok: true };
  });

  ipcMain.handle("agent:respondToolApproval", async (event, args: { toolCallId?: string; approved?: boolean }) => {
    const toolCallId = args?.toolCallId?.trim();
    const pending = toolCallId ? activeAskApprovals.get(toolCallId) : undefined;
    if (!pending || pending.senderId !== event.sender.id) return { ok: false };
    pending.resolve(args.approved === true);
    return { ok: true };
  });

  ipcMain.handle("agent:listAgentChat", async (_event, args?: { limit?: number; threadId?: string }) => {
    const paths = await loadPanelDbPaths();
    return listRecentAgentMessages(paths.desktopDb, { limit: args?.limit, threadId: args?.threadId });
  });

  ipcMain.handle(
    "agent:listOlderAgentChat",
    async (_event, args: { beforeSortOrder: number; limit?: number; threadId?: string }) => {
      const paths = await loadPanelDbPaths();
      return listOlderAgentMessages(paths.desktopDb, {
        beforeSortOrder: args.beforeSortOrder,
        limit: args?.limit,
        threadId: args?.threadId
      });
    }
  );

  ipcMain.handle("agent:clearAgentChat", async (_event, args?: { threadId?: string }) => {
    const paths = await loadPanelDbPaths();
    await clearAgentMessages(paths.desktopDb, args?.threadId);
    return { ok: true };
  });

  ipcMain.handle(
    "agent:truncateAgentChat",
    async (_event, args: { threadId: string; fromSortOrder: number }) => {
      const paths = await loadPanelDbPaths();
      await deleteAgentMessagesFromSortOrder(paths.desktopDb, {
        threadId: args.threadId,
        fromSortOrder: args.fromSortOrder
      });
      return { ok: true };
    }
  );

  ipcMain.handle("agent:listThreads", async () => {
    const paths = await loadPanelDbPaths();
    return listAgentThreads(paths.desktopDb);
  });

  ipcMain.handle("agent:createThread", async (_event, args: { title: string }) => {
    const paths = await loadPanelDbPaths();
    return createAgentThread(paths.desktopDb, args);
  });

  ipcMain.handle("agent:renameThread", async (_event, args: { id: string; title: string }) => {
    const paths = await loadPanelDbPaths();
    await renameAgentThread(paths.desktopDb, args.id, args.title);
    return { ok: true };
  });

  ipcMain.handle("agent:deleteThread", async (_event, args: { id: string }) => {
    const paths = await loadPanelDbPaths();
    await deleteAgentThread(paths.desktopDb, args.id);
    return { ok: true };
  });

  ipcMain.handle(
    "agent:listAgentNoteAudit",
    async (
      _event,
      args?: {
        limit?: number;
        noteId?: string;
        traceId?: string;
        status?: AgentNoteAuditStatus;
      }
    ) => {
      const paths = await loadPanelDbPaths();
      return listAgentNoteAudit(paths.desktopDb, args);
    }
  );

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
  registerFlowIpc();
  registerLinkGraphIpc(() => mainWindow, () => app.getLocale());
  tryRegisterPtyIpc();
  try {
    await loadPanelDbPaths();
  } catch (error) {
    void recordAppError({
      source: "startup",
      message: "Failed to prepare panel databases on startup.",
      error
    });
  }
  // Rewrite any client configs still pointing at the old GUI Electron MCP entry.
  try {
    const settings = await loadSettings();
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
    const settings = await loadSettings();
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
  createWindow();
  initializeStandaloneNoteShortcut(await loadSettings());
  await installApplicationMenu();
  startDesktopNotesIndexer();
  startSessionSummaryAuto();
  startSessionTranscriptIndexAuto();
  startSessionEmbeddingIndexAuto();
  startAutoTaggingService();
  await refreshMemorySchedulerFromSettings();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      // Invariant fallback: settings must not outlive main
      closeSettingsWindowIfOpen();
      createWindow();
      startDesktopNotesIndexer();
      startSessionSummaryAuto();
      startSessionTranscriptIndexAuto();
      startSessionEmbeddingIndexAuto();
      startAutoTaggingService();
      // Closing the last window on macOS used to stop the scheduler; restore it with the window.
      void refreshMemorySchedulerFromSettings();
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    showMainWindowIfReady();
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    }
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
  performQuitCleanup();
});

app.on("window-all-closed", () => {
  // macOS: app stays in Dock without windows — keep scheduler/notes indexer running so
  // scheduled digests still fire. Only non-darwin quits here; cleanup is in before-quit.
  if (process.platform !== "darwin") {
    stopMemoryScheduler();
    stopNotesIndexer();
    stopSessionSummaryAuto();
    stopSessionTranscriptIndexAuto();
    stopSessionEmbeddingIndexAuto();
    stopAutoTaggingService();
    tryDestroyPtyOnQuit();
    app.quit();
  } else {
    tryDestroyPtyOnQuit();
  }
});
}
