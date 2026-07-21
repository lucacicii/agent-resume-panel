import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  runAgentChat,
  clearAgentMessages,
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
  previewReportGtdSync,
  runMonthlyDigest,
  runWeeklyDigest,
  saveSettings,
  searchReportsByEmbedding,
  sessionSyncOptionsFromSettings,
  syncAgentSessions,
  summarizeSessionAction,
  type AgentProvider,
  type AgentNoteAuditStatus,
  type DigestProgressEvent,
  type PanelSettings,
  type WorkbenchProjectEditor,
  type AgentSessionSyncResult
} from "@agent-resume/core";
import { safeHandle } from "./ipcUtils";
import { registerWorkbenchFsIpc } from "./workbenchFs";
import { registerWorkbenchGitIpc } from "./workbenchGit";
import { checkForDesktopUpdate, getAppVersion } from "./updateCheck";
import { loadPanelDbPaths } from "./panelDatabases";
import { buildI18nBundle, desktopT, initI18nService } from "./i18nService";
import { shouldSyncSessionsAfterSettingsSave, type SaveSettingsOptions } from "./sessionSettingsSync";
import {
  invalidateNotesStore,
  notesCopyPath,
  notesCreate,
  notesDelete,
  notesImport,
  notesPasteImage,
  notesList,
  notesMove,
  notesOpenFolder,
  settingsOpenPanelHome,
  notesRead,
  notesRename,
  notesReveal,
  notesWrite
} from "./notesService";
import { refreshMemorySchedulerFromSettings, stopMemoryScheduler } from "./scheduler";
import { scheduleNotesIndex, startNotesIndexer, stopNotesIndexer } from "./noteIndexer";

function tryRegisterPtyIpc(): void {
  try {
    // Lazy-load so node-pty native binding issues do not block other IPC handlers.
    const { registerPtyIpc } = require("./ptyHost") as typeof import("./ptyHost");
    registerPtyIpc(() => mainWindow);
  } catch (error) {
    console.error("[desktop] node-pty unavailable — embedded terminal disabled.", error);
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
  return result;
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

function registerWorkbenchShortcuts(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    if (isWorkbenchCmdTInput(input)) {
      event.preventDefault();
      if (!win.isDestroyed()) {
        win.webContents.send("workbench:cmdT");
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

function createWindow(): void {
  const icon = loadAppIcon();
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
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
    width: 720,
    height: 560,
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
      const bundle = buildI18nBundle(saved);
      const sync = shouldSyncSessionsAfterSettingsSave(previous, saved, options)
        ? await syncAndNotify()
        : undefined;
      scheduleNotesIndex();
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

  ipcMain.handle("sessions:list", async (_event, limit?: number) => {
    const paths = await loadPanelDbPaths();
    return listSessions(paths.catalogDb, limit ?? 500);
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
      const settings = await loadSettings();
      const paths = await loadPanelDbPaths(settings);
      const session = await getSessionById(paths.catalogDb, args.provider, args.id);
      if (!session) {
        throw new Error(`Session not found: ${args.provider} ${args.id}`);
      }
      const mode = resolveWorkbenchTerminalMode(settings);
      const command = buildResumeCommand(session);
      const cwd = await resolveSessionCwd(session.projectPath, settings);

      if (mode === "external-system") {
        await openSessionInSystemTerminal(
          { ...session, projectPath: cwd },
          systemTerminalSettings(settings),
          {
            writeText: (text) => Promise.resolve(clipboard.writeText(text))
          }
        );
        return { mode, external: true, command, cwd };
      }
      return { mode, command, cwd, session };
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
      args: { cwd: string; provider: AgentProvider; useSystemTerminalOnly?: boolean }
    ) => {
      const settings = await loadSettings();
      const cwd = expandHome(args.cwd?.trim() || "");
      if (!cwd) {
        throw new Error("Working directory is required.");
      }
      const mode = resolveWorkbenchTerminalMode(settings);
      if (args.useSystemTerminalOnly || mode === "external-system") {
        await openProjectInSystemTerminal(cwd);
        return { mode: "external-system", cwd };
      }
      const command = buildNewSessionCommand(args.provider, cwd);
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
      console.error("report:getEntry failed:", error);
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
      args?: string | { date?: string; forceResummarize?: boolean }
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
        onProgress: sendProgress,
        systemLocale: app.getLocale()
      });
    }
  );

  ipcMain.handle("report:needsDailyRefresh", async (_event, date?: string) => {
    return needsDailyDigestRefresh({ date, systemLocale: app.getLocale() });
  });

  ipcMain.handle("report:needsWeeklyRefresh", async (_event, weekKey?: string) => {
    return needsWeeklyDigestRefresh({ weekKey, systemLocale: app.getLocale() });
  });

  ipcMain.handle("report:needsMonthlyRefresh", async (_event, monthKey?: string) => {
    return needsMonthlyDigestRefresh({ monthKey, systemLocale: app.getLocale() });
  });

  ipcMain.handle("report:runWeekly", async (event, weekKey?: string) => {
    const sendProgress = (progress: DigestProgressEvent) => {
      event.sender.send("report:digestProgress", progress);
    };
    return runWeeklyDigest({
      weekKey,
      onProgress: sendProgress,
      systemLocale: app.getLocale()
    });
  });

  ipcMain.handle("report:runMonthly", async (event, monthKey?: string) => {
    const sendProgress = (progress: DigestProgressEvent) => {
      event.sender.send("report:digestProgress", progress);
    };
    return runMonthlyDigest({
      monthKey,
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
      activeAskAbort = new AbortController();
      const signal = activeAskAbort.signal;
      try {
        return await runAgentChat({
          query: args.query,
          history: args.history,
          threadId: args.threadId,
          enableTools: args.enableTools ?? true,
          systemLocale: app.getLocale(),
          signal,
          onStream: async (streamEvent) => {
            event.sender.send("agent:askStream", streamEvent);
            if (streamEvent.phase === "chunk") {
              await new Promise<void>((resolve) => setImmediate(resolve));
            }
          }
        });
      } finally {
        if (activeAskAbort?.signal === signal) {
          activeAskAbort = null;
        }
      }
    }
  );

  ipcMain.handle("agent:cancelAsk", async () => {
    activeAskAbort?.abort();
    activeAskAbort = null;
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
        minSessionsPerDay: args?.minSessionsPerDay
      });
    }
  );

  ipcMain.handle("notes:list", async () => notesList());
  ipcMain.handle("notes:read", async (_event, args: { noteId: string }) => notesRead(args.noteId));
  ipcMain.handle("notes:write", async (_event, args: { noteId: string; content: string }) => {
    const result = await notesWrite(args.noteId, args.content);
    scheduleNotesIndex();
    return result;
  });
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

app.whenReady().then(async () => {
  initI18nService(path.join(app.getAppPath()));
  applyAppIcon();
  registerIpc();
  registerWorkbenchFsIpc();
  registerWorkbenchGitIpc(() => app.getLocale());
  tryRegisterPtyIpc();
  try {
    await loadPanelDbPaths();
  } catch (error) {
    console.error("Failed to prepare panel databases on startup:", error);
  }
  createWindow();
  await installApplicationMenu();
  startDesktopNotesIndexer();
  await refreshMemorySchedulerFromSettings();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      // Invariant fallback: settings must not outlive main
      closeSettingsWindowIfOpen();
      createWindow();
      startDesktopNotesIndexer();
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
  stopMemoryScheduler();
  stopNotesIndexer();
  tryDestroyPtyOnQuit();
});

app.on("window-all-closed", () => {
  // macOS: app stays in Dock without windows — keep scheduler/notes indexer running so
  // scheduled digests still fire. Only non-darwin quits here; cleanup is in before-quit.
  if (process.platform !== "darwin") {
    stopMemoryScheduler();
    stopNotesIndexer();
    tryDestroyPtyOnQuit();
    app.quit();
  } else {
    tryDestroyPtyOnQuit();
  }
});
