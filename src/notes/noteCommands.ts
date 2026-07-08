import * as vscode from "vscode";
import { AcpChatTreeProvider } from "../acp/acpChatTree";
import { AcpSessionRecord } from "../acp/types";
import { AgentSession } from "../history/types";
import { t } from "../i18n";
import { GtdTreeProvider } from "../gtd/gtdTree";
import { SessionTreeProvider } from "../tree/sessionTree";
import { projectNoteUri, sessionNoteUri } from "./noteUri";
import { NotesStore } from "./notesStore";

export async function openSessionNoteCommand(
  _notesStore: NotesStore,
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  gtdTree: GtdTreeProvider | undefined,
  nodeOrSession: unknown,
  onSaved?: () => void
): Promise<void> {
  const session = resolveSessionForNote(tree, acpTree, gtdTree, nodeOrSession);
  if (!session) {
    return;
  }

  const uri = sessionNoteUri(session.provider, session.id);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
  onSaved?.();
}

export async function openProjectNoteCommand(
  _notesStore: NotesStore,
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  node: unknown,
  onSaved?: () => void
): Promise<void> {
  const projectPath = tree.getProjectFromNode(node) ?? acpTree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }

  const uri = projectNoteUri(projectPath);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
  onSaved?.();
}

export async function deleteSessionNoteCommand(
  notesStore: NotesStore,
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  gtdTree: GtdTreeProvider | undefined,
  nodeOrSession: unknown,
  onDeleted?: () => void
): Promise<void> {
  const session = resolveSessionForNote(tree, acpTree, gtdTree, nodeOrSession);
  if (!session) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    t("dialog.deleteSessionNoteConfirm", session.title),
    { modal: true },
    t("dialog.deleteSessionNoteButton")
  );
  if (confirm !== t("dialog.deleteSessionNoteButton")) {
    return;
  }

  await notesStore.deleteSessionNote(session);
  onDeleted?.();
  vscode.window.showInformationMessage(t("notification.sessionNoteDeleted"));
}

export async function deleteProjectNoteCommand(
  notesStore: NotesStore,
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  node: unknown,
  onDeleted?: () => void
): Promise<void> {
  const projectPath = tree.getProjectFromNode(node) ?? acpTree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }

  const label = tree.getProjectDisplayName(projectPath);
  const confirm = await vscode.window.showWarningMessage(
    t("dialog.deleteProjectNoteConfirm", label),
    { modal: true },
    t("dialog.deleteProjectNoteButton")
  );
  if (confirm !== t("dialog.deleteProjectNoteButton")) {
    return;
  }

  await notesStore.deleteProjectNote(projectPath);
  onDeleted?.();
  vscode.window.showInformationMessage(t("notification.projectNoteDeleted"));
}

function resolveSessionForNote(
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  gtdTree: GtdTreeProvider | undefined,
  nodeOrSession: unknown
): AgentSession | undefined {
  const fromTree = tree.getSessionFromNode(nodeOrSession) ?? gtdTree?.getSessionFromNode(nodeOrSession);
  if (fromTree) {
    return fromTree;
  }

  const record = acpTree.getRecordFromNode(nodeOrSession);
  if (record) {
    return acpRecordToSession(record);
  }

  if (isAgentSession(nodeOrSession)) {
    return nodeOrSession;
  }

  return undefined;
}

function acpRecordToSession(record: AcpSessionRecord): AgentSession {
  return {
    provider: "chat",
    id: record.id,
    title: record.title,
    projectPath: record.projectPath,
    updatedAt: record.updatedAt,
    acpProvider: record.provider,
    messageCount: record.messageCount
  };
}

function isAgentSession(value: unknown): value is AgentSession {
  return Boolean(
    value &&
      typeof value === "object" &&
      "provider" in value &&
      (value.provider === "codex" ||
        value.provider === "claude" ||
        value.provider === "agy" ||
        value.provider === "grok" ||
        value.provider === "alma" ||
        value.provider === "opencode" ||
        value.provider === "pi" ||
        value.provider === "chat") &&
      "id" in value
  );
}