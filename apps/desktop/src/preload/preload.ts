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
  DigestGenerationEstimate,
  ReportEntry,
  ReportLinkRow,
  ReportSearchHit,
  NoteIndexProgressEvent,
  PanelSettings,
  DailyDigestRefreshCheck,
  RunDailyDigestResult,
  RunMonthlyDigestResult,
  RunWeeklyDigestResult,
  AgentSessionSyncResult,
  AgentToolDescriptor,
  GtdEvidence,
  GtdStatus,
  WorkbenchSessionFolder,
  WorkbenchSessionFolderAssignment
} from "@agent-resume/core";
import type { McpClientInfo } from "../main/mcpRegistration";
import type { BackupPreview, BackupProgressEvent, BackupResult, BackupStorageTarget, BackupStorageTargetStatus, BackupStoredItem } from "../main/backupService";
import type { GitDiffHunk, GitDiffHunkTarget, GitDiffLineTarget } from "../main/workbenchGitDiff";
import type { ModelTestKind, ModelsTestDraft, TestModelConnectionResult } from "../main/settingsTestModel";
import type { WorkbenchFileSystemChangedEvent } from "../main/workbenchWatcher";
import type { FlowAdvanceResult, FlowDefinition, FlowGraphEdgeInput, FlowGraphNodeInput, FlowNodeStatus, FlowResultStatus, FlowRun, FlowTemplate, FlowWorkflow } from "../shared/flowTypes";
import type {
  LinkGraphAnalyzeArgs,
  LinkGraphAnalyzeResult,
  LinkGraphProgressEvent
} from "../shared/linkGraphTypes";
import type { WorkbenchArrowDirection } from "../shared/workbenchShortcuts";

export type {
  BrowserIpcEvent,
  BrowserPolicyState,
  BrowserSessionState,
  BrowserSurfaceState,
  BrowserTabStateDto
} from "../shared/browserTypes";
import type {
  BrowserIpcEvent,
  BrowserPolicyState,
  BrowserSessionState
} from "../shared/browserTypes";

export interface DesktopApi {
  getPanelHome(): Promise<string>;
  getSettings(): Promise<PanelSettings>;
  backupTargetStatus(): Promise<BackupStorageTargetStatus[]>;
  backupListIcloud(): Promise<BackupStoredItem[]>;
  backupExport(args: { target: BackupStorageTarget; includeCredentials: boolean; includeNativeConversations: boolean; password?: string }): Promise<BackupResult>;
  backupSelectImport(): Promise<BackupPreview | null>;
  backupSelectIcloudImport(args: { backupId: string; password: string }): Promise<BackupPreview>;
  onBackupProgress(callback: (event: BackupProgressEvent) => void): () => void;
  backupImport(args: {
    importToken: string;
    includeCredentials: boolean;
    restoreNativeConversations: boolean;
    password?: string;
  }): Promise<BackupResult>;
  listMcpClients(): Promise<McpClientInfo[]>;
  getMcpManualConfig(): Promise<string>;
  registerMcpClient(args: { clientId: McpClientInfo["id"]; replace?: boolean }): Promise<{ ok: boolean }>;
  removeMcpClient(args: { clientId: McpClientInfo["id"] }): Promise<{ ok: boolean }>;
  registerAllMcpClients(args?: { replace?: boolean }): Promise<{
    registered: string[];
    failed: Array<{ clientId: string; error: string }>;
  }>;
  saveSettings(
    settings: PanelSettings,
    options?: { triggerSync?: boolean; section?: string }
  ): Promise<{ file: string; settings: PanelSettings; schedulerEnabled?: boolean; sync?: AgentSessionSyncResult }>;
  /** Probe Tool / Chat / Embedding using current Models form values (Save not required). */
  testModelConnection(args: {
    kind: ModelTestKind;
    draft: ModelsTestDraft;
  }): Promise<TestModelConnectionResult>;
  openSettingsWindow(options?: { pane?: string }): Promise<void>;
  closeSettingsWindow(): Promise<{ ok: boolean }>;
  onOpenSessions(callback: () => void): () => void;
  /** Open an existing note in a standalone floating window (same surface as ⌘/Ctrl+D). */
  standaloneNoteOpen(args: {
    noteId: string;
    x?: number;
    y?: number;
    /** When true, ignore drops that end inside the main window (used by list drag-out). */
    requireOutsideMainWindow?: boolean;
  }): Promise<{ ok: true } | { ok: false; reason: "inside-window" }>;
  /** Currently open floating note windows (for the nav-rail dots). */
  standaloneNoteList(): Promise<Array<{ noteId: string; title: string }>>;
  onStandaloneNotesChanged(callback: (notes: Array<{ noteId: string; title: string }>) => void): () => void;
  standaloneNoteGetState(): Promise<{ noteId: string; pinned: boolean }>;
  standaloneNoteSetAlwaysOnTop(args: { pinned: boolean }): Promise<{ pinned: boolean }>;
  standaloneNoteClose(): Promise<{ ok: boolean }>;
  standaloneNoteCloseReady(args: { ok: boolean }): Promise<{ ok: boolean }>;
  onStandaloneNoteCloseRequested(callback: () => void): () => void;
  browserCreate(args: {
    projectPath: string;
    startUrl?: string;
    boundRecordId?: string;
    surface?: "workbench" | "window";
  }): Promise<BrowserSessionState>;
  browserDestroy(args: { browserId: string }): Promise<{ ok: boolean }>;
  browserList(): Promise<BrowserSessionState[]>;
  browserGet(args: { browserId: string }): Promise<BrowserSessionState | null>;
  browserAttachBounds(args: {
    browserId: string;
    rect: { x: number; y: number; width: number; height: number };
    windowId?: number;
  }): Promise<{ ok: boolean }>;
  browserSetVisible(args: { browserId: string; visible: boolean }): Promise<{ ok: boolean }>;
  browserSetSurface(args: {
    browserId: string;
    surface: "workbench" | "window";
    bounds?: { x: number; y: number; width: number; height: number };
  }): Promise<BrowserSessionState>;
  browserFocus(args: { browserId: string }): Promise<{ ok: boolean }>;
  browserNavigate(args: { browserId: string; url: string; tabId?: string }): Promise<BrowserSessionState>;
  browserBack(args: { browserId: string; tabId?: string }): Promise<BrowserSessionState>;
  browserForward(args: { browserId: string; tabId?: string }): Promise<BrowserSessionState>;
  browserReload(args: { browserId: string; tabId?: string }): Promise<BrowserSessionState>;
  browserStop(args: { browserId: string; tabId?: string }): Promise<BrowserSessionState>;
  browserNewTab(args: { browserId: string; url?: string }): Promise<BrowserSessionState>;
  browserCloseTab(args: { browserId: string; tabId: string }): Promise<{ session: BrowserSessionState | null; destroyed: boolean }>;
  browserActivateTab(args: { browserId: string; tabId: string }): Promise<BrowserSessionState>;
  browserSetPolicy(args: { browserId: string; policy: Partial<BrowserPolicyState> }): Promise<BrowserSessionState>;
  browserClearCookies(args: { browserId: string; hosts?: string[] }): Promise<BrowserSessionState>;
  onBrowserEvent(callback: (event: BrowserIpcEvent) => void): () => void;
  onSettingsNavigate(callback: (payload: { pane: string }) => void): () => void;
  onSettingsChanged(
    callback: (payload: {
      settings: PanelSettings;
      section?: string;
      sync?: AgentSessionSyncResult;
    }) => void
  ): () => void;
  syncSessions(): Promise<AgentSessionSyncResult>;
  notifyRendererReady(): void;
  onSessionsSynced(callback: (result: AgentSessionSyncResult) => void): () => void;
  onSessionsSyncFailed(callback: (message: string) => void): () => void;
  countSessions(): Promise<{ total: number; visible: number; hidden: number }>;
  unhideAllSessions(): Promise<{
    restored: number;
    counts: { total: number; visible: number; hidden: number };
  }>;
  querySessionsPage(args?: {
    limit?: number;
    cursor?: { updatedAt: number; provider: string; id: string };
    search?: string;
    provider?: string;
    fromMs?: number;
    toMs?: number;
    projectPath?: string;
    projectId?: string;
    gtdStatus?: GtdStatus;
    tag?: string;
    keys?: Array<{ provider: string; id: string }>;
  }): Promise<{
    sessions: AgentSession[];
    total: number;
    nextCursor?: { updatedAt: number; provider: string; id: string };
  }>;
  listSessionGtdStatuses(): Promise<Record<string, GtdStatus>>;
  setSessionGtdStatus(args: {
    provider: string;
    id: string;
    status: GtdStatus | null;
  }): Promise<{ ok: boolean }>;
  listTags(args?: {
    category?: string;
    status?: "active" | "obsolete" | "all";
    entityType?: "session" | "note" | "all";
    minWeight?: number;
    query?: string;
    sortBy?: "weight" | "count" | "recency" | "alpha";
    limit?: number;
    offset?: number;
  }): Promise<
    Array<{
      tag: string;
      normalizedTag: string;
      category: string;
      sessionCount: number;
      noteCount: number;
      activeEntityCount: number;
      totalHits: number;
      globalWeight: number;
      status: string;
      pinned: boolean;
      updatedAtMs: number;
    }>
  >;
  searchTags(args: {
    query: string;
    category?: string;
    status?: "active" | "obsolete" | "all";
    limit?: number;
  }): Promise<
    Array<{
      tag: string;
      normalizedTag: string;
      category: string;
      activeEntityCount: number;
      globalWeight: number;
      status: string;
    }>
  >;
  listTagEntities(args: {
    tag: string;
    entityType?: "session" | "note" | "all";
    includeObsolete?: boolean;
    limit?: number;
  }): Promise<
    Array<{
      entityType: "session" | "note";
      entityId: string;
      weight: number;
      hitCount: number;
      status: string;
      updatedAtMs: number;
    }>
  >;
  getEntityTags(args: {
    entityType: "session" | "note";
    entityId?: string;
    provider?: string;
    sessionId?: string;
    noteId?: string;
    includeObsolete?: boolean;
  }): Promise<
    Array<{
      tag: string;
      normalizedTag: string;
      category: string;
      weight: number;
      hitCount: number;
      consensusCount: number;
      status: string;
      source: string;
    }>
  >;
  addEntityTag(args: {
    entityType: "session" | "note";
    entityId?: string;
    provider?: string;
    sessionId?: string;
    noteId?: string;
    tag: string;
    category?: string;
  }): Promise<{ ok: boolean; tag?: unknown }>;
  removeEntityTag(args: {
    entityType: "session" | "note";
    entityId?: string;
    provider?: string;
    sessionId?: string;
    noteId?: string;
    tag: string;
    hardDelete?: boolean;
  }): Promise<{ ok: boolean; removed: boolean }>;
  recordEntityTagHits(args: {
    entityType: "session" | "note";
    entityId?: string;
    provider?: string;
    sessionId?: string;
    noteId?: string;
  }): Promise<{ ok: boolean; count: number }>;
  retagEntity(args: {
    entityType: "session" | "note";
    entityId?: string;
    provider?: string;
    sessionId?: string;
    noteId?: string;
  }): Promise<{ ok: boolean; tags: unknown[] }>;
  sweepTagDecay(): Promise<{ ok: boolean; scanned: number; markedObsolete: number }>;
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
  moveSessionToProject(args: {
    provider: string;
    id: string;
    targetProjectPath: string;
  }): Promise<{
    provider: string;
    sessionId: string;
    moved: boolean;
    fromProjectId: string | null;
    toProjectId: string;
    oldPath: string;
    newPath: string;
    /** True when the provider's native cwd was also rewritten (physical move). */
    nativeUpdated: boolean;
  }>;
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
    acp?: { chatId: string; provider: string; title?: string };
    session?: AgentSession;
  }>;
  /** Agent tool/citation resume when terminal mode is xterm — open Workbench terminal. */
  onWorkbenchResumeFromAgent(
    callback: (payload: {
      provider: string;
      id: string;
      command: string;
      cwd: string;
      title?: string;
      projectPath?: string;
      mode?: string;
    }) => void
  ): () => void;
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
    executionMode: "standard" | "note-yolo";
    useSystemTerminalOnly?: boolean;
    noteId?: string;
    initialPrompt?: string;
  }): Promise<{
    mode: string;
    command?: string;
    cwd: string;
    external?: boolean;
    copied?: boolean;
  }>;
  listWorkbenchSessionFolders(args: { projectId: string }): Promise<{
    folders: WorkbenchSessionFolder[];
    assignments: WorkbenchSessionFolderAssignment[];
  }>;
  listAllWorkbenchSessionFolders(): Promise<Record<string, {
    folders: WorkbenchSessionFolder[];
    assignments: WorkbenchSessionFolderAssignment[];
  }>>;
  createWorkbenchSessionFolder(args: {
    projectId: string;
    parentId?: string | null;
    name: string;
  }): Promise<WorkbenchSessionFolder>;
  renameWorkbenchSessionFolder(args: { folderId: string; name: string }): Promise<WorkbenchSessionFolder>;
  deleteWorkbenchSessionFolder(args: { folderId: string }): Promise<{
    folderId: string;
    projectId: string;
    parentId: string | null;
  }>;
  assignWorkbenchSessionToFolder(args: {
    projectId: string;
    provider: string;
    agentSessionId: string;
    folderId: string;
  }): Promise<WorkbenchSessionFolderAssignment>;
  removeWorkbenchSessionFromFolder(args: {
    provider: string;
    agentSessionId: string;
  }): Promise<{ ok: true }>;
  /** ACP visual chat (Workbench). */
  acpListSessions(args?: { projectPath?: string }): Promise<
    Array<{
      id: string;
      title: string;
      projectPath: string;
      provider: string;
      acpSessionId?: string;
      currentModeId?: string;
      createdAt: number;
      updatedAt: number;
      messageCount: number;
    }>
  >;
  acpCreateSession(args: {
    projectPath: string;
    provider: string;
  }): Promise<{
    id: string;
    title: string;
    projectPath: string;
    provider: string;
    acpSessionId?: string;
    currentModeId?: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
  }>;
  acpGetSession(args: { chatId: string }): Promise<{
    id: string;
    title: string;
    projectPath: string;
    provider: string;
    acpSessionId?: string;
    currentModeId?: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
  } | null>;
  acpDeleteSession(args: { chatId: string }): Promise<{ ok: boolean }>;
  acpRenameSession(args: { chatId: string; title: string }): Promise<{
    id: string;
    title: string;
    projectPath: string;
    provider: string;
    acpSessionId?: string;
    currentModeId?: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
  }>;
  acpLoadMessages(args: { chatId: string }): Promise<
    Array<{
      id: string;
      role: string;
      text: string;
      timestamp: number;
      images?: Array<{ id: string; mimeType: string; fileName: string; storagePath: string }>;
      files?: Array<{
        id: string;
        mimeType: string;
        fileName: string;
        absolutePath?: string;
        storagePath?: string;
        sizeBytes?: number;
      }>;
      toolCalls?: Array<{
        toolCallId: string;
        title: string;
        kind: string;
        status: string;
        locations?: Array<{ path: string; line?: number }>;
        content?: unknown[];
        rawInput?: unknown;
        rawOutput?: unknown;
      }>;
    }>
  >;
  acpConnect(args: {
    chatId: string;
    force?: boolean;
  }): Promise<{
    ok: boolean;
    reused?: boolean;
    record: {
      id: string;
      title: string;
      projectPath: string;
      provider: string;
      acpSessionId?: string;
      currentModeId?: string;
      createdAt: number;
      updatedAt: number;
      messageCount: number;
    };
  }>;
  acpPrompt(args: {
    chatId: string;
    text?: string;
    images?: Array<{ mimeType: string; fileName: string; data: string }>;
    files?: Array<{
      mimeType: string;
      fileName: string;
      absolutePath?: string;
      data?: string;
      sizeBytes?: number;
    }>;
  }): Promise<{ ok: boolean }>;
  acpCancel(args: { chatId: string }): Promise<{ ok: boolean }>;
  acpSetMode(args: { chatId: string; modeId: string }): Promise<{ ok: boolean }>;
  acpSetConfigOption(args: {
    chatId: string;
    configId: string;
    value: string | boolean;
  }): Promise<{ ok: boolean }>;
  acpRespondPermission(args: {
    requestId: string;
    optionId?: string;
    cancelled?: boolean;
  }): Promise<{ ok: boolean }>;
  acpRespondQuestion(args: {
    requestId: string;
    cancelled?: boolean;
    answers?: Record<string, string>;
  }): Promise<{ ok: boolean }>;
  acpReadPlanFile(args: { path: string }): Promise<{ content: string; path: string }>;
  acpOpenPath(args: { path: string }): Promise<{ ok: boolean }>;
  acpDisconnect(args: { chatId: string }): Promise<{ ok: boolean }>;
  onAcpStream(callback: (event: Record<string, unknown>) => void): () => void;
  terminalSpawn(args: {
    cwd: string;
    command?: string;
    cols?: number;
    rows?: number;
  }): Promise<{ id: number; count?: number; softLimit?: number; warnSoftLimit?: boolean }>;
  terminalAttach(args: { id: number }): Promise<{ ok: boolean; replay: string }>;
  terminalDetach(args: { id: number }): Promise<{ ok: boolean }>;
  terminalInput(args: { id: number; data: string }): Promise<{ ok: boolean }>;
  terminalResize(args: { id: number; cols: number; rows: number }): Promise<{ ok: boolean }>;
  terminalDestroy(args: { id: number }): Promise<{ ok: boolean }>;
  workbenchGetRuntimeMetrics(): Promise<{
    watcherCount: number;
    pollingCount: number;
    activeCount: number;
    pty: {
      count: number;
      attachedCount: number;
      replayBytes: number;
      outputBytes: number;
      forwardedBytes: number;
    };
    acp: {
      count: number;
      liveCount: number;
    };
  }>;
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
    localBranches?: string[];
    remoteBranches?: Array<{ remote: string; name: string; fullName: string }>;
    repoRoot?: string | null;
    repos?: Array<{
      root: string;
      displayPath: string;
      current: string | null;
      branches: string[];
      localBranches: string[];
      remoteBranches: Array<{ remote: string; name: string; fullName: string }>;
    }>;
  }>;
  terminalGitCheckout(args: {
    cwd: string;
    branch: string;
    remote?: string;
    repoRoot?: string;
  }): Promise<{ branch: string | null; repoRoot?: string | null }>;
  terminalGitSuggestCommit(args: { repoRoot: string; paths: string[] }): Promise<{
    message: string;
    source: "llm" | "heuristic";
    fallbackReason?: "unconfigured" | "request-failed";
  }>;
  terminalGitCommit(args: { repoRoot: string; message: string; paths?: string[] }): Promise<{ ok: boolean; skipped?: string[] }>;
  terminalGitPush(args: { repoRoot: string }): Promise<{ ok: boolean }>;
  terminalGitPull(args: { repoRoot: string }): Promise<{ ok: boolean }>;
  terminalGitFetch(args: { repoRoot: string }): Promise<{ ok: boolean }>;
  terminalGitStage(args: { repoRoot: string; paths: string[] }): Promise<{ ok: boolean }>;
  terminalGitUnstage(args: { repoRoot: string; paths: string[] }): Promise<{ ok: boolean }>;
  terminalGitLog(args: {
    repoRoot: string;
    limit?: number;
  }): Promise<{
    commits: Array<{
      hash: string;
      shortHash: string;
      author: string;
      date: number;
      subject: string;
      parents: string[];
      decorations: string;
      refs: {
        heads: string[];
        remotes: string[];
        tags: string[];
        isHead: boolean;
        primaryLabel: string | null;
      };
      pathAtCommit: string;
    }>;
    layout: {
      laneWidth: number;
      rowHeight: number;
      maxColumns: number;
      columnColors: number[];
      rows: Array<{
        index: number;
        commitColumn?: number;
        incomingTracks: number[];
        outgoingTracks: number[];
        curves: Array<{
          fromCol: number;
          toCol: number;
          side: "left" | "right";
          colorIndex: number;
        }>;
        colorIndex: number;
        isHead: boolean;
        laneLabel?: string;
        laneLabelColorIndex?: number;
      }>;
    };
  }>;
  workbenchGitFileLog(args: {
    rootPath: string;
    filePath: string;
    limit?: number;
  }): Promise<{
    repoRoot: string;
    repoPath: string;
    commits: Array<{
      hash: string;
      shortHash: string;
      author: string;
      date: number;
      subject: string;
      parents: string[];
      decorations: string;
      refs: {
        heads: string[];
        remotes: string[];
        tags: string[];
        isHead: boolean;
        primaryLabel: string | null;
      };
      pathAtCommit: string;
    }>;
    layout: {
      laneWidth: number;
      rowHeight: number;
      maxColumns: number;
      columnColors: number[];
      rows: Array<{
        index: number;
        commitColumn?: number;
        incomingTracks: number[];
        outgoingTracks: number[];
        curves: Array<{
          fromCol: number;
          toCol: number;
          side: "left" | "right";
          colorIndex: number;
        }>;
        colorIndex: number;
        isHead: boolean;
        laneLabel?: string;
        laneLabelColorIndex?: number;
      }>;
    };
  }>;
  terminalGitShow(args: {
    repoRoot: string;
    hash: string;
  }): Promise<{
    hash: string;
    shortHash: string;
    author: string;
    date: number;
    subject: string;
    body: string;
    files: Array<{ status: string; path: string; oldPath?: string }>;
  }>;
  terminalGitShowFileDiffSides(args: {
    repoRoot: string;
    hash: string;
    path: string;
  }): Promise<{ oldLabel: string; newLabel: string; oldText: string; newText: string; hunks: GitDiffHunk[] }>;
  terminalGitRevert(args: { repoRoot: string; hash: string }): Promise<{ ok: boolean }>;
  terminalGitMerge(args: { repoRoot: string; hash: string }): Promise<{ ok: boolean }>;
  terminalGitCherryPick(args: { repoRoot: string; hash: string }): Promise<{ ok: boolean }>;
  terminalGitReset(args: { repoRoot: string; hash: string; mode: "soft" | "mixed" | "hard" }): Promise<{ ok: boolean }>;
  terminalGitCheckoutCommit(args: { repoRoot: string; hash: string }): Promise<{ ok: boolean }>;
  terminalGitBranchFromCommit(args: { repoRoot: string; hash: string; branch: string }): Promise<{ ok: boolean }>;
  workbenchListDirectory(args: {
    rootPath: string;
    dirPath: string;
  }): Promise<{
    entries: Array<{ name: string; path: string; isDirectory: boolean }>;
  }>;
  workbenchListFiles(args: { rootPath: string }): Promise<{
    files: Array<{ path: string; relativePath: string; kind: "file" | "directory" }>;
    truncated: boolean;
    engine: "rg" | "node";
  }>;
  workbenchListFilesCancel(): Promise<{ ok: boolean }>;
  workbenchSearchPaths(args: { rootPath: string; query: string }): Promise<{
    files: Array<{ path: string; relativePath: string; kind: "file" | "directory" }>;
    truncated: boolean;
    engine: "rg" | "node";
  }>;
  workbenchSearchPathsCancel(): Promise<{ ok: boolean }>;
  workbenchCopyPath(args: { rootPath: string; sourcePath: string }): Promise<{ ok: boolean }>;
  workbenchClipboardHasFiles(): Promise<{ hasFiles: boolean }>;
  workbenchPastePaths(args: { rootPath: string; targetDirectory: string }): Promise<{
    copied: Array<{
      sourcePath: string;
      destinationPath: string;
      isDirectory: boolean;
    }>;
    failures: Array<{ sourcePath: string; message: string }>;
  }>;
  workbenchSetFileWatch(args: { rootPath: string | null }): Promise<{ rootPath: string | null }>;
  onWorkbenchFileSystemChanged(callback: (event: WorkbenchFileSystemChangedEvent) => void): () => void;
  workbenchListScripts(args: {
    rootPath: string;
    maxDepth?: number;
    maxPackages?: number;
    ignoreDirs?: string[];
  }): Promise<{
    packages: Array<{
      id: string;
      kind: "npm" | "pnpm" | "yarn" | "bun" | "make" | "gradle" | "python" | "cargo";
      packageRoot: string;
      relativeRoot: string;
      label: string;
      manifestPath: string;
      managerHint?: string;
      scripts: Array<{
        id: string;
        name: string;
        detail?: string;
        run: { cwd: string; command: string };
      }>;
    }>;
    truncated: boolean;
    scannedDirs: number;
  }>;
  workbenchReadFileText(args: {
    rootPath: string;
    filePath: string;
    maxBytes?: number;
  }): Promise<{ content: string; truncated: boolean }>;
  workbenchInspectFile(args: { rootPath: string; filePath: string }): Promise<
    | {
        kind: "text";
        content: string;
        encoding: "utf8" | "utf8-bom" | "utf16le" | "utf16be";
        version: string;
        size: number;
        mtimeMs: number;
      }
    | { kind: "external"; reason: "binary" | "too-large"; size: number; mtimeMs: number }
    | { kind: "missing" }
  >;
  workbenchSaveFileText(args: {
    rootPath: string;
    filePath: string;
    content: string;
    encoding: "utf8" | "utf8-bom" | "utf16le" | "utf16be";
    expectedVersion: string;
    force?: boolean;
  }): Promise<
    | { ok: true; version: string; size: number; mtimeMs: number }
    | { ok: false; reason: "conflict"; version: string; size: number; mtimeMs: number }
    | { ok: false; reason: "missing" }
  >;
  workbenchCreateFileText(args: {
    rootPath: string;
    filePath: string;
    content: string;
    encoding: "utf8" | "utf8-bom" | "utf16le" | "utf16be";
  }): Promise<
    | { ok: true; version: string; size: number; mtimeMs: number }
    | { ok: false; reason: "exists" }
  >;
  workbenchOpenPath(args: { rootPath: string; filePath: string }): Promise<{ ok: boolean }>;
  workbenchRevealPath(args: {
    rootPath: string;
    targetPath: string;
  }): Promise<{ ok: boolean }>;
  workbenchSearchText(args: {
    rootPath: string;
    query: string;
    matchCase?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
    maxResults?: number;
    maxFileSizeBytes?: number;
  }): Promise<{
    matches: Array<{
      path: string;
      relativePath: string;
      line: number;
      column: number;
      endColumn: number;
      preview: string;
    }>;
    truncated: boolean;
    filesSearched: number;
    engine: "rg" | "node";
  }>;
  workbenchSearchTextCancel(): Promise<{ ok: boolean }>;
  linkGraphAnalyze(args: LinkGraphAnalyzeArgs): Promise<LinkGraphAnalyzeResult>;
  linkGraphCancel(): Promise<{ ok: boolean }>;
  onLinkGraphProgress(callback: (event: LinkGraphProgressEvent) => void): () => void;
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
    tracking?: Array<{
      repoRoot: string;
      branch: string | null;
      upstream: string | null;
      ahead: number;
      behind: number;
    }>;
  }>;
  terminalGitDiffSides(args: {
    cwd: string;
    path: string;
    staged?: boolean;
  }): Promise<{ oldLabel: string; newLabel: string; oldText: string; newText: string; hunks: GitDiffHunk[] }>;
  terminalGitDiscardChange(args: { repoRoot: string; path: string }): Promise<{ ok: boolean }>;
  terminalGitDiscardHunk(args: {
    repoRoot: string;
    path: string;
    staged?: boolean;
    target: GitDiffHunkTarget;
  }): Promise<{ ok: boolean }>;
  terminalGitDiscardLine(args: {
    repoRoot: string;
    path: string;
    staged?: boolean;
    target: GitDiffLineTarget;
  }): Promise<{ ok: boolean }>;
  terminalGitStageHunk(args: {
    repoRoot: string;
    path: string;
    target: GitDiffHunkTarget;
  }): Promise<{ ok: boolean }>;
  terminalGitUnstageHunk(args: {
    repoRoot: string;
    path: string;
    target: GitDiffHunkTarget;
  }): Promise<{ ok: boolean }>;
  terminalGitStageLine(args: {
    repoRoot: string;
    path: string;
    target: GitDiffLineTarget;
  }): Promise<{ ok: boolean }>;
  terminalGitUnstageLine(args: {
    repoRoot: string;
    path: string;
    target: GitDiffLineTarget;
  }): Promise<{ ok: boolean }>;
  onTerminalData(callback: (payload: { id: number; data: string }) => void): () => void;
  onTerminalExit(callback: (payload: { id: number }) => void): () => void;
  onTerminalRespawned(callback: (payload: { id: number }) => void): () => void;
  setWorkbenchActive(active: boolean): void;
  /** Notify main when the floating note has DOM focus so workbench shortcuts (⌘+Arrow) are suppressed. */
  setFloatingNoteFocused(focused: boolean): void;
  /** Notify main when any modal dialog (aria-modal) is open so workbench shortcuts (⌘+Arrow) are suppressed. */
  setModalOpen(open: boolean): void;
  onWorkbenchCmdT(callback: () => void): () => void;
  onWorkbenchCmdW(callback: () => void): () => void;
  onWorkbenchCmdArrow(callback: (direction: WorkbenchArrowDirection) => void): () => void;
  /** Quick Open (⌘P / Ctrl+P). */
  onWorkbenchCmdP(callback: () => void): () => void;
  /** Command Palette (⌘⇧P / Ctrl+Shift+P). */
  onWorkbenchCmdShiftP(callback: () => void): () => void;
  /** Find in Files (⌘⇧F / Ctrl+Shift+F). */
  onWorkbenchCmdShiftF(callback: () => void): () => void;
  listReports(opts?: {
    level?: string;
    limit?: number;
    fromMs?: number;
    toMs?: number;
  }): Promise<ReportEntry[]>;
  getReportEntry(reportId: string): Promise<ReportEntry | null>;
  getReportLinks(reportId: string): Promise<ReportLinkRow[]>;
  listDailyDigests(limit?: number): Promise<ReportEntry[]>;
  previewDigestRun(args: { level: "daily" | "weekly" | "monthly"; periodKey?: string }): Promise<DigestGenerationEstimate>;
  runDailyDigest(
    dateOrOpts?: string | { date?: string; forceResummarize?: boolean; allowOverBudget?: boolean }
  ): Promise<RunDailyDigestResult>;
  needsDailyDigestRefresh(date?: string): Promise<DailyDigestRefreshCheck>;
  needsWeeklyDigestRefresh(weekKey?: string): Promise<DailyDigestRefreshCheck>;
  needsMonthlyDigestRefresh(monthKey?: string): Promise<DailyDigestRefreshCheck>;
  runWeeklyDigest(args?: string | { weekKey?: string; allowOverBudget?: boolean }): Promise<RunWeeklyDigestResult>;
  runMonthlyDigest(args?: string | { monthKey?: string; allowOverBudget?: boolean }): Promise<RunMonthlyDigestResult>;
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
    /** When set and non-empty, only these MCP tool names are exposed to the model. */
    enabledTools?: string[];
    projectPath?: string;
  }): Promise<AgentChatResult>;
  /** Static catalog of Ask chat tools (for the tools popover checklist). */
  listAgentTools(): Promise<AgentToolDescriptor[]>;
  cancelAskAgent(): Promise<{ ok: boolean }>;
  respondToolApproval(args: { toolCallId: string; approved: boolean }): Promise<{ ok: boolean }>;
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
  truncateAgentChat(args: { threadId: string; fromSortOrder: number }): Promise<{ ok: boolean }>;
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
      evidence?: GtdEvidence;
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
  logsList(args?: {
    limit?: number;
    level?: "error" | "warn";
    source?: string;
  }): Promise<
    Array<{
      id: string;
      createdAtMs: number;
      level: "error" | "warn";
      source: string;
      message: string;
      detail?: string;
    }>
  >;
  logsClear(): Promise<{ ok: true }>;
  logsOpenDir(): Promise<{ ok: boolean; path: string }>;
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
      gtdStatus?: GtdStatus;
      createdAtMs: number;
      updatedAtMs: number;
      fsMtimeMs?: number;
    }>
  >;
  notesListRoot(): Promise<
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
      gtdStatus?: GtdStatus;
      createdAtMs: number;
      updatedAtMs: number;
      fsMtimeMs?: number;
    }>
  >;
  notesListLinks(): Promise<Array<{ parentNoteId: string; childNoteId: string; createdAtMs: number }>>;
  notesListLinkedChildIds(): Promise<string[]>;
  notesListChildCounts(): Promise<Record<string, number>>;
  notesGetParent(args: { noteId: string }): Promise<{ parentNoteId: string; childNoteId: string; createdAtMs: number } | null>;
  notesSetParent(args: { childNoteId: string; parentNoteId: string | null }): Promise<{ ok: boolean }>;
  notesCreateLinkedChild(args: { parentNoteId: string }): Promise<{ noteId: string; filename: string }>;
  notesGetSubtree(args: { rootNoteId: string }): Promise<{
    rootNoteId: string;
    root: {
      noteId: string;
      title: string;
      filename: string;
      projectPath?: string;
      children: Array<{
        noteId: string;
        title: string;
        filename: string;
        projectPath?: string;
        children: unknown[];
      }>;
    };
    nodesById: Record<string, { noteId: string; title: string; filename: string; projectPath?: string; children: unknown[] }>;
    edges: Array<{ parentNoteId: string; childNoteId: string }>;
  }>;
  notesResolveLinkRoot(args: { noteId: string }): Promise<{ rootNoteId: string }>;
  notesSetGtdStatus(args: { noteId: string; status: GtdStatus | null }): Promise<{
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
    gtdStatus?: GtdStatus;
    createdAtMs: number;
    updatedAtMs: number;
    fsMtimeMs?: number;
  }>;
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
      gtdStatus?: GtdStatus;
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
    content?: string;
    materialized?: boolean;
  }>;
  notesResumeSession(args: {
    provider: string;
    sessionId: string;
    initialPrompt?: string;
  }): Promise<{ ok: boolean; error?: string; command?: string; cwd?: string; mode?: string; external?: boolean }>;
  notesCreate(args: {
    scope: "library" | "project" | "session";
    projectPath?: string;
    provider?: string;
    sessionId?: string;
    body?: string;
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
  notesDelete(args: { noteId: string }): Promise<{ ok: boolean; deletedNoteIds: string[] }>;
  notesRename(args: { noteId: string; filename: string }): Promise<{ noteId: string; filename: string }>;
  notesImport(owner: {
    scope: "library" | "project" | "session";
    projectPath?: string;
    provider?: string;
    sessionId?: string;
  }): Promise<{ imported: number; skipped: number; errors: string[] }>;
  notesClipboardHasImage(): boolean;
  /** Synchronous system clipboard write (UTF-16 / Unicode-safe via Electron). */
  clipboardWriteText(text: string): void;
  /** Synchronous system clipboard read. */
  clipboardReadText(): string;
  notesPasteImage(args: { noteId: string }): Promise<{ snippet: string } | null>;
  notesOpenFolder(): Promise<{ ok: boolean }>;
  settingsOpenPanelHome(): Promise<{ ok: boolean }>;
  notesReveal(args: { noteId: string }): Promise<{ ok: boolean }>;
  notesCopyPath(args: { noteId: string }): Promise<{ path: string }>;
  listProjectAliases(): Promise<Record<string, string>>;
  setProjectAlias(args: { projectPath: string; alias: string }): Promise<{ ok: boolean }>;
  listProjects(opts?: { includeHidden?: boolean }): Promise<
    Array<{
      projectId: string;
      portableKey: string;
      alias: string;
      hidden: boolean;
      pinned: boolean;
      lastSeenAtMs: number | null;
      updatedAtMs: number;
      localPath: string | null;
      pathMissing: boolean;
      sessionCount: number;
    }>
  >;
  hideProject(args: { projectId?: string; projectPath?: string }): Promise<{
    projectId: string;
    hiddenSessions: number;
  }>;
  setProjectLocalPath(args: { projectId: string; absolutePath: string }): Promise<{ ok: boolean }>;
  pickProjectLocalPath(args: { projectId: string; title?: string }): Promise<
    | { ok: true; absolutePath: string; resolved: { cwd: string; source: string; projectId: string; portableKey: string } }
    | { ok: false; canceled: true }
  >;
  setProjectPinned(args: { projectId: string; pinned: boolean }): Promise<{ ok: boolean }>;
  revealProjectInFinder(args: { projectId?: string; projectPath?: string }): Promise<{ ok: boolean; path: string }>;
  copyProjectLocalPath(args: { projectId?: string; projectPath?: string }): Promise<{ ok: boolean; path: string }>;
  resolveProjectCwd(args: { projectId?: string; projectPath?: string }): Promise<{
    cwd: string;
    source: "local" | "portable" | "rehome" | "missing";
    projectId: string;
    portableKey: string;
  }>;
  listProjectPathVariants(args: { projectId: string }): Promise<
    Array<{ absolutePath: string; portableKey: string; sessionCount: number }>
  >;
  mergeProjects(args: {
    sourceProjectId: string;
    targetProjectId: string;
  }): Promise<{ targetProjectId: string; mergedSessions: number }>;
  splitProjectPath(args: {
    sourceProjectId: string;
    absolutePath: string;
  }): Promise<{ projectId: string; movedSessions: number; created: boolean }>;
  flowList(args?: { projectId?: string }): Promise<FlowWorkflow[]>;
  flowGet(args: { flowId: string }): Promise<FlowDefinition>;
  flowCreate(args: { projectId: string; projectPath: string; name: string }): Promise<FlowDefinition>;
  flowUpdateGraph(args: { flowId: string; name?: string; nodes: FlowGraphNodeInput[]; edges: FlowGraphEdgeInput[] }): Promise<FlowDefinition>;
  flowDelete(args: { flowId: string }): Promise<{ ok: true }>;
  flowTemplatesList(): Promise<FlowTemplate[]>;
  flowTemplateSave(args: { flowId: string; name: string; description?: string }): Promise<FlowTemplate>;
  flowTemplateDelete(args: { templateId: string }): Promise<{ ok: true }>;
  flowTemplateInstantiate(args: { templateId: string; projectId: string; projectPath: string; name?: string }): Promise<FlowDefinition>;
  flowRunStart(args: { flowId: string }): Promise<FlowAdvanceResult>;
  flowRunGet(args: { runId: string }): Promise<FlowRun>;
  flowRunLatest(args: { flowId: string }): Promise<FlowRun | null>;
  flowRunMarkNodeRunning(args: { runId: string; nodeId: string }): Promise<FlowAdvanceResult>;
  flowBindSession(args: { flowId: string; nodeId: string; provider: string; sessionId: string }): Promise<FlowDefinition>;
  flowRunCompleteNode(args: { runId: string; nodeId: string; status: FlowResultStatus; summary: string }): Promise<FlowAdvanceResult>;
  flowRunSetNodeStatus(args: { flowId: string; runId?: string; nodeId: string; status: FlowNodeStatus }): Promise<FlowDefinition>;
  flowRunRetryNode(args: { runId: string; nodeId: string }): Promise<FlowAdvanceResult>;
  flowRunSkipNode(args: { runId: string; nodeId: string }): Promise<FlowAdvanceResult>;
  flowRunCancel(args: { runId: string }): Promise<FlowAdvanceResult>;
  onFlowChanged(callback: (detail: { flowId?: string; runId?: string }) => void): () => void;
  getI18nBundle(): Promise<{ locale: string; messages: Record<string, string> }>;
  getAppVersion(): Promise<string>;
  checkForUpdate(options?: { force?: boolean }): Promise<UpdateCheckResult>;
  openExternalUrl(url: string): Promise<void>;
  onLocaleChanged(callback: (bundle: { locale: string; messages: Record<string, string> }) => void): () => void;
}

const api: DesktopApi = {
  getPanelHome: () => ipcRenderer.invoke("panel:getHome"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  backupTargetStatus: () => ipcRenderer.invoke("backup:targetStatus"),
  backupListIcloud: () => ipcRenderer.invoke("backup:listIcloud"),
  backupExport: (args) => ipcRenderer.invoke("backup:export", args),
  backupSelectImport: () => ipcRenderer.invoke("backup:selectImport"),
  backupSelectIcloudImport: (args) => ipcRenderer.invoke("backup:selectIcloudImport", args),
  onBackupProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: BackupProgressEvent) => callback(progress);
    ipcRenderer.on("backup:progress", handler);
    return () => ipcRenderer.removeListener("backup:progress", handler);
  },
  backupImport: (args) => ipcRenderer.invoke("backup:import", args),
  listMcpClients: () => ipcRenderer.invoke("mcp:listClients"),
  getMcpManualConfig: () => ipcRenderer.invoke("mcp:manualConfig"),
  registerMcpClient: (args) => ipcRenderer.invoke("mcp:register", args),
  removeMcpClient: (args) => ipcRenderer.invoke("mcp:remove", args),
  registerAllMcpClients: (args) => ipcRenderer.invoke("mcp:registerAll", args),
  saveSettings: (settings, options) => ipcRenderer.invoke("settings:save", settings, options),
  testModelConnection: (args) => ipcRenderer.invoke("settings:testModel", args),
  openSettingsWindow: (options) => ipcRenderer.invoke("settings:openWindow", options),
  closeSettingsWindow: () => ipcRenderer.invoke("settings:closeWindow"),
  standaloneNoteOpen: (args) => ipcRenderer.invoke("standalone-note:open", args),
  standaloneNoteList: () => ipcRenderer.invoke("standalone-note:list"),
  onStandaloneNotesChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, notes: Array<{ noteId: string; title: string }>) => callback(notes);
    ipcRenderer.on("standalone-note:changed", handler);
    return () => ipcRenderer.removeListener("standalone-note:changed", handler);
  },
  standaloneNoteGetState: () => ipcRenderer.invoke("standalone-note:getState"),
  standaloneNoteSetAlwaysOnTop: (args) => ipcRenderer.invoke("standalone-note:setAlwaysOnTop", args),
  standaloneNoteClose: () => ipcRenderer.invoke("standalone-note:close"),
  standaloneNoteCloseReady: (args) => ipcRenderer.invoke("standalone-note:closeReady", args),
  onStandaloneNoteCloseRequested: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("standalone-note:requestClose", handler);
    return () => ipcRenderer.removeListener("standalone-note:requestClose", handler);
  },
  browserCreate: (args) => ipcRenderer.invoke("browser:create", args),
  browserDestroy: (args) => ipcRenderer.invoke("browser:destroy", args),
  browserList: () => ipcRenderer.invoke("browser:list"),
  browserGet: (args) => ipcRenderer.invoke("browser:get", args),
  browserAttachBounds: (args) => ipcRenderer.invoke("browser:attachBounds", args),
  browserSetVisible: (args) => ipcRenderer.invoke("browser:setVisible", args),
  browserSetSurface: (args) => ipcRenderer.invoke("browser:setSurface", args),
  browserFocus: (args) => ipcRenderer.invoke("browser:focus", args),
  browserNavigate: (args) => ipcRenderer.invoke("browser:navigate", args),
  browserBack: (args) => ipcRenderer.invoke("browser:back", args),
  browserForward: (args) => ipcRenderer.invoke("browser:forward", args),
  browserReload: (args) => ipcRenderer.invoke("browser:reload", args),
  browserStop: (args) => ipcRenderer.invoke("browser:stop", args),
  browserNewTab: (args) => ipcRenderer.invoke("browser:newTab", args),
  browserCloseTab: (args) => ipcRenderer.invoke("browser:closeTab", args),
  browserActivateTab: (args) => ipcRenderer.invoke("browser:activateTab", args),
  browserSetPolicy: (args) => ipcRenderer.invoke("browser:setPolicy", args),
  browserClearCookies: (args) => ipcRenderer.invoke("browser:clearCookies", args),
  onBrowserEvent: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: BrowserIpcEvent) => callback(payload);
    ipcRenderer.on("browser:event", handler);
    return () => ipcRenderer.removeListener("browser:event", handler);
  },
  onSettingsNavigate: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { pane: string }) => callback(payload);
    ipcRenderer.on("settings:navigate", handler);
    return () => ipcRenderer.removeListener("settings:navigate", handler);
  },
  onOpenSessions: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("sessions:open", handler);
    return () => ipcRenderer.removeListener("sessions:open", handler);
  },
  onSettingsChanged: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { settings: PanelSettings; section?: string; sync?: AgentSessionSyncResult }
    ) => callback(payload);
    ipcRenderer.on("settings:changed", handler);
    return () => ipcRenderer.removeListener("settings:changed", handler);
  },
  syncSessions: () => ipcRenderer.invoke("sessions:sync"),
  notifyRendererReady: () => ipcRenderer.send("main:rendererReady"),
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
  querySessionsPage: (args) => ipcRenderer.invoke("sessions:queryPage", args),
  listSessionGtdStatuses: () => ipcRenderer.invoke("gtd:listSessionStatuses"),
  setSessionGtdStatus: (args) => ipcRenderer.invoke("gtd:setSessionStatus", args),
  listTags: (args) => ipcRenderer.invoke("tags:list", args),
  searchTags: (args) => ipcRenderer.invoke("tags:search", args),
  listTagEntities: (args) => ipcRenderer.invoke("tags:listEntities", args),
  getEntityTags: (args) => ipcRenderer.invoke("tags:getEntityTags", args),
  addEntityTag: (args) => ipcRenderer.invoke("tags:addEntityTag", args),
  removeEntityTag: (args) => ipcRenderer.invoke("tags:removeEntityTag", args),
  recordEntityTagHits: (args) => ipcRenderer.invoke("tags:recordHits", args),
  retagEntity: (args) => ipcRenderer.invoke("tags:retagEntity", args),
  sweepTagDecay: () => ipcRenderer.invoke("tags:sweepDecay"),
  listSessionsInRange: (args) => ipcRenderer.invoke("sessions:listInRange", args),
  previewSession: (args) => ipcRenderer.invoke("sessions:preview", args),
  summarizeSession: (args) => ipcRenderer.invoke("sessions:summarize", args),
  autoRenameSession: (args) => ipcRenderer.invoke("sessions:autoRename", args),
  suggestSessionRename: (args) => ipcRenderer.invoke("sessions:suggestRename", args),
  renameSession: (args) => ipcRenderer.invoke("sessions:rename", args),
  hideSession: (args) => ipcRenderer.invoke("sessions:hide", args),
  moveSessionToProject: (args) => ipcRenderer.invoke("sessions:moveToProject", args),
  createScratchDir: () => ipcRenderer.invoke("workbench:createScratchDir"),
  workbenchGetProjectEditor: () => ipcRenderer.invoke("workbench:getProjectEditor"),
  workbenchOpenProjectInEditor: (args) => ipcRenderer.invoke("workbench:openProjectInEditor", args),
  workbenchOpenSession: (args) => ipcRenderer.invoke("workbench:openSession", args),
  onWorkbenchResumeFromAgent: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: {
        provider: string;
        id: string;
        command: string;
        cwd: string;
        title?: string;
        projectPath?: string;
        mode?: string;
        initialPrompt?: string;
      }
    ) => {
      callback(payload);
    };
    ipcRenderer.on("workbench:resumeFromAgent", handler);
    return () => {
      ipcRenderer.removeListener("workbench:resumeFromAgent", handler);
    };
  },
  workbenchOpenCodexApp: (args) => ipcRenderer.invoke("workbench:openCodexApp", args),
  workbenchNewSession: (args) => ipcRenderer.invoke("workbench:newSession", args),
  listWorkbenchSessionFolders: (args) => ipcRenderer.invoke("workbench:listSessionFolders", args),
  listAllWorkbenchSessionFolders: () => ipcRenderer.invoke("workbench:listAllSessionFolders"),
  createWorkbenchSessionFolder: (args) => ipcRenderer.invoke("workbench:createSessionFolder", args),
  renameWorkbenchSessionFolder: (args) => ipcRenderer.invoke("workbench:renameSessionFolder", args),
  deleteWorkbenchSessionFolder: (args) => ipcRenderer.invoke("workbench:deleteSessionFolder", args),
  assignWorkbenchSessionToFolder: (args) => ipcRenderer.invoke("workbench:assignSessionToFolder", args),
  removeWorkbenchSessionFromFolder: (args) => ipcRenderer.invoke("workbench:removeSessionFromFolder", args),
  acpListSessions: (args) => ipcRenderer.invoke("acp:listSessions", args),
  acpCreateSession: (args) => ipcRenderer.invoke("acp:createSession", args),
  acpGetSession: (args) => ipcRenderer.invoke("acp:getSession", args),
  acpDeleteSession: (args) => ipcRenderer.invoke("acp:deleteSession", args),
  acpRenameSession: (args) => ipcRenderer.invoke("acp:renameSession", args),
  acpLoadMessages: (args) => ipcRenderer.invoke("acp:loadMessages", args),
  acpConnect: (args) => ipcRenderer.invoke("acp:connect", args),
  acpPrompt: (args) => ipcRenderer.invoke("acp:prompt", args),
  acpCancel: (args) => ipcRenderer.invoke("acp:cancel", args),
  acpSetMode: (args) => ipcRenderer.invoke("acp:setMode", args),
  acpSetConfigOption: (args) => ipcRenderer.invoke("acp:setConfigOption", args),
  acpRespondPermission: (args) => ipcRenderer.invoke("acp:respondPermission", args),
  acpRespondQuestion: (args) => ipcRenderer.invoke("acp:respondQuestion", args),
  acpReadPlanFile: (args) => ipcRenderer.invoke("acp:readPlanFile", args),
  acpOpenPath: (args) => ipcRenderer.invoke("acp:openPath", args),
  acpDisconnect: (args) => ipcRenderer.invoke("acp:disconnect", args),
  onAcpStream: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: Record<string, unknown>) => callback(payload);
    ipcRenderer.on("acp:stream", handler);
    return () => ipcRenderer.removeListener("acp:stream", handler);
  },
  terminalSpawn: (args) => ipcRenderer.invoke("terminal:spawn", args),
  terminalAttach: (args) => ipcRenderer.invoke("terminal:attach", args),
  terminalDetach: (args) => ipcRenderer.invoke("terminal:detach", args),
  terminalInput: (args) => ipcRenderer.invoke("terminal:input", args),
  terminalResize: (args) => ipcRenderer.invoke("terminal:resize", args),
  terminalDestroy: (args) => ipcRenderer.invoke("terminal:destroy", args),
  workbenchGetRuntimeMetrics: () => ipcRenderer.invoke("workbench:getRuntimeMetrics"),
  terminalGitInfo: (args) => ipcRenderer.invoke("terminal:gitInfo", args),
  terminalGitBranches: (args) => ipcRenderer.invoke("terminal:gitBranches", args),
  terminalGitCheckout: (args) => ipcRenderer.invoke("terminal:gitCheckout", args),
  workbenchListDirectory: (args) => ipcRenderer.invoke("workbench:listDirectory", args),
  workbenchListFiles: (args) => ipcRenderer.invoke("workbench:listFiles", args),
  workbenchListFilesCancel: () => ipcRenderer.invoke("workbench:listFilesCancel"),
  workbenchSearchPaths: (args) => ipcRenderer.invoke("workbench:searchPaths", args),
  workbenchSearchPathsCancel: () => ipcRenderer.invoke("workbench:searchPathsCancel"),
  workbenchCopyPath: (args) => ipcRenderer.invoke("workbench:copyPath", args),
  workbenchClipboardHasFiles: () => ipcRenderer.invoke("workbench:clipboardHasFiles"),
  workbenchPastePaths: (args) => ipcRenderer.invoke("workbench:pastePaths", args),
  workbenchSetFileWatch: (args) => ipcRenderer.invoke("workbench:setFileWatch", args),
  onWorkbenchFileSystemChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: WorkbenchFileSystemChangedEvent) => callback(payload);
    ipcRenderer.on("workbench:fileSystemChanged", handler);
    return () => ipcRenderer.removeListener("workbench:fileSystemChanged", handler);
  },
  workbenchListScripts: (args) => ipcRenderer.invoke("workbench:listScripts", args),
  workbenchReadFileText: (args) => ipcRenderer.invoke("workbench:readFileText", args),
  workbenchInspectFile: (args) => ipcRenderer.invoke("workbench:inspectFile", args),
  workbenchSaveFileText: (args) => ipcRenderer.invoke("workbench:saveFileText", args),
  workbenchCreateFileText: (args) => ipcRenderer.invoke("workbench:createFileText", args),
  workbenchOpenPath: (args) => ipcRenderer.invoke("workbench:openPath", args),
  workbenchRevealPath: (args) => ipcRenderer.invoke("workbench:revealPath", args),
  workbenchSearchText: (args) => ipcRenderer.invoke("workbench:searchText", args),
  workbenchSearchTextCancel: () => ipcRenderer.invoke("workbench:searchTextCancel"),
  linkGraphAnalyze: (args) => ipcRenderer.invoke("linkgraph:analyze", args),
  linkGraphCancel: () => ipcRenderer.invoke("linkgraph:cancel"),
  onLinkGraphProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: LinkGraphProgressEvent) => callback(payload);
    ipcRenderer.on("linkgraph:progress", handler);
    return () => ipcRenderer.removeListener("linkgraph:progress", handler);
  },
  terminalGitStatus: (args) => ipcRenderer.invoke("terminal:gitStatus", args),
  terminalGitFetch: (args) => ipcRenderer.invoke("terminal:gitFetch", args),
  terminalGitStage: (args) => ipcRenderer.invoke("terminal:gitStage", args),
  terminalGitUnstage: (args) => ipcRenderer.invoke("terminal:gitUnstage", args),
  terminalGitDiffSides: (args) => ipcRenderer.invoke("terminal:gitDiffSides", args),
  terminalGitDiscardChange: (args) => ipcRenderer.invoke("terminal:gitDiscardChange", args),
  terminalGitDiscardHunk: (args) => ipcRenderer.invoke("terminal:gitDiscardHunk", args),
  terminalGitDiscardLine: (args) => ipcRenderer.invoke("terminal:gitDiscardLine", args),
  terminalGitStageHunk: (args) => ipcRenderer.invoke("terminal:gitStageHunk", args),
  terminalGitUnstageHunk: (args) => ipcRenderer.invoke("terminal:gitUnstageHunk", args),
  terminalGitStageLine: (args) => ipcRenderer.invoke("terminal:gitStageLine", args),
  terminalGitUnstageLine: (args) => ipcRenderer.invoke("terminal:gitUnstageLine", args),
  terminalGitSuggestCommit: (args) => ipcRenderer.invoke("terminal:gitSuggestCommit", args),
  terminalGitCommit: (args) => ipcRenderer.invoke("terminal:gitCommit", args),
  terminalGitPush: (args) => ipcRenderer.invoke("terminal:gitPush", args),
  terminalGitPull: (args) => ipcRenderer.invoke("terminal:gitPull", args),
  terminalGitLog: (args) => ipcRenderer.invoke("terminal:gitLog", args),
  workbenchGitFileLog: (args) => ipcRenderer.invoke("workbench:gitFileLog", args),
  terminalGitShow: (args) => ipcRenderer.invoke("terminal:gitShow", args),
  terminalGitShowFileDiffSides: (args) => ipcRenderer.invoke("terminal:gitShowFileDiffSides", args),
  terminalGitRevert: (args) => ipcRenderer.invoke("terminal:gitRevert", args),
  terminalGitMerge: (args) => ipcRenderer.invoke("terminal:gitMerge", args),
  terminalGitCherryPick: (args) => ipcRenderer.invoke("terminal:gitCherryPick", args),
  terminalGitReset: (args) => ipcRenderer.invoke("terminal:gitReset", args),
  terminalGitCheckoutCommit: (args) => ipcRenderer.invoke("terminal:gitCheckoutCommit", args),
  terminalGitBranchFromCommit: (args) => ipcRenderer.invoke("terminal:gitBranchFromCommit", args),
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
  setWorkbenchActive: (active) => ipcRenderer.send("workbench:setActive", active),
  setFloatingNoteFocused: (focused) => ipcRenderer.send("workbench:setFloatingNoteFocused", focused),
  setModalOpen: (open) => ipcRenderer.send("workbench:setModalOpen", open),
  onWorkbenchCmdT: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("workbench:cmdT", handler);
    return () => ipcRenderer.removeListener("workbench:cmdT", handler);
  },
  onWorkbenchCmdW: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("workbench:cmdW", handler);
    return () => ipcRenderer.removeListener("workbench:cmdW", handler);
  },
  onWorkbenchCmdArrow: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, direction: WorkbenchArrowDirection) => callback(direction);
    ipcRenderer.on("workbench:cmdArrow", handler);
    return () => ipcRenderer.removeListener("workbench:cmdArrow", handler);
  },
  onWorkbenchCmdP: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("workbench:cmdP", handler);
    return () => ipcRenderer.removeListener("workbench:cmdP", handler);
  },
  onWorkbenchCmdShiftP: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("workbench:cmdShiftP", handler);
    return () => ipcRenderer.removeListener("workbench:cmdShiftP", handler);
  },
  onWorkbenchCmdShiftF: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("workbench:cmdShiftF", handler);
    return () => ipcRenderer.removeListener("workbench:cmdShiftF", handler);
  },
  listReports: (opts) => ipcRenderer.invoke("report:list", opts),
  getReportEntry: (reportId) => ipcRenderer.invoke("report:getEntry", reportId),
  getReportLinks: (reportId) => ipcRenderer.invoke("report:getLinks", reportId),
  listDailyDigests: (limit) => ipcRenderer.invoke("report:listDaily", limit),
  previewDigestRun: (args) => ipcRenderer.invoke("report:previewRun", args),
  runDailyDigest: (dateOrOpts) => {
    if (typeof dateOrOpts === "string" || dateOrOpts === undefined) {
      return ipcRenderer.invoke("report:runDaily", { date: dateOrOpts });
    }
    return ipcRenderer.invoke("report:runDaily", dateOrOpts);
  },
  needsDailyDigestRefresh: (date) => ipcRenderer.invoke("report:needsDailyRefresh", date),
  needsWeeklyDigestRefresh: (weekKey) => ipcRenderer.invoke("report:needsWeeklyRefresh", weekKey),
  needsMonthlyDigestRefresh: (monthKey) => ipcRenderer.invoke("report:needsMonthlyRefresh", monthKey),
  runWeeklyDigest: (args) => ipcRenderer.invoke("report:runWeekly", args),
  runMonthlyDigest: (args) => ipcRenderer.invoke("report:runMonthly", args),
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
  listAgentTools: () => ipcRenderer.invoke("agent:listTools"),
  cancelAskAgent: () => ipcRenderer.invoke("agent:cancelAsk"),
  respondToolApproval: (args) => ipcRenderer.invoke("agent:respondToolApproval", args),
  listAgentChat: (args) => ipcRenderer.invoke("agent:listAgentChat", args),
  listOlderAgentChat: (args) => ipcRenderer.invoke("agent:listOlderAgentChat", args),
  clearAgentChat: (args) => ipcRenderer.invoke("agent:clearAgentChat", args),
  truncateAgentChat: (args) => ipcRenderer.invoke("agent:truncateAgentChat", args),
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
  logsList: (args) => ipcRenderer.invoke("logs:list", args),
  logsClear: () => ipcRenderer.invoke("logs:clear"),
  logsOpenDir: () => ipcRenderer.invoke("logs:openDir"),
  notesList: () => ipcRenderer.invoke("notes:list"),
  notesListRoot: () => ipcRenderer.invoke("notes:listRoot"),
  notesListLinks: () => ipcRenderer.invoke("notes:listLinks"),
  notesListLinkedChildIds: () => ipcRenderer.invoke("notes:listLinkedChildIds"),
  notesListChildCounts: () => ipcRenderer.invoke("notes:listChildCounts"),
  notesGetParent: (args) => ipcRenderer.invoke("notes:getParent", args),
  notesSetParent: (args) => ipcRenderer.invoke("notes:setParent", args),
  notesCreateLinkedChild: (args) => ipcRenderer.invoke("notes:createLinkedChild", args),
  notesGetSubtree: (args) => ipcRenderer.invoke("notes:getSubtree", args),
  notesResolveLinkRoot: (args) => ipcRenderer.invoke("notes:resolveLinkRoot", args),
  notesSetGtdStatus: (args) => ipcRenderer.invoke("notes:setGtdStatus", args),
  notesRead: (args) => ipcRenderer.invoke("notes:read", args),
  notesWrite: (args) => ipcRenderer.invoke("notes:write", args),
  notesResumeSession: (args) => ipcRenderer.invoke("notes:resumeSession", args),
  notesCreate: (args) => ipcRenderer.invoke("notes:create", args),
  notesMove: (args) => ipcRenderer.invoke("notes:move", args),
  notesDelete: (args) => ipcRenderer.invoke("notes:delete", args),
  notesRename: (args) => ipcRenderer.invoke("notes:rename", args),
  notesImport: (owner) => ipcRenderer.invoke("notes:import", owner),
  notesClipboardHasImage: () => !clipboard.readImage().isEmpty(),
  clipboardWriteText: (text) => {
    clipboard.writeText(typeof text === "string" ? text : String(text ?? ""));
  },
  clipboardReadText: () => clipboard.readText(),
  notesPasteImage: (args) => ipcRenderer.invoke("notes:pasteImage", args),
  notesOpenFolder: () => ipcRenderer.invoke("notes:openFolder"),
  settingsOpenPanelHome: () => ipcRenderer.invoke("settings:openPanelHome"),
  notesReveal: (args) => ipcRenderer.invoke("notes:reveal", args),
  notesCopyPath: (args) => ipcRenderer.invoke("notes:copyPath", args),
  listProjectAliases: () => ipcRenderer.invoke("projects:listAliases"),
  setProjectAlias: (args) => ipcRenderer.invoke("projects:setAlias", args),
  listProjects: (opts) => ipcRenderer.invoke("projects:list", opts),
  hideProject: (args) => ipcRenderer.invoke("projects:hide", args),
  setProjectLocalPath: (args) => ipcRenderer.invoke("projects:setLocalPath", args),
  pickProjectLocalPath: (args) => ipcRenderer.invoke("projects:pickLocalPath", args),
  setProjectPinned: (args) => ipcRenderer.invoke("projects:setPinned", args),
  revealProjectInFinder: (args) => ipcRenderer.invoke("projects:revealInFinder", args),
  copyProjectLocalPath: (args) => ipcRenderer.invoke("projects:copyLocalPath", args),
  resolveProjectCwd: (args) => ipcRenderer.invoke("projects:resolveCwd", args),
  listProjectPathVariants: (args) => ipcRenderer.invoke("projects:listPathVariants", args),
  mergeProjects: (args) => ipcRenderer.invoke("projects:merge", args),
  splitProjectPath: (args) => ipcRenderer.invoke("projects:splitPath", args),
  flowList: (args) => ipcRenderer.invoke("flow:list", args),
  flowGet: (args) => ipcRenderer.invoke("flow:get", args),
  flowCreate: (args) => ipcRenderer.invoke("flow:create", args),
  flowUpdateGraph: (args) => ipcRenderer.invoke("flow:updateGraph", args),
  flowDelete: (args) => ipcRenderer.invoke("flow:delete", args),
  flowTemplatesList: () => ipcRenderer.invoke("flow:templatesList"),
  flowTemplateSave: (args) => ipcRenderer.invoke("flow:templateSave", args),
  flowTemplateDelete: (args) => ipcRenderer.invoke("flow:templateDelete", args),
  flowTemplateInstantiate: (args) => ipcRenderer.invoke("flow:templateInstantiate", args),
  flowRunStart: (args) => ipcRenderer.invoke("flow:runStart", args),
  flowRunGet: (args) => ipcRenderer.invoke("flow:runGet", args),
  flowRunLatest: (args) => ipcRenderer.invoke("flow:runLatest", args),
  flowRunMarkNodeRunning: (args) => ipcRenderer.invoke("flow:runMarkNodeRunning", args),
  flowBindSession: (args) => ipcRenderer.invoke("flow:bindSession", args),
  flowRunCompleteNode: (args) => ipcRenderer.invoke("flow:runCompleteNode", args),
  flowRunSetNodeStatus: (args) => ipcRenderer.invoke("flow:runSetNodeStatus", args),
  flowRunRetryNode: (args) => ipcRenderer.invoke("flow:runRetryNode", args),
  flowRunSkipNode: (args) => ipcRenderer.invoke("flow:runSkipNode", args),
  flowRunCancel: (args) => ipcRenderer.invoke("flow:runCancel", args),
  onFlowChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, detail: { flowId?: string; runId?: string }) => callback(detail);
    ipcRenderer.on("flow:changed", handler);
    return () => ipcRenderer.removeListener("flow:changed", handler);
  },
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
