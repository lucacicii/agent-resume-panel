import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession, basenameOrPath, compactPath } from "../history";
import { t } from "../i18n";
import { formatProjectLabel } from "../projects/projectAliases";
import { relativeTime } from "../util/relativeTime";
import { ProjectSessionSortMode, projectTreeItemId, sortSessionsForProject } from "./projectSessionSort";
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
  private projectSessionSortMode: (projectPath: string) => ProjectSessionSortMode = () => "updatedDesc";
  private projectAliasResolver: (projectPath: string) => string | undefined = () => undefined;

  setProjectSessionSortMode(resolver: (projectPath: string) => ProjectSessionSortMode): void {
    this.projectSessionSortMode = resolver;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setProjectAliasResolver(resolver: (projectPath: string) => string | undefined): void {
    this.projectAliasResolver = resolver;
    this.onDidChangeTreeDataEmitter.fire();
  }

  getProjectDisplayName(projectPath: string): string {
    return formatProjectLabel(projectPath, this.projectAliasResolver(projectPath));
  }

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
        return rootItem(t("tree.recentSessions"), "clock", element.kind);
      case "favoritesRoot":
        return rootItem(t("tree.favoriteProjects"), "star-full", element.kind);
      case "projectsRoot":
        return rootItem(t("tree.projects"), "folder-library", element.kind);
      case "warning": {
        const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("warning");
        return item;
      }
      case "empty": {
        const item = new vscode.TreeItem(t("tree.noSessionsFound"), vscode.TreeItemCollapsibleState.None);
        item.description = t("tree.noSessionsFoundDescription");
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
      case "project": {
        const alias = this.projectAliasResolver(element.projectPath);
        const item = new vscode.TreeItem(
          this.getProjectDisplayName(element.projectPath),
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.description = `${element.sessions.length}`;
        item.tooltip = buildProjectTooltip(element.projectPath, alias);
        item.id = projectTreeItemId(element.projectPath);
        item.iconPath = new vscode.ThemeIcon(element.favorited ? "star-full" : "folder");
        item.contextValue = element.favorited ? "agentResume.project.favorited" : "agentResume.project";
        return item;
      }
      case "session":
        return sessionItem(element.session, element.showProjectName, (path) => this.getProjectDisplayName(path));
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
        .map((session) => ({ kind: "session" as const, session, showProjectName: true } satisfies SessionNode));
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
      return buildProjectChildren(element.sessions, this.projectSessionSortMode(element.projectPath));
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

  updateSessionSummary(session: AgentSession, summary: string): void {
    const trimmed = summary.trim();
    if (!trimmed) {
      return;
    }

    const index = this.sessions.findIndex(
      (entry) => entry.provider === session.provider && entry.id === session.id
    );
    if (index < 0) {
      return;
    }

    this.sessions[index] = { ...this.sessions[index], sessionSummary: trimmed };
    this.onDidChangeTreeDataEmitter.fire();
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

function sessionItem(
  session: AgentSession,
  showProjectName = false,
  projectDisplayName: (projectPath: string) => string = basenameOrPath
): vscode.TreeItem {
  const item = new vscode.TreeItem(sessionLabel(session, showProjectName, projectDisplayName), vscode.TreeItemCollapsibleState.None);
  item.description = sessionDescription(session);
  item.tooltip = buildSessionTooltip(session);
  item.iconPath = new vscode.ThemeIcon(providerIcon(session.provider));
  item.contextValue = `agentResume.session.${session.provider}`;
  item.command = {
    command: session.provider === "chat" ? "agentResume.openChatSession" : "agentResume.openSession",
    title: session.provider === "chat" ? t("tree.commandOpenAcpChat") : t("tree.commandResumeSession"),
    arguments: [{ kind: "session", session } satisfies SessionNode]
  };
  return item;
}

function sessionDescription(session: AgentSession): string {
  const provider = providerLabel(session.provider);
  if (session.provider === "chat" && session.acpProvider) {
    return t("tree.descriptionAcp", session.acpProvider, relativeTime(session.updatedAt));
  }
  return t("tree.descriptionProvider", provider, relativeTime(session.updatedAt));
}

function showMoreRecentItem(remaining: number): vscode.TreeItem {
  const item = new vscode.TreeItem(t("tree.showMore"), vscode.TreeItemCollapsibleState.None);
  item.description = t("tree.showMoreDescription", remaining);
  item.tooltip = t("tree.showMoreTooltip");
  item.iconPath = new vscode.ThemeIcon("add");
  item.command = {
    command: "agentResume.showMoreRecent",
    title: t("tree.showMoreCommandTitle")
  };
  return item;
}

function sessionLabel(
  session: AgentSession,
  showProjectName: boolean,
  projectDisplayName: (projectPath: string) => string = basenameOrPath
): string {
  const title = formatTitleWithMessageCount(session);
  if (!showProjectName) {
    return title;
  }

  return `${projectDisplayName(session.projectPath)} · ${title}`;
}

function buildProjectTooltip(projectPath: string, alias?: string): string {
  const trimmed = alias?.trim();
  if (!trimmed) {
    return projectPath;
  }

  return `${t("tree.tooltipProjectAlias", trimmed)}\n${projectPath}`;
}

function buildSessionTooltip(session: AgentSession): string | vscode.MarkdownString {
  const lines = [
    formatTitleWithMessageCount(session),
    t("tree.tooltipProvider", providerLabel(session.provider)),
    session.acpProvider ? t("tree.tooltipAcpAgent", session.acpProvider) : undefined,
    t("tree.tooltipProject", session.projectPath),
    session.model ? t("tree.tooltipModel", session.model) : undefined,
    session.branch ? t("tree.tooltipBranch", session.branch) : undefined,
    session.source ? t("tree.tooltipSource", session.source) : undefined,
    t("tree.tooltipSessionId", session.id)
  ].filter(Boolean);

  if (session.sessionSummary) {
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;
    tooltip.supportHtml = false;
    tooltip.appendMarkdown(lines.join("  \n"));
    tooltip.appendMarkdown(`\n\n---\n\n**${t("tree.tooltipSummaryHeading")}**\n\n`);
    tooltip.appendText(session.sessionSummary);
    return tooltip;
  }

  return lines.join("\n");
}

export function formatTitleWithMessageCount(session: AgentSession): string {
  const title = session.title;
  if (
    session.provider === "grok" &&
    session.messageCount != null &&
    session.messageCount > MESSAGE_COUNT_THRESHOLD
  ) {
    return `${title}(${t("tree.subtitleMessageCount", session.messageCount)})`;
  }
  return title;
}

function buildProjectChildren(projectSessions: AgentSession[], sortMode: ProjectSessionSortMode): TreeNode[] {
  return sortSessionsForProject(projectSessions, sortMode).map((session) => ({ kind: "session" as const, session }));
}

export interface ProjectGroup {
  projectPath: string;
  sessions: AgentSession[];
  favorited?: boolean;
}

export function buildProjectList(sessions: AgentSession[], favoriteProjects: string[] = []): ProjectGroup[] {
  const favoriteSet = new Set(favoriteProjects.map((projectPath) => path.resolve(projectPath)));
  const byPath = groupSessionsByPath(sessions);

  return [...byPath.entries()]
    .map(([projectPath, projectSessions]) => ({
      projectPath,
      sessions: projectSessions.sort((a, b) => b.updatedAt - a.updatedAt),
      favorited: favoriteSet.has(projectPath)
    }))
    .sort((a, b) => latest(b.sessions) - latest(a.sessions) || a.projectPath.localeCompare(b.projectPath));
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
  return favoritePaths.map((favoritePath) => {
    const projectPath = path.resolve(favoritePath);
    return {
    kind: "project" as const,
    projectPath,
    sessions: byPath.get(projectPath) ?? [],
    favorited: true
  };
  });
}

function groupByProject(sessions: AgentSession[], excludePaths = new Set<string>()): ProjectNode[] {
  const byPath = groupSessionsByPath(sessions);

  return [...byPath.entries()]
    .filter(([projectPath]) => !excludePaths.has(projectPath))
    .map(([projectPath, projectSessions]) => ({
      kind: "project" as const,
      projectPath,
      sessions: projectSessions
    }))
    .sort((a, b) => latest(b.sessions) - latest(a.sessions) || a.projectPath.localeCompare(b.projectPath));
}

function latest(sessions: AgentSession[]): number {
  return sessions[0]?.updatedAt ?? 0;
}

export function providerLabel(provider: AgentSession["provider"]): string {
  if (provider === "chat") {
    return "chat";
  }
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
  if (provider === "opencode") {
    return "opencode";
  }
  if (provider === "pi") {
    return "pi";
  }
  return "claude";
}

function providerIcon(provider: AgentSession["provider"]): string {
  if (provider === "chat") {
    return "comment";
  }
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
  if (provider === "opencode") {
    return "terminal";
  }
  if (provider === "pi") {
    return "symbol-method";
  }
  return "comment-discussion";
}

export interface SearchSessionItem {
  provider: AgentSession["provider"];
  id: string;
  title: string;
  projectPath: string;
  projectName: string;
  branch?: string;
  updatedAtLabel: string;
  summary?: string;
}

export function enrichSessionsWithTreeSummaries(
  sessions: AgentSession[],
  treeSessions: AgentSession[]
): AgentSession[] {
  const treeSummaries = new Map<string, string>();
  for (const session of treeSessions) {
    const summary = session.sessionSummary?.trim();
    if (summary) {
      treeSummaries.set(`${session.provider}:${session.id}`, summary);
    }
  }

  return sessions.map((session) => {
    const key = `${session.provider}:${session.id}`;
    if (session.sessionSummary?.trim() || !treeSummaries.has(key)) {
      return session;
    }

    return { ...session, sessionSummary: treeSummaries.get(key) };
  });
}

export function getSessionSummaryText(session: AgentSession): string | undefined {
  const summary = session.sessionSummary?.trim();
  return summary || undefined;
}

export function buildSessionSubtitle(session: AgentSession): string {
  if (session.sessionSummary?.trim()) {
    return session.sessionSummary.trim();
  }

  const parts: string[] = [];
  if (session.branch) {
    parts.push(session.branch);
  }
  if (session.model) {
    parts.push(session.model);
  }
  if (session.messageCount != null) {
    parts.push(t("tree.subtitleMessageCount", session.messageCount));
  }
  if (parts.length) {
    return parts.join(" · ");
  }

  return compactPath(session.projectPath);
}

export function serializeSessionForSearch(
  session: AgentSession,
  projectDisplayName?: string
): SearchSessionItem {
  return {
    provider: session.provider,
    id: session.id,
    title: formatTitleWithMessageCount(session),
    projectPath: session.projectPath,
    projectName: projectDisplayName ?? basenameOrPath(session.projectPath),
    branch: session.branch,
    updatedAtLabel: relativeTime(session.updatedAt)
  };
}

export function sessionQuickPickLabel(
  session: AgentSession,
  options?: { omitProjectPath?: boolean }
): vscode.QuickPickItem & { session: AgentSession } {
  const linkSuffix = session.provider === "chat" && session.acpProvider ? ` · acp/${session.acpProvider}` : "";
  const detail = options?.omitProjectPath
    ? session.branch || undefined
    : `${compactPath(session.projectPath)}${session.branch ? ` · ${session.branch}` : ""}`;

  return {
    label: `$(${providerIcon(session.provider)}) ${formatTitleWithMessageCount(session)}`,
    description: `${providerLabel(session.provider)}${linkSuffix}`,
    detail,
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