import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
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
  splitProjectPathInCatalog,

  openChatGptAppSession,
  openProjectInEditor,
  openProjectInSystemTerminal,
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
  type PanelSettings,
  type WorkbenchProjectEditor,
  type AgentSessionSyncResult
} from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";
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
import { disposeAllAcpControllers, registerAcpIpc } from "./acp/acpHost";
import { acpRecordToAgentSession, excludeCodexAcpNativeSessions, mergeCatalogAndAcpSessions } from "./acp/sessionList";
import { getAcpRecord, loadAcpRecords } from "./acp/store";
import { registerWorkbenchFsIpc } from "./workbenchFs";
import { disposeWorkbenchWatchers, registerWorkbenchWatcherIpc } from "./workbenchWatcher";
import { registerWorkbenchGitIpc } from "./workbenchGit";
import { registerWorkbenchScriptsIpc } from "./workbenchScripts";
import { isQuickAccessShortcut } from "./desktopShortcuts";
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
  notesListGtd,
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
  notesSetParent,
  notesWrite,
  notesExecutableParse,
  notesExecutableApproveRun,
  notesExecutableBindSession,
  notesExecutableSettleChild,
  notesExecutableResolveLeaf,
  notesExecutableIsComposite,
  notesExecutableListBindings,
  notesExecutableListRuns,
  notesExecutableProbe,
  notesExecutableSetRunStatus,
  notesExecutableSetChildStatus,
  notesExecutableSetSessionStatus,
  notesExecutableAppendStep,
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
let settingsWindow: BrowserWindow | null = null;
let activeAskAbort: AbortController | null = null;
const activeAskApprovals = new Map<string, { senderId: number; resolve: (approved: boolean) => void }>();

function rejectActiveAskApprovals(): void {
  for (const pending of activeAskApprovals.values()) pending.resolve(false);
  activeAskApprovals.clear();
}
let sessionSyncTimer: NodeJS.Timeout | null = null;
let sessionSyncInFlight: Promise<AgentSessionSyncResult> | null = null;
let workbenchActive = false;
const SESSION_SYNC_INTERVAL_MS = 60_000;

const SETTINGS_PANES = [
  "general",
  "models",
  "sessions",
  "workbench",
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
  for (const win of [mainWindow, settingsWindow]) {
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
  return result;
}

/** Shared resume entry for Workbench IPC and Agent session_resume tool. */
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
  const icon = loadAppIcon();
  mainWindow = new BrowserWindow({
    ...DEFAULT_WINDOW_SIZE,
    minWidth: 860,
    minHeight: 600,
    title: "Agent Resume Desktop",
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

  mainWindow.maximize();
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
    // Invariant: settings never outlives main
    closeSettingsWindowIfOpen();
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
  const isMac = process.platform === "darwin";

  const settingsItem: Electron.MenuItemConstructorOptions = {
    label: settingsLabel,
    accelerator: "CommandOrControl+,",
    click: () => openSettingsWindow({ pane: "general" })
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
            submenu: [settingsItem, { type: "separator" as const }, { role: "quit" as const }]
          }
        ]),
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.on("workbench:setActive", (event, active: unknown) => {
    if (event.sender === mainWindow?.webContents) {
      workbenchActive = active === true;
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
      const file = await saveSettings(settings);
      invalidateNotesStore();
      const schedulerEnabled = await refreshMemorySchedulerFromSettings();
      const saved = await loadSettings();
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
      await hideSessionAction({ provider: args.provider, id: args.id });
      return { ok: true };
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
      if (args.useSystemTerminalOnly || mode === "external-system") {
        await openProjectInSystemTerminal(cwd);
        return { mode: "external-system", cwd };
      }
      const command = buildNewSessionCommand(args.provider, cwd, "standard");
      return { mode, command, cwd };
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
  ipcMain.handle("notes:listGtd", async (_event, args?: { query?: unknown; status?: unknown }) => {
    const query = typeof args?.query === "string" ? args.query : undefined;
    const status = typeof args?.status === "string" && isGtdStatus(args.status) ? args.status : undefined;
    return notesListGtd({ query, status });
  });
  ipcMain.handle("notes:read", async (_event, args: { noteId: string }) => notesRead(args.noteId));
  ipcMain.handle("notes:write", async (_event, args: { noteId: string; content: string }) => {
    const result = await notesWrite(args.noteId, args.content);
    scheduleNotesIndex();
    return result;
  });
  ipcMain.handle("notes:executableParse", async (_event, args: { noteId: string }) =>
    notesExecutableParse(args.noteId)
  );
  ipcMain.handle(
    "notes:executableApproveRun",
    async (_event, args: { noteId: string; runIndex?: number; defaultProvider?: string }) => {
      const result = await notesExecutableApproveRun(args.noteId, {
        runIndex: args.runIndex,
        defaultProvider: args.defaultProvider
      });
      scheduleNotesIndex();
      return result;
    }
  );
  ipcMain.handle(
    "notes:executableBindSession",
    async (
      _event,
      args: {
        noteId: string;
        provider: string;
        agentSessionId: string;
        runId?: string;
        role?: string;
        status?: string;
      }
    ) => {
      const result = await notesExecutableBindSession(args);
      scheduleNotesIndex();
      return result;
    }
  );
  ipcMain.handle(
    "notes:executableSettleChild",
    async (
      _event,
      args: {
        parentNoteId: string;
        childNoteId: string;
        outcome: "completed" | "failed";
        summary: string;
        runId?: string;
        defaultProvider?: string;
        bubble?: boolean;
      }
    ) => {
      const result = await notesExecutableSettleChild(args);
      scheduleNotesIndex();
      return result;
    }
  );
  ipcMain.handle(
    "notes:executableResolveLeaf",
    async (_event, args: { noteId: string; defaultProvider?: string; maxDepth?: number }) => {
      const result = await notesExecutableResolveLeaf(args.noteId, {
        defaultProvider: args.defaultProvider,
        maxDepth: args.maxDepth
      });
      scheduleNotesIndex();
      return result;
    }
  );
  ipcMain.handle("notes:executableIsComposite", async (_event, args: { noteId: string }) =>
    notesExecutableIsComposite(args.noteId)
  );
  ipcMain.handle("notes:executableListBindings", async (_event, args: { noteId: string }) =>
    notesExecutableListBindings(args.noteId)
  );
  ipcMain.handle("notes:executableListRuns", async (_event, args: { noteId: string }) =>
    notesExecutableListRuns(args.noteId)
  );
  ipcMain.handle("notes:executableProbe", async (_event, args: { noteId: string }) =>
    notesExecutableProbe(args.noteId)
  );
  ipcMain.handle(
    "notes:executableSetRunStatus",
    async (
      _event,
      args: {
        noteId: string;
        status: "draft" | "awaiting_approval" | "executing" | "completed" | "partial" | "failed";
      }
    ) => {
      const result = await notesExecutableSetRunStatus(args.noteId, args.status);
      scheduleNotesIndex();
      return result;
    }
  );
  ipcMain.handle(
    "notes:executableSetChildStatus",
    async (
      _event,
      args: { childNoteId: string; status: "idle" | "planned" | "running" | "done" | "failed" }
    ) => {
      const result = await notesExecutableSetChildStatus(args.childNoteId, args.status);
      scheduleNotesIndex();
      return result;
    }
  );
  ipcMain.handle(
    "notes:executableSetSessionStatus",
    async (
      _event,
      args: { noteId: string; status: "idle" | "planned" | "running" | "settled" | "failed" }
    ) => {
      const result = await notesExecutableSetSessionStatus(args.noteId, args.status);
      scheduleNotesIndex();
      return result;
    }
  );
  ipcMain.handle(
    "notes:executableAppendStep",
    async (_event, args: { parentNoteId: string; text?: string }) => {
      const result = await notesExecutableAppendStep(args.parentNoteId, args.text);
      scheduleNotesIndex();
      return result;
    }
  );
  ipcMain.handle(
    "notes:resumeSession",
    async (_event, args: { provider: AgentProvider; sessionId: string }) => {
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
      return mergeProjectsInCatalog(paths.catalogDb, args.sourceProjectId, args.targetProjectId);
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
  createWindow();
  await installApplicationMenu();
  startDesktopNotesIndexer();
  startSessionSummaryAuto();
  startSessionTranscriptIndexAuto();
  startSessionEmbeddingIndexAuto();
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
      // Closing the last window on macOS used to stop the scheduler; restore it with the window.
      void refreshMemorySchedulerFromSettings();
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    void refreshMemorySchedulerFromSettings();
  });
});

app.on("before-quit", () => {
  disposeWorkbenchWatchers();
  stopMemoryScheduler();
  stopNotesIndexer();
  stopSessionSummaryAuto();
  stopSessionTranscriptIndexAuto();
  stopSessionEmbeddingIndexAuto();
  disposeAllAcpControllers();
  tryDestroyPtyOnQuit();
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
    tryDestroyPtyOnQuit();
    app.quit();
  } else {
    tryDestroyPtyOnQuit();
  }
});
}
