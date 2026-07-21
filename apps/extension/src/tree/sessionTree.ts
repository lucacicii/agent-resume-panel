import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession, basenameOrPath, compactPath } from "../history";
import { t } from "../i18n";
import { GtdStatus } from "../catalog/gtd";
import { isFavoriteProject } from "../favorites/projectFavorites";
import {
  formatProjectLabel,
  pickProjectDisplayPath,
  projectGroupKey
} from "../projects/projectAliases";
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
  private gtdStatusResolver: (session: AgentSession) => string | undefined = () => undefined;
  private gtdRawStatusResolver: (session: AgentSession) => GtdStatus | undefined = () => undefined;
  private hasSessionNoteResolver: (session: AgentSession) => boolean = () => false;
  private hasProjectNoteResolver: (projectPath: string) => boolean = () => false;

  setProjectSessionSortMode(resolver: (projectPath: string) => ProjectSessionSortMode): void {
    this.projectSessionSortMode = resolver;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setProjectAliasResolver(resolver: (projectPath: string) => string | undefined): void {
    this.projectAliasResolver = resolver;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setGtdStatusResolver(resolver: (session: AgentSession) => string | undefined): void {
    this.gtdStatusResolver = resolver;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setGtdRawStatusResolver(resolver: (session: AgentSession) => GtdStatus | undefined): void {
    this.gtdRawStatusResolver = resolver;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setHasSessionNoteResolver(resolver: (session: AgentSession) => boolean): void {
    this.hasSessionNoteResolver = resolver;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setHasProjectNoteResolver(resolver: (projectPath: string) => boolean): void {
    this.hasProjectNoteResolver = resolver;
    this.onDidChangeTreeDataEmitter.fire();
  }

  getSessionGtdStatus(session: AgentSession): GtdStatus | undefined {
    return this.gtdRawStatusResolver(session);
  }

  getSessionGtdStatusLabel(session: AgentSession): string | undefined {
    return this.gtdStatusResolver(session);
  }

  getSessionTreeItemOptions(showProjectName = false): SessionTreeItemOptions {
    return {
      showProjectName,
      projectDisplayName: (projectPath) => this.getProjectDisplayName(projectPath),
      gtdStatusResolver: (session) => this.gtdStatusResolver(session),
      hasSessionNoteResolver: (session) => this.hasSessionNoteResolver(session)
    };
  }

  hasProjectNote(projectPath: string): boolean {
    return this.hasProjectNoteResolver(projectPath);
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
        item.tooltip = buildProjectTooltip(element.projectPath, alias, this.hasProjectNoteResolver(element.projectPath));
        item.id = projectTreeItemId(element.projectPath);
        item.iconPath = new vscode.ThemeIcon(element.favorited ? "star-full" : "folder");
        item.contextValue = element.favorited ? "agentResume.project.favorited" : "agentResume.project";
        return item;
      }
      case "session":
        return buildSessionTreeItem(element.session, this.getSessionTreeItemOptions(element.showProjectName));
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

export interface SessionTreeItemOptions {
  showProjectName?: boolean;
  projectDisplayName?: (projectPath: string) => string;
  gtdStatusResolver?: (session: AgentSession) => string | undefined;
  hasSessionNoteResolver?: (session: AgentSession) => boolean;
}

export function buildSessionTreeItem(session: AgentSession, options: SessionTreeItemOptions = {}): vscode.TreeItem {
  const showProjectName = options.showProjectName ?? false;
  const projectDisplayName = options.projectDisplayName ?? basenameOrPath;
  const gtdStatus = options.gtdStatusResolver?.(session);
  const hasNote = options.hasSessionNoteResolver?.(session) ?? false;

  const item = new vscode.TreeItem(
    sessionLabel(session, showProjectName, projectDisplayName),
    vscode.TreeItemCollapsibleState.None
  );
  item.description = sessionDescription(session, hasNote);
  item.tooltip = buildSessionTooltip(session, gtdStatus, hasNote);
  item.iconPath = new vscode.ThemeIcon(providerIcon(session.provider));
  item.contextValue = `agentResume.session.${session.provider}`;
  item.command = {
    command: session.provider === "chat" ? "agentResume.openChatSession" : "agentResume.openSession",
    title: session.provider === "chat" ? t("tree.commandOpenAcpChat") : t("tree.commandResumeSession"),
    arguments: [{ kind: "session", session } satisfies SessionNode]
  };
  return item;
}

function sessionDescription(session: AgentSession, hasNote = false): string {
  const provider = providerLabel(session.provider);
  const time =
    session.provider === "chat" && session.acpProvider
      ? t("tree.descriptionAcp", session.acpProvider, relativeTime(session.updatedAt))
      : t("tree.descriptionProvider", provider, relativeTime(session.updatedAt));
  return hasNote ? `${time} · ${t("tree.hasNote")}` : time;
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

function buildProjectTooltip(projectPath: string, alias?: string, hasNote = false): string {
  const trimmed = alias?.trim();
  const lines = [
    trimmed ? t("tree.tooltipProjectAlias", trimmed) : undefined,
    hasNote ? t("tree.tooltipHasNote") : undefined,
    projectPath
  ].filter(Boolean);

  return lines.join("\n");
}

function buildSessionTooltip(
  session: AgentSession,
  gtdStatus?: string,
  hasNote = false
): string | vscode.MarkdownString {
  const lines = [
    formatTitleWithMessageCount(session),
    t("tree.tooltipProvider", providerLabel(session.provider)),
    session.acpProvider ? t("tree.tooltipAcpAgent", session.acpProvider) : undefined,
    gtdStatus ? t("tree.tooltipGtdStatus", gtdStatus) : undefined,
    hasNote ? t("tree.tooltipHasNote") : undefined,
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
  const byGroup = groupSessionsByProject(sessions);

  return [...byGroup.values()]
    .map((projectSessions) => {
      const projectPath = pickProjectDisplayPath(projectSessions);
      return {
        projectPath,
        sessions: projectSessions.sort((a, b) => b.updatedAt - a.updatedAt),
        favorited: isFavoriteAmong(favoriteProjects, projectPath, projectSessions)
      };
    })
    .sort((a, b) => latest(b.sessions) - latest(a.sessions) || a.projectPath.localeCompare(b.projectPath));
}

function isFavoriteAmong(
  favoriteProjects: string[],
  projectPath: string,
  sessions: AgentSession[]
): boolean {
  if (isFavoriteProject(favoriteProjects, projectPath)) {
    return true;
  }
  return sessions.some((session) => isFavoriteProject(favoriteProjects, session.projectPath));
}

/** Group by logical project (projectId / portable_key), not raw absolute path only. */
export function groupSessionsByProject(sessions: AgentSession[]): Map<string, AgentSession[]> {
  const byGroup = new Map<string, AgentSession[]>();
  for (const session of sessions) {
    const key = projectGroupKey(session);
    const bucket = byGroup.get(key) ?? [];
    bucket.push(session);
    byGroup.set(key, bucket);
  }
  return byGroup;
}

/** @deprecated use groupSessionsByProject */
function groupSessionsByPath(sessions: AgentSession[]): Map<string, AgentSession[]> {
  return groupSessionsByProject(sessions);
}

function buildFavoriteProjectNodes(favoritePaths: string[], sessions: AgentSession[]): ProjectNode[] {
  const withSessions = buildProjectList(sessions, favoritePaths).filter((group) => group.favorited);
  const emptyFavorites = favoritePaths
    .filter(
      (favoritePath) =>
        !withSessions.some(
          (group) =>
            isFavoriteProject([favoritePath], group.projectPath) ||
            group.sessions.some((session) => isFavoriteProject([favoritePath], session.projectPath))
        )
    )
    .map((favoritePath) => ({
      kind: "project" as const,
      projectPath: path.resolve(favoritePath),
      sessions: [] as AgentSession[],
      favorited: true
    }));
  return [
    ...withSessions.map((group) => ({
      kind: "project" as const,
      projectPath: group.projectPath,
      sessions: group.sessions,
      favorited: true
    })),
    ...emptyFavorites
  ];
}

function groupByProject(sessions: AgentSession[], excludeFavoritePaths = new Set<string>()): ProjectNode[] {
  const favorites = [...excludeFavoritePaths];
  return buildProjectList(sessions, favorites)
    .filter((group) => !group.favorited)
    .map((group) => ({
      kind: "project" as const,
      projectPath: group.projectPath,
      sessions: group.sessions
    }));
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
  gtdStatus?: GtdStatus;
  gtdStatusLabel?: string;
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

export function enrichSearchSessionItem(session: AgentSession, tree: SessionTreeProvider): SearchSessionItem {
  const item = serializeSessionForSearch(session, tree.getProjectDisplayName(session.projectPath));
  const summary = getSessionSummaryText(session);
  const gtdStatus = tree.getSessionGtdStatus(session);
  const gtdStatusLabel = tree.getSessionGtdStatusLabel(session);

  return {
    ...item,
    ...(summary ? { summary } : {}),
    ...(gtdStatus && gtdStatusLabel ? { gtdStatus, gtdStatusLabel } : {})
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