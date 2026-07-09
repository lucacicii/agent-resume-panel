import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentCitation,
  AgentSession,
  AskMetaAgentResult,
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
  listMemory(opts?: {
    level?: string;
    limit?: number;
    fromMs?: number;
    toMs?: number;
  }): Promise<MemoryEntry[]>;
  listDailyDigests(limit?: number): Promise<MemoryEntry[]>;
  runDailyDigest(date?: string): Promise<RunDailyDigestResult>;
  runWeeklyDigest(weekKey?: string): Promise<RunWeeklyDigestResult>;
  runMonthlyDigest(monthKey?: string): Promise<RunMonthlyDigestResult>;
  searchMemory(args: {
    query: string;
    level?: string;
    limit?: number;
  }): Promise<MemorySearchHit[]>;
  askAgent(args: {
    query: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<AskMetaAgentResult>;
  buildResumeCommand(args: {
    provider: string;
    id: string;
  }): Promise<{ command: string; session: AgentSession }>;
  buildHandoffBrief(args: {
    query?: string;
    answer?: string;
    citations: AgentCitation[];
  }): Promise<{
    markdown: string;
    resumeCommand?: string;
    targetSession?: { provider: string; id: string; projectPath: string };
  }>;
  previewMemoryGtdSync(args?: {
    ensureDigests?: boolean;
  }): Promise<{
    previewId: string;
    proposals: Array<{
      provider: string;
      sessionId: string;
      title: string;
      projectPath: string;
      previousGtd: string | null;
      proposedGtd: string;
      reason: string;
      tasks: string[];
      sourceMemoryIds: string[];
      todolistPreview: string;
    }>;
    skipped: string[];
    warnings: string[];
    ensureDigest?: { ran: boolean; jobKey?: string };
  }>;
  applyMemoryGtdSync(args: {
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
  }): Promise<{
    applied: Array<{
      provider: string;
      sessionId: string;
      previousStatus: string | null;
      newStatus: string;
      reason: string;
      todolistPath?: string;
      title?: string;
    }>;
    failed: Array<{ key: string; error: string }>;
    jobKey: string;
  }>;
  previewBackfillDigests(args?: {
    maxDays?: number;
    skipExisting?: boolean;
    minSessionsPerDay?: number;
  }): Promise<{
    days: string[];
    weeks: string[];
    months: string[];
    sessionRowsScanned: number;
    estimatedLlmCalls: number;
  }>;
  backfillDigests(args?: {
    maxDays?: number;
    skipExisting?: boolean;
    skipEmbedding?: boolean;
    minSessionsPerDay?: number;
  }): Promise<{
    daily: { planned: string[]; ok: string[]; skipped: string[]; failed: Array<{ key: string; error: string }> };
    weekly: { planned: string[]; ok: string[]; skipped: string[]; failed: Array<{ key: string; error: string }> };
    monthly: { planned: string[]; ok: string[]; skipped: string[]; failed: Array<{ key: string; error: string }> };
    sessionRowsScanned: number;
  }>;
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
  searchMemory: (args) => ipcRenderer.invoke("memory:search", args),
  askAgent: (args) => ipcRenderer.invoke("agent:ask", args),
  buildResumeCommand: (args) => ipcRenderer.invoke("agent:resumeCommand", args),
  buildHandoffBrief: (args) => ipcRenderer.invoke("agent:handoffBrief", args),
  previewMemoryGtdSync: (args) => ipcRenderer.invoke("workflow:previewMemoryGtdSync", args),
  applyMemoryGtdSync: (args) => ipcRenderer.invoke("workflow:applyMemoryGtdSync", args),
  previewBackfillDigests: (args) => ipcRenderer.invoke("workflow:previewBackfillDigests", args),
  backfillDigests: (args) => ipcRenderer.invoke("workflow:backfillDigests", args)
};

contextBridge.exposeInMainWorld("agentResume", api);
