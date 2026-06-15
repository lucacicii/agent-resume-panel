import * as vscode from "vscode";
import { loadAllSessions, AgentProvider, AgentSession } from "./history";
import { basenameOrPath, compactPath, expandHome } from "./history/pathUtils";
import { openCodexAppProject } from "./terminal/codexApp";
import { openInGhostty, openProjectInGhostty } from "./terminal/ghosttyTerminal";
import { consumePendingResumeForWorkspace, storePendingResume } from "./terminal/pendingResume";
import {
  buildResumeCommand,
  openCodexAppResumeTerminal,
  openNewSessionTerminal,
  openResumeTerminal
} from "./terminal/resumeTerminal";
import { projectUri, sessionQuickPickLabel, SessionTreeProvider } from "./tree/sessionTree";

type NewSessionTarget = AgentProvider | "codexApp" | "ghostty";

export function activate(context: vscode.ExtensionContext): void {
  const tree = new SessionTreeProvider();
  const treeView = vscode.window.createTreeView("agentResume.sessions", {
    treeDataProvider: tree,
    showCollapseAll: true
  });

  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand("agentResume.refresh", () => refresh(tree, true)),
    vscode.commands.registerCommand("agentResume.search", () => searchAndOpen(tree)),
    vscode.commands.registerCommand("agentResume.showMoreRecent", () => tree.showMoreRecent()),
    vscode.commands.registerCommand("agentResume.newSession", () => newSessionInCurrentWorkspace(context)),
    vscode.commands.registerCommand("agentResume.openSession", (nodeOrSession?: unknown) => {
      const session = resolveSession(tree, nodeOrSession);
      if (session) {
        openResumeTerminal(session, context);
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
    vscode.commands.registerCommand("agentResume.newCodexAppSession", (node?: unknown) =>
      openNewCodexAppSession(tree, node)
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("agentResume")) {
        void refresh(tree, false);
      }
    })
  );

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
  const maxItems = config.get<number>("maxItems", 500);
  const showArchivedCodex = config.get<boolean>("showArchivedCodex", false);
  const showSubagentGrok = config.get<boolean>("showSubagentGrok", false);

  try {
    const result = await loadAllSessions({
      codexHome,
      claudeHome,
      antigravityHome,
      grokHome,
      maxItems,
      showArchivedCodex,
      showSubagentGrok
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

async function searchAndOpen(tree: SessionTreeProvider): Promise<void> {
  let sessions = tree.getSessions();
  if (!sessions.length) {
    await refresh(tree, false);
    sessions = tree.getSessions();
  }

  const picked = await vscode.window.showQuickPick(sessions.map(sessionQuickPickLabel), {
    title: "Resume Agent Session",
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: "Search title, provider, project, or branch"
  });

  if (picked) {
    openResumeTerminal(picked.session, undefined);
  }
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
        value.provider === "grok") &&
      "id" in value
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
