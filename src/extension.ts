import * as vscode from "vscode";
import { loadAllSessions, AgentProvider, AgentSession } from "./history";
import { expandHome } from "./history/pathUtils";
import { openInGhostty } from "./terminal/ghosttyTerminal";
import { consumePendingResumeForWorkspace, storePendingResume } from "./terminal/pendingResume";
import { buildResumeCommand, openNewSessionTerminal, openResumeTerminal } from "./terminal/resumeTerminal";
import {
  filterSummary,
  projectUri,
  ProviderFilter,
  sessionQuickPickLabel,
  SessionTreeProvider,
  TimeFilter
} from "./tree/sessionTree";

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
    vscode.commands.registerCommand("agentResume.filterSessions", () => filterSessions(tree)),
    vscode.commands.registerCommand("agentResume.clearSessionFilters", () => clearSessionFilters(tree)),
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
    vscode.commands.registerCommand("agentResume.openProject", (nodeOrSession?: unknown) =>
      openFolderAndResume(context, tree, nodeOrSession)
    ),
    vscode.commands.registerCommand("agentResume.openInGhostty", (nodeOrSession?: unknown) =>
      openSessionInGhostty(tree, nodeOrSession)
    ),
    vscode.commands.registerCommand("agentResume.newCodexSession", (node?: unknown) =>
      openNewSession(tree, node, "codex", context)
    ),
    vscode.commands.registerCommand("agentResume.newClaudeSession", (node?: unknown) =>
      openNewSession(tree, node, "claude", context)
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
  const maxItems = config.get<number>("maxItems", 500);
  const showArchivedCodex = config.get<boolean>("showArchivedCodex", false);

  try {
    const result = await loadAllSessions({
      codexHome,
      claudeHome,
      maxItems,
      showArchivedCodex
    });
    tree.setData(result.sessions, result.warnings);
    await updateFilterContext(tree);
    if (showToast) {
      vscode.window.showInformationMessage(`Loaded ${result.sessions.length} agent sessions.`);
    }
  } catch (error) {
    tree.setData([], [formatError(error)]);
    await updateFilterContext(tree);
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
    title: "Resume Codex or Claude Session",
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: "Search title, provider, project, or branch"
  });

  if (picked) {
    openResumeTerminal(picked.session, undefined);
  }
}

async function filterSessions(tree: SessionTreeProvider): Promise<void> {
  const current = tree.getFilters();
  const provider = await pickProvider(current.provider);
  if (!provider) {
    return;
  }

  const time = await pickTime(current.time);
  if (!time) {
    return;
  }

  const projectPath = await pickProject(tree, current.projectPath);
  if (projectPath === undefined) {
    return;
  }

  const text = await vscode.window.showInputBox({
    title: "Filter Sessions",
    prompt: "Filter by title, project path, branch, or session id",
    value: current.text,
    placeHolder: "Optional text filter"
  });
  if (text === undefined) {
    return;
  }

  tree.setFilters({
    provider,
    time,
    projectPath: projectPath || undefined,
    text
  });
  await updateFilterContext(tree);
  vscode.window.showInformationMessage(`Session filter: ${filterSummary(tree.getFilters())}`);
}

async function clearSessionFilters(tree: SessionTreeProvider): Promise<void> {
  tree.clearFilters();
  await updateFilterContext(tree);
  vscode.window.showInformationMessage("Session filters cleared.");
}

async function pickProvider(current: ProviderFilter): Promise<ProviderFilter | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      providerItem("all", "All Providers", current),
      providerItem("codex", "Codex", current),
      providerItem("claude", "Claude", current)
    ],
    {
      title: "Filter Sessions",
      placeHolder: "Choose provider"
    }
  );

  return picked?.value;
}

async function pickTime(current: TimeFilter): Promise<TimeFilter | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      timeItem("all", "All Time", current),
      timeItem("today", "Today", current),
      timeItem("7d", "Last 7 Days", current),
      timeItem("30d", "Last 30 Days", current),
      timeItem("90d", "Last 90 Days", current)
    ],
    {
      title: "Filter Sessions",
      placeHolder: "Choose updated time range"
    }
  );

  return picked?.value;
}

async function pickProject(tree: SessionTreeProvider, current?: string): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: current ? "All Projects" : "$(check) All Projects",
        detail: "Do not filter by project",
        value: ""
      },
      ...tree.getProjects().map((projectPath) => ({
        label: current === projectPath ? `$(check) ${projectPath}` : projectPath,
        detail: projectPath,
        value: projectPath
      }))
    ],
    {
      title: "Filter Sessions",
      matchOnDetail: true,
      placeHolder: "Choose project"
    }
  );

  return picked?.value;
}

async function updateFilterContext(tree: SessionTreeProvider): Promise<void> {
  await vscode.commands.executeCommand("setContext", "agentResume.hasSessionFilters", tree.hasActiveFilters());
}

function providerItem(
  value: ProviderFilter,
  label: string,
  current: ProviderFilter
): vscode.QuickPickItem & { value: ProviderFilter } {
  return {
    label: current === value ? `$(check) ${label}` : label,
    value
  };
}

function timeItem(value: TimeFilter, label: string, current: TimeFilter): vscode.QuickPickItem & { value: TimeFilter } {
  return {
    label: current === value ? `$(check) ${label}` : label,
    value
  };
}

async function openSessionInGhostty(tree: SessionTreeProvider, nodeOrSession: unknown): Promise<void> {
  const session = await resolveOpenFolderSession(tree, nodeOrSession);
  if (!session) {
    return;
  }

  await openInGhostty(session);
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
      (value.provider === "codex" || value.provider === "claude") &&
      "id" in value
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
