import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";
import {
  askMetaAgent,
  backfillMemoryDigests,
  buildMemoryHandoffBrief,
  buildResumeCommandFromRef,
  catalogDbFromSettings,
  ensureCatalogSchema,
  getMemoryEntryById,
  getSessionById,
  listMemoryEntries,
  listMemoryEntriesInRange,
  listMemoryLinks,
  listSessions,
  loadSettings,
  previewBackfillMemoryDigests,
  resolvePanelHome,
  runDailyDigest,
  applyMemoryGtdSync,
  previewMemoryGtdSync,
  runMonthlyDigest,
  runWeeklyDigest,
  saveSettings,
  searchMemoryByEmbedding,
  type AgentCitation,
  type AgentProvider,
  type PanelSettings
} from "@agent-resume/core";
import { refreshMemorySchedulerFromSettings, stopMemoryScheduler } from "./scheduler";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    title: "Agent Resume Desktop",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.on("closed", () => {
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
    return { file, settings: await loadSettings(), schedulerEnabled };
  });

  ipcMain.handle("sessions:list", async (_event, limit?: number) => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
    return listSessions(dbPath, limit ?? 500);
  });

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

  ipcMain.handle("memory:listDaily", async (_event, limit?: number) => {
    const settings = await loadSettings();
    const dbPath = catalogDbFromSettings(settings);
    await ensureCatalogSchema(dbPath);
    return listMemoryEntries(dbPath, { level: "daily", limit: limit ?? 30 });
  });

  ipcMain.handle("memory:runDaily", async (_event, date?: string) => {
    return runDailyDigest({ date });
  });

  ipcMain.handle("memory:runWeekly", async (_event, weekKey?: string) => {
    return runWeeklyDigest({ weekKey });
  });

  ipcMain.handle("memory:runMonthly", async (_event, monthKey?: string) => {
    return runMonthlyDigest({ monthKey });
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
      _event,
      args: {
        query: string;
        history?: Array<{ role: "user" | "assistant"; content: string }>;
      }
    ) => {
      return askMetaAgent({
        query: args.query,
        history: args.history
      });
    }
  );

  ipcMain.handle(
    "agent:resumeCommand",
    async (
      _event,
      args: { provider: AgentProvider; id: string }
    ) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      const session = await getSessionById(dbPath, args.provider, args.id);
      if (!session) {
        throw new Error(`Session not found: ${args.provider} ${args.id}`);
      }
      return {
        command: buildResumeCommandFromRef({
          provider: session.provider,
          id: session.id,
          projectPath: session.projectPath,
          title: session.title
        }),
        session
      };
    }
  );

  ipcMain.handle(
    "workflow:previewMemoryGtdSync",
    async (_event, args?: { ensureDigests?: boolean }) => {
      return previewMemoryGtdSync({
        ensureDigests: args?.ensureDigests
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
        }>;
      }
    ) => {
      return applyMemoryGtdSync({
        items: (args?.items || []).map((it) => ({
          ...it,
          previousGtd: (it.previousGtd as "inbox" | "next" | "waiting" | "someday" | "reference" | null) ?? null
        }))
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

  ipcMain.handle(
    "agent:handoffBrief",
    async (
      _event,
      args: {
        query?: string;
        answer?: string;
        citations: AgentCitation[];
      }
    ) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);

      const digests = [];
      for (const c of args.citations || []) {
        const entry = await getMemoryEntryById(dbPath, c.memoryId);
        if (entry) {
          digests.push(entry);
        }
      }

      // Enrich citations with links if missing session
      const citations: AgentCitation[] = [];
      for (const c of args.citations || []) {
        if (c.session) {
          citations.push(c);
          continue;
        }
        const links = await listMemoryLinks(dbPath, c.memoryId);
        const first = links.find((l) => l.provider && l.agentSessionId);
        citations.push({
          ...c,
          session: first
            ? {
                provider: first.provider as AgentProvider,
                id: first.agentSessionId as string,
                projectPath: first.projectPath || ""
              }
            : undefined
        });
      }

      const target = citations.find((c) => c.session)?.session;
      const resumeCommand = target
        ? buildResumeCommandFromRef({
            provider: target.provider,
            id: target.id,
            projectPath: target.projectPath
          })
        : undefined;

      const markdown = buildMemoryHandoffBrief({
        query: args.query,
        answer: args.answer,
        citations,
        digests,
        targetSession: target,
        resumeCommand
      });

      return { markdown, resumeCommand, targetSession: target };
    }
  );
}

app.whenReady().then(async () => {
  registerIpc();
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
  if (process.platform !== "darwin") {
    app.quit();
  }
});
