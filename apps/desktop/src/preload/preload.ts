import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentCitation,
  AgentSession,
  AskMetaAgentResult,
  DigestProgressEvent,
  MemoryEntry,
  MemorySearchHit,
  PanelSettings,
  DailyDigestRefreshCheck,
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
  listSessionsInRange(args: {
    fromMs: number;
    toMs: number;
    limit?: number;
  }): Promise<AgentSession[]>;
  previewSession(args: {
    provider: string;
    id: string;
  }): Promise<{
    session: AgentSession;
    preview: {
      title: string;
      messages: Array<{ role: string; text: string; timestamp?: string }>;
      truncated?: boolean;
      warning?: string;
    };
  }>;
  summarizeSession(args: {
    provider: string;
    id: string;
  }): Promise<{ summary: string; language: string; session: AgentSession }>;
  autoRenameSession(args: {
    provider: string;
    id: string;
  }): Promise<{
    title: string;
    previousTitle: string;
    session: AgentSession;
    nativeRenamed: boolean;
    nativeError?: string;
  }>;
  listMemory(opts?: {
    level?: string;
    limit?: number;
    fromMs?: number;
    toMs?: number;
  }): Promise<MemoryEntry[]>;
  listDailyDigests(limit?: number): Promise<MemoryEntry[]>;
  runDailyDigest(
    dateOrOpts?: string | { date?: string; forceResummarize?: boolean }
  ): Promise<RunDailyDigestResult>;
  needsDailyDigestRefresh(date?: string): Promise<DailyDigestRefreshCheck>;
  runWeeklyDigest(weekKey?: string): Promise<RunWeeklyDigestResult>;
  runMonthlyDigest(monthKey?: string): Promise<RunMonthlyDigestResult>;
  onDigestProgress(callback: (event: DigestProgressEvent) => void): () => void;
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
    memoryIds?: string[];
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
      todolistMarkdown?: string;
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
  usageSummary(args?: { days?: number }): Promise<{
    days: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    chatTokens: number;
    embeddingTokens: number;
    eventCount: number;
    bySource: Array<{ source: string; totalTokens: number; events: number }>;
    byDay: Array<{ day: string; totalTokens: number; events: number; scheduleRuns: number }>;
  }>;
  usageListEvents(args?: {
    limit?: number;
    source?: string;
    days?: number;
  }): Promise<
    Array<{
      id: string;
      createdAtMs: number;
      kind: string;
      source: string;
      jobKey?: string | null;
      model?: string | null;
      promptTokens?: number | null;
      completionTokens?: number | null;
      totalTokens?: number | null;
      durationMs?: number | null;
      ok: boolean;
      error?: string | null;
    }>
  >;
  usageListScheduleRuns(args?: {
    limit?: number;
    level?: string;
    days?: number;
  }): Promise<
    Array<{
      id: string;
      startedAtMs: number;
      finishedAtMs?: number | null;
      level: string;
      periodKey: string;
      trigger: string;
      status: string;
      error?: string | null;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    }>
  >;
}

const api: DesktopApi = {
  getPanelHome: () => ipcRenderer.invoke("panel:getHome"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  listSessions: (limit) => ipcRenderer.invoke("sessions:list", limit),
  listSessionsInRange: (args) => ipcRenderer.invoke("sessions:listInRange", args),
  previewSession: (args) => ipcRenderer.invoke("sessions:preview", args),
  summarizeSession: (args) => ipcRenderer.invoke("sessions:summarize", args),
  autoRenameSession: (args) => ipcRenderer.invoke("sessions:autoRename", args),
  listMemory: (opts) => ipcRenderer.invoke("memory:list", opts),
  listDailyDigests: (limit) => ipcRenderer.invoke("memory:listDaily", limit),
  runDailyDigest: (dateOrOpts) => {
    if (typeof dateOrOpts === "string" || dateOrOpts === undefined) {
      return ipcRenderer.invoke("memory:runDaily", { date: dateOrOpts });
    }
    return ipcRenderer.invoke("memory:runDaily", dateOrOpts);
  },
  needsDailyDigestRefresh: (date) => ipcRenderer.invoke("memory:needsDailyRefresh", date),
  runWeeklyDigest: (weekKey) => ipcRenderer.invoke("memory:runWeekly", weekKey),
  runMonthlyDigest: (monthKey) => ipcRenderer.invoke("memory:runMonthly", monthKey),
  onDigestProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: DigestProgressEvent) => {
      callback(progress);
    };
    ipcRenderer.on("memory:digestProgress", handler);
    return () => {
      ipcRenderer.removeListener("memory:digestProgress", handler);
    };
  },
  searchMemory: (args) => ipcRenderer.invoke("memory:search", args),
  askAgent: (args) => ipcRenderer.invoke("agent:ask", args),
  buildResumeCommand: (args) => ipcRenderer.invoke("agent:resumeCommand", args),
  buildHandoffBrief: (args) => ipcRenderer.invoke("agent:handoffBrief", args),
  previewMemoryGtdSync: (args) => ipcRenderer.invoke("workflow:previewMemoryGtdSync", args),
  applyMemoryGtdSync: (args) => ipcRenderer.invoke("workflow:applyMemoryGtdSync", args),
  previewBackfillDigests: (args) => ipcRenderer.invoke("workflow:previewBackfillDigests", args),
  backfillDigests: (args) => ipcRenderer.invoke("workflow:backfillDigests", args),
  usageSummary: (args) => ipcRenderer.invoke("usage:summary", args),
  usageListEvents: (args) => ipcRenderer.invoke("usage:listEvents", args),
  usageListScheduleRuns: (args) => ipcRenderer.invoke("usage:listScheduleRuns", args)
};

contextBridge.exposeInMainWorld("agentResume", api);
