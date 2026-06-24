import * as vscode from "vscode";
import { syncAllChatSummaries } from "./chat/agentSummary";
import { startWatchingSummary, stopAllWatchers } from "./chat/agentSummaryWatcher";
import { setChatApiKey } from "./chat/apiKey";
import { ChatPanelManager, handoffChatSession } from "./chat/chatPanel";
import { tryLinkChatAgent } from "./chat/linkAgent";
import { clearPendingChatLink, drainPendingChatLinks } from "./chat/pendingLinks";
import { createChatSession, panelHomeFromConfig, pickTerminalAgentProvider } from "./chat/newChat";
import { getChatRecord } from "./chat/store";
import { loadAllSessions, AgentProvider, AgentSession, HistoryLoadOptions } from "./history";
import { defaultAlmaDataDir } from "./history/alma";
import { basenameOrPath, compactPath, expandHome } from "./history/pathUtils";
import { openNewAlmaSession } from "./terminal/almaApp";
import { openCodexAppProject } from "./terminal/codexApp";
import { openInGhostty, openProjectInGhostty } from "./terminal/ghosttyTerminal";
import { consumePendingResumeForWorkspace, storePendingResume } from "./terminal/pendingResume";
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
import {
  applyProjectMenuContext,
  configureProjectMenu,
  loadMainActions
} from "./menu/projectContextMenu";
import { loadSectionOrder } from "./tree/sectionOrder";
import { SessionTreeDragDrop } from "./tree/sessionTreeDragDrop";
import { projectUri, sessionQuickPickLabel, SessionTreeProvider } from "./tree/sessionTree";

type NewSessionTarget = AgentProvider | "codexApp" | "ghostty";
type EditorNewSessionProvider = Extract<
  AgentProvider,
  "codex" | "claude" | "agy" | "grok" | "opencode" | "pi" | "chat"
>;

let extensionContext: vscode.ExtensionContext | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  const tree = new SessionTreeProvider();
  let chatPanels: ChatPanelManager;
  chatPanels = new ChatPanelManager(
    context,
    () => refresh(tree, false, chatPanels, context),
    (chatId) => {
      startWatchingSummary(context, panelHomeFromConfig(), chatId, () => loadSessionsFromConfig(), chatPanels);
    }
  );
  tree.setFavoriteProjects(loadFavoriteProjects(context));
  tree.setSectionOrder(loadSectionOrder(context));
  void applyProjectMenuContext(loadMainActions(vscode.workspace.getConfiguration("agentResume")));
  const treeView = vscode.window.createTreeView("agentResume.sessions", {
    treeDataProvider: tree,
    showCollapseAll: true,
    dragAndDropController: new SessionTreeDragDrop(tree, context)
  });

  context.subscriptions.push(
    treeView,
    { dispose: () => chatPanels.dispose() },
    vscode.commands.registerCommand("agentResume.refresh", () => refresh(tree, true, chatPanels, context)),
    vscode.commands.registerCommand("agentResume.search", () => searchAndOpen(tree, chatPanels)),
    vscode.commands.registerCommand("agentResume.showMoreRecent", () => tree.showMoreRecent()),
    vscode.commands.registerCommand("agentResume.newSession", () => newSessionInCurrentWorkspace(context, chatPanels, tree)),
    vscode.commands.registerCommand("agentResume.newSessionFromEditor", () => newSessionFromEditor(context, chatPanels, tree)),
    vscode.commands.registerCommand("agentResume.openSession", (nodeOrSession?: unknown) => {
      const session = resolveSession(tree, nodeOrSession);
      if (session) {
        void openResolvedSession(session, context, chatPanels);
      }
    }),
    vscode.commands.registerCommand("agentResume.openChatSession", (nodeOrSession?: unknown) => {
      void openChatSession(tree, nodeOrSession, chatPanels);
    }),
    vscode.commands.registerCommand("agentResume.setChatApiKey", () => setChatApiKey(context)),
    vscode.commands.registerCommand("agentResume.handoffChat", (nodeOrSession?: unknown) =>
      void handoffChat(context, tree, nodeOrSession, chatPanels)
    ),
    vscode.commands.registerCommand("agentResume.newChatSession", (node?: unknown) =>
      void openNewChatSession(tree, node, chatPanels)
    ),
    vscode.commands.registerCommand("agentResume.copyResumeCommand", async (nodeOrSession?: unknown) => {
      const session = resolveSession(tree, nodeOrSession);
      if (!session) {
        return;
      }
      await vscode.env.clipboard.writeText(buildResumeCommand(session));
      vscode.window.showInformationMessage("Resume command copied.");
    }),
    vscode.commands.registerCommand("agentResume.openFolder", (node?: unknown) => openFolder(tree, node)),
    vscode.commands.registerCommand("agentResume.openProject", (nodeOrSession?: unknown) =>
      openFolderAndResume(context, tree, nodeOrSession)
    ),
    vscode.commands.registerCommand("agentResume.openInGhostty", (nodeOrSession?: unknown) =>
      openSessionInGhostty(tree, nodeOrSession)
    ),
    vscode.commands.registerCommand("agentResume.openInCodexApp", (nodeOrSession?: unknown) =>
      openSessionInCodexApp(tree, nodeOrSession)
    ),
    vscode.commands.registerCommand("agentResume.newCodexSession", (node?: unknown) =>
      openNewSession(tree, node, "codex", context)
    ),
    vscode.commands.registerCommand("agentResume.newClaudeSession", (node?: unknown) =>
      openNewSession(tree, node, "claude", context)
    ),
    vscode.commands.registerCommand("agentResume.newAgySession", (node?: unknown) =>
      openNewSession(tree, node, "agy", context)
    ),
    vscode.commands.registerCommand("agentResume.newGrokSession", (node?: unknown) =>
      openNewSession(tree, node, "grok", context)
    ),
    vscode.commands.registerCommand("agentResume.newOpenCodeSession", (node?: unknown) =>
      openNewSession(tree, node, "opencode", context)
    ),
    vscode.commands.registerCommand("agentResume.newPiSession", (node?: unknown) =>
      openNewSession(tree, node, "pi", context)
    ),
    vscode.commands.registerCommand("agentResume.newAlmaSession", (node?: unknown) =>
      openNewAlmaSessionFromTree(tree, node)
    ),
    vscode.commands.registerCommand("agentResume.newCodexAppSession", (node?: unknown) =>
      openNewCodexAppSession(tree, node)
    ),
    vscode.commands.registerCommand("agentResume.favoriteProject", (node?: unknown) =>
      favoriteProject(context, tree, node)
    ),
    vscode.commands.registerCommand("agentResume.unfavoriteProject", (node?: unknown) =>
      unfavoriteProject(context, tree, node)
    ),
    vscode.commands.registerCommand("agentResume.configureProjectMenu", () => configureProjectMenu()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("agentResume.projectMenu.mainActions")) {
        void applyProjectMenuContext(loadMainActions(vscode.workspace.getConfiguration("agentResume")));
      }
      if (event.affectsConfiguration("agentResume")) {
        void refresh(tree, false, chatPanels, context);
      }
    })
  );

  void refresh(tree, false, chatPanels, context);
  void consumePendingResumeForWorkspace(context);
}

export function deactivate(): void {
  stopAllWatchers();
}

async function refresh(
  tree: SessionTreeProvider,
  showToast: boolean,
  chatPanels?: ChatPanelManager,
  context?: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const panelHome = panelHomeFromConfig();
  const loadOptions = buildHistoryLoadOptions(config);

  try {
    const result = await loadAllSessions(loadOptions);

    let sessions = result.sessions;
    let linkedAgentKeys = result.linkedAgentKeys;
    let linkedAny = false;

    for (const chatId of drainPendingChatLinks()) {
      const linked = await tryLinkChatAgent(panelHome, chatId, sessions, linkedAgentKeys);
      if (linked?.linkedAgent.sessionId) {
        clearPendingChatLink(chatId);
        linkedAny = true;
      }
    }

    if (linkedAny) {
      const refreshed = await loadAllSessions(loadOptions);
      sessions = refreshed.sessions;
      linkedAgentKeys = refreshed.linkedAgentKeys;
    }

    if (chatPanels && context) {
      const synced = await syncAllChatSummaries(context, panelHome, sessions, chatPanels);
      if (synced > 0) {
        const refreshed = await loadAllSessions(loadOptions);
        sessions = refreshed.sessions;
        linkedAgentKeys = refreshed.linkedAgentKeys;
      }
    }

    tree.setData(sessions, result.warnings, linkedAgentKeys);
    if (showToast) {
      vscode.window.showInformationMessage(`Loaded ${sessions.length} agent sessions.`);
    }
  } catch (error) {
    tree.setData([], [formatError(error)]);
    vscode.window.showErrorMessage(`Agent Resume refresh failed: ${formatError(error)}`);
  }
}

async function handoffChat(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  nodeOrSession: unknown,
  chatPanels: ChatPanelManager
): Promise<void> {
  const session = resolveSession(tree, nodeOrSession);
  if (!session || session.provider !== "chat") {
    return;
  }

  if (chatPanels.hasPanel(session.id)) {
    await chatPanels.runHandoff(session.id);
    return;
  }

  await handoffChatSession(
    context,
    panelHomeFromConfig(),
    session.id,
    () => refresh(tree, false, chatPanels, context),
    (chatId) => {
      startWatchingSummary(context, panelHomeFromConfig(), chatId, () => loadSessionsFromConfig(), chatPanels);
    }
  );
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
    showSubagentGrok: config.get<boolean>("showSubagentGrok", false),
    hideCronAlma: config.get<boolean>("hideCronAlma", true),
    hideChannelAlma: config.get<boolean>("hideChannelAlma", true),
    showIncognitoAlma: config.get<boolean>("showIncognitoAlma", false)
  };
}

async function loadSessionsFromConfig(): Promise<AgentSession[]> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const result = await loadAllSessions(buildHistoryLoadOptions(config));
  return result.sessions;
}

async function searchAndOpen(tree: SessionTreeProvider, chatPanels: ChatPanelManager): Promise<void> {
  let sessions = tree.getSessions();
  if (!sessions.length) {
    await refresh(tree, false, chatPanels, extensionContext);
    sessions = tree.getSessions();
  }

  const picked = await vscode.window.showQuickPick(sessions.map(sessionQuickPickLabel), {
    title: "Resume Agent Session",
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: "Search title, provider, project, or branch"
  });

  if (picked) {
    void openResolvedSession(picked.session, undefined, chatPanels);
  }
}

async function openResolvedSession(
  session: AgentSession,
  context: vscode.ExtensionContext | undefined,
  chatPanels: ChatPanelManager | undefined
): Promise<void> {
  if (session.provider === "chat") {
    if (chatPanels) {
      await openChatSessionById(session.id, chatPanels);
    }
    return;
  }
  openSessionResume(session, context);
}

async function openChatSession(
  tree: SessionTreeProvider,
  nodeOrSession: unknown,
  chatPanels: ChatPanelManager
): Promise<void> {
  const session = resolveSession(tree, nodeOrSession);
  if (!session || session.provider !== "chat") {
    return;
  }
  await openChatSessionById(session.id, chatPanels);
}

async function openChatSessionById(chatId: string, chatPanels: ChatPanelManager): Promise<void> {
  const record = await getChatRecord(panelHomeFromConfig(), chatId);
  if (!record) {
    vscode.window.showWarningMessage("Chat session not found.");
    return;
  }
  chatPanels.open(record);
}

async function openNewChatSession(
  tree: SessionTreeProvider,
  node: unknown,
  chatPanels: ChatPanelManager
): Promise<void> {
  const projectPath = tree.getProjectFromNode(node) ?? (await pickWorkspaceProject());
  if (!projectPath) {
    return;
  }

  const provider = await pickTerminalAgentProvider();
  if (!provider) {
    return;
  }

  const record = await createChatSession(projectPath, provider);
  chatPanels.open(record);
  await refresh(tree, false, chatPanels, extensionContext);
}

async function newSessionFromEditor(
  context: vscode.ExtensionContext,
  chatPanels?: ChatPanelManager,
  tree?: SessionTreeProvider
): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const provider = config.get<EditorNewSessionProvider>("editorNewSessionProvider", "codex");
  const projectPath = await resolveProjectForNewSession();
  if (!projectPath) {
    return;
  }

  if (provider === "chat") {
    const linkedProvider = await pickTerminalAgentProvider();
    if (!linkedProvider || !chatPanels) {
      return;
    }
    const record = await createChatSession(projectPath, linkedProvider);
    chatPanels.open(record);
    if (tree) {
      await refresh(tree, false, chatPanels, context);
    }
    return;
  }

  openNewSessionTerminal(provider, projectPath, context);
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

async function newSessionInCurrentWorkspace(
  context: vscode.ExtensionContext,
  chatPanels: ChatPanelManager,
  tree: SessionTreeProvider
): Promise<void> {
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

  if (target === "chat") {
    const provider = await pickTerminalAgentProvider();
    if (!provider) {
      return;
    }
    const record = await createChatSession(projectPath, provider);
    chatPanels.open(record);
    await refresh(tree, false, chatPanels, context);
    return;
  }

  openNewSessionTerminal(target, projectPath, context);
}

async function pickNewSessionTarget(): Promise<NewSessionTarget | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: "$(hubot) Codex", description: "Start a new Codex session", provider: "codex" as const },
      {
        label: "$(comment-discussion) Claude",
        description: "Start a new Claude session",
        provider: "claude" as const
      },
      {
        label: "$(sparkle) Antigravity CLI",
        description: "Start a new agy session",
        provider: "agy" as const
      },
      {
        label: "$(rocket) Grok Build",
        description: "Start a new Grok session",
        provider: "grok" as const
      },
      {
        label: "$(terminal) OpenCode",
        description: "Start a new OpenCode session",
        provider: "opencode" as const
      },
      {
        label: "$(symbol-method) Pi",
        description: "Start a new Pi session",
        provider: "pi" as const
      },
      {
        label: "$(comment) Chat",
        description: "Start a new Chat session with linked agent",
        provider: "chat" as const
      },
      {
        label: "$(window) Codex App",
        description: "Start a new Codex App session",
        provider: "codexApp" as const
      },
      {
        label: "$(terminal) Ghostty",
        description: "Open this workspace in Ghostty",
        provider: "ghostty" as const
      }
    ],
    {
      title: "New Session",
      placeHolder: "Choose agent"
    }
  );

  return picked?.provider;
}

async function pickWorkspaceProject(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) {
    vscode.window.showWarningMessage("Open a workspace folder before starting a new agent session.");
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
      title: "New Session",
      placeHolder: "Choose workspace folder"
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
    vscode.window.showWarningMessage("Open in Codex App is only available for Codex sessions.");
    return;
  }

  openCodexAppResumeTerminal(session);
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

  await storePendingResume(context, session);
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

  const picked = await vscode.window.showQuickPick(projectSessions.map(sessionQuickPickLabel), {
    title: "Select Session to Resume",
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: "Choose the conversation to resume in the new window"
  });

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
  vscode.window.showInformationMessage("Project added to favorites.");
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
  vscode.window.showInformationMessage("Project removed from favorites.");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
