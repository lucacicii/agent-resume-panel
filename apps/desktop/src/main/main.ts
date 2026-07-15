import { app, BrowserWindow, clipboard, ipcMain, nativeImage } from "electron";
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
  catalogDbFromSettings,
  effectivePanelHome,
  ensureCatalogSchema,
  expandHome,
  getReportEntryById,
  getSessionById,
  getUsageSummary,
  hideSessionAction,
  listLlmUsageEvents,
  listReportEntries,
  listReportEntriesInRange,
  listScheduleRuns,
  listSessions,
  listSessionsInRange,
  loadProjectAliasesMap,
  loadSessionPreview,
  loadSettings,
  setProjectAliasInCatalog,
  openAlmaThreadInApp,
  openChatGptAppSession,
  openProjectInEditor,
  openProjectInSystemTerminal,
  openSessionInSystemTerminal,
  previewBackfillReportDigests,
  renameSessionAction,
  resolveProjectEditor,
  resolvePanelHome,
  resolvePreviewHomes,
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
import { buildI18nBundle, initI18nService } from "./i18nService";
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
  settings: PanelSettings
): Promise<string> {
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
let activeAskAbort: AbortController | null = null;
let sessionSyncTimer: NodeJS.Timeout | null = null;
let sessionSyncInFlight: Promise<AgentSessionSyncResult> | null = null;
const SESSION_SYNC_INTERVAL_MS = 60_000;

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
    mainWindow = null;
  });
}

function registerIpc(): void {
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

  ipcMain.handle("settings:save", async (_event, settings: PanelSettings) => {
    const previous = await loadSettings();
    const prevLocale = buildI18nBundle(previous).locale;
    const file = await saveSettings(settings);
    invalidateNotesStore();
    const schedulerEnabled = await refreshMemorySchedulerFromSettings();
    const saved = await loadSettings();
    const bundle = buildI18nBundle(saved);
    if (bundle.locale !== prevLocale && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("i18n:localeChanged", bundle);
    }
    const sync = await syncAndNotify();
    scheduleNotesIndex();
    return { file, settings: saved, schedulerEnabled, sync };
  });

  ipcMain.handle("sessions:sync", async () => syncAndNotify());

  ipcMain.handle("sessions:list", async (_event, limit?: number) => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
    return listSessions(dbPath, limit ?? 500);
  });

  ipcMain.handle(
    "sessions:listInRange",
    async (
      _event,
      args?: { fromMs?: number; toMs?: number; limit?: number }
    ) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      const fromMs = Number(args?.fromMs);
      const toMs = Number(args?.toMs);
      // NaN is not null — must use isFinite or SQLite gets "updated_at_ms >= NaN"
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
        return [];
      }
      return listSessionsInRange(dbPath, fromMs, toMs, args?.limit ?? 2000);
    }
  );

  ipcMain.handle(
    "sessions:preview",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      const session = await getSessionById(dbPath, args.provider, args.id);
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
      return summarizeSessionAction({ provider: args.provider, id: args.id });
    }
  );

  ipcMain.handle(
    "sessions:autoRename",
    async (_event, args: { provider: AgentProvider; id: string; persist?: boolean }) => {
      return autoRenameSessionAction({
        provider: args.provider,
        id: args.id,
        persist: args.persist
      });
    }
  );

  ipcMain.handle(
    "sessions:suggestRename",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      return suggestSessionRenameAction({ provider: args.provider, id: args.id });
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
    const home = effectivePanelHome(settings);
    const scratchBase = settings.workbench?.scratchDir?.trim() || path.join(home, "scratch");
    const base = expandHome(scratchBase);
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
      const editor = await openProjectInEditor(args.projectPath, selected);
      return { ok: true, editor };
    }
  );

  safeHandle(
    "workbench:openSession",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      const session = await getSessionById(dbPath, args.provider, args.id);
      if (!session) {
        throw new Error(`Session not found: ${args.provider} ${args.id}`);
      }
      const mode = resolveWorkbenchTerminalMode(settings);
      const command = buildResumeCommand(session);
      const cwd = await resolveSessionCwd(session.projectPath, settings);

      if (session.provider === "alma") {
        await openAlmaThreadInApp(session);
        return { mode, external: true, alma: true, command, cwd };
      }

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
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      const session = await getSessionById(dbPath, args.provider, args.id);
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
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      const level = opts?.level && opts.level !== "all" ? opts.level : undefined;
      if (opts?.fromMs != null && opts?.toMs != null) {
        return listReportEntriesInRange(dbPath, {
          level,
          startMs: opts.fromMs,
          endMs: opts.toMs,
          limit: opts?.limit ?? 200
        });
      }
      return listReportEntries(dbPath, {
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
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      return (await getReportEntryById(dbPath, id)) ?? null;
    } catch (error) {
      console.error("report:getEntry failed:", error);
      return null;
    }
  });

  ipcMain.handle("report:listDaily", async (_event, limit?: number) => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
    return listReportEntries(dbPath, { level: "daily", limit: limit ?? 30 });
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
        onProgress: sendProgress
      });
    }
  );

  ipcMain.handle("report:needsDailyRefresh", async (_event, date?: string) => {
    return needsDailyDigestRefresh({ date });
  });

  ipcMain.handle("report:needsWeeklyRefresh", async (_event, weekKey?: string) => {
    return needsWeeklyDigestRefresh({ weekKey });
  });

  ipcMain.handle("report:needsMonthlyRefresh", async (_event, monthKey?: string) => {
    return needsMonthlyDigestRefresh({ monthKey });
  });

  ipcMain.handle("report:runWeekly", async (event, weekKey?: string) => {
    const sendProgress = (progress: DigestProgressEvent) => {
      event.sender.send("report:digestProgress", progress);
    };
    return runWeeklyDigest({ weekKey, onProgress: sendProgress });
  });

  ipcMain.handle("report:runMonthly", async (event, monthKey?: string) => {
    const sendProgress = (progress: DigestProgressEvent) => {
      event.sender.send("report:digestProgress", progress);
    };
    return runMonthlyDigest({ monthKey, onProgress: sendProgress });
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
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
    return listRecentAgentMessages(dbPath, { limit: args?.limit, threadId: args?.threadId });
  });

  ipcMain.handle(
    "agent:listOlderAgentChat",
    async (_event, args: { beforeSortOrder: number; limit?: number; threadId?: string }) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      return listOlderAgentMessages(dbPath, {
        beforeSortOrder: args.beforeSortOrder,
        limit: args?.limit,
        threadId: args?.threadId
      });
    }
  );

  ipcMain.handle("agent:clearAgentChat", async (_event, args?: { threadId?: string }) => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await clearAgentMessages(dbPath, args?.threadId);
    return { ok: true };
  });

  ipcMain.handle("agent:listThreads", async () => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    return listAgentThreads(dbPath);
  });

  ipcMain.handle("agent:createThread", async (_event, args: { title: string }) => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    return createAgentThread(dbPath, args);
  });

  ipcMain.handle("agent:renameThread", async (_event, args: { id: string; title: string }) => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await renameAgentThread(dbPath, args.id, args.title);
    return { ok: true };
  });

  ipcMain.handle("agent:deleteThread", async (_event, args: { id: string }) => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await deleteAgentThread(dbPath, args.id);
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
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      return listAgentNoteAudit(dbPath, args);
    }
  );

  ipcMain.handle(
    "workflow:previewReportGtdSync",
    async (_event, args?: { ensureDigests?: boolean; reportIds?: string[] }) => {
      return previewReportGtdSync({
        ensureDigests: args?.ensureDigests,
        reportIds: args?.reportIds
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
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
    return getUsageSummary(dbPath, args?.days ?? 30);
  });

  ipcMain.handle(
    "usage:listEvents",
    async (_event, args?: { limit?: number; source?: string; days?: number }) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      const days = args?.days ?? 30;
      const fromMs = Date.now() - days * 24 * 60 * 60 * 1000;
      return listLlmUsageEvents(dbPath, {
        fromMs,
        source: args?.source,
        limit: args?.limit ?? 100
      });
    }
  );

  ipcMain.handle(
    "usage:listScheduleRuns",
    async (_event, args?: { limit?: number; level?: string; days?: number }) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      const days = args?.days ?? 30;
      const fromMs = Date.now() - days * 24 * 60 * 60 * 1000;
      return listScheduleRuns(dbPath, {
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
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
    return loadProjectAliasesMap(dbPath);
  });

  ipcMain.handle(
    "projects:setAlias",
    async (_event, args: { projectPath: string; alias: string }) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      await setProjectAliasInCatalog(dbPath, args.projectPath, args.alias);
      return { ok: true };
    }
  );
}

app.whenReady().then(async () => {
  initI18nService(path.join(app.getAppPath()));
  applyAppIcon();
  registerIpc();
  tryRegisterPtyIpc();
  try {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
  } catch (error) {
    console.error("Failed to ensure catalog schema on startup:", error);
  }
  createWindow();
  startDesktopNotesIndexer();
  await refreshMemorySchedulerFromSettings();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      startDesktopNotesIndexer();
    }
  });
});

app.on("window-all-closed", () => {
  stopMemoryScheduler();
  stopNotesIndexer();
  tryDestroyPtyOnQuit();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
