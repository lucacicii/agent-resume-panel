import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { AcpChatManager, refreshAcpChatPanels } from "./acp/acpChatManager";
import { AcpChatTreeProvider } from "./acp/acpChatTree";
import { createAcpChatSession, panelHomeFromConfig, pickAcpAgentProvider } from "./acp/newSession";
import { getAcpRecord, loadAcpRecords } from "./acp/store";
import { AcpAgentProvider, AcpSessionRecord } from "./acp/types";
import {
  loadCatalogSettings,
  queryRecentSessionsPage,
  querySessionsByKeys,
  queryVisibleSessionCount,
  removeSessionsFromPanel,
  renameSessionWithCatalog,
  resolveSessionById,
  syncCatalog
} from "./catalog";

import { AgentProvider, AgentSession, HistoryLoadOptions } from "./history";
import { renameSession } from "./history/rename";
import { loadRenameHomes } from "./history/rename/homes";
import { basenameOrPath, compactPath, expandHome } from "./history/pathUtils";
import { t } from "./i18n";
import { menuCommand } from "./i18n/menuCommands";
import { registerLocalizedUiRefreshTargets, refreshAllLocalizedUi } from "./i18n/refresh";
import { applyUiLocaleContext } from "./i18n/uiLocaleContext";
import { truncateText } from "./util/dialogText";
import { agentIconPath } from "./icons/agentIcons";
import { openCodexAppProject } from "./terminal/codexApp";
import { openInGhostty, openProjectInGhostty } from "./terminal/ghosttyTerminal";
import { HerdrSessionTracker } from "./herdr/herdrSessionTracker";
import {
  disposeBuiltInHerdrTerminals,
  getHerdrSessionTracker,
  openHerdrResume,
  restoreBuiltInHerdrTerminals,
  sendTextToActiveHerdrTerminal,
  setHerdrSessionTracker,
  setHerdrTerminalWorkspaceState
} from "./terminal/herdrTerminal";
import { consumePendingResumeForWorkspace, storePendingResume } from "./terminal/pendingResume";
import { openClaudeCodePanelResumeFlow, shouldResumeClaudeInPanel } from "./terminal/claudeCodePanel";
import {
  applyCodexIdePanelContext,
  openCodexIdePanelResumeFlow,
  shouldResumeCodexInIdePanel
} from "./terminal/codexIdePanel";
import {
  buildResumeCommand,
  openCodexAppResumeTerminal,
  openNewSessionTerminal,
  openSessionResume
} from "./terminal/resumeTerminal";
import {
  addFavoriteProject,
  loadFavoriteProjects,
  removeFavoriteProject
} from "./favorites/projectFavorites";
import { ProjectAliasStore } from "./projects/projectAliasStore";
import { GtdStatus, GTD_STATUSES } from "./catalog/gtd";
import { GtdTreeProvider, gtdStatusLabel } from "./gtd/gtdTree";
import { SessionGtdStore } from "./gtd/sessionGtdStore";
import {
  clearNotesFilterCommand,
  copyNotePathCommand,
  deleteNoteCommand,
  deleteProjectNoteCommand,
  deleteSessionNoteCommand,
  filterNotesCommand,
  importNotesCommand,
  insertNoteImageCommand,
  moveNoteCommand,
  newNoteFromNotesViewCommand,
  newProjectNoteCommand,
  newSessionNoteCommand,
  openNoteCommand,
  openNotesFolderCommand,
  openProjectNoteCommand,
  openSessionNoteCommand,
  renameNoteCommand,
  revealNoteInOsCommand,
  setNoteGtdStatusCommand
} from "./notes/noteCommands";
import { ensureCatalogSchema } from "./catalog/db";
import { NotesStore } from "./notes/notesStore";
import { NotesTreeProvider } from "./notes/notesTree";
import { notesRoot } from "./notes/notesPaths";
import { applyProjectMenuContext, loadItemOrder, loadMainActions } from "./menu/projectContextMenu";
import {
  applySessionMenuContext,
  loadMainSessionActions,
  loadSessionItemOrder
} from "./menu/sessionContextMenu";
import {
  getProjectSessionSortMode,
  ProjectSessionSortMode,
  setProjectSessionSortMode
} from "./tree/projectSessionSort";
import { getLlmConfig, isOutputLanguageFollowingUi } from "./llm/config";
import { migrateSummariesFromGlobalState } from "./llm/summaryMigration";
import { executeHandoffCommand } from "./handoff/handoffCommand";
import { CLI_HANDOFF_TARGETS, handoffCommandId } from "./menu/handoffMenu";

import { runAutoRename } from "./preview/sessionAssistActions";
import {
  openSessionManagerPanel,
  refreshSessionManagerPanel,
  restoreSessionManagerPanel
} from "./manager/sessionManagerPanel";
import {
  openSessionPreviewPanel,
  refreshSessionPreviewPanel,
  restoreSessionPreviewPanel
} from "./preview/sessionPreviewPanel";
import {
  refreshSessionSearchPanel,
  restoreSearchSessionsPanel,
  searchAndOpenSessions
} from "./search/sessionSearch";
import {
  openSettingsPanel,
  openSettingsPanelToAcp,
  openSettingsPanelToProjectMenu,
  openSettingsPanelToSessionMenu,
  refreshSettingsPanel,
  restoreSettingsPanel
} from "./settings/settingsPanel";
import { loadSectionOrder } from "./tree/sectionOrder";
import { SessionTreeDragDrop } from "./tree/sessionTreeDragDrop";
import { projectUri, sessionQuickPickLabel, SessionTreeProvider } from "./tree/sessionTree";
import { PANEL_DOC_ISSUES, PANEL_DOC_README } from "./constants/docLinks";
import { promptReloadIfContributionsStale } from "./upgrade/contributionSync";

type NewSessionTarget = AgentProvider | "codexApp" | "ghostty";
type EditorCliProvider = Extract<
  AgentProvider,
  "codex" | "claude" | "agy" | "grok" | "opencode" | "pi" | "prime" | "omp" | "cursor"
>;
type EditorNewSessionProvider = EditorCliProvider | "acp" | `acp:${AcpAgentProvider}`;

function isAcpEditorProvider(
  provider: EditorNewSessionProvider
): provider is "acp" | `acp:${AcpAgentProvider}` {
  return provider === "acp" || provider.startsWith("acp:");
}

const VALID_ACP_PROVIDERS = new Set<AcpAgentProvider>([
  "codex",
  "claude",
  "grok",
  "opencode",
  "pi",
  "prime",
  "omp"
]);

function defaultCursorIdeUserDataHome(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor", "User");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Cursor", "User");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "Cursor", "User");
}

let extensionContext: vscode.ExtensionContext | undefined;
let projectAliasStore: ProjectAliasStore | undefined;
let sessionGtdStore: SessionGtdStore | undefined;
let notesStore: NotesStore | undefined;
let gtdTree: GtdTreeProvider | undefined;
let notesTree: NotesTreeProvider | undefined;
let notesTreeView: vscode.TreeView<import("./notes/notesTree").NotesTreeNode> | undefined;
let recentApiSessions: AgentSession[] = [];
let onDidChangeSessionsEmitter: vscode.EventEmitter<void> | undefined;

export interface AgentResumeSessionSummary {
  provider: AgentProvider;
  id: string;
  title: string;
  projectPath: string;
  summary?: string;
}

export interface AgentResumeTerminalQuery {
  provider?: string;
  sessionId?: string;
  cwd?: string;
  title?: string;
  updatedNearMs?: number;
}

export interface AgentResumePanelApi {
  readonly version: 1;
  readonly onDidChangeSessions: vscode.Event<void>;
  findSessionForTerminal(query: AgentResumeTerminalQuery): AgentResumeSessionSummary | undefined;
}

function normalizePathForMatch(dir?: string): string {
  if (!dir) {
    return "";
  }
  const trimmed = dir.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return fs.realpathSync(trimmed);
  } catch {
    return path.resolve(trimmed);
  }
}

export function activate(context: vscode.ExtensionContext): AgentResumePanelApi {
  extensionContext = context;
  void promptReloadIfContributionsStale(context);
  const tree = new SessionTreeProvider(context.extensionUri);
  const acpTree = new AcpChatTreeProvider(context.extensionUri);
  const catalogDbPath = loadCatalogSettings().dbPath;
  projectAliasStore = new ProjectAliasStore(catalogDbPath);
  sessionGtdStore = new SessionGtdStore(catalogDbPath);
  notesStore = new NotesStore(catalogDbPath, panelHomeFromConfig(), ensureCatalogSchema);
  gtdTree = new GtdTreeProvider(sessionGtdStore);
  notesTree = new NotesTreeProvider(notesStore);
  const acpChatManager = new AcpChatManager(context, () => refreshAcpChats(acpTree, false));
  let acpStoreWatcher: vscode.Disposable | undefined;
  let acpStoreWatcherHome: string | undefined;
  let acpStoreRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshAcpStoreFromDisk = () => {
    if (acpStoreRefreshTimer) {
      clearTimeout(acpStoreRefreshTimer);
    }
    acpStoreRefreshTimer = setTimeout(() => {
      acpStoreRefreshTimer = undefined;
      void refreshAcpChats(acpTree, false);
      void acpChatManager.refreshExternalStore();
    }, 200);
  };
  const replaceAcpStoreWatcher = () => {
    const panelHome = panelHomeFromConfig();
    if (acpStoreWatcher && acpStoreWatcherHome === panelHome) {
      return;
    }
    acpStoreWatcher?.dispose();
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(path.join(panelHome, "acp")), "**/*.jsonl")
    );
    acpStoreWatcher = vscode.Disposable.from(
      watcher,
      watcher.onDidCreate(refreshAcpStoreFromDisk),
      watcher.onDidChange(refreshAcpStoreFromDisk),
      watcher.onDidDelete(refreshAcpStoreFromDisk)
    );
    acpStoreWatcherHome = panelHome;
  };
  replaceAcpStoreWatcher();
  tree.setFavoriteProjects(loadFavoriteProjects(context));
  tree.setSectionOrder(loadSectionOrder(context));
  tree.setProjectSessionSortMode((projectPath) => getProjectSessionSortMode(context, projectPath));
  const initialConfig = vscode.workspace.getConfiguration("agentResume");
  const herdrTracker = new HerdrSessionTracker(
    context,
    initialConfig.get<string>("herdrSocketPath", "")
  );
  setHerdrSessionTracker(herdrTracker);
  setHerdrTerminalWorkspaceState(context.workspaceState);
  if (initialConfig.get<boolean>("herdrEnabled", true)) {
    void herdrTracker.initialize().then(() => restoreBuiltInHerdrTerminals());
  }
  void applyProjectMenuContextFromConfig();
  void applySessionMenuContextFromConfig();
  void applyUiLocaleContext();
  const treeView = vscode.window.createTreeView("agentResume.sessions", {
    treeDataProvider: tree,
    showCollapseAll: true,
    dragAndDropController: new SessionTreeDragDrop(tree, context)
  });
  const acpTreeView = vscode.window.createTreeView("agentResume.acpChats", {
    treeDataProvider: acpTree,
    showCollapseAll: true
  });
  const gtdTreeView = vscode.window.createTreeView("agentResume.gtd", {
    treeDataProvider: gtdTree,
    showCollapseAll: true
  });
  notesTreeView = vscode.window.createTreeView("agentResume.notes", {
    treeDataProvider: notesTree,
    showCollapseAll: true
  });

  context.subscriptions.push(
    treeView,
    acpTreeView,
    gtdTreeView,
    notesTreeView,
    herdrTracker,
    herdrTracker.onDidChange(() => {
      tree.refresh();
      gtdTree?.refresh();
    }),
    { dispose: () => setHerdrSessionTracker(undefined) },
    { dispose: () => disposeBuiltInHerdrTerminals() },
    { dispose: () => acpChatManager.dispose() },
    vscode.window.registerWebviewPanelSerializer("agentResume.settings", {
      async deserializeWebviewPanel(panel) {
        await restoreSettingsPanel(panel, context);
      }
    }),
    vscode.window.registerWebviewPanelSerializer("agentResume.sessionManager", {
      async deserializeWebviewPanel(panel) {
        await restoreSessionManagerPanel(
          panel,
          context,
          tree,
          () => buildHistoryLoadOptions(vscode.workspace.getConfiguration("agentResume")),
          () => refresh(tree, false)
        );
      }
    }),
    vscode.window.registerWebviewPanelSerializer("agentResume.searchSessions", {
      async deserializeWebviewPanel(panel) {
        await restoreSearchSessionsPanel(panel, context, tree, () => refresh(tree, false), acpChatManager);
      }
    }),
    vscode.window.registerWebviewPanelSerializer("agentResume.sessionPreview", {
      async deserializeWebviewPanel(panel, state) {
        await restoreSessionPreviewPanel(panel, state, tree, () => refresh(tree, false), context, acpChatManager);
      }
    }),
    vscode.window.registerWebviewPanelSerializer("agentResume.acpChatPanel", {
      async deserializeWebviewPanel(panel, state) {
        const chatId =
          typeof (state as { chatId?: unknown } | undefined)?.chatId === "string"
            ? (state as { chatId: string }).chatId
            : undefined;
        if (!chatId) {
          panel.dispose();
          return;
        }
        const record = await getAcpRecord(panelHomeFromConfig(), chatId);
        if (!record) {
          panel.dispose();
          return;
        }
        acpChatManager.restore(panel, record);
      }
    }),
    {
      dispose: () => {
        if (acpStoreRefreshTimer) {
          clearTimeout(acpStoreRefreshTimer);
        }
        acpStoreWatcher?.dispose();
      }
    },
    vscode.commands.registerCommand("agentResume.refresh", () => refresh(tree, true)),
    vscode.commands.registerCommand("agentResume.refreshGtd", () => refresh(tree, true)),
    vscode.commands.registerCommand("agentResume.refreshAcpChats", () => refreshAcpChats(acpTree, true)),
    vscode.commands.registerCommand("agentResume.search", () =>
      searchAndOpen(context, tree, () => refresh(tree, false), acpChatManager)
    ),
    vscode.commands.registerCommand("agentResume.openSessionManager", () =>
      openSessionManagerPanel(context, tree, () => buildHistoryLoadOptions(vscode.workspace.getConfiguration("agentResume")), () =>
        refresh(tree, false)
      )
    ),
    ...menuCommand("agentResume.setSessionGtdStatus", (nodeOrSession?: unknown) =>
      setSessionGtdStatusCommand(tree, nodeOrSession)
    ),
    ...menuCommand("agentResume.renameSession", (nodeOrSession?: unknown) =>
      renameSessionCommand(tree, nodeOrSession, context)
    ),
    ...menuCommand("agentResume.removeSessionFromPanel", (nodeOrSession?: unknown) =>
      void removeSessionFromPanelCommand(tree, nodeOrSession)
    ),
    ...menuCommand("agentResume.previewSession", (nodeOrSession?: unknown) => {
      const session = resolveSession(tree, nodeOrSession);
      if (session && session.provider !== "chat") {
        void openSessionPreviewPanel(session, tree, () => refresh(tree, false), context, acpChatManager);
      }
    }),
    vscode.commands.registerCommand("agentResume.showMoreRecent", () => tree.showMoreRecent()),
    vscode.commands.registerCommand("agentResume.showMoreProjects", () => tree.showMoreProjects()),
    vscode.commands.registerCommand("agentResume.showMoreProjectSessions", (projectKey?: string) =>
      tree.showMoreProjectSessions(projectKey)
    ),
    vscode.commands.registerCommand("agentResume.showMoreGtdStatus", (status?: GtdStatus) =>
      gtdTree?.showMoreStatus(status)
    ),
    vscode.commands.registerCommand("agentResume.newSession", () => newSessionInCurrentWorkspace(context, tree)),
    vscode.commands.registerCommand("agentResume.newSessionFromEditor", () =>
      newSessionFromEditor(context, tree, acpTree, acpChatManager)
    ),
    vscode.commands.registerCommand("agentResume.newAcpChat", () =>
      openNewAcpChat(acpTree, acpChatManager, context.extensionUri)
    ),
    ...menuCommand("agentResume.openSession", (nodeOrSession?: unknown) => {
      const session = resolveSession(tree, nodeOrSession);
      if (session) {
        void openResolvedSession(session, context);
      }
    }),
    vscode.commands.registerCommand("agentResume.openAcpChat", (nodeOrRecord?: unknown) => {
      void openAcpChat(acpTree, nodeOrRecord, acpChatManager);
    }),
    vscode.commands.registerCommand("agentResume.openChatSession", (nodeOrSession?: unknown) => {
      void openAcpChat(acpTree, nodeOrSession, acpChatManager);
    }),
    ...menuCommand("agentResume.newChatSession", (node?: unknown) =>
      void openNewChatSession(acpTree, tree, node, acpChatManager, context.extensionUri)
    ),
    vscode.commands.registerCommand("agentResume.renameAcpChat", (nodeOrRecord?: unknown) =>
      renameAcpChatCommand(acpTree, nodeOrRecord, () => refreshAcpChats(acpTree, false))
    ),
    ...menuCommand("agentResume.copyResumeCommand", async (nodeOrSession?: unknown) => {
      const session = resolveSession(tree, nodeOrSession);
      if (!session) {
        return;
      }
      await vscode.env.clipboard.writeText(buildResumeCommand(session));
      vscode.window.showInformationMessage(t("notification.resumeCommandCopied"));
    }),
    ...menuCommand("agentResume.openFolder", (node?: unknown) => openFolder(tree, node)),
    ...menuCommand("agentResume.openProject", (nodeOrSession?: unknown) =>
      openFolderAndResume(context, tree, nodeOrSession)
    ),
    ...menuCommand("agentResume.openInGhostty", (nodeOrSession?: unknown) =>
      openSessionInGhostty(tree, nodeOrSession)
    ),
    ...menuCommand("agentResume.openInHerdr", (nodeOrSession?: unknown) =>
      openSessionInHerdr(tree, nodeOrSession, context)
    ),
    ...menuCommand("agentResume.openInCodexApp", (nodeOrSession?: unknown) =>
      openSessionInCodexApp(tree, nodeOrSession)
    ),
    ...menuCommand("agentResume.openInClaudeCodePanel", (nodeOrSession?: unknown) =>
      openSessionInClaudeCodePanel(context, tree, nodeOrSession)
    ),
    ...menuCommand("agentResume.openInCodexIdePanel", (nodeOrSession?: unknown) =>
      openSessionInCodexIdePanel(context, tree, nodeOrSession)
    ),
    ...menuCommand("agentResume.newCodexSession", (node?: unknown) => openNewSession(tree, node, "codex", context)),
    ...menuCommand("agentResume.newClaudeSession", (node?: unknown) => openNewSession(tree, node, "claude", context)),
    ...menuCommand("agentResume.newAgySession", (node?: unknown) => openNewSession(tree, node, "agy", context)),
    ...menuCommand("agentResume.newGrokSession", (node?: unknown) => openNewSession(tree, node, "grok", context)),
    ...menuCommand("agentResume.newOpenCodeSession", (node?: unknown) =>
      openNewSession(tree, node, "opencode", context)
    ),
    ...menuCommand("agentResume.newPiSession", (node?: unknown) => openNewSession(tree, node, "pi", context)),
    ...menuCommand("agentResume.newPrimeSession", (node?: unknown) => openNewSession(tree, node, "prime", context)),
    ...menuCommand("agentResume.newOmpSession", (node?: unknown) => openNewSession(tree, node, "omp", context)),
    ...menuCommand("agentResume.newCodexAppSession", (node?: unknown) => openNewCodexAppSession(tree, node)),
    ...menuCommand("agentResume.favoriteProject", (node?: unknown) => favoriteProject(context, tree, node)),
    ...menuCommand("agentResume.unfavoriteProject", (node?: unknown) => unfavoriteProject(context, tree, node)),
    ...menuCommand("agentResume.setProjectAlias", (node?: unknown) =>
      setProjectAliasCommand(tree, acpTree, node)
    ),
    ...menuCommand("agentResume.configureProjectMenu", () => openSettingsPanelToProjectMenu(context)),
    ...menuCommand("agentResume.configureSessionMenu", () => openSettingsPanelToSessionMenu(context)),
    ...menuCommand("agentResume.sortProjectSessionsUpdatedDesc", (node?: unknown) =>
      setProjectSortMode(context, tree, node, "updatedDesc")
    ),
    ...menuCommand("agentResume.sortProjectSessionsUpdatedAsc", (node?: unknown) =>
      setProjectSortMode(context, tree, node, "updatedAsc")
    ),
    ...menuCommand("agentResume.sortProjectSessionsTitleAsc", (node?: unknown) =>
      setProjectSortMode(context, tree, node, "titleAsc")
    ),
    ...menuCommand("agentResume.sortProjectSessionsTitleDesc", (node?: unknown) =>
      setProjectSortMode(context, tree, node, "titleDesc")
    ),
    vscode.commands.registerCommand("agentResume.openSettings", () => openSettingsPanel(context)),
    vscode.commands.registerCommand("agentResume.openAcpSettings", () => openSettingsPanelToAcp(context)),
    vscode.commands.registerCommand("agentResume.openDocumentation", () =>
      vscode.env.openExternal(vscode.Uri.parse(PANEL_DOC_README))
    ),
    vscode.commands.registerCommand("agentResume.reportIssue", () =>
      vscode.env.openExternal(vscode.Uri.parse(PANEL_DOC_ISSUES))
    ),
    ...menuCommand("agentResume.autoRenameSession", (nodeOrSession?: unknown) =>
      autoRenameSessionCommand(tree, nodeOrSession, context, () => refresh(tree, false))
    ),
    ...menuCommand("agentResume.openSessionNote", (nodeOrSession?: unknown) => {
      if (!notesStore) {
        return;
      }
      void openSessionNoteCommand(notesStore, tree, acpTree, gtdTree, nodeOrSession, () =>
        refreshNotesUi(tree)
      );
    }),
    ...menuCommand("agentResume.deleteSessionNote", (nodeOrSession?: unknown) => {
      if (!notesStore) {
        return;
      }
      void deleteSessionNoteCommand(notesStore, tree, acpTree, gtdTree, nodeOrSession, () =>
        refreshNotesUi(tree)
      );
    }),
    ...menuCommand("agentResume.openProjectNote", (node?: unknown) => {
      if (!notesStore) {
        return;
      }
      void openProjectNoteCommand(notesStore, tree, acpTree, node, () => refreshNotesUi(tree));
    }),
    ...menuCommand("agentResume.deleteProjectNote", (node?: unknown) => {
      if (!notesStore) {
        return;
      }
      void deleteProjectNoteCommand(notesStore, tree, acpTree, node, () => refreshNotesUi(tree));
    }),
    ...menuCommand("agentResume.newSessionNote", (nodeOrSession?: unknown) => {
      if (!notesStore) {
        return;
      }
      void newSessionNoteCommand(notesStore, tree, acpTree, gtdTree, nodeOrSession, () =>
        refreshNotesUi(tree)
      );
    }),
    ...menuCommand("agentResume.newProjectNote", (node?: unknown) => {
      if (!notesStore) {
        return;
      }
      void newProjectNoteCommand(notesStore, tree, acpTree, node, () => refreshNotesUi(tree));
    }),
    ...menuCommand("agentResume.openNote", (node?: unknown) => {
      if (!notesStore || !notesTree) {
        return;
      }
      void openNoteCommand(notesStore, notesTree, node);
    }),
    ...menuCommand("agentResume.setNoteGtdStatus", (node?: unknown) => {
      if (!notesStore || !notesTree) {
        return;
      }
      void setNoteGtdStatusCommand(notesStore, notesTree, node, () => refreshNotesUi(tree, true));
    }),
    ...menuCommand("agentResume.deleteNote", (node?: unknown) => {
      if (!notesStore || !notesTree) {
        return;
      }
      void deleteNoteCommand(notesStore, notesTree, node, () => refreshNotesUi(tree));
    }),
    ...menuCommand("agentResume.renameNote", (node?: unknown) => {
      if (!notesStore || !notesTree) {
        return;
      }
      void renameNoteCommand(notesStore, notesTree, node, () => refreshNotesUi(tree));
    }),
    ...menuCommand("agentResume.newNote", (node?: unknown) => {
      if (!notesStore || !notesTree) {
        return;
      }
      void newNoteFromNotesViewCommand(notesStore, tree, notesTree, node, () => refreshNotesUi(tree));
    }),
    ...menuCommand("agentResume.moveNote", (node?: unknown) => {
      if (!notesStore || !notesTree) {
        return;
      }
      void moveNoteCommand(notesStore, tree, notesTree, node, () => refreshNotesUi(tree));
    }),
    ...menuCommand("agentResume.importNotes", (node?: unknown) => {
      if (!notesStore || !notesTree) {
        return;
      }
      void importNotesCommand(notesStore, tree, notesTree, node, () => refreshNotesUi(tree));
    }),
    ...menuCommand("agentResume.filterNotes", () => {
      if (!notesTree) {
        return;
      }
      void filterNotesCommand(notesTree, notesTreeView);
    }),
    ...menuCommand("agentResume.clearNotesFilter", () => {
      if (!notesTree) {
        return;
      }
      void clearNotesFilterCommand(notesTree, notesTreeView);
    }),
    ...menuCommand("agentResume.refreshNotes", () => {
      void refreshNotesUi(tree, true);
    }),
    ...menuCommand("agentResume.revealNoteInOS", (node?: unknown) => {
      if (!notesStore || !notesTree) {
        return;
      }
      void revealNoteInOsCommand(notesStore, notesTree, node);
    }),
    ...menuCommand("agentResume.openNotesFolder", () => {
      if (!notesStore) {
        return;
      }
      void openNotesFolderCommand(notesStore);
    }),
    ...menuCommand("agentResume.copyNotePath", (node?: unknown) => {
      if (!notesStore || !notesTree) {
        return;
      }
      void copyNotePathCommand(notesStore, notesTree, node);
    }),
    ...menuCommand("agentResume.insertNoteImage", () => {
      if (!notesStore) {
        return;
      }
      void insertNoteImageCommand(notesStore);
    }),
    ...menuCommand("agentResume.sendNoteToHerdr", async (node?: unknown) => {
      if (!notesStore || !notesTree) {
        return;
      }
      const record = notesTree.getNoteFromNode(node);
      if (!record) {
        return;
      }
      const absPath = notesStore.absolutePath(record);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absPath));
      const formatted = workspaceFolder
        ? path.relative(workspaceFolder.uri.fsPath, absPath)
        : absPath;
      const sent = await sendTextToActiveHerdrTerminal(`@${formatted} `);
      if (sent) {
        vscode.window.showInformationMessage(t("notification.noteSentToHerdr", record.filename));
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.scheme !== "file" || !notesStore) {
        return;
      }
      const root = notesRoot(notesStore.getPanelHome());
      if (document.uri.fsPath.startsWith(root)) {
        void notesStore.reload().then(() => refreshNotesUi(tree));
      }
    }),
    ...CLI_HANDOFF_TARGETS.map((target) =>
      vscode.commands.registerCommand(handoffCommandId(target), (nodeOrSource?: unknown) => {
        void executeHandoffCommand(nodeOrSource, { target }, {
          context,
          acpChatManager,
          sessionTree: tree,
          acpTree
        }).then(() => refreshAcpChats(acpTree, false));
      })
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration("agentResume.projectMenu.mainActions") ||
        event.affectsConfiguration("agentResume.projectMenu.itemOrder")
      ) {
        void applyProjectMenuContextFromConfig();
      }
      if (
        event.affectsConfiguration("agentResume.sessionMenu.mainActions") ||
        event.affectsConfiguration("agentResume.sessionMenu.itemOrder")
      ) {
        void applySessionMenuContextFromConfig();
      }
      if (event.affectsConfiguration("agentResume.codexIdePanelResume")) {
        void applyCodexIdePanelContext();
      }
      if (
        event.affectsConfiguration("agentResume.herdrSocketPath") ||
        event.affectsConfiguration("agentResume.herdrEnabled")
      ) {
        const cfg = vscode.workspace.getConfiguration("agentResume");
        const enabled = cfg.get<boolean>("herdrEnabled", true);
        herdrTracker.setEnabled(enabled);
        if (enabled) {
          herdrTracker.setSocketPath(cfg.get<string>("herdrSocketPath", ""));
        }
      }
      if (event.affectsConfiguration("agentResume.panelHome")) {
        replaceAcpStoreWatcher();
      }
      if (event.affectsConfiguration("agentResume.uiLanguage")) {
        void refreshAllLocalizedUi(false);
        if (isOutputLanguageFollowingUi()) {
          void refresh(tree, false);
        }
      }
      if (event.affectsConfiguration("agentResume") && !event.affectsConfiguration("agentResume.uiLanguage")) {
        void refresh(tree, false);
        void refreshAcpChats(acpTree, false);
      }
    })
  );

  void applyCodexIdePanelContext();
  void Promise.all([
    migrateSummariesFromGlobalState(context),
    projectAliasStore.initialize(context),
    sessionGtdStore.initialize(),
    notesStore.initialize()
  ])
    .then(() => {
      if (gtdTree) {
        applyProjectAndGtdResolvers(tree, acpTree, gtdTree);
      }
      notesTree?.setProjectDisplayName((projectPath) => tree.getProjectDisplayName(projectPath));
      void refresh(tree, false);
      void refreshAcpChats(acpTree, false);
    })
    .catch((error) => {
      console.error("[agent-resume] Failed to initialize catalog stores during activate:", error);
      void refresh(tree, false);
      void refreshAcpChats(acpTree, false);
    });
  void consumePendingResumeForWorkspace(context);

  const notesWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(notesRoot(panelHomeFromConfig())), "**/*.md")
  );
  const onNotesFsChange = () => {
    void notesStore?.reload().then(() => refreshNotesUi(tree));
  };
  context.subscriptions.push(
    notesWatcher,
    notesWatcher.onDidCreate(onNotesFsChange),
    notesWatcher.onDidChange(onNotesFsChange),
    notesWatcher.onDidDelete(onNotesFsChange)
  );

  registerLocalizedUiRefreshTargets({
    sessionTree: { refresh: () => tree.refresh() },
    acpTree: { refresh: () => acpTree.refresh() },
    gtdTree: { refresh: () => gtdTree?.refresh() },
    notesTree: { refresh: () => notesTree?.refresh() },
    refreshSettingsPanel,
    refreshSessionSearch: refreshSessionSearchPanel,
    refreshSessionPreview: refreshSessionPreviewPanel,
    refreshSessionManager: refreshSessionManagerPanel,
    refreshAcpChatPanels
  });

  onDidChangeSessionsEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(
    onDidChangeSessionsEmitter,
    tree.onDidChangeTreeData(() => {
      onDidChangeSessionsEmitter?.fire();
    })
  );

  return {
    version: 1,
    onDidChangeSessions: onDidChangeSessionsEmitter.event,
    findSessionForTerminal(query: AgentResumeTerminalQuery): AgentResumeSessionSummary | undefined {
      const merged = new Map<string, AgentSession>();
      for (const s of recentApiSessions) {
        merged.set(`${s.provider}:${s.id}`, s);
      }
      for (const s of tree.getSessions()) {
        merged.set(`${s.provider}:${s.id}`, s);
      }
      const sessions = [...merged.values()];
      if (sessions.length === 0) {
        return undefined;
      }

      if (query.sessionId) {
        const exact = sessions.find(
          (s) => s.id === query.sessionId && (!query.provider || s.provider === query.provider)
        );
        if (exact) {
          return {
            provider: exact.provider,
            id: exact.id,
            title: exact.title,
            projectPath: exact.projectPath,
            summary: exact.sessionSummary
          };
        }
      }

      const normCwd = normalizePathForMatch(query.cwd);
      if (!normCwd || !query.provider) {
        return undefined;
      }

      const candidates = sessions.filter((s) => {
        if (s.provider !== query.provider) {
          return false;
        }
        const paths = [s.projectPath, s.nativeProjectPath]
          .map((p) => normalizePathForMatch(p))
          .filter(Boolean);
        return paths.some(
          (p) => p === normCwd || normCwd.startsWith(`${p}${path.sep}`) || p.startsWith(`${normCwd}${path.sep}`)
        );
      });

      if (candidates.length === 0) {
        return undefined;
      }

      const exactDirCandidates = candidates.filter((s) =>
        [s.projectPath, s.nativeProjectPath]
          .map((p) => normalizePathForMatch(p))
          .includes(normCwd)
      );
      const pool = exactDirCandidates.length > 0 ? exactDirCandidates : candidates;

      let best = pool[0];
      if (query.updatedNearMs && query.updatedNearMs > 0) {
        let bestDelta = Math.abs(best.updatedAt - query.updatedNearMs);
        for (const s of pool.slice(1)) {
          const delta = Math.abs(s.updatedAt - query.updatedNearMs);
          if (delta < bestDelta) {
            best = s;
            bestDelta = delta;
          }
        }
        // Avoid linking unrelated stale sessions (> 6h away) when only directory matched
        if (bestDelta > 6 * 60 * 60 * 1000) {
          return undefined;
        }
      }

      return {
        provider: best.provider,
        id: best.id,
        title: best.title,
        projectPath: best.projectPath,
        summary: best.sessionSummary
      };
    }
  };
}

export function deactivate(): void {
  // AcpChatManager disposes via context.subscriptions.
}

async function refresh(tree: SessionTreeProvider, showToast: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const loadOptions = buildHistoryLoadOptions(config);
  const catalog = loadCatalogSettings(config);

  try {
    const result = await syncCatalog(loadOptions, catalog);
    const llmConfig = extensionContext ? await getLlmConfig(extensionContext) : undefined;
    const maxCap = catalog.sidebarMode === "full" ? Math.max(loadOptions.maxItems, catalog.syncMaxItems) : loadOptions.maxItems;
    await projectAliasStore?.reload();
    await sessionGtdStore?.reload();
    await notesStore?.reload();
    tree.setCatalogSource({
      dbPath: catalog.dbPath,
      maxCap,
      outputLanguage: llmConfig?.outputLanguage,
      warnings: result.warnings
    });
    gtdTree?.setCatalogSource({
      dbPath: catalog.dbPath,
      outputLanguage: llmConfig?.outputLanguage,
      warnings: result.warnings
    });
    const noteSessionKeys = (notesStore?.getAllNotes() ?? [])
      .filter((note) => note.scope === "session" && note.provider && note.agentSessionId)
      .map((note) => ({ provider: note.provider!, id: note.agentSessionId! }));
    const [noteSessions, recentPage] = await Promise.all([
      querySessionsByKeys(catalog.dbPath, noteSessionKeys, llmConfig?.outputLanguage),
      queryRecentSessionsPage(catalog.dbPath, {
        limit: 150,
        offset: 0,
        maxCap,
        outputLanguage: llmConfig?.outputLanguage
      }).catch(() => ({ sessions: [] as AgentSession[] }))
    ]);
    recentApiSessions = recentPage.sessions;
    notesTree?.setSessions(noteSessions);
    notesTree?.setProjectDisplayName((projectPath) => tree.getProjectDisplayName(projectPath));
    notesTree?.refresh();
    onDidChangeSessionsEmitter?.fire();
    if (showToast) {
      const totalVisible = await queryVisibleSessionCount(catalog.dbPath, maxCap);
      vscode.window.showInformationMessage(t("notification.syncedCliSessions", totalVisible));
    }
  } catch (error) {
    tree.setData([], [formatError(error)]);
    gtdTree?.setData([], [formatError(error)]);
    notesTree?.setSessions([]);
    notesTree?.refresh();
    vscode.window.showErrorMessage(t("notification.refreshFailed", formatError(error)));
  }
}

async function refreshAcpChats(acpTree: AcpChatTreeProvider, showToast: boolean): Promise<void> {
  try {
    const records = await loadAcpRecords(panelHomeFromConfig());
    acpTree.setData(records);
    if (showToast) {
      vscode.window.showInformationMessage(t("notification.loadedAcpChats", records.length));
    }
  } catch (error) {
    acpTree.setData([], [formatError(error)]);
    vscode.window.showErrorMessage(t("notification.acpRefreshFailed", formatError(error)));
  }
}

function buildHistoryLoadOptions(
  config: vscode.WorkspaceConfiguration
): HistoryLoadOptions {
  const configuredCursorIdeUserDataHome = config.get<string>("cursorIdeUserDataHome", "").trim();
  return {
    panelHome: panelHomeFromConfig(),
    codexHome: expandHome(config.get<string>("codexHome", "~/.codex")),
    claudeHome: expandHome(config.get<string>("claudeHome", "~/.claude")),
    antigravityHome: expandHome(config.get<string>("antigravityHome", "~/.gemini")),
    grokHome: expandHome(config.get<string>("grokHome", "~/.grok")),
    opencodeHome: expandHome(config.get<string>("opencodeHome", "~/.local/share/opencode")),
    piHome: expandHome(config.get<string>("piHome", "~/.pi/agent")),
    primeHome: expandHome(config.get<string>("primeHome", "~/.prime/agent")),
    ompHome: expandHome(config.get<string>("ompHome", "~/.omp/agent")),
    cursorHome: expandHome(config.get<string>("cursorHome", "~/.cursor")),
    cursorIdeUserDataHome: configuredCursorIdeUserDataHome
      ? expandHome(configuredCursorIdeUserDataHome)
      : defaultCursorIdeUserDataHome(),
    maxItems: config.get<number>("maxItems", 10_000),
    showArchivedCodex: config.get<boolean>("showArchivedCodex", false),
    showArchivedOpenCode: config.get<boolean>("showArchivedOpenCode", false),
    showSubagentCodex: config.get<boolean>("showSubagentCodex", false),
    showSubagentGrok: config.get<boolean>("showSubagentGrok", false),
    showArchivedCursorIde: config.get<boolean>("showArchivedCursorIde", false),
    showSubagentCursorIde: config.get<boolean>("showSubagentCursorIde", false)
  };
}

async function searchAndOpen(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  refreshTree: () => Promise<void>,
  acpChatManager: AcpChatManager
): Promise<void> {
  await refresh(tree, false);
  const catalog = loadCatalogSettings();
  if ((await queryVisibleSessionCount(catalog.dbPath)) === 0) {
    vscode.window.showInformationMessage(t("notification.noAgentSessionsFound"));
    return;
  }
  await searchAndOpenSessions(context, tree, refreshTree, acpChatManager);
}

async function autoRenameSessionCommand(
  tree: SessionTreeProvider,
  nodeOrSession: unknown,
  context: vscode.ExtensionContext,
  refreshTree: () => Promise<void>
): Promise<void> {
  const session = resolveSession(tree, nodeOrSession);
  if (!session) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("progress.autoRenamingSession"),
      cancellable: false
    },
    async () => {
      await runAutoRename(session, tree, refreshTree, context);
    }
  );
}

async function renameSessionCommand(
  tree: SessionTreeProvider,
  nodeOrSession: unknown,
  context?: vscode.ExtensionContext
): Promise<void> {
  const session = resolveSession(tree, nodeOrSession);
  if (!session || session.provider === "chat") {
    return;
  }

  const newTitle = await vscode.window.showInputBox({
    title: t("dialog.renameSessionTitle"),
    prompt: t("dialog.renameSessionPrompt"),
    value: session.title,
    validateInput: (value) => (value.trim() ? undefined : t("dialog.renameSessionValidateEmpty"))
  });

  if (!newTitle) {
    return;
  }

  try {
    await renameSessionWithCatalog(session, newTitle, loadRenameHomes());
    await refresh(tree, false);
    vscode.window.showInformationMessage(t("notification.sessionRenamed"));
  } catch (error) {
    vscode.window.showErrorMessage(t("notification.renameFailed", formatError(error)));
  }
}

async function removeSessionFromPanelCommand(tree: SessionTreeProvider, nodeOrSession: unknown): Promise<void> {
  const session =
    resolveSession(tree, nodeOrSession) ??
    (await resolveSessionFromArgument(tree, nodeOrSession));
  if (!session || session.provider === "chat") {
    return;
  }

  const removeButton = t("dialog.buttonRemove");
  const confirm = await vscode.window.showWarningMessage(
    t(
      "dialog.removeFromPanelConfirm",
      truncateText(session.title, 48),
      session.provider
    ),
    { modal: true },
    removeButton
  );
  if (confirm !== removeButton) {
    return;
  }

  try {
    const catalog = loadCatalogSettings();
    await removeSessionsFromPanel(catalog.dbPath, [session]);
    await refresh(tree, false);
    vscode.window.showInformationMessage(t("notification.sessionRemovedFromPanel"));
  } catch (error) {
    vscode.window.showErrorMessage(t("notification.removeFailed", formatError(error)));
  }
}

async function resolveSessionFromArgument(tree: SessionTreeProvider, value: unknown): Promise<AgentSession | undefined> {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const provider = (value as { provider?: AgentProvider }).provider;
  const id = (value as { id?: string }).id;
  if (!provider || !id) {
    return undefined;
  }
  return resolveSessionById(tree, provider, id);
}

async function openResolvedSession(session: AgentSession, context: vscode.ExtensionContext | undefined): Promise<void> {
  if (session.provider === "chat") {
    return;
  }
  openSessionResume(session, context);
}

async function openAcpChat(
  acpTree: AcpChatTreeProvider,
  nodeOrRecord: unknown,
  acpChatManager: AcpChatManager
): Promise<void> {
  const record = acpTree.getRecordFromNode(nodeOrRecord);
  if (!record) {
    return;
  }
  await openAcpChatById(record.id, acpChatManager);
}

async function openAcpChatById(chatId: string, acpChatManager: AcpChatManager): Promise<void> {
  const record = await getAcpRecord(panelHomeFromConfig(), chatId);
  if (!record) {
    vscode.window.showWarningMessage(t("notification.acpChatNotFound"));
    return;
  }
  acpChatManager.open(record);
}

async function openNewAcpChat(
  acpTree: AcpChatTreeProvider,
  acpChatManager: AcpChatManager,
  extensionUri?: vscode.Uri
): Promise<void> {
  const projectPath = await pickWorkspaceProject();
  if (!projectPath) {
    return;
  }

  const provider = await pickAcpAgentProvider(extensionUri);
  if (!provider) {
    return;
  }

  const record = await createAcpChatSession(projectPath, provider);
  acpChatManager.open(record);
  await refreshAcpChats(acpTree, false);
}

async function openNewChatSession(
  acpTree: AcpChatTreeProvider,
  cliTree: SessionTreeProvider,
  node: unknown,
  acpChatManager: AcpChatManager,
  extensionUri?: vscode.Uri
): Promise<void> {
  const projectPath =
    acpTree.getProjectFromNode(node) ?? cliTree.getProjectFromNode(node) ?? (await pickWorkspaceProject());
  if (!projectPath) {
    return;
  }

  const provider = await pickAcpAgentProvider(extensionUri);
  if (!provider) {
    return;
  }

  const record = await createAcpChatSession(projectPath, provider);
  acpChatManager.open(record);
  await refreshAcpChats(acpTree, false);
}

async function newSessionFromEditor(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider | undefined,
  acpTree: AcpChatTreeProvider,
  acpChatManager: AcpChatManager
): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  let provider = config.get<EditorNewSessionProvider>("editorNewSessionProvider", "codex");
  if (provider === ("chat" as EditorNewSessionProvider)) {
    provider = "codex";
  }
  const projectPath = await resolveProjectForNewSession();
  if (!projectPath) {
    return;
  }

  if (isAcpEditorProvider(provider)) {
    const requested = provider.startsWith("acp:") ? provider.slice(4) : undefined;
    const acpProvider =
      requested && VALID_ACP_PROVIDERS.has(requested as AcpAgentProvider)
        ? (requested as AcpAgentProvider)
        : await pickAcpAgentProvider(context.extensionUri);
    if (!acpProvider) {
      return;
    }

    const record = await createAcpChatSession(projectPath, acpProvider);
    acpChatManager.open(record);
    await refreshAcpChats(acpTree, false);
    return;
  }

  openNewSessionTerminal(provider, projectPath, context);
  void tree;
}

async function resolveProjectForNewSession(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (folder) {
      return folder.uri.fsPath;
    }
  }

  return pickWorkspaceProject();
}

async function newSessionInCurrentWorkspace(context: vscode.ExtensionContext, tree: SessionTreeProvider): Promise<void> {
  const target = await pickNewSessionTarget(context.extensionUri);
  if (!target) {
    return;
  }

  const projectPath = await pickWorkspaceProject();
  if (!projectPath) {
    return;
  }

  if (target === "codexApp") {
    openCodexAppProject(projectPath);
    return;
  }

  if (target === "ghostty") {
    await openProjectInGhostty(projectPath);
    return;
  }

  openNewSessionTerminal(target, projectPath, context);
  void tree;
}

function stripCodiconPrefix(label: string): string {
  return label.replace(/^\$\([^)]+\)\s*/, "");
}

async function pickNewSessionTarget(extensionUri?: vscode.Uri): Promise<NewSessionTarget | undefined> {
  const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { provider: NewSessionTarget }>(
    [
      {
        label: stripCodiconPrefix(t("quickpick.newSessionCodexLabel")),
        description: t("quickpick.newSessionCodexDescription"),
        iconPath: agentIconPath(extensionUri, "codex"),
        provider: "codex" as const
      },
      {
        label: stripCodiconPrefix(t("quickpick.newSessionClaudeLabel")),
        description: t("quickpick.newSessionClaudeDescription"),
        iconPath: agentIconPath(extensionUri, "claude"),
        provider: "claude" as const
      },
      {
        label: stripCodiconPrefix(t("quickpick.newSessionAgyLabel")),
        description: t("quickpick.newSessionAgyDescription"),
        iconPath: agentIconPath(extensionUri, "agy"),
        provider: "agy" as const
      },
      {
        label: stripCodiconPrefix(t("quickpick.newSessionGrokLabel")),
        description: t("quickpick.newSessionGrokDescription"),
        iconPath: agentIconPath(extensionUri, "grok"),
        provider: "grok" as const
      },
      {
        label: stripCodiconPrefix(t("quickpick.newSessionOpenCodeLabel")),
        description: t("quickpick.newSessionOpenCodeDescription"),
        iconPath: agentIconPath(extensionUri, "opencode"),
        provider: "opencode" as const
      },
      {
        label: stripCodiconPrefix(t("quickpick.newSessionPiLabel")),
        description: t("quickpick.newSessionPiDescription"),
        iconPath: agentIconPath(extensionUri, "pi"),
        provider: "pi" as const
      },
      {
        label: stripCodiconPrefix(t("quickpick.newSessionPrimeLabel")),
        description: t("quickpick.newSessionPrimeDescription"),
        iconPath: agentIconPath(extensionUri, "prime"),
        provider: "prime" as const
      },
      {
        label: stripCodiconPrefix(t("quickpick.newSessionOmpLabel")),
        description: t("quickpick.newSessionOmpDescription"),
        iconPath: agentIconPath(extensionUri, "omp"),
        provider: "omp" as const
      },
      {
        label: "Cursor CLI",
        description: "Start a Cursor agent session in the selected workspace",
        iconPath: agentIconPath(extensionUri, "cursor"),
        provider: "cursor" as const
      },
      {
        label: stripCodiconPrefix(t("quickpick.newSessionCodexAppLabel")),
        description: t("quickpick.newSessionCodexAppDescription"),
        iconPath: agentIconPath(extensionUri, "codex"),
        provider: "codexApp" as const
      },
      {
        label: t("quickpick.newSessionGhosttyLabel"),
        description: t("quickpick.newSessionGhosttyDescription"),
        provider: "ghostty" as const
      }
    ],
    {
      title: t("quickpick.newSessionTitle"),
      placeHolder: t("quickpick.newSessionPlaceHolder")
    }
  );

  return picked?.provider;
}

async function pickWorkspaceProject(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) {
    vscode.window.showWarningMessage(t("warning.openWorkspaceBeforeNewSession"));
    return undefined;
  }

  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: basenameOrPath(folder.uri.fsPath),
      description: compactPath(folder.uri.fsPath),
      projectPath: folder.uri.fsPath
    })),
    {
      title: t("quickpick.workspaceFolderTitle"),
      placeHolder: t("quickpick.workspaceFolderPlaceHolder")
    }
  );

  return picked?.projectPath;
}

async function openSessionInGhostty(tree: SessionTreeProvider, nodeOrSession: unknown): Promise<void> {
  const session = await resolveOpenFolderSession(tree, nodeOrSession);
  if (!session) {
    return;
  }

  await openInGhostty(session);
}

async function openSessionInHerdr(
  tree: SessionTreeProvider,
  nodeOrSession: unknown,
  context: vscode.ExtensionContext
): Promise<void> {
  const session = resolveSession(tree, nodeOrSession);
  if (!session) {
    return;
  }

  await openHerdrResume(session, context);
}

function openSessionInCodexApp(tree: SessionTreeProvider, nodeOrSession: unknown): void {
  const session = resolveSession(tree, nodeOrSession);
  if (!session) {
    return;
  }

  if (session.provider !== "codex") {
    vscode.window.showWarningMessage(t("warning.codexAppOnlyForCodex"));
    return;
  }

  void openCodexAppResumeTerminal(session);
}

async function openSessionInClaudeCodePanel(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  nodeOrSession: unknown
): Promise<void> {
  const session = resolveSession(tree, nodeOrSession);
  if (!session) {
    return;
  }

  if (session.provider !== "claude") {
    vscode.window.showWarningMessage(t("warning.claudePanelOnlyForClaude"));
    return;
  }

  await openClaudeCodePanelResumeFlow(session, context);
}

async function openSessionInCodexIdePanel(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  nodeOrSession: unknown
): Promise<void> {
  const session = resolveSession(tree, nodeOrSession);
  if (!session) {
    return;
  }

  if (session.provider !== "codex") {
    vscode.window.showWarningMessage(t("warning.codexIdePanelOnlyForCodex"));
    return;
  }

  await openCodexIdePanelResumeFlow(session, context);
}

async function openFolder(tree: SessionTreeProvider, node: unknown): Promise<void> {
  const projectPath = tree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }

  await vscode.commands.executeCommand("vscode.openFolder", projectUri(projectPath), true);
}

async function openFolderAndResume(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  nodeOrSession: unknown
): Promise<void> {
  const session = await resolveOpenFolderSession(tree, nodeOrSession);
  if (!session) {
    return;
  }

  let pendingOptions: { claudePanel?: boolean; codexPanel?: boolean } | undefined;
  if (session.provider === "claude" && shouldResumeClaudeInPanel()) {
    pendingOptions = { claudePanel: true };
  } else if (session.provider === "codex" && shouldResumeCodexInIdePanel()) {
    pendingOptions = { codexPanel: true };
  }

  await storePendingResume(context, session, pendingOptions);
  await vscode.commands.executeCommand("vscode.openFolder", projectUri(session.projectPath), true);
}

function openNewSession(
  tree: SessionTreeProvider,
  node: unknown,
  provider: AgentProvider,
  context: vscode.ExtensionContext
): void {
  const projectPath = tree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }

  openNewSessionTerminal(provider, projectPath, context);
}

function openNewCodexAppSession(tree: SessionTreeProvider, node: unknown): void {
  const projectPath = tree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }

  openCodexAppProject(projectPath);
}

async function resolveOpenFolderSession(
  tree: SessionTreeProvider,
  nodeOrSession: unknown
): Promise<AgentSession | undefined> {
  const session = resolveSession(tree, nodeOrSession);
  if (session) {
    return session;
  }

  const projectSessions = await tree.loadProjectSessionsFromNode(nodeOrSession, 200);
  if (!projectSessions.length) {
    return undefined;
  }

  const extensionUri = tree.getSessionTreeItemOptions().extensionUri;
  const picked = await vscode.window.showQuickPick(
    projectSessions.map((session) => sessionQuickPickLabel(session, { extensionUri })),
    {
      title: t("quickpick.selectSessionToResumeTitle"),
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: t("quickpick.selectSessionToResumePlaceHolder")
    }
  );

  return picked?.session;
}

function applyProjectAndGtdResolvers(
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  gtdTreeProvider: GtdTreeProvider
): void {
  const aliasResolver = (projectPath: string) =>
    projectAliasStore?.get(projectPath) ?? getHerdrSessionTracker()?.getSpaceNameForFolder(projectPath);
  tree.setProjectAliasResolver(aliasResolver);
  acpTree.setProjectAliasResolver(aliasResolver);

  const gtdResolver = (session: AgentSession) => {
    const status = sessionGtdStore?.get(session);
    return status ? gtdStatusLabel(status) : undefined;
  };
  tree.setGtdStatusResolver(gtdResolver);
  tree.setGtdRawStatusResolver((session) => sessionGtdStore?.get(session));
  tree.setHasSessionNoteResolver((session) => notesStore?.hasSessionNote(session) ?? false);
  tree.setHasProjectNoteResolver((projectPath) => notesStore?.hasProjectNote(projectPath) ?? false);
  tree.setHerdrMatchResolver((session) => {
    const enabled = vscode.workspace
      .getConfiguration("agentResume")
      .get<boolean>("herdrEnabled", true);
    if (!enabled) {
      return undefined;
    }
    return getHerdrSessionTracker()?.resolve(session);
  });
  gtdTreeProvider.setSessionTreeOptions(tree.getSessionTreeItemOptions());
}

function refreshNotesUi(tree: SessionTreeProvider, reload = false): void {
  const run = async () => {
    if (reload) {
      await notesStore?.reload();
    }
    tree.refresh();
    gtdTree?.refresh();
    notesTree?.refresh();
  };
  void run();
}

async function setSessionGtdStatusCommand(
  tree: SessionTreeProvider,
  nodeOrSession: unknown
): Promise<void> {
  const session = resolveSession(tree, nodeOrSession);
  if (!session || session.provider === "chat" || !sessionGtdStore) {
    return;
  }

  const current = sessionGtdStore.get(session);
  const picked = await vscode.window.showQuickPick<
    { label: string; description?: string; status?: GtdStatus }
  >(
    [
      ...GTD_STATUSES.map((status) => ({
        label: gtdStatusLabel(status),
        description: current === status ? t("dialog.setGtdStatusCurrent") : undefined,
        status
      })),
      { label: t("menu.session.clearGtdStatus") }
    ],
    {
      title: t("dialog.setGtdStatusTitle"),
      placeHolder: t("dialog.setGtdStatusPlaceholder")
    }
  );

  if (!picked) {
    return;
  }

  if (!picked.status) {
    await sessionGtdStore.clear(session);
    tree.refresh();
    gtdTree?.refresh();
    await refreshSessionSearchPanel();
    await refreshSessionManagerPanel();
    vscode.window.showInformationMessage(t("notification.gtdStatusCleared"));
    return;
  }

  await sessionGtdStore.set(session, picked.status);
  tree.refresh();
  gtdTree?.refresh();
  await refreshSessionSearchPanel();
  await refreshSessionManagerPanel();
  vscode.window.showInformationMessage(t("notification.gtdStatusSet", gtdStatusLabel(picked.status)));
}

function resolveSession(tree: SessionTreeProvider, nodeOrSession: unknown): AgentSession | undefined {
  const fromNode = tree.getSessionFromNode(nodeOrSession) ?? gtdTree?.getSessionFromNode(nodeOrSession);
  if (fromNode) {
    return fromNode;
  }

  if (isAgentSession(nodeOrSession)) {
    const matched =
      tree
        .getSessions()
        .find((s) => s.provider === nodeOrSession.provider && s.id === nodeOrSession.id) ??
      recentApiSessions.find((s) => s.provider === nodeOrSession.provider && s.id === nodeOrSession.id);
    return matched ?? nodeOrSession;
  }

  return undefined;
}

function isAgentSession(value: unknown): value is AgentSession {
  return Boolean(
    value &&
      typeof value === "object" &&
      "provider" in value &&
      (value.provider === "codex" ||
        value.provider === "claude" ||
        value.provider === "agy" ||
        value.provider === "grok" ||
        value.provider === "opencode" ||
        value.provider === "pi" ||
        value.provider === "prime" ||
        value.provider === "omp" ||
        value.provider === "cursor" ||
        value.provider === "cursor-ide" ||
        value.provider === "chat") &&
      "id" in value
  );
}

async function favoriteProject(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  node: unknown
): Promise<void> {
  const projectPath = tree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }

  const favorites = await addFavoriteProject(context, projectPath);
  tree.setFavoriteProjects(favorites);
  vscode.window.showInformationMessage(t("notification.projectAddedToFavorites"));
}

async function unfavoriteProject(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  node: unknown
): Promise<void> {
  const projectPath = tree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }

  const favorites = await removeFavoriteProject(context, projectPath);
  tree.setFavoriteProjects(favorites);
  vscode.window.showInformationMessage(t("notification.projectRemovedFromFavorites"));
}

async function setProjectAliasCommand(
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  node: unknown
): Promise<void> {
  const projectPath = tree.getProjectFromNode(node);
  if (!projectPath || !projectAliasStore) {
    return;
  }

  const nextAlias = await vscode.window.showInputBox({
    title: t("dialog.setProjectAliasTitle"),
    prompt: t("dialog.setProjectAliasPrompt"),
    placeHolder: t("dialog.setProjectAliasPlaceholder"),
    value: projectAliasStore.get(projectPath) ?? ""
  });

  if (nextAlias === undefined) {
    return;
  }

  await projectAliasStore.set(projectPath, nextAlias);
  const trimmedAlias = nextAlias.trim();
  if (trimmedAlias) {
    const tracker = getHerdrSessionTracker();
    const space = tracker?.getSpaceByFolder(projectPath);
    if (space?.id) {
      const bridgeApi = tracker?.getBridgeApi();
      if (bridgeApi) {
        void bridgeApi.renameSpace(space.id, trimmedAlias).catch(() => undefined);
      } else if (tracker?.herdrApp.isAvailable()) {
        void tracker.herdrApp.doCommand("space.rename", { id: space.id, name: trimmedAlias }).catch(() => undefined);
      }
    }
  }
  tree.refresh();
  acpTree.refresh();
  await refreshSessionSearchPanel();
  await refreshSessionManagerPanel();
  vscode.window.showInformationMessage(
    trimmedAlias ? t("notification.projectAliasSet") : t("notification.projectAliasCleared")
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function acpRecordToAgentSession(record: AcpSessionRecord): AgentSession {
  return {
    provider: "chat",
    id: record.id,
    title: record.title,
    projectPath: record.projectPath,
    updatedAt: record.updatedAt,
    messageCount: record.messageCount,
    source: "acp",
    acpProvider: record.provider,
    model: record.provider
  };
}

async function renameAcpChatCommand(
  acpTree: AcpChatTreeProvider,
  nodeOrRecord: unknown,
  refreshAcpTree: () => Promise<void>
): Promise<void> {
  const record = acpTree.getRecordFromNode(nodeOrRecord);
  if (!record) {
    return;
  }

  const nextTitle = await vscode.window.showInputBox({
    title: t("dialog.renameAcpChatTitle"),
    value: record.title,
    prompt: t("dialog.renameAcpChatPrompt"),
    validateInput: (value) => (value.trim() ? undefined : t("dialog.renameSessionValidateEmpty"))
  });
  if (!nextTitle) {
    return;
  }

  try {
    await renameSession(acpRecordToAgentSession(record), nextTitle, loadRenameHomes());
    await refreshAcpTree();
    vscode.window.showInformationMessage(t("notification.acpChatRenamed"));
  } catch (error) {
    vscode.window.showErrorMessage(t("notification.renameFailed", formatError(error)));
  }
}

function applyProjectMenuContextFromConfig(): void {
  const config = vscode.workspace.getConfiguration("agentResume");
  void applyProjectMenuContext(loadMainActions(config), loadItemOrder(config));
}

function applySessionMenuContextFromConfig(): void {
  const config = vscode.workspace.getConfiguration("agentResume");
  void applySessionMenuContext(loadMainSessionActions(config), loadSessionItemOrder(config));
}

async function setProjectSortMode(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  node: unknown,
  mode: ProjectSessionSortMode
): Promise<void> {
  const projectPath = tree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }

  await setProjectSessionSortMode(context, projectPath, mode);
  tree.setProjectSessionSortMode((pathValue) => getProjectSessionSortMode(context, pathValue));
  vscode.window.showInformationMessage(t("notification.sessionsSortedBy", sortModeLabel(mode)));
}

function sortModeLabel(mode: ProjectSessionSortMode): string {
  switch (mode) {
    case "updatedAsc":
      return t("tree.sortModeUpdatedAsc");
    case "titleAsc":
      return t("tree.sortModeTitleAsc");
    case "titleDesc":
      return t("tree.sortModeTitleDesc");
    case "updatedDesc":
    default:
      return t("tree.sortModeUpdatedDesc");
  }
}
