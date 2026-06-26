import * as vscode from "vscode";
import { loadAllSessions, AgentProvider, AgentSession } from "./history";
import { renameSession } from "./history/rename";
import { loadRenameHomes } from "./history/rename/homes";
import { defaultAlmaDataDir } from "./history/alma";
import { basenameOrPath, compactPath, expandHome } from "./history/pathUtils";
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
import {
  applyProjectMenuContext,
  configureProjectMenu,
  loadMainActions
} from "./menu/projectContextMenu";
import { openSessionPreviewPanel } from "./preview/sessionPreviewPanel";
import { searchAndOpenSessions } from "./search/sessionSearch";
import { loadSectionOrder } from "./tree/sectionOrder";
import { SessionTreeDragDrop } from "./tree/sessionTreeDragDrop";
import { projectUri, sessionQuickPickLabel, SessionTreeProvider } from "./tree/sessionTree";

type NewSessionTarget = AgentProvider | "codexApp" | "ghostty";
type EditorNewSessionProvider = Extract<
  AgentProvider,
  "codex" | "claude" | "agy" | "grok" | "opencode" | "pi"
>;

export function activate(context: vscode.ExtensionContext): void {
  const tree = new SessionTreeProvider();
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
    vscode.commands.registerCommand("agentResume.refresh", () => refresh(tree, true)),
    vscode.commands.registerCommand("agentResume.search", () =>
      searchAndOpen(context, tree, () => refresh(tree, false))
    ),
    vscode.commands.registerCommand("agentResume.renameSession", (nodeOrSession?: unknown) =>
      renameSessionCommand(tree, nodeOrSession)
    ),
    vscode.commands.registerCommand("agentResume.previewSession", (nodeOrSession?: unknown) => {
      const session = resolveSession(tree, nodeOrSession);
      if (session) {
        void openSessionPreviewPanel(session, tree, () => refresh(tree, false), context);
      }
    }),
    vscode.commands.registerCommand("agentResume.showMoreRecent", () => tree.showMoreRecent()),
    vscode.commands.registerCommand("agentResume.newSession", () => newSessionInCurrentWorkspace(context)),
    vscode.commands.registerCommand("agentResume.newSessionFromEditor", () => newSessionFromEditor(context)),
    vscode.commands.registerCommand("agentResume.openSession", (nodeOrSession?: unknown) => {
      const session = resolveSession(tree, nodeOrSession);
      if (session) {
        openSessionResume(session, context);
      }
    }),
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
    vscode.commands.registerCommand("agentResume.openInClaudeCodePanel", (nodeOrSession?: unknown) =>
      openSessionInClaudeCodePanel(context, tree, nodeOrSession)
    ),
    vscode.commands.registerCommand("agentResume.openInCodexIdePanel", (nodeOrSession?: unknown) =>
      openSessionInCodexIdePanel(context, tree, nodeOrSession)
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
      if (event.affectsConfiguration("agentResume.codexIdePanelResume")) {
        void applyCodexIdePanelContext();
      }
      if (event.affectsConfiguration("agentResume")) {
        void refresh(tree, false);
      }
    })
  );

  void applyCodexIdePanelContext();
  void refresh(tree, false);
  void consumePendingResumeForWorkspace(context);
}

export function deactivate(): void {
  // Nothing to dispose. VS Code owns registered subscriptions.
}

async function refresh(tree: SessionTreeProvider, showToast: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const codexHome = expandHome(config.get<string>("codexHome", "~/.codex"));
  const claudeHome = expandHome(config.get<string>("claudeHome", "~/.claude"));
  const antigravityHome = expandHome(config.get<string>("antigravityHome", "~/.gemini"));
  const grokHome = expandHome(config.get<string>("grokHome", "~/.grok"));
  const almaDataDir = expandHome(config.get<string>("almaDataDir", defaultAlmaDataDir()));
  const opencodeHome = expandHome(config.get<string>("opencodeHome", "~/.local/share/opencode"));
  const piHome = expandHome(config.get<string>("piHome", "~/.pi/agent"));
  const maxItems = config.get<number>("maxItems", 500);
  const showArchivedCodex = config.get<boolean>("showArchivedCodex", false);
  const showArchivedOpenCode = config.get<boolean>("showArchivedOpenCode", false);
  const showSubagentGrok = config.get<boolean>("showSubagentGrok", false);
  const hideCronAlma = config.get<boolean>("hideCronAlma", true);
  const hideChannelAlma = config.get<boolean>("hideChannelAlma", true);
  const showIncognitoAlma = config.get<boolean>("showIncognitoAlma", false);

  try {
    const result = await loadAllSessions({
      codexHome,
      claudeHome,
      antigravityHome,
      grokHome,
      almaDataDir,
      opencodeHome,
      piHome,
      maxItems,
      showArchivedCodex,
      showArchivedOpenCode,
      showSubagentGrok,
      hideCronAlma,
      hideChannelAlma,
      showIncognitoAlma
    });
    tree.setData(result.sessions, result.warnings);
    if (showToast) {
      vscode.window.showInformationMessage(`Loaded ${result.sessions.length} agent sessions.`);
    }
  } catch (error) {
    tree.setData([], [formatError(error)]);
    vscode.window.showErrorMessage(`Agent Resume refresh failed: ${formatError(error)}`);
  }
}

async function searchAndOpen(
  context: vscode.ExtensionContext,
  tree: SessionTreeProvider,
  refreshTree: () => Promise<void>
): Promise<void> {
  let sessions = tree.getSessions();
  if (!sessions.length) {
    await refresh(tree, false);
    sessions = tree.getSessions();
  }

  if (!sessions.length) {
    vscode.window.showInformationMessage("No agent sessions found.");
    return;
  }

  await searchAndOpenSessions(context, tree, refreshTree);
}

async function renameSessionCommand(tree: SessionTreeProvider, nodeOrSession: unknown): Promise<void> {
  const session = resolveSession(tree, nodeOrSession);
  if (!session) {
    return;
  }

  const newTitle = await vscode.window.showInputBox({
    title: "Rename Session",
    prompt: "Enter a new session title",
    value: session.title,
    validateInput: (value) => (value.trim() ? undefined : "Title cannot be empty.")
  });

  if (!newTitle) {
    return;
  }

  try {
    await renameSession(session, newTitle, loadRenameHomes());
    await refresh(tree, false);
    vscode.window.showInformationMessage("Session renamed.");
  } catch (error) {
    vscode.window.showErrorMessage(`Rename failed: ${formatError(error)}`);
  }
}



async function newSessionFromEditor(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const provider = config.get<EditorNewSessionProvider>("editorNewSessionProvider", "codex");
  const projectPath = await resolveProjectForNewSession();
  if (!projectPath) {
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

async function newSessionInCurrentWorkspace(context: vscode.ExtensionContext): Promise<void> {
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
    vscode.window.showWarningMessage("Resume in Claude Code Panel is only available for Claude sessions.");
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
    vscode.window.showWarningMessage("Resume in Codex IDE Panel is only available for Codex sessions.");
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
        value.provider === "pi") &&
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
