import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession, basenameOrPath, compactPath } from "../history";
import { DEFAULT_SECTION_ORDER, SectionKind } from "./sectionOrder";

type RootNode = RecentRootNode | FavoritesRootNode | ProjectsRootNode | WarningNode | EmptyNode;
export type TreeNode = RootNode | ProjectNode | SessionNode | ShowMoreRecentNode;
export type SectionRootNode = RecentRootNode | FavoritesRootNode | ProjectsRootNode;

const recentInitialLimit = 10;
const recentLimitStep = 10;
const MESSAGE_COUNT_THRESHOLD = 10;

interface RecentRootNode {
  kind: "recentRoot";
}

interface FavoritesRootNode {
  kind: "favoritesRoot";
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
  favorited?: boolean;
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
  private favoriteProjects: string[] = [];
  private sectionOrder: SectionKind[] = [...DEFAULT_SECTION_ORDER];
  private recentVisibleCount = recentInitialLimit;

  setData(sessions: AgentSession[], warnings: string[]): void {
    this.sessions = sessions;
    this.warnings = warnings;
    this.recentVisibleCount = recentInitialLimit;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setFavoriteProjects(projectPaths: string[]): void {
    this.favoriteProjects = projectPaths;
    this.onDidChangeTreeDataEmitter.fire();
  }

  getFavoriteProjects(): string[] {
    return this.favoriteProjects;
  }

  setSectionOrder(order: SectionKind[]): void {
    this.sectionOrder = order;
    this.onDidChangeTreeDataEmitter.fire();
  }

  getSectionOrder(): SectionKind[] {
    return this.sectionOrder;
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
        return rootItem("Recent Sessions", "clock", element.kind);
      case "favoritesRoot":
        return rootItem("Favorite Projects", "star-full", element.kind);
      case "projectsRoot":
        return rootItem("Projects", "folder-library", element.kind);
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
        item.iconPath = new vscode.ThemeIcon(element.favorited ? "star-full" : "folder");
        item.contextValue = element.favorited ? "agentResume.project.favorited" : "agentResume.project";
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
      roots.push(...this.sectionOrder.map((kind) => ({ kind })));
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

    if (element.kind === "favoritesRoot") {
      return buildFavoriteProjectNodes(this.favoriteProjects, this.sessions);
    }

    if (element.kind === "projectsRoot") {
      return groupByProject(this.sessions, new Set(this.favoriteProjects));
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

function rootItem(label: string, icon: string, id: string, description?: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
  item.id = id;
  item.description = description;
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

export function isSectionRoot(node: TreeNode): node is SectionRootNode {
  return node.kind === "recentRoot" || node.kind === "favoritesRoot" || node.kind === "projectsRoot";
}

function sessionItem(session: AgentSession, showProjectName = false): vscode.TreeItem {
  const item = new vscode.TreeItem(sessionLabel(session, showProjectName), vscode.TreeItemCollapsibleState.None);
  item.description = `${providerLabel(session.provider)} · ${relativeTime(session.updatedAt)}`;
  item.tooltip = [
    formatTitleWithMessageCount(session),
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
  const title = formatTitleWithMessageCount(session);
  if (!showProjectName) {
    return title;
  }

  return `${basenameOrPath(session.projectPath)} · ${title}`;
}

function formatTitleWithMessageCount(session: AgentSession): string {
  const title = session.title;
  if (
    session.provider === "grok" &&
    session.messageCount != null &&
    session.messageCount > MESSAGE_COUNT_THRESHOLD
  ) {
    return `${title}(${session.messageCount}msg)`;
  }
  return title;
}

function groupSessionsByPath(sessions: AgentSession[]): Map<string, AgentSession[]> {
  const byPath = new Map<string, AgentSession[]>();
  for (const session of sessions) {
    const projectPath = path.resolve(session.projectPath || process.env.HOME || "");
    const bucket = byPath.get(projectPath) ?? [];
    bucket.push(session);
    byPath.set(projectPath, bucket);
  }
  return byPath;
}

function buildFavoriteProjectNodes(favoritePaths: string[], sessions: AgentSession[]): ProjectNode[] {
  const byPath = groupSessionsByPath(sessions);
  return favoritePaths.map((projectPath) => ({
    kind: "project" as const,
    projectPath,
    sessions: (byPath.get(projectPath) ?? []).sort((a, b) => b.updatedAt - a.updatedAt),
    favorited: true
  }));
}

function groupByProject(sessions: AgentSession[], excludePaths = new Set<string>()): ProjectNode[] {
  const byPath = groupSessionsByPath(sessions);

  return [...byPath.entries()]
    .filter(([projectPath]) => !excludePaths.has(projectPath))
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
  if (provider === "grok") {
    return "grok";
  }
  if (provider === "alma") {
    return "alma";
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
  if (provider === "grok") {
    return "rocket";
  }
  if (provider === "alma") {
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
    label: `$(${providerIcon(session.provider)}) ${formatTitleWithMessageCount(session)}`,
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
