import * as vscode from "vscode";
import { AcpChatManager, refreshAcpChatPanels } from "./acp/acpChatManager";
import { AcpChatTreeProvider } from "./acp/acpChatTree";
import { createAcpChatSession, panelHomeFromConfig, pickAcpAgentProvider } from "./acp/newSession";
import { getAcpRecord, loadAcpRecords } from "./acp/store";
import { AcpSessionRecord } from "./acp/types";
import {
  loadCatalogSettings,
  queryCatalogSessions,
  querySidebarSessions,
  removeSessionsFromPanel,
  renameSessionWithCatalog,
  resolveSessionById,
  syncCatalog
} from "./catalog";

import { AgentProvider, AgentSession, HistoryLoadOptions } from "./history";
import { renameSession } from "./history/rename";
import { loadRenameHomes } from "./history/rename/homes";
import { defaultAlmaDataDir } from "./history/alma";
import { basenameOrPath, compactPath, expandHome } from "./history/pathUtils";
import { t } from "./i18n";
import { menuCommand } from "./i18n/menuCommands";
import { registerLocalizedUiRefreshTargets, refreshAllLocalizedUi } from "./i18n/refresh";
import { applyUiLocaleContext } from "./i18n/uiLocaleContext";
import { truncateText } from "./util/dialogText";
import { openNewAlmaSession } from "./terminal/almaApp";
import { openCodexAppProject } from "./terminal/codexApp";
import { openInGhostty, openProjectInGhostty } from "./terminal/ghosttyTerminal";
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
import { getLlmConfig } from "./llm/config";
import { migrateSummariesFromGlobalState } from "./llm/summaryMigration";
import { executeHandoffCommand } from "./handoff/handoffCommand";
import { CLI_HANDOFF_TARGETS, handoffCommandId } from "./menu/handoffMenu";

import { runAutoRename } from "./preview/sessionAssistActions";
import { openSessionManagerPanel, refreshSessionManagerPanel } from "./manager/sessionManagerPanel";
import { openSessionPreviewPanel, refreshSessionPreviewPanel } from "./preview/sessionPreviewPanel";
import { refreshSessionSearchPanel, searchAndOpenSessions } from "./search/sessionSearch";
import {
  openSettingsPanel,
  openSettingsPanelToAcp,
  openSettingsPanelToProjectMenu,
  openSettingsPanelToSessionMenu,
  refreshSettingsPanel
} from "./settings/settingsPanel";
import { loadSectionOrder } from "./tree/sectionOrder";
import { SessionTreeDragDrop } from "./tree/sessionTreeDragDrop";
import { projectUri, sessionQuickPickLabel, SessionTreeProvider } from "./tree/sessionTree";
import { promptReloadIfContributionsStale } from "./upgrade/contributionSync";

type NewSessionTarget = AgentProvider | "codexApp" | "ghostty";
type EditorNewSessionProvider = Extract<AgentProvider, "codex" | "claude" | "agy" | "grok" | "opencode" | "pi">;

let extensionContext: vscode.ExtensionContext | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  void promptReloadIfContributionsStale(context);
  const tree = new SessionTreeProvider();
  const acpTree = new AcpChatTreeProvider();
  const acpChatManager = new AcpChatManager(context, () => refreshAcpChats(acpTree, false));
  tree.setFavoriteProjects(loadFavoriteProjects(context));
  tree.setSectionOrder(loadSectionOrder(context));
  tree.setProjectSessionSortMode((projectPath) => getProjectSessionSortMode(context, projectPath));
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

  context.subscriptions.push(
    treeView,
    acpTreeView,
    { dispose: () => acpChatManager.dispose() },
    vscode.commands.registerCommand("agentResume.refresh", () => refresh(tree, true)),
    vscode.commands.registerCommand("agentResume.refreshAcpChats", () => refreshAcpChats(acpTree, true)),
    vscode.commands.registerCommand("agentResume.search", () =>
      searchAndOpen(context, tree, () => refresh(tree, false), acpChatManager)
    ),
    vscode.commands.registerCommand("agentResume.openSessionManager", () =>
      openSessionManagerPanel(context, tree, () => buildHistoryLoadOptions(vscode.workspace.getConfiguration("agentResume")), () =>
        refresh(tree, false)
      )
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
    vscode.commands.registerCommand("agentResume.newSession", () => newSessionInCurrentWorkspace(context, tree)),
    vscode.commands.registerCommand("agentResume.newSessionFromEditor", () => newSessionFromEditor(context, tree)),
    vscode.commands.registerCommand("agentResume.newAcpChat", () => openNewAcpChat(acpTree, acpChatManager)),
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
      void openNewChatSession(acpTree, tree, node, acpChatManager)
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
    ...menuCommand("agentResume.newAlmaSession", (node?: unknown) => openNewAlmaSessionFromTree(tree, node)),
    ...menuCommand("agentResume.newCodexAppSession", (node?: unknown) => openNewCodexAppSession(tree, node)),
    ...menuCommand("agentResume.favoriteProject", (node?: unknown) => favoriteProject(context, tree, node)),
    ...menuCommand("agentResume.unfavoriteProject", (node?: unknown) => unfavoriteProject(context, tree, node)),
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
    ...menuCommand("agentResume.autoRenameSession", (nodeOrSession?: unknown) =>
      autoRenameSessionCommand(tree, nodeOrSession, context, () => refresh(tree, false))
    ),
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
      if (event.affectsConfiguration("agentResume.uiLanguage")) {
        void refreshAllLocalizedUi(false);
      }
      if (event.affectsConfiguration("agentResume") && !event.affectsConfiguration("agentResume.uiLanguage")) {
        void refresh(tree, false);
        void refreshAcpChats(acpTree, false);
      }
    })
  );

  void applyCodexIdePanelContext();
  void migrateSummariesFromGlobalState(context).then(() => refresh(tree, false));
  void refreshAcpChats(acpTree, false);
  void consumePendingResumeForWorkspace(context);

  registerLocalizedUiRefreshTargets({
    sessionTree: { refresh: () => tree.refresh() },
    acpTree: { refresh: () => acpTree.refresh() },
    refreshSettingsPanel,
    refreshSessionSearch: refreshSessionSearchPanel,
    refreshSessionPreview: refreshSessionPreviewPanel,
    refreshSessionManager: refreshSessionManagerPanel,
    refreshAcpChatPanels
  });
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
    const sessions = await querySidebarSessions(catalog, loadOptions.maxItems, llmConfig?.outputLanguage);
    tree.setData(sessions, result.warnings);
    if (showToast) {
      vscode.window.showInformationMessage(t("notification.syncedCliSessions", sessions.length));
    }
  } catch (error) {
    tree.setData([], [formatError(error)]);
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
  return {
    panelHome: panelHomeFromConfig(),
    codexHome: expandHome(config.get<string>("codexHome", "~/.codex")),
    claudeHome: expandHome(config.get<string>("claudeHome", "~/.claude")),
    antigravityHome: expandHome(config.get<string>("antigravityHome", "~/.gemini")),
    grokHome: expandHome(config.get<string>("grokHome", "~/.grok")),
    almaDataDir: expandHome(config.get<string>("almaDataDir", defaultAlmaDataDir())),
    opencodeHome: expandHome(config.get<string>("opencodeHome", "~/.local/share/opencode")),
    piHome: expandHome(config.get<string>("piHome", "~/.pi/agent")),
    maxItems: config.get<number>("maxItems", 500),
    showArchivedCodex: config.get<boolean>("showArchivedCodex", false),
    showArchivedOpenCode: config.get<boolean>("showArchivedOpenCode", false),
    showSubagentCodex: config.get<boolean>("showSubagentCodex", false),
    showSubagentGrok: config.get<boolean>("showSubagentGrok", false),
    hideCronAlma: config.get<boolean>("hideCronAlma", true),
    hideChannelAlma: config.get<boolean>("hideChannelAlma", true),
    showIncognitoAlma: config.get<boolean>("showIncognitoAlma", false)
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
  if (!tree.getSessions().length && !(await queryCatalogSessions(catalog)).length) {
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

async function openNewAcpChat(acpTree: AcpChatTreeProvider, acpChatManager: AcpChatManager): Promise<void> {
  const projectPath = await pickWorkspaceProject();
  if (!projectPath) {
    return;
  }

  const provider = await pickAcpAgentProvider();
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
  acpChatManager: AcpChatManager
): Promise<void> {
  const projectPath =
    acpTree.getProjectFromNode(node) ?? cliTree.getProjectFromNode(node) ?? (await pickWorkspaceProject());
  if (!projectPath) {
    return;
  }

  const provider = await pickAcpAgentProvider();
  if (!provider) {
    return;
  }

  const record = await createAcpChatSession(projectPath, provider);
  acpChatManager.open(record);
  await refreshAcpChats(acpTree, false);
}

async function newSessionFromEditor(context: vscode.ExtensionContext, tree?: SessionTreeProvider): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  let provider = config.get<EditorNewSessionProvider>("editorNewSessionProvider", "codex");
  if (provider === ("chat" as EditorNewSessionProvider)) {
    provider = "codex";
  }
  const projectPath = await resolveProjectForNewSession();
  if (!projectPath) {
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
  const target = await pickNewSessionTarget();
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

async function pickNewSessionTarget(): Promise<NewSessionTarget | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: t("quickpick.newSessionCodexLabel"),
        description: t("quickpick.newSessionCodexDescription"),
        provider: "codex" as const
      },
      {
        label: t("quickpick.newSessionClaudeLabel"),
        description: t("quickpick.newSessionClaudeDescription"),
        provider: "claude" as const
      },
      {
        label: t("quickpick.newSessionAgyLabel"),
        description: t("quickpick.newSessionAgyDescription"),
        provider: "agy" as const
      },
      {
        label: t("quickpick.newSessionGrokLabel"),
        description: t("quickpick.newSessionGrokDescription"),
        provider: "grok" as const
      },
      {
        label: t("quickpick.newSessionOpenCodeLabel"),
        description: t("quickpick.newSessionOpenCodeDescription"),
        provider: "opencode" as const
      },
      {
        label: t("quickpick.newSessionPiLabel"),
        description: t("quickpick.newSessionPiDescription"),
        provider: "pi" as const
      },
      {
        label: t("quickpick.newSessionCodexAppLabel"),
        description: t("quickpick.newSessionCodexAppDescription"),
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

function openSessionInCodexApp(tree: SessionTreeProvider, nodeOrSession: unknown): void {
  const session = resolveSession(tree, nodeOrSession);
  if (!session) {
    return;
  }

  if (session.provider !== "codex") {
    vscode.window.showWarningMessage(t("warning.codexAppOnlyForCodex"));
    return;
  }

  openCodexAppResumeTerminal(session);
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

async function openNewAlmaSessionFromTree(tree: SessionTreeProvider, node: unknown): Promise<void> {
  const projectPath = tree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }

  const almaDataDir = expandHome(
    vscode.workspace.getConfiguration("agentResume").get<string>("almaDataDir", defaultAlmaDataDir())
  );
  await openNewAlmaSession(projectPath, almaDataDir);
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

  const projectSessions = tree.getProjectSessionsFromNode(nodeOrSession);
  if (!projectSessions.length) {
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    projectSessions.map((session) => sessionQuickPickLabel(session)),
    {
      title: t("quickpick.selectSessionToResumeTitle"),
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: t("quickpick.selectSessionToResumePlaceHolder")
    }
  );

  return picked?.session;
}

function resolveSession(tree: SessionTreeProvider, nodeOrSession: unknown): AgentSession | undefined {
  const fromNode = tree.getSessionFromNode(nodeOrSession);
  if (fromNode) {
    return fromNode;
  }

  if (isAgentSession(nodeOrSession)) {
    return nodeOrSession;
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
        value.provider === "alma" ||
        value.provider === "opencode" ||
        value.provider === "pi" ||
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
