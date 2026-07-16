import { clipboard, contextBridge, ipcRenderer } from "electron";
import type { UpdateCheckResult } from "../main/updateCheck";
import type {
  AgentSession,
  AgentChatMessage,
  AgentThread,
  AgentNoteAuditEvent,
  AgentChatResult,
  AgentStreamEvent,
  DigestProgressEvent,
  ReportEntry,
  ReportSearchHit,
  NoteIndexProgressEvent,
  PanelSettings,
  DailyDigestRefreshCheck,
  RunDailyDigestResult,
  RunMonthlyDigestResult,
  RunWeeklyDigestResult,
  AgentSessionSyncResult
} from "@agent-resume/core";

export interface DesktopApi {
  getPanelHome(): Promise<string>;
  getSettings(): Promise<PanelSettings>;
  saveSettings(
    settings: PanelSettings,
    options?: { triggerSync?: boolean }
  ): Promise<{ file: string; settings: PanelSettings; schedulerEnabled?: boolean; sync?: AgentSessionSyncResult }>;
  syncSessions(): Promise<AgentSessionSyncResult>;
  onSessionsSynced(callback: (result: AgentSessionSyncResult) => void): () => void;
  onSessionsSyncFailed(callback: (message: string) => void): () => void;
  countSessions(): Promise<{ total: number; visible: number; hidden: number }>;
  unhideAllSessions(): Promise<{
    restored: number;
    counts: { total: number; visible: number; hidden: number };
  }>;
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
    persist?: boolean;
  }): Promise<{
    title: string;
    previousTitle: string;
    session: AgentSession;
    nativeRenamed: boolean;
    nativeError?: string;
  }>;
  suggestSessionRename(args: {
    provider: string;
    id: string;
  }): Promise<{
    title: string;
    previousTitle: string;
  }>;
  renameSession(args: {
    provider: string;
    id: string;
    title: string;
  }): Promise<{
    session: AgentSession;
    nativeRenamed: boolean;
    nativeError?: string;
  }>;
  hideSession(args: { provider: string; id: string }): Promise<{ ok: boolean }>;
  createScratchDir(): Promise<string>;
  workbenchGetProjectEditor(): Promise<{
    selected: "auto" | "vscode" | "vscodium" | "cursor" | "windsurf";
    available: boolean;
    editor: {
      id: "vscode" | "vscodium" | "cursor" | "windsurf";
      label: string;
    } | null;
  }>;
  workbenchOpenProjectInEditor(args: { projectPath: string }): Promise<{
    ok: boolean;
    editor: {
      id: "vscode" | "vscodium" | "cursor" | "windsurf";
      label: string;
    };
  }>;
  workbenchOpenSession(args: {
    provider: string;
    id: string;
  }): Promise<{
    mode: string;
    command?: string;
    cwd: string;
    external?: boolean;
    session?: AgentSession;
  }>;
  workbenchOpenCodexApp(args: {
    provider: string;
    id: string;
  }): Promise<{
    mode: string;
    command?: string;
    cwd: string;
    external?: boolean;
    codexApp?: boolean;
    followUp?: string;
    followUpDelayMs?: number;
  }>;
  workbenchNewSession(args: {
    cwd: string;
    provider: string;
    useSystemTerminalOnly?: boolean;
  }): Promise<{ mode: string; command?: string; cwd: string }>;
  terminalSpawn(args: {
    cwd: string;
    command?: string;
    cols?: number;
    rows?: number;
  }): Promise<{ id: number }>;
  terminalInput(args: { id: number; data: string }): Promise<{ ok: boolean }>;
  terminalResize(args: { id: number; cols: number; rows: number }): Promise<{ ok: boolean }>;
  terminalDestroy(args: { id: number }): Promise<{ ok: boolean }>;
  terminalGitInfo(args: {
    cwd: string;
    nestedScan?: {
      maxDepth?: number;
      ignoreDirs?: string[];
      maxRepos?: number;
    };
  }): Promise<{
    mode: "none" | "direct" | "nested";
    isRepo: boolean;
    branch: string | null;
    repoRoot: string | null;
    nestedRepos: Array<{ root: string; displayPath: string; branch: string | null }>;
  }>;
  terminalGitBranches(args: {
    cwd: string;
    nestedScan?: {
      maxDepth?: number;
      ignoreDirs?: string[];
      maxRepos?: number;
    };
  }): Promise<{
    mode: "none" | "direct" | "nested";
    current?: string | null;
    branches?: string[];
    repoRoot?: string | null;
    repos?: Array<{
      root: string;
      displayPath: string;
      current: string | null;
      branches: string[];
    }>;
  }>;
  terminalGitCheckout(args: {
    cwd: string;
    branch: string;
    repoRoot?: string;
  }): Promise<{ branch: string | null; repoRoot?: string | null }>;
  terminalGitSuggestCommit(args: { repoRoot: string }): Promise<{
    message: string;
    source: "llm" | "heuristic";
  }>;
  terminalGitCommit(args: { repoRoot: string; message: string }): Promise<{ ok: boolean }>;
  terminalGitPush(args: { repoRoot: string }): Promise<{ ok: boolean }>;
  terminalGitPull(args: { repoRoot: string }): Promise<{ ok: boolean }>;
  workbenchListDirectory(args: {
    rootPath: string;
    dirPath: string;
  }): Promise<{
    entries: Array<{ name: string; path: string; isDirectory: boolean }>;
  }>;
  workbenchReadFileText(args: {
    rootPath: string;
    filePath: string;
    maxBytes?: number;
  }): Promise<{ content: string; truncated: boolean }>;
  workbenchRevealPath(args: {
    rootPath: string;
    targetPath: string;
  }): Promise<{ ok: boolean }>;
  terminalGitStatus(args: {
    cwd: string;
    nestedScan?: { maxDepth?: number; ignoreDirs?: string[]; maxRepos?: number };
  }): Promise<{
    isRepo: boolean;
    root: string | null;
    staged: Array<{
      path: string;
      repoPath: string;
      repoRoot: string;
      status: string;
      staged: boolean;
      unstaged: boolean;
    }>;
    unstaged: Array<{
      path: string;
      repoPath: string;
      repoRoot: string;
      status: string;
      staged: boolean;
      unstaged: boolean;
    }>;
    nestedRepos?: Array<{ root: string; displayPath: string }>;
    nestedScanDepth?: number;
  }>;
  terminalGitDiffSides(args: {
    cwd: string;
    path: string;
    staged?: boolean;
  }): Promise<{ oldLabel: string; newLabel: string; oldText: string; newText: string }>;
  onTerminalData(callback: (payload: { id: number; data: string }) => void): () => void;
  onTerminalExit(callback: (payload: { id: number }) => void): () => void;
  onTerminalRespawned(callback: (payload: { id: number }) => void): () => void;
  onWorkbenchCmdT(callback: () => void): () => void;
  listReports(opts?: {
    level?: string;
    limit?: number;
    fromMs?: number;
    toMs?: number;
  }): Promise<ReportEntry[]>;
  getReportEntry(reportId: string): Promise<ReportEntry | null>;
  listDailyDigests(limit?: number): Promise<ReportEntry[]>;
  runDailyDigest(
    dateOrOpts?: string | { date?: string; forceResummarize?: boolean }
  ): Promise<RunDailyDigestResult>;
  needsDailyDigestRefresh(date?: string): Promise<DailyDigestRefreshCheck>;
  needsWeeklyDigestRefresh(weekKey?: string): Promise<DailyDigestRefreshCheck>;
  needsMonthlyDigestRefresh(monthKey?: string): Promise<DailyDigestRefreshCheck>;
  runWeeklyDigest(weekKey?: string): Promise<RunWeeklyDigestResult>;
  runMonthlyDigest(monthKey?: string): Promise<RunMonthlyDigestResult>;
  onDigestProgress(callback: (event: DigestProgressEvent) => void): () => void;
  searchReports(args: {
    query: string;
    level?: string;
    limit?: number;
  }): Promise<ReportSearchHit[]>;
  askAgent(args: {
    query: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    threadId?: string;
    enableTools?: boolean;
  }): Promise<AgentChatResult>;
  cancelAskAgent(): Promise<{ ok: boolean }>;
  listAgentChat(args?: { limit?: number; threadId?: string }): Promise<{
    messages: AgentChatMessage[];
    hasMore: boolean;
  }>;
  listOlderAgentChat(args: {
    beforeSortOrder: number;
    limit?: number;
    threadId?: string;
  }): Promise<{
    messages: AgentChatMessage[];
    hasMore: boolean;
  }>;
  clearAgentChat(args?: { threadId?: string }): Promise<{ ok: boolean }>;
  listAgentThreads(): Promise<AgentThread[]>;
  createAgentThread(args: { title: string }): Promise<AgentThread>;
  renameAgentThread(args: { id: string; title: string }): Promise<{ ok: boolean }>;
  deleteAgentThread(args: { id: string }): Promise<{ ok: boolean }>;
  listAgentNoteAudit(args?: {
    limit?: number;
    noteId?: string;
    traceId?: string;
    status?: string;
  }): Promise<AgentNoteAuditEvent[]>;
  onAskStream(callback: (event: AgentStreamEvent) => void): () => void;
  onNotesIndexProgress(callback: (event: NoteIndexProgressEvent) => void): () => void;
  previewReportGtdSync(args?: {
    ensureDigests?: boolean;
    reportIds?: string[];
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
      sourceReportIds: string[];
      todolistPreview: string;
    }>;
    skipped: string[];
    warnings: string[];
    ensureDigest?: { ran: boolean; jobKey?: string };
  }>;
  applyReportGtdSync(args: {
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
  notesList(): Promise<
    Array<{
      noteId: string;
      scope: string;
      provider?: string;
      agentSessionId?: string;
      projectPath?: string;
      filename: string;
      relDir: string;
      relMdPath: string;
      title?: string;
      contentPreview?: string;
      createdAtMs: number;
      updatedAtMs: number;
      fsMtimeMs?: number;
    }>
  >;
  notesRead(args: { noteId: string }): Promise<{
    record: {
      noteId: string;
      scope: string;
      provider?: string;
      agentSessionId?: string;
      projectPath?: string;
      filename: string;
      relDir: string;
      relMdPath: string;
      title?: string;
      contentPreview?: string;
      createdAtMs: number;
      updatedAtMs: number;
      fsMtimeMs?: number;
    };
    content: string;
  }>;
  notesWrite(args: { noteId: string; content: string }): Promise<{
    noteId: string;
    filename: string;
    updatedAtMs: number;
  }>;
  notesCreate(args: {
    scope: "library" | "project" | "session";
    projectPath?: string;
    provider?: string;
    sessionId?: string;
  }): Promise<{ noteId: string; filename: string }>;
  notesMove(args: {
    noteId: string;
    owner: {
      scope: "library" | "project" | "session";
      projectPath?: string;
      provider?: string;
      sessionId?: string;
    };
  }): Promise<{ noteId: string; filename: string; scope: string }>;
  notesDelete(args: { noteId: string }): Promise<{ ok: boolean }>;
  notesRename(args: { noteId: string; filename: string }): Promise<{ noteId: string; filename: string }>;
  notesImport(owner: {
    scope: "library" | "project" | "session";
    projectPath?: string;
    provider?: string;
    sessionId?: string;
  }): Promise<{ imported: number; skipped: number; errors: string[] }>;
  notesClipboardHasImage(): boolean;
  notesPasteImage(args: { noteId: string }): Promise<{ snippet: string } | null>;
  notesOpenFolder(): Promise<{ ok: boolean }>;
  settingsOpenPanelHome(): Promise<{ ok: boolean }>;
  notesReveal(args: { noteId: string }): Promise<{ ok: boolean }>;
  notesCopyPath(args: { noteId: string }): Promise<{ path: string }>;
  listProjectAliases(): Promise<Record<string, string>>;
  setProjectAlias(args: { projectPath: string; alias: string }): Promise<{ ok: boolean }>;
  getI18nBundle(): Promise<{ locale: string; messages: Record<string, string> }>;
  getAppVersion(): Promise<string>;
  checkForUpdate(options?: { force?: boolean }): Promise<UpdateCheckResult>;
  openExternalUrl(url: string): Promise<void>;
  onLocaleChanged(callback: (bundle: { locale: string; messages: Record<string, string> }) => void): () => void;
}

const api: DesktopApi = {
  getPanelHome: () => ipcRenderer.invoke("panel:getHome"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings, options) => ipcRenderer.invoke("settings:save", settings, options),
  syncSessions: () => ipcRenderer.invoke("sessions:sync"),
  countSessions: () => ipcRenderer.invoke("sessions:count"),
  unhideAllSessions: () => ipcRenderer.invoke("sessions:unhideAll"),
  onSessionsSynced: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, result: AgentSessionSyncResult) => callback(result);
    ipcRenderer.on("sessions:synced", handler);
    return () => ipcRenderer.removeListener("sessions:synced", handler);
  },
  onSessionsSyncFailed: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on("sessions:syncFailed", handler);
    return () => ipcRenderer.removeListener("sessions:syncFailed", handler);
  },
  listSessions: (limit) => ipcRenderer.invoke("sessions:list", limit),
  listSessionsInRange: (args) => ipcRenderer.invoke("sessions:listInRange", args),
  previewSession: (args) => ipcRenderer.invoke("sessions:preview", args),
  summarizeSession: (args) => ipcRenderer.invoke("sessions:summarize", args),
  autoRenameSession: (args) => ipcRenderer.invoke("sessions:autoRename", args),
  suggestSessionRename: (args) => ipcRenderer.invoke("sessions:suggestRename", args),
  renameSession: (args) => ipcRenderer.invoke("sessions:rename", args),
  hideSession: (args) => ipcRenderer.invoke("sessions:hide", args),
  createScratchDir: () => ipcRenderer.invoke("workbench:createScratchDir"),
  workbenchGetProjectEditor: () => ipcRenderer.invoke("workbench:getProjectEditor"),
  workbenchOpenProjectInEditor: (args) => ipcRenderer.invoke("workbench:openProjectInEditor", args),
  workbenchOpenSession: (args) => ipcRenderer.invoke("workbench:openSession", args),
  workbenchOpenCodexApp: (args) => ipcRenderer.invoke("workbench:openCodexApp", args),
  workbenchNewSession: (args) => ipcRenderer.invoke("workbench:newSession", args),
  terminalSpawn: (args) => ipcRenderer.invoke("terminal:spawn", args),
  terminalInput: (args) => ipcRenderer.invoke("terminal:input", args),
  terminalResize: (args) => ipcRenderer.invoke("terminal:resize", args),
  terminalDestroy: (args) => ipcRenderer.invoke("terminal:destroy", args),
  terminalGitInfo: (args) => ipcRenderer.invoke("terminal:gitInfo", args),
  terminalGitBranches: (args) => ipcRenderer.invoke("terminal:gitBranches", args),
  terminalGitCheckout: (args) => ipcRenderer.invoke("terminal:gitCheckout", args),
  workbenchListDirectory: (args) => ipcRenderer.invoke("workbench:listDirectory", args),
  workbenchReadFileText: (args) => ipcRenderer.invoke("workbench:readFileText", args),
  workbenchRevealPath: (args) => ipcRenderer.invoke("workbench:revealPath", args),
  terminalGitStatus: (args) => ipcRenderer.invoke("terminal:gitStatus", args),
  terminalGitDiffSides: (args) => ipcRenderer.invoke("terminal:gitDiffSides", args),
  terminalGitSuggestCommit: (args) => ipcRenderer.invoke("terminal:gitSuggestCommit", args),
  terminalGitCommit: (args) => ipcRenderer.invoke("terminal:gitCommit", args),
  terminalGitPush: (args) => ipcRenderer.invoke("terminal:gitPush", args),
  terminalGitPull: (args) => ipcRenderer.invoke("terminal:gitPull", args),
  onTerminalData: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { id: number; data: string }) =>
      callback(payload);
    ipcRenderer.on("terminal:data", handler);
    return () => ipcRenderer.removeListener("terminal:data", handler);
  },
  onTerminalExit: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { id: number }) => callback(payload);
    ipcRenderer.on("terminal:exit", handler);
    return () => ipcRenderer.removeListener("terminal:exit", handler);
  },
  onTerminalRespawned: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { id: number }) => callback(payload);
    ipcRenderer.on("terminal:respawned", handler);
    return () => ipcRenderer.removeListener("terminal:respawned", handler);
  },
  onWorkbenchCmdT: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("workbench:cmdT", handler);
    return () => ipcRenderer.removeListener("workbench:cmdT", handler);
  },
  listReports: (opts) => ipcRenderer.invoke("report:list", opts),
  getReportEntry: (reportId) => ipcRenderer.invoke("report:getEntry", reportId),
  listDailyDigests: (limit) => ipcRenderer.invoke("report:listDaily", limit),
  runDailyDigest: (dateOrOpts) => {
    if (typeof dateOrOpts === "string" || dateOrOpts === undefined) {
      return ipcRenderer.invoke("report:runDaily", { date: dateOrOpts });
    }
    return ipcRenderer.invoke("report:runDaily", dateOrOpts);
  },
  needsDailyDigestRefresh: (date) => ipcRenderer.invoke("report:needsDailyRefresh", date),
  needsWeeklyDigestRefresh: (weekKey) => ipcRenderer.invoke("report:needsWeeklyRefresh", weekKey),
  needsMonthlyDigestRefresh: (monthKey) => ipcRenderer.invoke("report:needsMonthlyRefresh", monthKey),
  runWeeklyDigest: (weekKey) => ipcRenderer.invoke("report:runWeekly", weekKey),
  runMonthlyDigest: (monthKey) => ipcRenderer.invoke("report:runMonthly", monthKey),
  onDigestProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: DigestProgressEvent) => {
      callback(progress);
    };
    ipcRenderer.on("report:digestProgress", handler);
    return () => {
      ipcRenderer.removeListener("report:digestProgress", handler);
    };
  },
  searchReports: (args) => ipcRenderer.invoke("report:search", args),
  askAgent: (args) => ipcRenderer.invoke("agent:ask", args),
  cancelAskAgent: () => ipcRenderer.invoke("agent:cancelAsk"),
  listAgentChat: (args) => ipcRenderer.invoke("agent:listAgentChat", args),
  listOlderAgentChat: (args) => ipcRenderer.invoke("agent:listOlderAgentChat", args),
  clearAgentChat: (args) => ipcRenderer.invoke("agent:clearAgentChat", args),
  listAgentThreads: () => ipcRenderer.invoke("agent:listThreads"),
  createAgentThread: (args) => ipcRenderer.invoke("agent:createThread", args),
  renameAgentThread: (args) => ipcRenderer.invoke("agent:renameThread", args),
  deleteAgentThread: (args) => ipcRenderer.invoke("agent:deleteThread", args),
  listAgentNoteAudit: (args) => ipcRenderer.invoke("agent:listAgentNoteAudit", args),
  onAskStream: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, streamEvent: AgentStreamEvent) => {
      callback(streamEvent);
    };
    ipcRenderer.on("agent:askStream", handler);
    return () => {
      ipcRenderer.removeListener("agent:askStream", handler);
    };
  },
  onNotesIndexProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: NoteIndexProgressEvent) => {
      callback(progress);
    };
    ipcRenderer.on("notes:indexProgress", handler);
    return () => {
      ipcRenderer.removeListener("notes:indexProgress", handler);
    };
  },
  previewReportGtdSync: (args) => ipcRenderer.invoke("workflow:previewReportGtdSync", args),
  applyReportGtdSync: (args) => ipcRenderer.invoke("workflow:applyReportGtdSync", args),
  previewBackfillDigests: (args) => ipcRenderer.invoke("workflow:previewBackfillDigests", args),
  backfillDigests: (args) => ipcRenderer.invoke("workflow:backfillDigests", args),
  usageSummary: (args) => ipcRenderer.invoke("usage:summary", args),
  usageListEvents: (args) => ipcRenderer.invoke("usage:listEvents", args),
  usageListScheduleRuns: (args) => ipcRenderer.invoke("usage:listScheduleRuns", args),
  notesList: () => ipcRenderer.invoke("notes:list"),
  notesRead: (args) => ipcRenderer.invoke("notes:read", args),
  notesWrite: (args) => ipcRenderer.invoke("notes:write", args),
  notesCreate: (args) => ipcRenderer.invoke("notes:create", args),
  notesMove: (args) => ipcRenderer.invoke("notes:move", args),
  notesDelete: (args) => ipcRenderer.invoke("notes:delete", args),
  notesRename: (args) => ipcRenderer.invoke("notes:rename", args),
  notesImport: (owner) => ipcRenderer.invoke("notes:import", owner),
  notesClipboardHasImage: () => !clipboard.readImage().isEmpty(),
  notesPasteImage: (args) => ipcRenderer.invoke("notes:pasteImage", args),
  notesOpenFolder: () => ipcRenderer.invoke("notes:openFolder"),
  settingsOpenPanelHome: () => ipcRenderer.invoke("settings:openPanelHome"),
  notesReveal: (args) => ipcRenderer.invoke("notes:reveal", args),
  notesCopyPath: (args) => ipcRenderer.invoke("notes:copyPath", args),
  listProjectAliases: () => ipcRenderer.invoke("projects:listAliases"),
  setProjectAlias: (args) => ipcRenderer.invoke("projects:setAlias", args),
  getI18nBundle: () => ipcRenderer.invoke("i18n:getBundle"),
  getAppVersion: async () => {
    const result = (await ipcRenderer.invoke("app:getVersion")) as { version?: string };
    return typeof result?.version === "string" ? result.version : "";
  },
  checkForUpdate: (options) => ipcRenderer.invoke("update:check", options),
  openExternalUrl: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  onLocaleChanged: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      bundle: { locale: string; messages: Record<string, string> }
    ) => callback(bundle);
    ipcRenderer.on("i18n:localeChanged", handler);
    return () => ipcRenderer.removeListener("i18n:localeChanged", handler);
  }
};

contextBridge.exposeInMainWorld("agentResume", api);
