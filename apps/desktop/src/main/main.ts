import { app, BrowserWindow, clipboard, ipcMain } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  askMetaAgent,
  clearAskMessages,
  listOlderAskMessages,
  listRecentAskMessages,
  autoRenameSessionAction,
  backfillMemoryDigests,
  buildNewSessionCommand,
  buildResumeCommand,
  catalogDbFromSettings,
  effectivePanelHome,
  ensureCatalogSchema,
  expandHome,
  getMemoryEntryById,
  getSessionById,
  getUsageSummary,
  hideSessionAction,
  listLlmUsageEvents,
  listMemoryEntries,
  listMemoryEntriesInRange,
  listScheduleRuns,
  listSessions,
  listSessionsInRange,
  loadSessionPreview,
  loadSettings,
  openProjectInGhostty,
  openSessionInGhostty,
  previewBackfillMemoryDigests,
  renameSessionAction,
  resolvePanelHome,
  resolvePreviewHomes,
  runDailyDigest,
  needsDailyDigestRefresh,
  needsWeeklyDigestRefresh,
  needsMonthlyDigestRefresh,
  applyMemoryGtdSync,
  previewMemoryGtdSync,
  runMonthlyDigest,
  runWeeklyDigest,
  saveSettings,
  searchMemoryByEmbedding,
  sessionSyncOptionsFromSettings,
  syncAgentSessions,
  summarizeSessionAction,
  type AgentProvider,
  type DigestProgressEvent,
  type PanelSettings,
  type AgentSessionSyncResult
} from "@agent-resume/core";
import { destroyPtyOnQuit, registerPtyIpc } from "./ptyHost";
import { refreshMemorySchedulerFromSettings, stopMemoryScheduler } from "./scheduler";

let mainWindow: BrowserWindow | null = null;
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

function resumeSessionSync(): void {
  startSessionSyncTimer();
  void syncAndNotify().catch(notifySessionSyncFailure);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 860,
    minHeight: 600,
    title: "Agent Resume Desktop",
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
  mainWindow.on("show", resumeSessionSync);
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

  ipcMain.handle("settings:save", async (_event, settings: PanelSettings) => {
    const file = await saveSettings(settings);
    const schedulerEnabled = await refreshMemorySchedulerFromSettings();
    const saved = await loadSettings();
    const sync = await syncAndNotify();
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
    async (_event, args: { provider: AgentProvider; id: string }) => {
      return autoRenameSessionAction({ provider: args.provider, id: args.id });
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

  ipcMain.handle("workbench:createScratchDir", async () => {
    const settings = await loadSettings();
    const home = effectivePanelHome(settings);
    const scratchBase = settings.workbench?.scratchDir?.trim() || path.join(home, "scratch");
    const base = expandHome(scratchBase);
    const dir = path.join(base, `session-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  });

  ipcMain.handle(
    "workbench:openSession",
    async (_event, args: { provider: AgentProvider; id: string }) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      const session = await getSessionById(dbPath, args.provider, args.id);
      if (!session) {
        throw new Error(`Session not found: ${args.provider} ${args.id}`);
      }
      const mode = settings.workbench?.terminalMode || "xterm";
      const command = buildResumeCommand(session);
      if (mode === "external-ghostty") {
        await openSessionInGhostty(session, settings, {
          writeText: (text) => Promise.resolve(clipboard.writeText(text))
        });
        return { mode, external: true, command, cwd: session.projectPath };
      }
      return { mode, command, cwd: session.projectPath, session };
    }
  );

  ipcMain.handle(
    "workbench:newSession",
    async (
      _event,
      args: { cwd: string; provider: AgentProvider; useGhosttyOnly?: boolean }
    ) => {
      const settings = await loadSettings();
      const cwd = expandHome(args.cwd?.trim() || "");
      if (!cwd) {
        throw new Error("Working directory is required.");
      }
      const mode = settings.workbench?.terminalMode || "xterm";
      if (args.useGhosttyOnly || mode === "external-ghostty") {
        await openProjectInGhostty(cwd, settings);
        return { mode: "external-ghostty", cwd };
      }
      const command = buildNewSessionCommand(args.provider, cwd);
      return { mode, command, cwd };
    }
  );

  ipcMain.handle(
    "memory:list",
    async (
      _event,
      opts?: { level?: string; limit?: number; fromMs?: number; toMs?: number }
    ) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      const level = opts?.level && opts.level !== "all" ? opts.level : undefined;
      if (opts?.fromMs != null && opts?.toMs != null) {
        return listMemoryEntriesInRange(dbPath, {
          level,
          startMs: opts.fromMs,
          endMs: opts.toMs,
          limit: opts?.limit ?? 200
        });
      }
      return listMemoryEntries(dbPath, {
        level,
        limit: opts?.limit ?? 50
      });
    }
  );

  ipcMain.handle("memory:getEntry", async (_event, memoryId?: string) => {
    const id = typeof memoryId === "string" ? memoryId.trim() : "";
    if (!id) {
      return null;
    }
    try {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      return (await getMemoryEntryById(dbPath, id)) ?? null;
    } catch (error) {
      console.error("memory:getEntry failed:", error);
      return null;
    }
  });

  ipcMain.handle("memory:listDaily", async (_event, limit?: number) => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
    return listMemoryEntries(dbPath, { level: "daily", limit: limit ?? 30 });
  });

  ipcMain.handle(
    "memory:runDaily",
    async (
      event,
      args?: string | { date?: string; forceResummarize?: boolean }
    ) => {
      const opts =
        typeof args === "string" || args === undefined
          ? { date: args }
          : args || {};
      const sendProgress = (progress: DigestProgressEvent) => {
        event.sender.send("memory:digestProgress", progress);
      };
      return runDailyDigest({
        date: opts.date,
        forceResummarize: opts.forceResummarize,
        onProgress: sendProgress
      });
    }
  );

  ipcMain.handle("memory:needsDailyRefresh", async (_event, date?: string) => {
    return needsDailyDigestRefresh({ date });
  });

  ipcMain.handle("memory:needsWeeklyRefresh", async (_event, weekKey?: string) => {
    return needsWeeklyDigestRefresh({ weekKey });
  });

  ipcMain.handle("memory:needsMonthlyRefresh", async (_event, monthKey?: string) => {
    return needsMonthlyDigestRefresh({ monthKey });
  });

  ipcMain.handle("memory:runWeekly", async (event, weekKey?: string) => {
    const sendProgress = (progress: DigestProgressEvent) => {
      event.sender.send("memory:digestProgress", progress);
    };
    return runWeeklyDigest({ weekKey, onProgress: sendProgress });
  });

  ipcMain.handle("memory:runMonthly", async (event, monthKey?: string) => {
    const sendProgress = (progress: DigestProgressEvent) => {
      event.sender.send("memory:digestProgress", progress);
    };
    return runMonthlyDigest({ monthKey, onProgress: sendProgress });
  });

  ipcMain.handle(
    "memory:search",
    async (_event, args: { query: string; level?: string; limit?: number }) => {
      return searchMemoryByEmbedding({
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
      }
    ) => {
      return askMetaAgent({
        query: args.query,
        history: args.history,
        onStream: async (streamEvent) => {
          event.sender.send("agent:askStream", streamEvent);
          if (streamEvent.phase === "chunk") {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
      });
    }
  );

  ipcMain.handle("agent:listAskChat", async (_event, args?: { limit?: number }) => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
    return listRecentAskMessages(dbPath, { limit: args?.limit });
  });

  ipcMain.handle(
    "agent:listOlderAskChat",
    async (_event, args: { beforeSortOrder: number; limit?: number }) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      return listOlderAskMessages(dbPath, {
        beforeSortOrder: args.beforeSortOrder,
        limit: args?.limit
      });
    }
  );

  ipcMain.handle("agent:clearAskChat", async () => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await clearAskMessages(dbPath);
    return { ok: true };
  });

  ipcMain.handle(
    "workflow:previewMemoryGtdSync",
    async (_event, args?: { ensureDigests?: boolean; memoryIds?: string[] }) => {
      return previewMemoryGtdSync({
        ensureDigests: args?.ensureDigests,
        memoryIds: args?.memoryIds
      });
    }
  );

  ipcMain.handle(
    "workflow:applyMemoryGtdSync",
    async (
      _event,
      args: {
        items: Array<{
          provider: string;
          sessionId: string;
          gtd: string;
          reason: string;
          tasks: string[];
          sourceMemoryIds: string[];
          title?: string;
          projectPath?: string;
          previousGtd?: string | null;
          todolistMarkdown?: string;
        }>;
      }
    ) => {
      return applyMemoryGtdSync({
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
      return previewBackfillMemoryDigests({
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
      return backfillMemoryDigests({
        maxDays: args?.maxDays,
        skipExisting: args?.skipExisting,
        skipEmbedding: args?.skipEmbedding,
        minSessionsPerDay: args?.minSessionsPerDay
      });
    }
  );

}

app.whenReady().then(async () => {
  registerIpc();
  registerPtyIpc(() => mainWindow);
  try {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
  } catch (error) {
    console.error("Failed to ensure catalog schema on startup:", error);
  }
  createWindow();
  await refreshMemorySchedulerFromSettings();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopMemoryScheduler();
  destroyPtyOnQuit();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
