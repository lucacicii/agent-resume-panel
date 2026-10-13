import * as vscode from "vscode";
import { GtdStatus, GTD_STATUSES } from "../catalog/gtd";
import { queryGtdCountsFromCatalog, queryGtdSessionsPage } from "../catalog/query";
import { AgentSession } from "../history";
import { t } from "../i18n";
import { LlmOutputLanguage } from "../llm/languages";
import { buildSessionTreeItem, SessionTreeItemOptions } from "../tree/sessionTree";
import { SessionGtdStore } from "./sessionGtdStore";

const gtdInitialLimit = 20;
const gtdLimitStep = 20;

type GtdTreeNode =
  | { kind: "status"; status: GtdStatus; count: number }
  | { kind: "session"; session: AgentSession }
  | { kind: "showMoreStatus"; status: GtdStatus; remaining: number }
  | { kind: "warning"; message: string }
  | { kind: "empty" };
export class GtdTreeProvider implements vscode.TreeDataProvider<GtdTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<GtdTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private sessions: AgentSession[] = [];
  private warnings: string[] = [];
  private sessionTreeOptions: SessionTreeItemOptions = {};
  private catalogConfig?: { dbPath: string; outputLanguage?: LlmOutputLanguage };
  private visibleCounts = new Map<GtdStatus, number>();
  private cachedSessionsByStatus = new Map<GtdStatus, AgentSession[]>();

  constructor(private readonly gtdStore: SessionGtdStore) {}

  setSessionTreeOptions(options: SessionTreeItemOptions): void {
    this.sessionTreeOptions = options;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setCatalogSource(config: { dbPath: string; outputLanguage?: LlmOutputLanguage; warnings?: string[] }): void {
    this.catalogConfig = { dbPath: config.dbPath, outputLanguage: config.outputLanguage };
    this.warnings = config.warnings ?? [];
    this.visibleCounts.clear();
    this.cachedSessionsByStatus.clear();
    this.onDidChangeTreeDataEmitter.fire();
  }

  setData(sessions: AgentSession[], warnings: string[] = []): void {
    this.catalogConfig = undefined;
    this.sessions = sessions;
    this.warnings = warnings;
    this.visibleCounts.clear();
    this.cachedSessionsByStatus.clear();
    this.onDidChangeTreeDataEmitter.fire();
  }

  showMoreStatus(status?: GtdStatus): void {
    if (!status) {
      return;
    }
    const current = this.visibleCounts.get(status) ?? gtdInitialLimit;
    this.visibleCounts.set(status, current + gtdLimitStep);
    this.onDidChangeTreeDataEmitter.fire();
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getSessions(): AgentSession[] {
    if (!this.catalogConfig) {
      return this.sessions;
    }
    const all: AgentSession[] = [];
    for (const list of this.cachedSessionsByStatus.values()) {
      all.push(...list);
    }
    return all;
  }

  getSessionFromNode(node: unknown): AgentSession | undefined {
    if (isGtdSessionNode(node)) {
      return node.session;
    }
    return undefined;
  }

  getTreeItem(element: GtdTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "warning": {
        const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("warning");
        return item;
      }
      case "empty": {
        const item = new vscode.TreeItem(t("tree.gtd.noTaggedSessions"), vscode.TreeItemCollapsibleState.None);
        item.description = t("tree.gtd.noTaggedSessionsDescription");
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
      case "status": {
        const item = new vscode.TreeItem(
          gtdStatusLabel(element.status),
          element.count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );
        item.description = `${element.count}`;
        item.id = `agentResume.gtd.${element.status}`;
        item.iconPath = new vscode.ThemeIcon(gtdStatusIcon(element.status));
        item.contextValue = `agentResume.gtdStatus.${element.status}`;
        return item;
      }
      case "session":
        return buildSessionTreeItem(element.session, this.sessionTreeOptions);
      case "showMoreStatus": {
        const item = new vscode.TreeItem(t("tree.showMore"), vscode.TreeItemCollapsibleState.None);
        item.description = t("tree.showMoreDescription", element.remaining);
        item.tooltip = t("tree.showMoreTooltip");
        item.iconPath = new vscode.ThemeIcon("add");
        item.command = {
          command: "agentResume.showMoreGtdStatus",
          title: t("tree.showMoreCommandTitle"),
          arguments: [element.status]
        };
        return item;
      }
    }
  }

  async getChildren(element?: GtdTreeNode): Promise<GtdTreeNode[]> {
    if (!element) {
      const roots: GtdTreeNode[] = [];
      if (this.warnings.length) {
        roots.push(...this.warnings.map((message) => ({ kind: "warning" as const, message })));
      }

      const counts = this.catalogConfig
        ? await queryGtdCountsFromCatalog(this.catalogConfig.dbPath)
        : this.gtdStore.countByStatus(this.sessions);
      const hasTagged = GTD_STATUSES.some((status) => counts[status] > 0);
      if (!hasTagged && !this.warnings.length) {
        roots.push({ kind: "empty" });
      }

      roots.push(
        ...GTD_STATUSES.map((status) => ({
          kind: "status" as const,
          status,
          count: counts[status]
        }))
      );
      return roots;
    }

    if (element.kind === "status") {
      const limit = this.visibleCounts.get(element.status) ?? gtdInitialLimit;
      if (this.catalogConfig) {
        const page = await queryGtdSessionsPage(this.catalogConfig.dbPath, {
          status: element.status,
          limit,
          offset: 0,
          outputLanguage: this.catalogConfig.outputLanguage
        });
        this.cachedSessionsByStatus.set(element.status, page.sessions);
        const nodes: GtdTreeNode[] = page.sessions.map((session) => ({ kind: "session" as const, session }));
        const remaining = Math.max(0, page.total - nodes.length);
        if (remaining > 0) {
          nodes.push({ kind: "showMoreStatus", status: element.status, remaining });
        }
        return nodes;
      }

      const allForStatus = this.gtdStore.sessionsForStatus(this.sessions, element.status);
      const visible: GtdTreeNode[] = allForStatus
        .slice(0, limit)
        .map((session) => ({ kind: "session" as const, session }));
      const remaining = Math.max(0, allForStatus.length - visible.length);
      if (remaining > 0) {
        visible.push({ kind: "showMoreStatus", status: element.status, remaining });
      }
      return visible;
    }

    return [];
  }
}

export function gtdStatusLabel(status: GtdStatus): string {
  return t(`tree.gtd.status.${status}`);
}

function gtdStatusIcon(status: GtdStatus): string {
  switch (status) {
    case "inbox":
      return "inbox";
    case "next":
      return "arrow-right";
    case "waiting":
      return "watch";
    case "someday":
      return "calendar";
    case "reference":
      return "book";
    case "done":
      return "pass-filled";
    default:
      return "tag";
  }
}

function isGtdSessionNode(node: unknown): node is Extract<GtdTreeNode, { kind: "session" }> {
  return Boolean(node && typeof node === "object" && "kind" in node && (node as GtdTreeNode).kind === "session");
}
