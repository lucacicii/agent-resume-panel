import { clipboard, contextBridge, ipcRenderer } from "electron";
import type { UpdateCheckResult } from "../main/updateCheck";
import type {
  AgentSession,
  ReportEntry,
  NoteIndexProgressEvent,
  PanelSettings,
  AgentSessionSyncResult,
  AgentToolDescriptor,
  SkillDescriptor,
  GtdStatus,
  TaskGtdRollup,
  WorkbenchSessionFolder,
  WorkbenchSessionFolderAssignment,
  TaskWorkbench,
  TaskWorkbenchSessionLink
} from "@agent-resume/core";
import type { McpClientInfo } from "../main/mcpRegistration";
import type {
  AgentIntegrationId,
  AgentIntegrationStatus
} from "../main/agentStatus/integrations";
import type { AgentStatusDaemonStatus } from "../main/agentStatus/lifecycle";
import type { DetectionExplain, PaneScreenDump, PaneStatus, StatusSnapshot } from "../shared/agentStatusTypes";
import type { BackupPreview, BackupProgressEvent, BackupResult, BackupStorageTarget, BackupStorageTargetStatus, BackupStoredItem } from "../main/backupService";
import type { GitDiffHunk, GitDiffHunkTarget, GitDiffLineTarget } from "../main/workbenchGitDiff";
import type {
  ProviderDraft,
  ProviderFetchModelsResult,
  ProviderTestConnectionResult,
  ProviderTestKind
} from "../main/providerSettings";
import type { WorkbenchFileSystemChangedEvent } from "../main/workbenchWatcher";
import type {
  WorkbenchActiveSessionDot,
  WorkbenchFocusSessionRequest,
  WorkbenchFocusSessionResult,
  WorkbenchSendSelectionRequest,
  WorkbenchSendSelectionResult
} from "../shared/workbenchSelection";
import type { SelectionAction } from "../shared/selectionActions";

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

/** Reusable GTD task template stored in `desktop.db`. */
export type TaskTemplate = {
  templateId: string;
  title: string;
  projectPaths: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

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
  ): Promise<{ file: string; settings: PanelSettings; sync?: AgentSessionSyncResult }>;
  pickDirectory(args?: { title?: string }): Promise<{ ok: true; path: string } | { ok: false; canceled: true }>;
  /** Probe a provider's model (text/embedding) using current Providers form values (Save not required). */
  providersTestConnection(args: {
    kind: ProviderTestKind;
    provider: ProviderDraft;
    modelId: string;
  }): Promise<ProviderTestConnectionResult>;
  /** Fetch the model list of a provider using current Providers form values. */
  providersFetchModels(args: { baseUrl: string; apiKey?: string }): Promise<ProviderFetchModelsResult>;
  openSettingsWindow(options?: { pane?: string }): Promise<void>;
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
  /**
   * Open the window that hosts one task workbench, or focus it when it is
   * already open. One workbenchId maps to one window (and one workbench copy).
   */
  taskWindowOpen(args: {
    noteId: string;
    workbenchId: string;
    title?: string;
    x?: number;
    y?: number;
  }): Promise<{ ok: true; created: boolean } | { ok: false; reason: "limit"; limit: number }>;
  /** Open workbench windows, for board badges and tray menus. */
  taskWindowList(): Promise<Array<{ workbenchId: string; noteId: string; title: string }>>;
  onTaskWindowsChanged(callback: (windows: Array<{ workbenchId: string; noteId: string; title: string }>) => void): () => void;
  taskWindowFocus(args: { workbenchId: string }): Promise<{ ok: boolean }>;
  taskWindowGetState(): Promise<{ workbenchId: string; noteId: string; title: string }>;
  taskWindowSetTitle(args: { title: string }): Promise<{ ok: boolean }>;
  taskWindowClose(): Promise<{ ok: boolean }>;
  /** The host refused to open another workbench window (cap reached). */
  onTaskWindowLimit(callback: (payload: { limit: number }) => void): () => void;
  /** The host asked this window to close; answer with `taskWindowCloseReady`. */
  onTaskWindowCloseRequested(callback: () => void): () => void;
  taskWindowCloseReady(args: { ok: boolean }): Promise<{ ok: boolean }>;
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
  /** The macOS accent colour as `#rrggbb`, or null to use the system blue. */
  systemAccent(): Promise<string | null>;
  onSystemAccentChanged(callback: (accent: string | null) => void): () => void;
  /** Edit ▸ Find… (⌘F) — the menu owns the accelerator, so it forwards here. */
  onMenuFind(callback: () => void): () => void;
  /**
   * Show a native context menu at a point in this window. Resolves with the id of
   * the chosen item, or null when the menu was dismissed.
   */
  contextMenuShow(args: {
    x: number;
    y: number;
    items: Array<{
      id?: string;
      label?: string;
      type?: "normal" | "separator" | "checkbox";
      enabled?: boolean;
      checked?: boolean;
      submenu?: unknown[];
    }>;
  }): Promise<string | null>;
  /** Native confirmation alert; resolves true when the user confirmed. */
  dialogConfirm(args: {
    message: string;
    detail?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }): Promise<boolean>;
  /** Native fullscreen changes, so chrome can drop the traffic-light inset. */
  onWindowFullscreenChanged(callback: (fullscreen: boolean) => void): () => void;
  /** Report unsaved state so the close button shows the edited dot. */
  standaloneNoteDocumentState(args: { noteId: string; dirty: boolean }): Promise<{ ok: boolean }>;
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
    keys?: Array<{ provider: string; id: string }>;
    unassignedOnly?: boolean;
  }): Promise<{
    sessions: AgentSession[];
    total: number;
    nextCursor?: { updatedAt: number; provider: string; id: string };
  }>;
  clearSessionLastExitWaiting(args: { provider: string; id: string }): Promise<{ ok: boolean }>;
  listSessionGtdStatuses(): Promise<Record<string, GtdStatus>>;
  listTaskGtdRollups(): Promise<Record<string, TaskGtdRollup>>;
  taskGtdRollup(args: { noteId: string }): Promise<TaskGtdRollup>;
  setSessionGtdStatus(args: {
    provider: string;
    id: string;
    status: GtdStatus | null;
  }): Promise<{ ok: boolean }>;
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
  hideSessions(args: { sessions: Array<{ provider: string; id: string }> }): Promise<{ ok: boolean }>;
  createScratchDir(): Promise<string>;
  workbenchGetProjectEditor(): Promise<{
    selected: "auto" | "vscode" | "vscodium" | "cursor" | "windsurf";
    available: boolean;
    editor: {
      id: "vscode" | "vscodium" | "cursor" | "windsurf";
      label: string;
    } | null;
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
  /** Publish the currently open Workbench session dots to every renderer, including floating notes. */
  setWorkbenchActiveSessions(sessions: WorkbenchActiveSessionDot[]): void;
  /** Snapshot of currently open Workbench sessions (for note menus that mount later). */
  getWorkbenchActiveSessions(): Promise<WorkbenchActiveSessionDot[]>;
  /** Live open-session list for note selection menus (main window + floating notes). */
  onWorkbenchActiveSessions(callback: (sessions: WorkbenchActiveSessionDot[]) => void): () => void;
  /** Focus an already-open Workbench pane from the menu-bar tray. */
  focusWorkbenchSession(args: WorkbenchFocusSessionRequest): Promise<WorkbenchFocusSessionResult>;
  /** Main-window Workbench listener for tray / note session focus. */
  onWorkbenchFocusSession(callback: (payload: WorkbenchFocusSessionRequest) => void): () => void;
  /** Send selected note text to Workbench: open a new agent session or an already-open pane. */
  workbenchSendSelection(args: WorkbenchSendSelectionRequest): Promise<WorkbenchSendSelectionResult>;
  /** Main-window Workbench listener for note selection sends. */
  onWorkbenchSendSelection(callback: (payload: WorkbenchSendSelectionRequest) => void): () => void;
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
    taskNoteId?: string;
    initialPrompt?: string;
  }): Promise<{
    mode: string;
    command?: string;
    cwd: string;
    external?: boolean;
    copied?: boolean;
    unsupportedYolo?: boolean;
    warning?: string;
    /** MCP session identity env for embedded terminals (agent-resume service). */
    env?: Record<string, string>;
  }>;
  listWorkbenchSessionFolders(args: { projectId: string }): Promise<{
    folders: WorkbenchSessionFolder[];
    assignments: WorkbenchSessionFolderAssignment[];
  }>;
  listAllWorkbenchSessionFolders(): Promise<Record<string, {
    folders: WorkbenchSessionFolder[];
    assignments: WorkbenchSessionFolderAssignment[];
  }>>;
  /** Task workbenches (GTD task → N workbenches). Desktop-private. */
  listTaskWorkbenches(args: { taskNoteId: string }): Promise<TaskWorkbench[]>;
  listAllTaskWorkbenches(): Promise<TaskWorkbench[]>;
  ensureTaskWorkbench(args: { taskNoteId: string; name?: string; projectPath?: string | null }): Promise<TaskWorkbench>;
  createTaskWorkbench(args: { taskNoteId: string; name?: string; projectPath?: string | null }): Promise<TaskWorkbench>;
  renameTaskWorkbench(args: { workbenchId: string; name: string }): Promise<TaskWorkbench>;
  setTaskWorkbenchProject(args: { workbenchId: string; projectPath: string | null }): Promise<TaskWorkbench>;
  setTaskWorkbenchLayout(args: { workbenchId: string; layoutJson: string | null }): Promise<{ ok: boolean }>;
  reorderTaskWorkbenches(args: { taskNoteId: string; orderedIds: string[] }): Promise<{ ok: boolean }>;
  deleteTaskWorkbench(args: { workbenchId: string }): Promise<{ ok: boolean }>;
  listTaskWorkbenchSessionLinks(args: { workbenchId: string }): Promise<TaskWorkbenchSessionLink[]>;
  assignSessionToTaskWorkbench(args: { workbenchId: string; provider: string; agentSessionId: string }): Promise<TaskWorkbenchSessionLink>;
  removeSessionFromTaskWorkbench(args: { workbenchId: string; provider: string; agentSessionId: string }): Promise<{ ok: boolean }>;
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
  selectionListActions(): Promise<SelectionAction[]>;
  selectionCreateAction(args: {
    name: string;
    prompt?: string;
    providerId?: string;
    modelId?: string;
  }): Promise<SelectionAction>;
  selectionUpdateAction(args: {
    actionId: string;
    name?: string;
    prompt?: string;
    providerId?: string | null;
    modelId?: string | null;
    enabled?: boolean;
  }): Promise<SelectionAction>;
  selectionDeleteAction(args: { actionId: string }): Promise<{ ok: boolean }>;
  selectionReorderActions(args: { actionIds: string[] }): Promise<SelectionAction[]>;
  selectionRunAction(args: { actionId: string; text: string }): Promise<{ text: string }>;
  terminalSpawn(args: {
    cwd: string;
    command?: string;
    cols?: number;
    rows?: number;
    /** Session the pane belongs to, when the renderer already knows it. */
    sessionKey?: string;
    /** Workbench the pane belongs to, so a reopened workbench can find it again. */
    workbenchId?: string;
    /** Extra env for the agent process (allowlisted `AGENT_RESUME_*` keys only). */
    env?: Record<string, string>;
  }): Promise<{ id: number; count?: number; softLimit?: number; warnSoftLimit?: boolean }>;
  terminalAttach(args: { id: number }): Promise<{ ok: boolean; replay: string }>;
  terminalDetach(args: { id: number }): Promise<{ ok: boolean }>;
  terminalInput(args: { id: number; data: string }): Promise<{ ok: boolean }>;
  terminalResize(args: { id: number; cols: number; rows: number }): Promise<{ ok: boolean }>;
  /** Bind the session and workbench a pane belongs to (status + restore). */
  terminalBindSession(args: {
    id: number;
    sessionKey?: string;
    cwd?: string;
    workbenchId?: string;
  }): Promise<{ ok: boolean }>;
  /** Panes of one workbench that are still running, for re-attaching after a reopen. */
  terminalListForWorkbench(args: { workbenchId: string }): Promise<Array<{ id: number; cwd: string; cols: number; rows: number }>>;
  terminalDestroy(args: { id: number }): Promise<{ ok: boolean }>;
  workbenchComposerSendAppend(args: {
    paneKey: string;
    projectPath: string;
    sessionKey?: string | null;
    provider?: string | null;
    agentSessionId?: string | null;
    text: string;
  }): Promise<{
    id: string;
    createdAtMs: number;
    paneKey: string;
    projectPath: string;
    sessionKey: string | null;
    provider: string | null;
    agentSessionId: string | null;
    text: string;
  }>;
  workbenchComposerSendList(args: {
    paneKey?: string;
    sessionKey?: string;
    agentSessionId?: string;
    limit?: number;
  }): Promise<Array<{
    id: string;
    createdAtMs: number;
    paneKey: string;
    projectPath: string;
    sessionKey: string | null;
    provider: string | null;
    agentSessionId: string | null;
    text: string;
  }>>;
  workbenchComposerSendImport(args: {
    provider: string;
    id: string;
  }): Promise<{ imported: number; skipped: number; found: number }>;
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
    /** Open workbench windows, their cap, and how long each took to open. */
    windows: {
      count: number;
      limit: number;
      timings: Array<{ workbenchId: string; loadMs: number | null; showMs: number | null }>;
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
  workbenchListFiles(args: { rootPaths: string[] }): Promise<{
    files: Array<{ path: string; relativePath: string; kind: "file" | "directory" }>;
    truncated: boolean;
    engine: "rg" | "node";
  }>;
  workbenchListFilesCancel(): Promise<{ ok: boolean }>;
  workbenchSearchPaths(args: { rootPaths: string[]; query: string }): Promise<{
    files: Array<{ path: string; relativePath: string; kind: "file" | "directory" }>;
    truncated: boolean;
    engine: "rg" | "node";
  }>;
  workbenchSearchPathsCancel(): Promise<{ ok: boolean }>;
  workbenchCopyPath(args: { rootPath: string; sourcePath: string }): Promise<{ ok: boolean }>;
  workbenchClipboardHasFiles(): Promise<{ hasFiles: boolean }>;
  workbenchPasteClipboardImage(): Promise<{ path: string; previewUrl: string } | null>;
  workbenchPastePaths(args: { rootPath: string; targetDirectory: string }): Promise<{
    copied: Array<{
      sourcePath: string;
      destinationPath: string;
      isDirectory: boolean;
    }>;
    failures: Array<{ sourcePath: string; message: string }>;
  }>;
  workbenchSetFileWatch(args: { rootPaths: string[] | null }): Promise<{ rootPaths: string[] }>;
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
    rootPaths: string[];
    query: string;
    matchCase?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
    filesToInclude?: string;
    filesToExclude?: string;
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
  workbenchReplaceText(args: {
    rootPath: string;
    query: string;
    replaceWith: string;
    matchCase?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
    files: string[];
    only?: Array<{ path: string; ordinal: number }>;
  }): Promise<{
    replaced: Array<{ path: string; count: number }>;
    skipped: Array<{ path: string; reason: string }>;
    totalReplaced: number;
  }>;
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
  /**
   * Current agent-status snapshot for every pane, or null while the background
   * daemon is not connected yet. The daemon is the single source of truth.
   */
  agentStatusGetSnapshot?(): Promise<StatusSnapshot | null>;
  /** Pushes whenever any pane's settled status changes. */
  onAgentStatusChanged?(callback: (snapshot: StatusSnapshot) => void): () => void;
  /** Which agents can report their own state, and whether their hook is installed. */
  agentStatusListIntegrations?(): Promise<AgentIntegrationStatus[]>;
  agentStatusInstallIntegration?(args: { id: AgentIntegrationId }): Promise<AgentIntegrationStatus>;
  agentStatusUninstallIntegration?(args: { id: AgentIntegrationId }): Promise<AgentIntegrationStatus>;
  /** Health of the background status daemon. */
  agentStatusDaemonStatus?(): Promise<AgentStatusDaemonStatus>;
  agentStatusStartDaemon?(): Promise<AgentStatusDaemonStatus>;
  agentStatusStopDaemon?(): Promise<AgentStatusDaemonStatus>;
  /** Every pane the daemon knows about, for the inspector. */
  agentStatusPanes?(): Promise<PaneStatus[]>;
  /** Why one pane settled the way it did, rule by rule. */
  agentStatusExplain?(args: { paneId: number }): Promise<DetectionExplain | null>;
  /** The screen text the rules were evaluated against. */
  agentStatusScreen?(args: { paneId: number }): Promise<PaneScreenDump | null>;
  onTerminalExit(callback: (payload: { id: number }) => void): () => void;
  onTerminalRespawned(callback: (payload: { id: number }) => void): () => void;
  setWorkbenchActive(active: boolean): void;
  onWorkbenchCmdT(callback: () => void): () => void;
  onWorkbenchCmdW(callback: () => void): () => void;
  /** Quick Open (⌘P / Ctrl+P). */
  onWorkbenchCmdP(callback: () => void): () => void;
  /** Command Palette (⌘⇧P / Ctrl+Shift+P). */
  onWorkbenchCmdShiftP(callback: () => void): () => void;
  /** Find in Files (⌘⇧F / Ctrl+Shift+F). */
  onWorkbenchCmdShiftF(callback: () => void): () => void;
  getReportEntry(reportId: string): Promise<ReportEntry | null>;
  /** Static catalog of chat tools and discovered skills/mcp tools. */
  listAgentTools(args?: { projectPath?: string }): Promise<AgentToolDescriptor[]>;
  /** Discover available skills for workspace / user. */
  listSkills(args?: { projectPath?: string }): Promise<SkillDescriptor[]>;
  /** Read full content of a SKILL.md. */
  readSkill(args: { location: string }): Promise<string>;
  onNotesIndexProgress(callback: (event: NoteIndexProgressEvent) => void): () => void;
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
      /** Present only on tasks (`work: true`). */
      work?: {
        next?: string;
        decision?: string;
        sessions?: string[];
        projects?: string[];
        primaryProject?: string;
      };
    }>
  >;
  notesListTasks(): Promise<
    Array<{
      noteId: string;
      scope: string;
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
      work: {
        next?: string;
        decision?: string;
        sessions?: string[];
        projects?: string[];
        primaryProject?: string;
      };
    }>
  >;
  notesCreateTask(args: {
    title?: string;
    next?: string;
    decision?: string;
    sessions?: string[];
    projects?: string[];
    primaryProject?: string;
    /** Initial GTD column; defaults to `inbox` when omitted. */
    status?: GtdStatus;
  }): Promise<{
    noteId: string;
    scope: string;
    projectPath?: string;
    filename: string;
    relMdPath: string;
    title?: string;
    createdAtMs: number;
    updatedAtMs: number;
    gtdStatus?: GtdStatus;
    work?: { next?: string; decision?: string; sessions?: string[]; projects?: string[]; primaryProject?: string };
  }>;
  /** Rename a task's name (front-matter title + heading). */
  notesRenameTask(args: { noteId: string; title: string }): Promise<{
    noteId: string;
    title?: string;
    updatedAtMs: number;
  }>;
  taskTemplatesList(): Promise<Array<TaskTemplate>>;
  taskTemplatesCreate(args: { title: string; projectPaths?: string[] }): Promise<TaskTemplate>;
  taskTemplatesUpdate(args: { templateId: string; title: string; projectPaths?: string[] }): Promise<TaskTemplate>;
  taskTemplatesDelete(args: { templateId: string }): Promise<{ ok: boolean }>;
  notesLinkSessionToTask(args: { noteId: string; sessionKey: string; projectPath?: string }): Promise<{ noteId: string }>;
  notesListTaskSessionLinks(): Promise<Array<{ noteId: string; title?: string; provider: string; sessionId: string }>>;
  /** Allocate/refresh a task's neutral workspace; returns its directory. */
  notesEnsureTaskWorkspace(args: { noteId: string }): Promise<{ dir: string }>;
  /** The neutral workspace directory and whether it exists; never creates it. */
  notesTaskWorkspace(args: { noteId: string }): Promise<{ dir: string; exists: boolean }>;
  /** Open the neutral workspace in the system file manager. */
  notesOpenTaskWorkspace(args: { noteId: string }): Promise<{ ok: boolean }>;
  notesAddTaskProject(args: { noteId: string; projectPath: string }): Promise<{ noteId: string }>;
  notesRemoveTaskProject(args: { noteId: string; projectPath: string }): Promise<{ noteId: string }>;
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
      /** Present only on tasks (`work: true`). */
      work?: {
        next?: string;
        decision?: string;
        sessions?: string[];
        projects?: string[];
        primaryProject?: string;
      };
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
      /** Present only on tasks (`work: true`). */
      work?: {
        next?: string;
        decision?: string;
        sessions?: string[];
        projects?: string[];
        primaryProject?: string;
      };
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
    scope: "library" | "session";
    projectPath?: string;
    provider?: string;
    sessionId?: string;
    body?: string;
  }): Promise<{ noteId: string; filename: string }>;
  notesDelete(args: { noteId: string }): Promise<{ ok: boolean; deletedNoteIds: string[] }>;
  notesRename(args: { noteId: string; filename: string }): Promise<{ noteId: string; filename: string }>;
  notesImport(owner: {
    scope: "library" | "session";
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
  listProjects(opts?: { includeHidden?: boolean }): Promise<
    Array<{
      projectId: string;
      portableKey: string;
      alias: string;
      hidden: boolean;
      pinned: boolean;
      keptVisible: boolean;
      lastSeenAtMs: number | null;
      updatedAtMs: number;
      localPath: string | null;
      pathMissing: boolean;
      sessionCount: number;
    }>
  >;
  addProject(args: { title?: string }): Promise<
    | { ok: true; project: {
      projectId: string;
      portableKey: string;
      alias: string;
      hidden: boolean;
      pinned: boolean;
      keptVisible: boolean;
      lastSeenAtMs: number | null;
      updatedAtMs: number;
      localPath: string | null;
      pathMissing: boolean;
      sessionCount: number;
    } }
    | { ok: false; canceled: true }
  >;
  resolveProjectCwd(args: { projectId?: string; projectPath?: string }): Promise<{
    cwd: string;
    source: "local" | "portable" | "rehome" | "missing";
    projectId: string;
    portableKey: string;
  }>;
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
  pickDirectory: (args) => ipcRenderer.invoke("dialog:pickDirectory", args),
  providersTestConnection: (args) => ipcRenderer.invoke("providers:testConnection", args),
  providersFetchModels: (args) => ipcRenderer.invoke("providers:fetchModels", args),
  openSettingsWindow: (options) => ipcRenderer.invoke("settings:openWindow", options),
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
  taskWindowOpen: (args) => ipcRenderer.invoke("task-window:open", args),
  taskWindowList: () => ipcRenderer.invoke("task-window:list"),
  onTaskWindowsChanged: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      windows: Array<{ workbenchId: string; noteId: string; title: string }>
    ) => callback(windows);
    ipcRenderer.on("task-window:changed", handler);
    return () => ipcRenderer.removeListener("task-window:changed", handler);
  },
  taskWindowFocus: (args) => ipcRenderer.invoke("task-window:focus", args),
  taskWindowGetState: () => ipcRenderer.invoke("task-window:getState"),
  taskWindowSetTitle: (args) => ipcRenderer.invoke("task-window:setTitle", args),
  taskWindowClose: () => ipcRenderer.invoke("task-window:close"),
  onTaskWindowLimit: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { limit: number }) => callback(payload);
    ipcRenderer.on("task-window:limit", handler);
    return () => ipcRenderer.removeListener("task-window:limit", handler);
  },
  onTaskWindowCloseRequested: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("task-window:requestClose", handler);
    return () => ipcRenderer.removeListener("task-window:requestClose", handler);
  },
  taskWindowCloseReady: (args) => ipcRenderer.invoke("task-window:closeReady", args),
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
  onSettingsChanged: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { settings: PanelSettings; section?: string; sync?: AgentSessionSyncResult }
    ) => callback(payload);
    ipcRenderer.on("settings:changed", handler);
    return () => ipcRenderer.removeListener("settings:changed", handler);
  },
  systemAccent: () => ipcRenderer.invoke("appearance:accent"),
  onSystemAccentChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, accent: string | null) => callback(accent);
    ipcRenderer.on("appearance:accentChanged", handler);
    return () => ipcRenderer.removeListener("appearance:accentChanged", handler);
  },
  onMenuFind: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("menu:find", handler);
    return () => ipcRenderer.removeListener("menu:find", handler);
  },
  contextMenuShow: (args) => ipcRenderer.invoke("contextMenu:show", args),
  dialogConfirm: (args) => ipcRenderer.invoke("dialog:confirm", args),
  onWindowFullscreenChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, fullscreen: boolean) => callback(fullscreen);
    ipcRenderer.on("window:fullscreenChanged", handler);
    return () => ipcRenderer.removeListener("window:fullscreenChanged", handler);
  },
  standaloneNoteDocumentState: (args) => ipcRenderer.invoke("standaloneNote:documentState", args),
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
  clearSessionLastExitWaiting: (args) => ipcRenderer.invoke("sessions:clearLastExitWaiting", args),
  listSessionGtdStatuses: () => ipcRenderer.invoke("gtd:listSessionStatuses"),
  listTaskGtdRollups: () => ipcRenderer.invoke("gtd:listTaskRollups"),
  taskGtdRollup: (args) => ipcRenderer.invoke("gtd:taskRollup", args),
  setSessionGtdStatus: (args) => ipcRenderer.invoke("gtd:setSessionStatus", args),
  previewSession: (args) => ipcRenderer.invoke("sessions:preview", args),
  summarizeSession: (args) => ipcRenderer.invoke("sessions:summarize", args),
  autoRenameSession: (args) => ipcRenderer.invoke("sessions:autoRename", args),
  suggestSessionRename: (args) => ipcRenderer.invoke("sessions:suggestRename", args),
  renameSession: (args) => ipcRenderer.invoke("sessions:rename", args),
  hideSession: (args) => ipcRenderer.invoke("sessions:hide", args),
  hideSessions: (args) => ipcRenderer.invoke("sessions:hideMany", args),
  createScratchDir: () => ipcRenderer.invoke("workbench:createScratchDir"),
  workbenchGetProjectEditor: () => ipcRenderer.invoke("workbench:getProjectEditor"),
  workbenchOpenSession: (args) => ipcRenderer.invoke("workbench:openSession", args),
  setWorkbenchActiveSessions: (sessions) => {
    ipcRenderer.send("workbench:activeSessions", sessions);
  },
  getWorkbenchActiveSessions: () => ipcRenderer.invoke("workbench:getActiveSessions"),
  onWorkbenchActiveSessions: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, sessions: WorkbenchActiveSessionDot[]) => {
      callback(sessions);
    };
    ipcRenderer.on("workbench:activeSessions", handler);
    return () => {
      ipcRenderer.removeListener("workbench:activeSessions", handler);
    };
  },
  focusWorkbenchSession: (args) => ipcRenderer.invoke("workbench:focusSession", args),
  onWorkbenchFocusSession: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: WorkbenchFocusSessionRequest) => {
      callback(payload);
    };
    ipcRenderer.on("workbench:focusSession", handler);
    return () => {
      ipcRenderer.removeListener("workbench:focusSession", handler);
    };
  },
  workbenchSendSelection: (args) => ipcRenderer.invoke("workbench:sendSelection", args),
  onWorkbenchSendSelection: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: WorkbenchSendSelectionRequest) => {
      callback(payload);
    };
    ipcRenderer.on("workbench:sendSelection", handler);
    return () => {
      ipcRenderer.removeListener("workbench:sendSelection", handler);
    };
  },
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
  listTaskWorkbenches: (args) => ipcRenderer.invoke("taskWorkbenches:list", args),
  listAllTaskWorkbenches: () => ipcRenderer.invoke("taskWorkbenches:listAll"),
  ensureTaskWorkbench: (args) => ipcRenderer.invoke("taskWorkbenches:ensure", args),
  createTaskWorkbench: (args) => ipcRenderer.invoke("taskWorkbenches:create", args),
  renameTaskWorkbench: (args) => ipcRenderer.invoke("taskWorkbenches:rename", args),
  setTaskWorkbenchProject: (args) => ipcRenderer.invoke("taskWorkbenches:setProject", args),
  setTaskWorkbenchLayout: (args) => ipcRenderer.invoke("taskWorkbenches:setLayout", args),
  reorderTaskWorkbenches: (args) => ipcRenderer.invoke("taskWorkbenches:reorder", args),
  deleteTaskWorkbench: (args) => ipcRenderer.invoke("taskWorkbenches:delete", args),
  listTaskWorkbenchSessionLinks: (args) => ipcRenderer.invoke("taskWorkbenches:listSessionLinks", args),
  assignSessionToTaskWorkbench: (args) => ipcRenderer.invoke("taskWorkbenches:assignSession", args),
  removeSessionFromTaskWorkbench: (args) => ipcRenderer.invoke("taskWorkbenches:removeSession", args),
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
  selectionListActions: () => ipcRenderer.invoke("selection:listActions"),
  selectionCreateAction: (args) => ipcRenderer.invoke("selection:createAction", args),
  selectionUpdateAction: (args) => ipcRenderer.invoke("selection:updateAction", args),
  selectionDeleteAction: (args) => ipcRenderer.invoke("selection:deleteAction", args),
  selectionReorderActions: (args) => ipcRenderer.invoke("selection:reorderActions", args),
  selectionRunAction: (args) => ipcRenderer.invoke("selection:runAction", args),
  terminalSpawn: (args) => ipcRenderer.invoke("terminal:spawn", args),
  terminalAttach: (args) => ipcRenderer.invoke("terminal:attach", args),
  terminalDetach: (args) => ipcRenderer.invoke("terminal:detach", args),
  terminalInput: (args) => ipcRenderer.invoke("terminal:input", args),
  terminalResize: (args) => ipcRenderer.invoke("terminal:resize", args),
  terminalBindSession: (args) => ipcRenderer.invoke("terminal:bindSession", args),
  terminalListForWorkbench: (args) => ipcRenderer.invoke("terminal:listForWorkbench", args),
  terminalDestroy: (args) => ipcRenderer.invoke("terminal:destroy", args),
  workbenchComposerSendAppend: (args) => ipcRenderer.invoke("workbench:composerSendAppend", args),
  workbenchComposerSendList: (args) => ipcRenderer.invoke("workbench:composerSendList", args),
  workbenchComposerSendImport: (args) => ipcRenderer.invoke("workbench:composerSendImport", args),
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
  workbenchPasteClipboardImage: () => ipcRenderer.invoke("workbench:pasteClipboardImage"),
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
  workbenchReplaceText: (args) => ipcRenderer.invoke("workbench:replaceText", args),
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
  agentStatusGetSnapshot: () => ipcRenderer.invoke("agentStatus:getSnapshot"),
  onAgentStatusChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: StatusSnapshot) => callback(payload);
    ipcRenderer.on("agentStatus:changed", handler);
    return () => ipcRenderer.removeListener("agentStatus:changed", handler);
  },
  agentStatusListIntegrations: () => ipcRenderer.invoke("agentStatus:listIntegrations"),
  agentStatusInstallIntegration: (args) => ipcRenderer.invoke("agentStatus:installIntegration", args),
  agentStatusUninstallIntegration: (args) => ipcRenderer.invoke("agentStatus:uninstallIntegration", args),
  agentStatusDaemonStatus: () => ipcRenderer.invoke("agentStatus:daemonStatus"),
  agentStatusStartDaemon: () => ipcRenderer.invoke("agentStatus:startDaemon"),
  agentStatusStopDaemon: () => ipcRenderer.invoke("agentStatus:stopDaemon"),
  agentStatusPanes: () => ipcRenderer.invoke("agentStatus:panes"),
  agentStatusExplain: (args) => ipcRenderer.invoke("agentStatus:explain", args),
  agentStatusScreen: (args) => ipcRenderer.invoke("agentStatus:screen", args),
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
  getReportEntry: (reportId) => ipcRenderer.invoke("report:getEntry", reportId),
  listAgentTools: (args) => ipcRenderer.invoke("agent:listTools", args),
  listSkills: (args) => ipcRenderer.invoke("skills:list", args),
  readSkill: (args) => ipcRenderer.invoke("skills:read", args),
  onNotesIndexProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: NoteIndexProgressEvent) => {
      callback(progress);
    };
    ipcRenderer.on("notes:indexProgress", handler);
    return () => {
      ipcRenderer.removeListener("notes:indexProgress", handler);
    };
  },
  usageSummary: (args) => ipcRenderer.invoke("usage:summary", args),
  usageListEvents: (args) => ipcRenderer.invoke("usage:listEvents", args),
  usageListScheduleRuns: (args) => ipcRenderer.invoke("usage:listScheduleRuns", args),
  logsList: (args) => ipcRenderer.invoke("logs:list", args),
  logsClear: () => ipcRenderer.invoke("logs:clear"),
  logsOpenDir: () => ipcRenderer.invoke("logs:openDir"),
  notesList: () => ipcRenderer.invoke("notes:list"),
  notesListTasks: () => ipcRenderer.invoke("notes:listTasks"),
  taskTemplatesList: () => ipcRenderer.invoke("taskTemplates:list"),
  taskTemplatesCreate: (args) => ipcRenderer.invoke("taskTemplates:create", args),
  taskTemplatesUpdate: (args) => ipcRenderer.invoke("taskTemplates:update", args),
  taskTemplatesDelete: (args) => ipcRenderer.invoke("taskTemplates:delete", args),
  notesCreateTask: (args) => ipcRenderer.invoke("notes:createTask", args),
  notesLinkSessionToTask: (args) => ipcRenderer.invoke("notes:linkSessionToTask", args),
  notesListTaskSessionLinks: () => ipcRenderer.invoke("notes:listTaskSessionLinks"),
  notesEnsureTaskWorkspace: (args) => ipcRenderer.invoke("notes:ensureTaskWorkspace", args),
  notesTaskWorkspace: (args) => ipcRenderer.invoke("notes:taskWorkspace", args),
  notesOpenTaskWorkspace: (args) => ipcRenderer.invoke("notes:openTaskWorkspace", args),
  notesAddTaskProject: (args) => ipcRenderer.invoke("notes:addTaskProject", args),
  notesRemoveTaskProject: (args) => ipcRenderer.invoke("notes:removeTaskProject", args),
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
  notesDelete: (args) => ipcRenderer.invoke("notes:delete", args),
  notesRename: (args) => ipcRenderer.invoke("notes:rename", args),
  notesRenameTask: (args) => ipcRenderer.invoke("notes:renameTask", args),
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
  listProjects: (opts) => ipcRenderer.invoke("projects:list", opts),
  addProject: (args) => ipcRenderer.invoke("projects:addProject", args),
  resolveProjectCwd: (args) => ipcRenderer.invoke("projects:resolveCwd", args),
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
