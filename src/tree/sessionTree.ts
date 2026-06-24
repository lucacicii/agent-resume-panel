import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession, basenameOrPath, compactPath } from "../history";
import { DEFAULT_SECTION_ORDER, SectionKind } from "./sectionOrder";

type RootNode = RecentRootNode | FavoritesRootNode | ProjectsRootNode | WarningNode | EmptyNode;
export type TreeNode = RootNode | ProjectNode | SessionNode | ChatSessionNode | LinkedAgentNode | ShowMoreRecentNode;
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

export interface ChatSessionNode {
  kind: "chatSession";
  session: AgentSession;
}

export interface LinkedAgentNode {
  kind: "linkedAgent";
  chatSession: AgentSession;
  agentSession?: AgentSession;
}

export class SessionTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private sessions: AgentSession[] = [];
  private linkedAgentKeys = new Set<string>();
  private warnings: string[] = [];
  private favoriteProjects: string[] = [];
  private sectionOrder: SectionKind[] = [...DEFAULT_SECTION_ORDER];
  private recentVisibleCount = recentInitialLimit;

  setData(sessions: AgentSession[], warnings: string[], linkedAgentKeys: Set<string> = new Set()): void {
    this.sessions = sessions;
    this.warnings = warnings;
    this.linkedAgentKeys = linkedAgentKeys;
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
    if (isChatSessionNode(node)) {
      return node.session;
    }
    if (isLinkedAgentNode(node) && node.agentSession) {
      return node.agentSession;
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
    if (isChatSessionNode(node)) {
      return node.session.projectPath;
    }
    if (isLinkedAgentNode(node)) {
      return node.chatSession.projectPath;
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
    if (isChatSessionNode(node)) {
      return [node.session];
    }
    if (isLinkedAgentNode(node) && node.agentSession) {
      return [node.agentSession];
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
      case "chatSession":
        return chatSessionItem(element.session);
      case "linkedAgent":
        return linkedAgentItem(element);
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
        .map((session) =>
          session.provider === "chat"
            ? ({ kind: "chatSession" as const, session } satisfies ChatSessionNode)
            : ({ kind: "session" as const, session, showProjectName: true } satisfies SessionNode)
        );
      const remaining = Math.max(0, this.sessions.length - visibleSessions.length);
      if (remaining > 0) {
        visibleSessions.push({ kind: "showMoreRecent", remaining });
      }
      return visibleSessions;
    }

    if (element.kind === "favoritesRoot") {
      return buildFavoriteProjectNodes(this.favoriteProjects, this.sessions, this.linkedAgentKeys);
    }

    if (element.kind === "projectsRoot") {
      return groupByProject(this.sessions, new Set(this.favoriteProjects), this.linkedAgentKeys);
    }

    if (element.kind === "project") {
      return buildProjectChildren(element.sessions, this.sessions, this.linkedAgentKeys);
    }

    if (element.kind === "chatSession") {
      return [
        {
          kind: "linkedAgent",
          chatSession: element.session,
          agentSession: resolveLinkedAgentSession(element.session, this.sessions)
        }
      ];
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
  item.tooltip = buildSessionTooltip(session);
  item.iconPath = new vscode.ThemeIcon(providerIcon(session.provider));
  item.contextValue = `agentResume.session.${session.provider}`;
  item.command = {
    command: "agentResume.openSession",
    title: "Resume Session",
    arguments: [{ kind: "session", session } satisfies SessionNode]
  };
  return item;
}

function chatSessionItem(session: AgentSession): vscode.TreeItem {
  const link = session.chatLink;
  const status = chatSessionStatus(session);
  const linkLabel = link?.sessionId ? `${link.provider} · ${status}` : `${link?.provider ?? "agent"} · ${status}`;
  const item = new vscode.TreeItem(session.title, vscode.TreeItemCollapsibleState.Collapsed);
  item.description = `chat · → ${linkLabel} · ${relativeTime(session.updatedAt)}`;
  item.tooltip = [
    buildSessionTooltip(session),
    link ? `Linked agent: ${link.provider}` : undefined,
    `Status: ${status}`,
    "Expand to view linked agent"
  ]
    .filter(Boolean)
    .join("\n");
  item.iconPath = new vscode.ThemeIcon(chatSessionIcon(status));
  item.contextValue = "agentResume.session.chat";
  item.command = {
    command: "agentResume.openChatSession",
    title: "Open Chat",
    arguments: [{ kind: "chatSession", session } satisfies ChatSessionNode]
  };
  return item;
}

function chatSessionStatus(session: AgentSession): "planning" | "linked" | "synced" {
  const link = session.chatLink;
  if (!link?.handoffCount) {
    return "planning";
  }
  if (link.lastAgentSummaryAt) {
    return "synced";
  }
  return "linked";
}

function chatSessionIcon(status: "planning" | "linked" | "synced"): string {
  if (status === "synced") {
    return "check";
  }
  if (status === "linked") {
    return "link";
  }
  return "comment";
}

function linkedAgentItem(node: LinkedAgentNode): vscode.TreeItem {
  if (node.agentSession) {
    const item = sessionItem(node.agentSession);
    item.label = `→ ${node.agentSession.title}`;
    item.collapsibleState = vscode.TreeItemCollapsibleState.None;
    item.contextValue = `agentResume.linkedAgent.${node.agentSession.provider}`;
    item.command = {
      command: "agentResume.openSession",
      title: "Resume Linked Agent",
      arguments: [{ kind: "session", session: node.agentSession } satisfies SessionNode]
    };
    return item;
  }

  const provider = node.chatSession.chatLink?.provider ?? "codex";
  const item = new vscode.TreeItem(`→ ${provider} (awaiting handoff)`, vscode.TreeItemCollapsibleState.None);
  item.description = "pending";
  item.iconPath = new vscode.ThemeIcon(providerIcon(provider));
  item.contextValue = "agentResume.linkedAgent.pending";
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

function buildSessionTooltip(session: AgentSession): string {
  return [
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

function buildProjectChildren(
  projectSessions: AgentSession[],
  allSessions: AgentSession[],
  linkedAgentKeys: Set<string>
): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const session of projectSessions) {
    if (session.provider === "chat") {
      nodes.push({ kind: "chatSession", session });
      continue;
    }
    if (linkedAgentKeys.has(`${session.provider}:${session.id}`)) {
      continue;
    }
    nodes.push({ kind: "session", session });
  }
  return nodes;
}

function resolveLinkedAgentSession(chatSession: AgentSession, sessions: AgentSession[]): AgentSession | undefined {
  const link = chatSession.chatLink;
  if (!link?.sessionId) {
    return undefined;
  }
  return sessions.find((session) => session.provider === link.provider && session.id === link.sessionId);
}

function groupSessionsByPath(sessions: AgentSession[], linkedAgentKeys: Set<string>): Map<string, AgentSession[]> {
  const byPath = new Map<string, AgentSession[]>();
  for (const session of sessions) {
    if (session.provider !== "chat" && linkedAgentKeys.has(`${session.provider}:${session.id}`)) {
      continue;
    }
    const projectPath = path.resolve(session.projectPath || process.env.HOME || "");
    const bucket = byPath.get(projectPath) ?? [];
    bucket.push(session);
    byPath.set(projectPath, bucket);
  }
  return byPath;
}

function buildFavoriteProjectNodes(
  favoritePaths: string[],
  sessions: AgentSession[],
  linkedAgentKeys: Set<string>
): ProjectNode[] {
  const byPath = groupSessionsByPath(sessions, linkedAgentKeys);
  return favoritePaths.map((projectPath) => ({
    kind: "project" as const,
    projectPath,
    sessions: (byPath.get(projectPath) ?? []).sort((a, b) => b.updatedAt - a.updatedAt),
    favorited: true
  }));
}

function groupByProject(
  sessions: AgentSession[],
  excludePaths = new Set<string>(),
  linkedAgentKeys: Set<string>
): ProjectNode[] {
  const byPath = groupSessionsByPath(sessions, linkedAgentKeys);

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
  const linkSuffix =
    session.provider === "chat" && session.chatLink
      ? ` → ${session.chatLink.provider}${session.chatLink.sessionId ? "" : " (pending)"}`
      : "";
  return {
    label: `$(${providerIcon(session.provider)}) ${formatTitleWithMessageCount(session)}`,
    description: `${providerLabel(session.provider)}${linkSuffix}`,
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

function isChatSessionNode(node: unknown): node is ChatSessionNode {
  return Boolean(node && typeof node === "object" && "kind" in node && node.kind === "chatSession");
}

function isLinkedAgentNode(node: unknown): node is LinkedAgentNode {
  return Boolean(node && typeof node === "object" && "kind" in node && node.kind === "linkedAgent");
}

function isProjectNode(node: unknown): node is ProjectNode {
  return Boolean(node && typeof node === "object" && "kind" in node && node.kind === "project");
}