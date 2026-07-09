import { contextBridge, ipcRenderer } from "electron";
import type { AgentSession, MemoryEntry, PanelSettings, RunDailyDigestResult } from "@agent-resume/core";

export interface DesktopApi {
  getPanelHome(): Promise<string>;
  getSettings(): Promise<PanelSettings>;
  saveSettings(settings: PanelSettings): Promise<{ file: string; settings: PanelSettings }>;
  listSessions(limit?: number): Promise<AgentSession[]>;
  listDailyDigests(limit?: number): Promise<MemoryEntry[]>;
  runDailyDigest(date?: string): Promise<RunDailyDigestResult>;
}

const api: DesktopApi = {
  getPanelHome: () => ipcRenderer.invoke("panel:getHome"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  listSessions: (limit) => ipcRenderer.invoke("sessions:list", limit),
  listDailyDigests: (limit) => ipcRenderer.invoke("memory:listDaily", limit),
  runDailyDigest: (date) => ipcRenderer.invoke("memory:runDaily", date)
};

contextBridge.exposeInMainWorld("agentResume", api);
