import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";
import {
  catalogDbFromSettings,
  ensureCatalogSchema,
  listMemoryEntries,
  listSessions,
  loadSettings,
  resolvePanelHome,
  runDailyDigest,
  runMonthlyDigest,
  runWeeklyDigest,
  saveSettings,
  searchMemoryByEmbedding,
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
    async (_event, opts?: { level?: string; limit?: number }) => {
      const settings = await loadSettings();
      const dbPath = catalogDbFromSettings(settings);
      await ensureCatalogSchema(dbPath);
      return listMemoryEntries(dbPath, {
        level: opts?.level && opts.level !== "all" ? opts.level : undefined,
        limit: opts?.limit ?? 50
      });
    }
  );

  // Back-compat for older preload
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
    async (
      _event,
      args: { query: string; level?: string; limit?: number }
    ) => {
      return searchMemoryByEmbedding({
        query: args.query,
        level: args.level && args.level !== "all" ? args.level : undefined,
        limit: args.limit ?? 20
      });
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
