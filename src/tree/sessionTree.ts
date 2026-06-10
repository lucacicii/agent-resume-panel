import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession, basenameOrPath, compactPath } from "../history";

type RootNode = ActionNode | RecentRootNode | ProjectsRootNode | WarningNode | EmptyNode;
type TreeNode = RootNode | ProjectNode | SessionNode;
export type ProviderFilter = "all" | "codex" | "claude";
export type TimeFilter = "all" | "today" | "7d" | "30d" | "90d";

export interface SessionFilters {
  provider: ProviderFilter;
  time: TimeFilter;
  projectPath?: string;
  text: string;
}

interface ActionNode {
  kind: "action";
  action: "filter" | "clearFilters";
}

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
  filtered: boolean;
}

interface ProjectNode {
  kind: "project";
  projectPath: string;
  sessions: AgentSession[];
}

export interface SessionNode {
  kind: "session";
  session: AgentSession;
}

export class SessionTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private sessions: AgentSession[] = [];
  private warnings: string[] = [];
  private filters: SessionFilters = defaultFilters();

  setData(sessions: AgentSession[], warnings: string[]): void {
    this.sessions = sessions;
    this.warnings = warnings;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setFilters(filters: SessionFilters): void {
    this.filters = normalizeFilters(filters);
    this.onDidChangeTreeDataEmitter.fire();
  }

  clearFilters(): void {
    this.setFilters(defaultFilters());
  }

  getFilters(): SessionFilters {
    return { ...this.filters };
  }

  hasActiveFilters(): boolean {
    return hasActiveFilters(this.filters);
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
      case "action":
        return actionItem(element.action, this.filterSummaryLabel());
      case "recentRoot":
        return rootItem("Recent Sessions", "clock", this.filteredDescription());
      case "projectsRoot":
        return rootItem("Projects", "folder-library", this.filteredDescription());
      case "warning": {
        const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("warning");
        return item;
      }
      case "empty": {
        const item = new vscode.TreeItem(
          element.filtered ? "No sessions match filters" : "No sessions found",
          vscode.TreeItemCollapsibleState.None
        );
        item.description = element.filtered ? "Clear filters" : "Check settings";
        item.iconPath = new vscode.ThemeIcon("info");
        if (element.filtered) {
          item.command = {
            command: "agentResume.clearSessionFilters",
            title: "Clear Session Filters"
          };
        }
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
        return sessionItem(element.session);
    }
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const filteredSessions = this.getFilteredSessions();

    if (!element) {
      const roots: TreeNode[] = [];
      if (this.warnings.length) {
        roots.push(...this.warnings.map((message) => ({ kind: "warning" as const, message })));
      }
      roots.push({ kind: "action", action: "filter" });
      if (this.hasActiveFilters()) {
        roots.push({ kind: "action", action: "clearFilters" });
      }
      if (!this.sessions.length || !filteredSessions.length) {
        roots.push({ kind: "empty", filtered: this.sessions.length > 0 });
        return roots;
      }
      roots.push({ kind: "recentRoot" }, { kind: "projectsRoot" });
      return roots;
    }

    if (element.kind === "recentRoot") {
      return filteredSessions.slice(0, 50).map((session) => ({ kind: "session", session }));
    }

    if (element.kind === "projectsRoot") {
      return groupByProject(filteredSessions);
    }

    if (element.kind === "project") {
      return element.sessions.map((session) => ({ kind: "session", session }));
    }

    return [];
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getSessions(): AgentSession[] {
    return this.sessions;
  }

  getFilteredSessions(): AgentSession[] {
    return filterSessions(this.sessions, this.filters);
  }

  getProjects(): string[] {
    return groupByProject(this.sessions).map((project) => project.projectPath);
  }

  private filteredDescription(): string | undefined {
    if (!this.hasActiveFilters()) {
      return undefined;
    }

    return `${this.getFilteredSessions().length}/${this.sessions.length}`;
  }

  private filterSummaryLabel(): string {
    if (!this.hasActiveFilters()) {
      return "All sessions";
    }

    return `${filterSummary(this.filters)} · ${this.getFilteredSessions().length}/${this.sessions.length}`;
  }
}

function actionItem(action: ActionNode["action"], description: string): vscode.TreeItem {
  if (action === "filter") {
    const item = new vscode.TreeItem("Filter Sessions", vscode.TreeItemCollapsibleState.None);
    item.description = description;
    item.iconPath = new vscode.ThemeIcon("filter");
    item.contextValue = "agentResume.action";
    item.command = {
      command: "agentResume.filterSessions",
      title: "Filter Sessions"
    };
    return item;
  }

  const item = new vscode.TreeItem("Clear Session Filters", vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon("clear-all");
  item.contextValue = "agentResume.action";
  item.command = {
    command: "agentResume.clearSessionFilters",
    title: "Clear Session Filters"
  };
  return item;
}

function rootItem(label: string, icon: string, description?: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
  item.description = description;
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

function sessionItem(session: AgentSession): vscode.TreeItem {
  const item = new vscode.TreeItem(session.title, vscode.TreeItemCollapsibleState.None);
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
  item.iconPath = new vscode.ThemeIcon(session.provider === "codex" ? "hubot" : "comment-discussion");
  item.contextValue = "agentResume.session";
  item.command = {
    command: "agentResume.openSession",
    title: "Resume Session",
    arguments: [{ kind: "session", session } satisfies SessionNode]
  };
  return item;
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
  return provider === "codex" ? "codex" : "claude";
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
    label: `$(comment-discussion) ${session.title}`,
    description: providerLabel(session.provider),
    detail: `${compactPath(session.projectPath)}${session.branch ? ` · ${session.branch}` : ""}`,
    session
  };
}

export function defaultFilters(): SessionFilters {
  return {
    provider: "all",
    time: "all",
    text: ""
  };
}

export function filterSummary(filters: SessionFilters): string {
  const parts: string[] = [];
  if (filters.provider !== "all") {
    parts.push(providerLabel(filters.provider));
  }
  if (filters.time !== "all") {
    parts.push(timeLabel(filters.time));
  }
  if (filters.projectPath) {
    parts.push(compactPath(filters.projectPath));
  }
  if (filters.text.trim()) {
    parts.push(`"${filters.text.trim()}"`);
  }

  return parts.length ? parts.join(" · ") : "All sessions";
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

function filterSessions(sessions: AgentSession[], filters: SessionFilters): AgentSession[] {
  const normalizedText = filters.text.trim().toLowerCase();
  const minTimestamp = minTimestampFor(filters.time);

  return sessions.filter((session) => {
    if (filters.provider !== "all" && session.provider !== filters.provider) {
      return false;
    }
    if (filters.projectPath && session.projectPath !== filters.projectPath) {
      return false;
    }
    if (minTimestamp && session.updatedAt < minTimestamp) {
      return false;
    }
    if (normalizedText && !sessionMatchesText(session, normalizedText)) {
      return false;
    }

    return true;
  });
}

function sessionMatchesText(session: AgentSession, text: string): boolean {
  return [session.title, session.projectPath, session.branch, session.id]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(text));
}

function minTimestampFor(time: TimeFilter): number | undefined {
  if (time === "all") {
    return undefined;
  }
  if (time === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }

  const days = Number(time.replace("d", ""));
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function normalizeFilters(filters: SessionFilters): SessionFilters {
  return {
    provider: filters.provider,
    time: filters.time,
    projectPath: filters.projectPath || undefined,
    text: filters.text.trim()
  };
}

function hasActiveFilters(filters: SessionFilters): boolean {
  return (
    filters.provider !== "all" ||
    filters.time !== "all" ||
    Boolean(filters.projectPath) ||
    Boolean(filters.text.trim())
  );
}

function timeLabel(time: TimeFilter): string {
  switch (time) {
    case "today":
      return "today";
    case "7d":
      return "7d";
    case "30d":
      return "30d";
    case "90d":
      return "90d";
    case "all":
      return "all";
  }
}
