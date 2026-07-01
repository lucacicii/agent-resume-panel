import * as path from "node:path";
import * as vscode from "vscode";
import { basenameOrPath, compactPath } from "../history/pathUtils";
import { AcpAgentProvider, AcpSessionRecord } from "./types";

type AcpTreeRoot = "recentRoot" | "projectsRoot";

export type AcpChatTreeNode =
  | { kind: "recentRoot" }
  | { kind: "projectsRoot" }
  | { kind: "warning"; message: string }
  | { kind: "empty" }
  | { kind: "project"; projectPath: string; records: AcpSessionRecord[] }
  | { kind: "chat"; record: AcpSessionRecord; showProjectName?: boolean };

const recentInitialLimit = 15;

export class AcpChatTreeProvider implements vscode.TreeDataProvider<AcpChatTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<AcpChatTreeNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private records: AcpSessionRecord[] = [];
  private warnings: string[] = [];
  private recentVisibleCount = recentInitialLimit;

  setData(records: AcpSessionRecord[], warnings: string[] = []): void {
    this.records = records;
    this.warnings = warnings;
    this.recentVisibleCount = recentInitialLimit;
    this.onDidChangeTreeDataEmitter.fire();
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  getRecords(): AcpSessionRecord[] {
    return this.records;
  }

  getRecordFromNode(node: unknown): AcpSessionRecord | undefined {
    if (isAcpChatNode(node)) {
      return node.record;
    }
    if (isAcpChatRecord(node)) {
      return node;
    }
    return undefined;
  }

  getProjectFromNode(node: unknown): string | undefined {
    if (isAcpProjectNode(node)) {
      return node.projectPath;
    }
    if (isAcpChatNode(node)) {
      return node.record.projectPath;
    }
    return undefined;
  }

  getTreeItem(element: AcpChatTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "recentRoot":
        return rootItem("Recent ACP Chats", "clock", "acp.recentRoot");
      case "projectsRoot":
        return rootItem("By Project", "folder-library", "acp.projectsRoot");
      case "warning": {
        const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("warning");
        return item;
      }
      case "empty": {
        const item = new vscode.TreeItem("No ACP chats yet", vscode.TreeItemCollapsibleState.None);
        item.description = "Use + New ACP Chat";
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
      case "project": {
        const item = new vscode.TreeItem(
          basenameOrPath(element.projectPath),
          vscode.TreeItemCollapsibleState.Collapsed
        );
        item.description = `${element.records.length}`;
        item.tooltip = element.projectPath;
        item.iconPath = new vscode.ThemeIcon("folder");
        item.contextValue = "agentResume.acpProject";
        return item;
      }
      case "chat":
        return chatItem(element.record, element.showProjectName);
    }
  }

  getChildren(element?: AcpChatTreeNode): AcpChatTreeNode[] {
    if (!element) {
      const roots: AcpChatTreeNode[] = [];
      if (this.warnings.length) {
        roots.push(...this.warnings.map((message) => ({ kind: "warning" as const, message })));
      }
      if (!this.records.length && !this.warnings.length) {
        roots.push({ kind: "empty" });
      }
      roots.push({ kind: "recentRoot" }, { kind: "projectsRoot" });
      return roots;
    }

    if (element.kind === "recentRoot") {
      return this.records
        .slice(0, this.recentVisibleCount)
        .map((record) => ({ kind: "chat" as const, record, showProjectName: true }));
    }

    if (element.kind === "projectsRoot") {
      return groupByProject(this.records);
    }

    if (element.kind === "project") {
      return element.records.map((record) => ({ kind: "chat" as const, record }));
    }

    return [];
  }
}

function rootItem(label: string, icon: string, id: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
  item.id = id;
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

function chatItem(record: AcpSessionRecord, showProjectName = false): vscode.TreeItem {
  const title = record.title || "New ACP Chat";
  const label = showProjectName ? `${basenameOrPath(record.projectPath)} · ${title}` : title;
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.description = `acp/${record.provider} · ${relativeTime(record.updatedAt)}`;
  item.tooltip = [
    title,
    `ACP agent: ${record.provider}`,
    `Project: ${record.projectPath}`,
    `Messages: ${record.messageCount}`,
    record.acpSessionId ? `ACP session: ${record.acpSessionId}` : undefined,
    `Chat: ${record.id}`
  ]
    .filter(Boolean)
    .join("\n");
  item.iconPath = new vscode.ThemeIcon(providerIcon(record.provider));
  item.contextValue = "agentResume.acpChat";
  item.command = {
    command: "agentResume.openAcpChat",
    title: "Open ACP Chat",
    arguments: [{ kind: "chat", record } satisfies AcpChatTreeNode & { kind: "chat" }]
  };
  return item;
}

function groupByProject(records: AcpSessionRecord[]): AcpChatTreeNode[] {
  const byPath = new Map<string, AcpSessionRecord[]>();
  for (const record of records) {
    const projectPath = path.resolve(record.projectPath || process.env.HOME || "");
    const bucket = byPath.get(projectPath) ?? [];
    bucket.push(record);
    byPath.set(projectPath, bucket);
  }

  return [...byPath.entries()]
    .map(([projectPath, projectRecords]) => ({
      kind: "project" as const,
      projectPath,
      records: projectRecords.sort((a, b) => b.updatedAt - a.updatedAt)
    }))
    .sort((a, b) => (b.records[0]?.updatedAt ?? 0) - (a.records[0]?.updatedAt ?? 0) || a.projectPath.localeCompare(b.projectPath));
}

function providerIcon(provider: AcpAgentProvider): string {
  switch (provider) {
    case "codex":
      return "hubot";
    case "claude":
      return "comment-discussion";
    case "grok":
      return "rocket";
    case "opencode":
      return "terminal";
    case "pi":
      return "symbol-method";
    default:
      return "comment";
  }
}

function relativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function acpChatQuickPickLabel(record: AcpSessionRecord): { label: string; description: string; detail: string; record: AcpSessionRecord } {
  return {
    label: record.title || "New ACP Chat",
    description: `acp/${record.provider}`,
    detail: compactPath(record.projectPath),
    record
  };
}

function isAcpChatNode(value: unknown): value is { kind: "chat"; record: AcpSessionRecord } {
  return Boolean(value && typeof value === "object" && (value as { kind?: string }).kind === "chat" && (value as { record?: unknown }).record);
}

function isAcpProjectNode(value: unknown): value is { kind: "project"; projectPath: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { kind?: string }).kind === "project" &&
      typeof (value as { projectPath?: unknown }).projectPath === "string"
  );
}

function isAcpChatRecord(value: unknown): value is AcpSessionRecord {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { id?: unknown }).id === "string" &&
      typeof (value as { projectPath?: unknown }).projectPath === "string" &&
      typeof (value as { provider?: unknown }).provider === "string"
  );
}