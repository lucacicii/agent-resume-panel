import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession, basenameOrPath, compactPath } from "../history";
import { t } from "../i18n";
import { GtdStatus } from "../catalog/gtd";
import {
  CatalogProjectGroupSummary,
  queryProjectGroupSummaries,
  queryProjectSessionsPage,
  queryRecentSessionsPage
} from "../catalog/query";
import { isFavoriteProject } from "../favorites/projectFavorites";
import { LlmOutputLanguage } from "../llm/languages";
import {
  formatProjectLabel,
  pickProjectDisplayPath,
  projectGroupKey
} from "../projects/projectAliases";
import { relativeTime } from "../util/relativeTime";
import { ProjectSessionSortMode, projectTreeItemId, sortSessionsForProject } from "./projectSessionSort";
import { DEFAULT_SECTION_ORDER, SectionKind } from "./sectionOrder";

type RootNode = RecentRootNode | FavoritesRootNode | ProjectsRootNode | WarningNode | EmptyNode;
export type TreeNode =
  | RootNode
  | ProjectNode
  | SessionNode
  | ShowMoreRecentNode
  | ShowMoreProjectsNode
  | ShowMoreProjectSessionsNode;
type SectionRootNode = RecentRootNode | FavoritesRootNode | ProjectsRootNode;

const recentInitialLimit = 10;
const recentLimitStep = 10;
const projectsInitialLimit = 25;
const projectsLimitStep = 25;
const projectSessionsInitialLimit = 20;
const projectSessionsLimitStep = 20;
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

interface ShowMoreProjectsNode {
  kind: "showMoreProjects";
  remaining: number;
}

interface ShowMoreProjectSessionsNode {
  kind: "showMoreProjectSessions";
  projectKey: string;
  remaining: number;
}

interface ProjectNode {
  kind: "project";
  projectPath: string;
  projectId?: string;
  groupKey?: string;
  sessionCount?: number;
  candidatePaths?: string[];
  sessions: AgentSession[];
  favorited?: boolean;
}

interface SessionNode {
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
  private projectsVisibleCount = projectsInitialLimit;
  private projectSessionVisibleCounts = new Map<string, number>();
  private catalogConfig?: {
    dbPath: string;
    maxCap: number;
    outputLanguage?: LlmOutputLanguage;
  };
  private cachedRecentSessions: AgentSession[] = [];
  private cachedRecentTotal = 0;
  private cachedProjectGroups: CatalogProjectGroupSummary[] = [];
  private cachedProjectSessions = new Map<string, AgentSession[]>();
  private summaryOverrides = new Map<string, string>();
  private projectSessionSortMode: (projectPath: string) => ProjectSessionSortMode = () => "updatedDesc";
  private projectAliasResolver: (projectPath: string) => string | undefined = () => undefined;
  private gtdStatusResolver: (session: AgentSession) => string | undefined = () => undefined;
  private gtdRawStatusResolver: (session: AgentSession) => GtdStatus | undefined = () => undefined;
  private hasSessionNoteResolver: (session: AgentSession) => boolean = () => false;
  private hasProjectNoteResolver: (projectPath: string) => boolean = () => false;

  constructor(private readonly cursorIconPath?: vscode.Uri) {}

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
      hasSessionNoteResolver: (session) => this.hasSessionNoteResolver(session),
      cursorIconPath: this.cursorIconPath
    };
  }

  hasProjectNote(projectPath: string): boolean {
    return this.hasProjectNoteResolver(projectPath);
  }

  getProjectDisplayName(projectPath: string): string {
    return formatProjectLabel(projectPath, this.projectAliasResolver(projectPath));
  }

  setCatalogSource(config: {
    dbPath: string;
    maxCap: number;
    outputLanguage?: LlmOutputLanguage;
    warnings?: string[];
  }): void {
    this.catalogConfig = {
      dbPath: config.dbPath,
      maxCap: config.maxCap,
      outputLanguage: config.outputLanguage
    };
    this.warnings = config.warnings ?? [];
    this.recentVisibleCount = recentInitialLimit;
    this.projectsVisibleCount = projectsInitialLimit;
    this.projectSessionVisibleCounts.clear();
    this.cachedProjectSessions.clear();
    this.onDidChangeTreeDataEmitter.fire();
  }

  setData(sessions: AgentSession[], warnings: string[]): void {
    this.catalogConfig = undefined;
    this.sessions = sessions;
    this.warnings = warnings;
    this.recentVisibleCount = recentInitialLimit;
    this.projectsVisibleCount = projectsInitialLimit;
    this.projectSessionVisibleCounts.clear();
    this.cachedProjectSessions.clear();
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
      if (node.sessions.length > 0) {
        return node.sessions;
      }
      const key = node.groupKey ?? projectTreeItemId(node.projectPath);
      return this.cachedProjectSessions.get(key) ?? [];
    }
    if (isSessionNode(node)) {
      return [node.session];
    }
    return [];
  }

  async loadProjectSessionsFromNode(node: unknown, limit = 100): Promise<AgentSession[]> {
    if (isSessionNode(node)) {
      return [node.session];
    }
    if (!isProjectNode(node)) {
      return [];
    }
    if (!this.catalogConfig) {
      return node.sessions;
    }
    const page = await queryProjectSessionsPage(this.catalogConfig.dbPath, {
      projectPath: node.projectPath,
      projectId: node.projectId,
      candidatePaths: node.candidatePaths,
      sortMode: this.projectSessionSortMode(node.projectPath),
      limit,
      offset: 0,
      outputLanguage: this.catalogConfig.outputLanguage
    });
    return page.sessions.map((s) => this.applySummaryOverride(s));
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
        const count = element.sessionCount ?? element.sessions.length;
        item.description = `${count}`;
        item.tooltip = buildProjectTooltip(element.projectPath, alias, this.hasProjectNoteResolver(element.projectPath));
        item.id = projectTreeItemId(element.projectPath);
        item.iconPath = new vscode.ThemeIcon(element.favorited ? "star-full" : "folder");
        item.contextValue = element.favorited ? "agentResume.project.favorited" : "agentResume.project";
        return item;
      }
      case "session":
        return buildSessionTreeItem(element.session, this.getSessionTreeItemOptions(element.showProjectName));
      case "showMoreRecent":
        return showMoreItem(element.remaining, "agentResume.showMoreRecent");
      case "showMoreProjects":
        return showMoreItem(element.remaining, "agentResume.showMoreProjects");
      case "showMoreProjectSessions":
        return showMoreItem(element.remaining, "agentResume.showMoreProjectSessions", [element.projectKey]);
    }
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (!element) {
      const roots: TreeNode[] = [];
      if (this.warnings.length) {
        roots.push(...this.warnings.map((message) => ({ kind: "warning" as const, message })));
      }
      roots.push(...this.sectionOrder.map((kind) => ({ kind })));
      return roots;
    }

    if (this.catalogConfig) {
      return this.getCatalogChildren(element);
    }

    if (element.kind === "recentRoot") {
      const visibleSessions: TreeNode[] = this.sessions
        .slice(0, this.recentVisibleCount)
        .map((session) => ({
          kind: "session" as const,
          session: this.applySummaryOverride(session),
          showProjectName: true
        } satisfies SessionNode));
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
      const allProjects = groupByProject(this.sessions, new Set(this.favoriteProjects));
      const visibleProjects: TreeNode[] = allProjects.slice(0, this.projectsVisibleCount);
      const remaining = Math.max(0, allProjects.length - visibleProjects.length);
      if (remaining > 0) {
        visibleProjects.push({ kind: "showMoreProjects", remaining });
      }
      return visibleProjects;
    }

    if (element.kind === "project") {
      const key = element.groupKey ?? projectTreeItemId(element.projectPath);
      const limit = this.projectSessionVisibleCounts.get(key) ?? projectSessionsInitialLimit;
      const sorted = sortSessionsForProject(element.sessions, this.projectSessionSortMode(element.projectPath));
      const visible: TreeNode[] = sorted
        .slice(0, limit)
        .map((session) => ({ kind: "session" as const, session: this.applySummaryOverride(session) }));
      const remaining = Math.max(0, sorted.length - visible.length);
      if (remaining > 0) {
        visible.push({ kind: "showMoreProjectSessions", projectKey: key, remaining });
      }
      return visible;
    }

    return [];
  }
  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  showMoreRecent(): void {
    const maxTotal = this.catalogConfig ? this.cachedRecentTotal : this.sessions.length;
    this.recentVisibleCount = Math.min(maxTotal, this.recentVisibleCount + recentLimitStep);
    this.onDidChangeTreeDataEmitter.fire();
  }

  showMoreProjects(): void {
    this.projectsVisibleCount += projectsLimitStep;
    this.onDidChangeTreeDataEmitter.fire();
  }

  showMoreProjectSessions(projectKey?: string): void {
    if (!projectKey) {
      return;
    }
    const current = this.projectSessionVisibleCounts.get(projectKey) ?? projectSessionsInitialLimit;
    this.projectSessionVisibleCounts.set(projectKey, current + projectSessionsLimitStep);
    this.onDidChangeTreeDataEmitter.fire();
  }

  getSessions(): AgentSession[] {
    if (!this.catalogConfig) {
      return this.sessions;
    }
    const seen = new Map<string, AgentSession>();
    for (const s of this.cachedRecentSessions) {
      seen.set(`${s.provider}:${s.id}`, this.applySummaryOverride(s));
    }
    for (const list of this.cachedProjectSessions.values()) {
      for (const s of list) {
        seen.set(`${s.provider}:${s.id}`, this.applySummaryOverride(s));
      }
    }
    return [...seen.values()];
  }

  updateSessionSummary(session: AgentSession, summary: string): void {
    const trimmed = summary.trim();
    if (!trimmed) {
      return;
    }
    this.summaryOverrides.set(`${session.provider}:${session.id}`, trimmed);
    const index = this.sessions.findIndex(
      (entry) => entry.provider === session.provider && entry.id === session.id
    );
    if (index >= 0) {
      this.sessions[index] = { ...this.sessions[index], sessionSummary: trimmed };
    }
    this.onDidChangeTreeDataEmitter.fire();
  }

  private applySummaryOverride(session: AgentSession): AgentSession {
    const override = this.summaryOverrides.get(`${session.provider}:${session.id}`);
    return override ? { ...session, sessionSummary: override } : session;
  }

  private async getCatalogChildren(element: TreeNode): Promise<TreeNode[]> {
    const cfg = this.catalogConfig!;
    if (element.kind === "recentRoot") {
      const page = await queryRecentSessionsPage(cfg.dbPath, {
        limit: this.recentVisibleCount,
        offset: 0,
        maxCap: cfg.maxCap,
        outputLanguage: cfg.outputLanguage
      });
      this.cachedRecentSessions = page.sessions;
      this.cachedRecentTotal = page.total;
      const visibleSessions: TreeNode[] = page.sessions.map((session) => ({
        kind: "session" as const,
        session: this.applySummaryOverride(session),
        showProjectName: true
      }));
      const remaining = Math.max(0, page.total - visibleSessions.length);
      if (remaining > 0) {
        visibleSessions.push({ kind: "showMoreRecent", remaining });
      }
      return visibleSessions;
    }

    if (element.kind === "favoritesRoot" || element.kind === "projectsRoot") {
      this.cachedProjectGroups = await queryProjectGroupSummaries(cfg.dbPath, this.favoriteProjects);
      if (element.kind === "favoritesRoot") {
        const withSessions = this.cachedProjectGroups.filter((g) => g.favorited);
        const emptyFavorites = this.favoriteProjects
          .filter(
            (favoritePath) =>
              !withSessions.some(
                (g) =>
                  isFavoriteProject([favoritePath], g.projectPath) ||
                  g.candidatePaths.some((candidate) => isFavoriteProject([favoritePath], candidate))
              )
          )
          .map((favoritePath) => ({
            kind: "project" as const,
            projectPath: path.resolve(favoritePath),
            groupKey: projectTreeItemId(favoritePath),
            sessionCount: 0,
            sessions: [] as AgentSession[],
            favorited: true
          }));
        return [
          ...withSessions.map((g) => ({
            kind: "project" as const,
            projectPath: g.projectPath,
            projectId: g.projectId,
            groupKey: g.groupKey,
            sessionCount: g.sessionCount,
            candidatePaths: g.candidatePaths,
            sessions: [] as AgentSession[],
            favorited: true
          })),
          ...emptyFavorites
        ];
      }

      const nonFavorites = this.cachedProjectGroups.filter((g) => !g.favorited);
      const visible: TreeNode[] = nonFavorites.slice(0, this.projectsVisibleCount).map((g) => ({
        kind: "project" as const,
        projectPath: g.projectPath,
        projectId: g.projectId,
        groupKey: g.groupKey,
        sessionCount: g.sessionCount,
        candidatePaths: g.candidatePaths,
        sessions: [] as AgentSession[]
      }));
      const remaining = Math.max(0, nonFavorites.length - visible.length);
      if (remaining > 0) {
        visible.push({ kind: "showMoreProjects", remaining });
      }
      return visible;
    }

    if (element.kind === "project") {
      const key = element.groupKey ?? projectTreeItemId(element.projectPath);
      const limit = this.projectSessionVisibleCounts.get(key) ?? projectSessionsInitialLimit;
      const page = await queryProjectSessionsPage(cfg.dbPath, {
        projectPath: element.projectPath,
        projectId: element.projectId,
        candidatePaths: element.candidatePaths,
        sortMode: this.projectSessionSortMode(element.projectPath),
        limit,
        offset: 0,
        outputLanguage: cfg.outputLanguage
      });
      this.cachedProjectSessions.set(key, page.sessions);
      const children: TreeNode[] = page.sessions.map((session) => ({
        kind: "session" as const,
        session: this.applySummaryOverride(session)
      }));
      const remaining = Math.max(0, page.total - children.length);
      if (remaining > 0) {
        children.push({ kind: "showMoreProjectSessions", projectKey: key, remaining });
      }
      return children;
    }

    return [];
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
  cursorIconPath?: vscode.Uri;
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
  item.iconPath = sessionIconPath(session.provider, options.cursorIconPath);
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

function showMoreItem(remaining: number, commandId: string, args?: unknown[]): vscode.TreeItem {
  const item = new vscode.TreeItem(t("tree.showMore"), vscode.TreeItemCollapsibleState.None);
  item.description = t("tree.showMoreDescription", remaining);
  item.tooltip = t("tree.showMoreTooltip");
  item.iconPath = new vscode.ThemeIcon("add");
  item.command = {
    command: commandId,
    title: t("tree.showMoreCommandTitle"),
    ...(args ? { arguments: args } : {})
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

function formatTitleWithMessageCount(session: AgentSession): string {
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

interface ProjectGroup {
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
function groupSessionsByProject(sessions: AgentSession[]): Map<string, AgentSession[]> {
  const byGroup = new Map<string, AgentSession[]>();
  for (const session of sessions) {
    const key = projectGroupKey(session);
    const bucket = byGroup.get(key) ?? [];
    bucket.push(session);
    byGroup.set(key, bucket);
  }
  return byGroup;
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
  if (provider === "prime") {
    return "prime";
  }
  if (provider === "omp") {
    return "omp";
  }
  if (provider === "cursor") {
    return "cursor cli";
  }
  if (provider === "cursor-ide") {
    return "cursor ide";
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
  if (provider === "prime") {
    return "sparkle";
  }
  if (provider === "omp") {
    return "symbol-method";
  }
  if (provider === "cursor" || provider === "cursor-ide") {
    return "window";
  }
  return "comment-discussion";
}

function sessionIconPath(provider: AgentSession["provider"], cursorIconPath?: vscode.Uri): vscode.ThemeIcon | vscode.Uri {
  if ((provider === "cursor" || provider === "cursor-ide") && cursorIconPath) {
    return cursorIconPath;
  }
  return new vscode.ThemeIcon(providerIcon(provider));
}

interface SearchSessionItem {
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

function getSessionSummaryText(session: AgentSession): string | undefined {
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

function serializeSessionForSearch(
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
