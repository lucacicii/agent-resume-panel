import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession, basenameOrPath, compactPath } from "../history";

type RootNode = RecentRootNode | ProjectsRootNode | WarningNode | EmptyNode;
type TreeNode = RootNode | ProjectNode | SessionNode | ShowMoreRecentNode;

const recentInitialLimit = 10;
const recentLimitStep = 10;

interface RecentRootNode {
  kind: "recentRoot";
}

interface ProjectsRootNode {
  kind: "projectsRoot";
}

interface WarningNode {
  kind: "warning";
  message: string;
}

interface EmptyNode {
  kind: "empty";
}

interface ShowMoreRecentNode {
  kind: "showMoreRecent";
  remaining: number;
}

interface ProjectNode {
  kind: "project";
  projectPath: string;
  sessions: AgentSession[];
}

export interface SessionNode {
  kind: "session";
  session: AgentSession;
  showProjectName?: boolean;
}

export class SessionTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private sessions: AgentSession[] = [];
  private warnings: string[] = [];
  private recentVisibleCount = recentInitialLimit;

  setData(sessions: AgentSession[], warnings: string[]): void {
    this.sessions = sessions;
    this.warnings = warnings;
    this.recentVisibleCount = recentInitialLimit;
    this.onDidChangeTreeDataEmitter.fire();
  }

  getSessionFromNode(node: unknown): AgentSession | undefined {
    if (isSessionNode(node)) {
      return node.session;
    }
    return undefined;
  }

  getProjectFromNode(node: unknown): string | undefined {
    if (isProjectNode(node)) {
      return node.projectPath;
    }
    if (isSessionNode(node)) {
      return node.session.projectPath;
    }
    return undefined;
  }

  getProjectSessionsFromNode(node: unknown): AgentSession[] {
    if (isProjectNode(node)) {
      return node.sessions;
    }
    if (isSessionNode(node)) {
      return [node.session];
    }
    return [];
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "recentRoot":
        return rootItem("Recent Sessions", "clock");
      case "projectsRoot":
        return rootItem("Projects", "folder-library");
      case "warning": {
        const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("warning");
        return item;
      }
      case "empty": {
        const item = new vscode.TreeItem("No sessions found", vscode.TreeItemCollapsibleState.None);
        item.description = "Check settings";
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
      case "project": {
        const item = new vscode.TreeItem(
          basenameOrPath(element.projectPath),
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.description = `${element.sessions.length}`;
        item.tooltip = element.projectPath;
        item.iconPath = new vscode.ThemeIcon("folder");
        item.contextValue = "agentResume.project";
        return item;
      }
      case "session":
        return sessionItem(element.session, element.showProjectName);
      case "showMoreRecent":
        return showMoreRecentItem(element.remaining);
    }
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      const roots: TreeNode[] = [];
      if (this.warnings.length) {
        roots.push(...this.warnings.map((message) => ({ kind: "warning" as const, message })));
      }
      if (!this.sessions.length) {
        roots.push({ kind: "empty" });
        return roots;
      }
      roots.push({ kind: "recentRoot" }, { kind: "projectsRoot" });
      return roots;
    }

    if (element.kind === "recentRoot") {
      const visibleSessions: TreeNode[] = this.sessions
        .slice(0, this.recentVisibleCount)
        .map((session) => ({ kind: "session" as const, session, showProjectName: true }));
      const remaining = Math.max(0, this.sessions.length - visibleSessions.length);
      if (remaining > 0) {
        visibleSessions.push({ kind: "showMoreRecent", remaining });
      }
      return visibleSessions;
    }

    if (element.kind === "projectsRoot") {
      return groupByProject(this.sessions);
    }

    if (element.kind === "project") {
      return element.sessions.map((session) => ({ kind: "session", session }));
    }

    return [];
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  showMoreRecent(): void {
    this.recentVisibleCount = Math.min(this.sessions.length, this.recentVisibleCount + recentLimitStep);
    this.onDidChangeTreeDataEmitter.fire();
  }

  getSessions(): AgentSession[] {
    return this.sessions;
  }
}

function rootItem(label: string, icon: string, description?: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
  item.description = description;
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

function sessionItem(session: AgentSession, showProjectName = false): vscode.TreeItem {
  const item = new vscode.TreeItem(sessionLabel(session, showProjectName), vscode.TreeItemCollapsibleState.None);
  item.description = `${providerLabel(session.provider)} · ${relativeTime(session.updatedAt)}`;
  item.tooltip = [
    session.title,
    `Provider: ${providerLabel(session.provider)}`,
    `Project: ${session.projectPath}`,
    session.model ? `Model: ${session.model}` : undefined,
    session.branch ? `Branch: ${session.branch}` : undefined,
    session.source ? `Source: ${session.source}` : undefined,
    `Session: ${session.id}`
  ]
    .filter(Boolean)
    .join("\n");
  item.iconPath = new vscode.ThemeIcon(providerIcon(session.provider));
  item.contextValue = `agentResume.session.${session.provider}`;
  item.command = {
    command: "agentResume.openSession",
    title: "Resume Session",
    arguments: [{ kind: "session", session } satisfies SessionNode]
  };
  return item;
}

function showMoreRecentItem(remaining: number): vscode.TreeItem {
  const item = new vscode.TreeItem("Show More", vscode.TreeItemCollapsibleState.None);
  item.description = `${remaining} remaining`;
  item.tooltip = "Show 10 more recent sessions";
  item.iconPath = new vscode.ThemeIcon("add");
  item.command = {
    command: "agentResume.showMoreRecent",
    title: "Show More Recent Sessions"
  };
  return item;
}

function sessionLabel(session: AgentSession, showProjectName: boolean): string {
  if (!showProjectName) {
    return session.title;
  }

  return `${basenameOrPath(session.projectPath)} · ${session.title}`;
}

function groupByProject(sessions: AgentSession[]): ProjectNode[] {
  const byPath = new Map<string, AgentSession[]>();
  for (const session of sessions) {
    const projectPath = session.projectPath || process.env.HOME || "";
    const bucket = byPath.get(projectPath) ?? [];
    bucket.push(session);
    byPath.set(projectPath, bucket);
  }

  return [...byPath.entries()]
    .map(([projectPath, projectSessions]) => ({
      kind: "project" as const,
      projectPath,
      sessions: projectSessions.sort((a, b) => b.updatedAt - a.updatedAt)
    }))
    .sort((a, b) => latest(b.sessions) - latest(a.sessions) || a.projectPath.localeCompare(b.projectPath));
}

function latest(sessions: AgentSession[]): number {
  return sessions[0]?.updatedAt ?? 0;
}

function providerLabel(provider: AgentSession["provider"]): string {
  if (provider === "codex") {
    return "codex";
  }
  if (provider === "agy") {
    return "agy";
  }
  return "claude";
}

function providerIcon(provider: AgentSession["provider"]): string {
  if (provider === "codex") {
    return "hubot";
  }
  if (provider === "agy") {
    return "sparkle";
  }
  return "comment-discussion";
}

function relativeTime(timestamp: number): string {
  if (!timestamp) {
    return "unknown";
  }

  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < hour) {
    return `${Math.max(1, Math.round(absMs / minute))}m`;
  }
  if (absMs < day) {
    return `${Math.round(absMs / hour)}h`;
  }
  if (absMs < 30 * day) {
    return `${Math.round(absMs / day)}d`;
  }

  return new Date(timestamp).toLocaleDateString();
}

export function sessionQuickPickLabel(session: AgentSession): vscode.QuickPickItem & { session: AgentSession } {
  return {
    label: `$(${providerIcon(session.provider)}) ${session.title}`,
    description: providerLabel(session.provider),
    detail: `${compactPath(session.projectPath)}${session.branch ? ` · ${session.branch}` : ""}`,
    session
  };
}

export function projectUri(projectPath: string): vscode.Uri {
  return vscode.Uri.file(path.resolve(projectPath));
}

function isSessionNode(node: unknown): node is SessionNode {
  return Boolean(node && typeof node === "object" && "kind" in node && node.kind === "session");
}

function isProjectNode(node: unknown): node is ProjectNode {
  return Boolean(node && typeof node === "object" && "kind" in node && node.kind === "project");
}
