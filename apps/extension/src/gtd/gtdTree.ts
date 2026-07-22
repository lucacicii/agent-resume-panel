import * as vscode from "vscode";
import { GtdStatus, GTD_STATUSES } from "../catalog/gtd";
import { AgentSession } from "../history";
import { t } from "../i18n";
import { buildSessionTreeItem, SessionTreeItemOptions } from "../tree/sessionTree";
import { SessionGtdStore } from "./sessionGtdStore";

export type GtdTreeNode =
  | { kind: "status"; status: GtdStatus; count: number }
  | { kind: "session"; session: AgentSession }
  | { kind: "warning"; message: string }
  | { kind: "empty" };

export class GtdTreeProvider implements vscode.TreeDataProvider<GtdTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<GtdTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private sessions: AgentSession[] = [];
  private warnings: string[] = [];
  private sessionTreeOptions: SessionTreeItemOptions = {};

  constructor(private readonly gtdStore: SessionGtdStore) {}

  setSessionTreeOptions(options: SessionTreeItemOptions): void {
    this.sessionTreeOptions = options;
    this.onDidChangeTreeDataEmitter.fire();
  }

  setData(sessions: AgentSession[], warnings: string[] = []): void {
    this.sessions = sessions;
    this.warnings = warnings;
    this.onDidChangeTreeDataEmitter.fire();
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getSessions(): AgentSession[] {
    return this.sessions;
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
    }
  }

  getChildren(element?: GtdTreeNode): GtdTreeNode[] {
    if (!element) {
      const roots: GtdTreeNode[] = [];
      if (this.warnings.length) {
        roots.push(...this.warnings.map((message) => ({ kind: "warning" as const, message })));
      }

      const counts = this.gtdStore.countByStatus(this.sessions);
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
      return this.gtdStore
        .sessionsForStatus(this.sessions, element.status)
        .map((session) => ({ kind: "session" as const, session }));
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
