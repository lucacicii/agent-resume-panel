import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentSession,
  MemoryEntry,
  MemorySearchHit,
  PanelSettings,
  RunDailyDigestResult,
  RunMonthlyDigestResult,
  RunWeeklyDigestResult
} from "@agent-resume/core";

export interface DesktopApi {
  getPanelHome(): Promise<string>;
  getSettings(): Promise<PanelSettings>;
  saveSettings(
    settings: PanelSettings
  ): Promise<{ file: string; settings: PanelSettings; schedulerEnabled?: boolean }>;
  listSessions(limit?: number): Promise<AgentSession[]>;
  listMemory(opts?: { level?: string; limit?: number }): Promise<MemoryEntry[]>;
  listDailyDigests(limit?: number): Promise<MemoryEntry[]>;
  runDailyDigest(date?: string): Promise<RunDailyDigestResult>;
  runWeeklyDigest(weekKey?: string): Promise<RunWeeklyDigestResult>;
  runMonthlyDigest(monthKey?: string): Promise<RunMonthlyDigestResult>;
  searchMemory(args: {
    query: string;
    level?: string;
    limit?: number;
  }): Promise<MemorySearchHit[]>;
}

const api: DesktopApi = {
  getPanelHome: () => ipcRenderer.invoke("panel:getHome"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  listSessions: (limit) => ipcRenderer.invoke("sessions:list", limit),
  listMemory: (opts) => ipcRenderer.invoke("memory:list", opts),
  listDailyDigests: (limit) => ipcRenderer.invoke("memory:listDaily", limit),
  runDailyDigest: (date) => ipcRenderer.invoke("memory:runDaily", date),
  runWeeklyDigest: (weekKey) => ipcRenderer.invoke("memory:runWeekly", weekKey),
  runMonthlyDigest: (monthKey) => ipcRenderer.invoke("memory:runMonthly", monthKey),
  searchMemory: (args) => ipcRenderer.invoke("memory:search", args)
};

contextBridge.exposeInMainWorld("agentResume", api);
