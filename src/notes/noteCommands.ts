import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { AcpChatTreeProvider } from "../acp/acpChatTree";
import { AcpSessionRecord } from "../acp/types";
import { NoteRecord } from "../catalog/notes";
import { AgentSession } from "../history/types";
import { t } from "../i18n";
import { GtdTreeProvider } from "../gtd/gtdTree";
import { SessionTreeProvider } from "../tree/sessionTree";
import { noteAssetsDirName } from "./noteNaming";
import { NoteOwner } from "./notesPaths";
import { NotesStore } from "./notesStore";
import { NotesTreeProvider, NotesTreeNode } from "./notesTree";

export async function openNoteRecord(notesStore: NotesStore, record: NoteRecord): Promise<void> {
  const abs = notesStore.absolutePath(record);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
  await vscode.window.showTextDocument(document, { preview: false });
}

export async function openNoteCommand(
  notesStore: NotesStore,
  notesTree: NotesTreeProvider | undefined,
  node: unknown
): Promise<void> {
  const record =
    notesTree?.getNoteFromNode(node) ??
    (node && typeof node === "object" && "noteId" in node ? (node as NoteRecord) : undefined);
  if (!record || !("noteId" in record)) {
    return;
  }
  const full = (await notesStore.getNote(record.noteId)) ?? (record as NoteRecord);
  await openNoteRecord(notesStore, full);
}

export async function openSessionNoteCommand(
  notesStore: NotesStore,
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  gtdTree: GtdTreeProvider | undefined,
  nodeOrSession: unknown,
  onChanged?: () => void
): Promise<void> {
  const session = resolveSessionForNote(tree, acpTree, gtdTree, nodeOrSession);
  if (!session) {
    return;
  }

  const notes = await notesStore.listSessionNotes(session);
  if (!notes.length) {
    const created = await notesStore.createSessionNote(session);
    await openNoteRecord(notesStore, created);
    onChanged?.();
    return;
  }

  if (notes.length === 1) {
    await openNoteRecord(notesStore, notes[0]);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    notes.map((n) => ({
      label: n.filename,
      description: n.title,
      note: n
    })),
    { title: t("dialog.pickSessionNoteTitle"), placeHolder: t("dialog.pickNotePlaceholder") }
  );
  if (picked) {
    await openNoteRecord(notesStore, picked.note);
  }
}

export async function openProjectNoteCommand(
  notesStore: NotesStore,
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  node: unknown,
  onChanged?: () => void
): Promise<void> {
  const projectPath = tree.getProjectFromNode(node) ?? acpTree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }

  const notes = await notesStore.listProjectNotes(projectPath);
  if (!notes.length) {
    const created = await notesStore.createProjectNote(projectPath);
    await openNoteRecord(notesStore, created);
    onChanged?.();
    return;
  }

  if (notes.length === 1) {
    await openNoteRecord(notesStore, notes[0]);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    notes.map((n) => ({
      label: n.filename,
      description: n.title,
      note: n
    })),
    { title: t("dialog.pickProjectNoteTitle"), placeHolder: t("dialog.pickNotePlaceholder") }
  );
  if (picked) {
    await openNoteRecord(notesStore, picked.note);
  }
}

export async function newSessionNoteCommand(
  notesStore: NotesStore,
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  gtdTree: GtdTreeProvider | undefined,
  nodeOrSession: unknown,
  onChanged?: () => void
): Promise<void> {
  const session = resolveSessionForNote(tree, acpTree, gtdTree, nodeOrSession);
  if (!session) {
    return;
  }
  const created = await notesStore.createSessionNote(session);
  await openNoteRecord(notesStore, created);
  onChanged?.();
}

export async function newProjectNoteCommand(
  notesStore: NotesStore,
  tree: SessionTreeProvider,
  acpTree: AcpChatTreeProvider,
  node: unknown,
  onChanged?: () => void
): Promise<void> {
  const projectPath = tree.getProjectFromNode(node) ?? acpTree.getProjectFromNode(node);
  if (!projectPath) {
    return;
  }
  const created = await notesStore.createProjectNote(projectPath);
  await openNoteRecord(notesStore, created);
  onChanged?.();
}

export async function newNoteFromNotesViewCommand(
  notesStore: NotesStore,
  tree: SessionTreeProvider,
  notesTree: NotesTreeProvider,
  node: unknown,
  onChanged?: () => void
): Promise<void> {
  if (node && typeof node === "object" && "kind" in node) {
    const n = node as NotesTreeNode;
    if (n.kind === "project") {
      const created = await notesStore.createProjectNote(n.projectPath);
      await openNoteRecord(notesStore, created);
      onChanged?.();
      return;
    }
    if (n.kind === "session") {
      const created = await notesStore.createSessionNote({
        provider: n.provider as AgentSession["provider"],
        id: n.sessionId,
        projectPath: n.projectPath ?? ""
      });
      await openNoteRecord(notesStore, created);
      onChanged?.();
      return;
    }
  }

  const choice = await vscode.window.showQuickPick(
    [
      { label: t("dialog.newNoteKindProject"), noteKind: "project" as const },
      { label: t("dialog.newNoteKindSession"), noteKind: "session" as const }
    ],
    { title: t("dialog.newNoteTitle") }
  );
  if (!choice) {
    return;
  }

  if (choice.noteKind === "project") {
    const projects = [...new Set(tree.getSessions().map((s) => s.projectPath).filter(Boolean))];
    const picked = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: tree.getProjectDisplayName(p), description: p, path: p })),
      { title: t("dialog.pickProjectForNote"), placeHolder: t("dialog.pickNotePlaceholder") }
    );
    if (!picked) {
      return;
    }
    const created = await notesStore.createProjectNote(picked.path);
    await openNoteRecord(notesStore, created);
    onChanged?.();
    return;
  }

  const sessions = tree.getSessions();
  const picked = await vscode.window.showQuickPick(
    sessions.map((s) => ({
      label: s.title,
      description: `${s.provider} · ${tree.getProjectDisplayName(s.projectPath)}`,
      session: s
    })),
    { title: t("dialog.pickSessionForNote"), placeHolder: t("dialog.pickNotePlaceholder") }
  );
  if (!picked) {
    return;
  }
  const created = await notesStore.createSessionNote(picked.session);
  await openNoteRecord(notesStore, created);
  onChanged?.();
  void notesTree;
}

export async function importNotesCommand(
  notesStore: NotesStore,
  tree: SessionTreeProvider,
  notesTree: NotesTreeProvider,
  node: unknown,
  onChanged?: () => void
): Promise<void> {
  const owner = await resolveNoteOwnerForCommand(tree, notesTree, node);
  if (!owner) {
    return;
  }

  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: true,
    openLabel: t("dialog.importNotesOpenLabel"),
    filters: { Markdown: ["md"] }
  });
  if (!uris?.length) {
    return;
  }

  const sourcePaths: string[] = [];
  for (const uri of uris) {
    const fsPath = uri.fsPath;
    try {
      const stat = await fs.stat(fsPath);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(fsPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !entry.name.startsWith(".")) {
            sourcePaths.push(path.join(fsPath, entry.name));
          }
        }
      } else if (stat.isFile() && fsPath.toLowerCase().endsWith(".md")) {
        sourcePaths.push(fsPath);
      }
    } catch {
      // skip unreadable paths
    }
  }

  if (!sourcePaths.length) {
    vscode.window.showInformationMessage(t("notification.importNotesNoFiles"));
    return;
  }

  const result = await notesStore.importMarkdownFiles(owner, sourcePaths);
  onChanged?.();

  if (result.imported > 0 && result.errors.length === 0) {
    vscode.window.showInformationMessage(t("notification.importNotesSuccess", result.imported));
  } else if (result.imported > 0) {
    vscode.window.showWarningMessage(
      t("notification.importNotesPartial", result.imported, result.skipped, result.errors.length)
    );
  } else {
    const detail = result.errors[0] ? ` ${result.errors[0]}` : "";
    vscode.window.showErrorMessage(t("notification.importNotesFailed") + detail);
  }
}

async function resolveNoteOwnerForCommand(
  tree: SessionTreeProvider,
  notesTree: NotesTreeProvider,
  node: unknown
): Promise<NoteOwner | undefined> {
  if (node && typeof node === "object" && "kind" in node) {
    const n = node as NotesTreeNode;
    if (n.kind === "project") {
      return { scope: "project", projectPath: n.projectPath };
    }
    if (n.kind === "session") {
      return {
        scope: "session",
        provider: n.provider as AgentSession["provider"],
        sessionId: n.sessionId,
        projectPath: n.projectPath
      };
    }
    if (n.kind === "note") {
      const note = n.note;
      if (note.scope === "project" && note.projectPath) {
        return { scope: "project", projectPath: note.projectPath };
      }
      if (note.scope === "session" && note.provider && note.agentSessionId) {
        return {
          scope: "session",
          provider: note.provider as AgentSession["provider"],
          sessionId: note.agentSessionId,
          projectPath: note.projectPath
        };
      }
    }
  }

  const choice = await vscode.window.showQuickPick(
    [
      { label: t("dialog.newNoteKindProject"), noteKind: "project" as const },
      { label: t("dialog.newNoteKindSession"), noteKind: "session" as const }
    ],
    { title: t("dialog.importNotesTitle") }
  );
  if (!choice) {
    return undefined;
  }

  if (choice.noteKind === "project") {
    const projects = [...new Set(tree.getSessions().map((s) => s.projectPath).filter(Boolean))];
    const picked = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: tree.getProjectDisplayName(p), description: p, path: p })),
      { title: t("dialog.pickProjectForNote"), placeHolder: t("dialog.pickNotePlaceholder") }
    );
    if (!picked) {
      return undefined;
    }
    return { scope: "project", projectPath: picked.path };
  }

  const sessions = tree.getSessions();
  const picked = await vscode.window.showQuickPick(
    sessions.map((s) => ({
      label: s.title,
      description: `${s.provider} · ${tree.getProjectDisplayName(s.projectPath)}`,
      session: s
    })),
    { title: t("dialog.pickSessionForNote"), placeHolder: t("dialog.pickNotePlaceholder") }
  );
  if (!picked) {
    return undefined;
  }
  return {
    scope: "session",
    provider: picked.session.provider,
    sessionId: picked.session.id,
    projectPath: picked.session.projectPath
  };
}

export async function deleteNoteCommand(
  notesStore: NotesStore,
  notesTree: NotesTreeProvider | undefined,
  node: unknown,
  onChanged?: () => void
): Promise<void> {
  const record = notesTree?.getNoteFromNode(node);
  if (!record) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    t("dialog.deleteNoteConfirm", record.filename),
    { modal: true },
    t("dialog.deleteNoteButton")
  );
  if (confirm !== t("dialog.deleteNoteButton")) {
    return;
  }

  await notesStore.deleteNote(record.noteId);
  onChanged?.();
  vscode.window.showInformationMessage(t("notification.noteDeleted"));
}

export async function renameNoteCommand(
  notesStore: NotesStore,
  notesTree: NotesTreeProvider | undefined,
  node: unknown,
  onChanged?: () => void
): Promise<void> {
  const record = notesTree?.getNoteFromNode(node);
  if (!record) {
    return;
  }

  const value = await vscode.window.showInputBox({
    title: t("dialog.renameNoteTitle"),
    prompt: t("dialog.renameNotePrompt"),
    value: record.filename,
    valueSelection: [0, record.filename.endsWith(".md") ? record.filename.length - 3 : record.filename.length],
    validateInput: (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        return t("dialog.renameNoteValidateEmpty");
      }
      if (/[\\/]/.test(trimmed)) {
        return t("dialog.renameNoteValidatePath");
      }
      return undefined;
    }
  });
  if (value === undefined) {
    return;
  }

  try {
    const updated = await notesStore.renameNote(record.noteId, value);
    onChanged?.();
    vscode.window.showInformationMessage(t("notification.noteRenamed", updated.filename));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(t("notification.noteRenameFailed", message));
  }
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

  const notes = await notesStore.listSessionNotes(session);
  if (!notes.length) {
    vscode.window.showInformationMessage(t("notification.noNotesToDelete"));
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    t("dialog.deleteSessionNotesConfirm", session.title, String(notes.length)),
    { modal: true },
    t("dialog.deleteSessionNoteButton")
  );
  if (confirm !== t("dialog.deleteSessionNoteButton")) {
    return;
  }

  await notesStore.deleteSessionNotes(session);
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

  const notes = await notesStore.listProjectNotes(projectPath);
  if (!notes.length) {
    vscode.window.showInformationMessage(t("notification.noNotesToDelete"));
    return;
  }

  const label = tree.getProjectDisplayName(projectPath);
  const confirm = await vscode.window.showWarningMessage(
    t("dialog.deleteProjectNotesConfirm", label, String(notes.length)),
    { modal: true },
    t("dialog.deleteProjectNoteButton")
  );
  if (confirm !== t("dialog.deleteProjectNoteButton")) {
    return;
  }

  await notesStore.deleteProjectNotes(projectPath);
  onDeleted?.();
  vscode.window.showInformationMessage(t("notification.projectNoteDeleted"));
}

export async function filterNotesCommand(notesTree: NotesTreeProvider, treeView?: vscode.TreeView<NotesTreeNode>): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: t("dialog.filterNotesTitle"),
    prompt: t("dialog.filterNotesPrompt"),
    value: notesTree.getFilter()
  });
  if (value === undefined) {
    return;
  }
  notesTree.setFilter(value);
  if (treeView) {
    treeView.message = value.trim() ? t("tree.notes.filterMessage", value.trim()) : undefined;
  }
}

export async function clearNotesFilterCommand(
  notesTree: NotesTreeProvider,
  treeView?: vscode.TreeView<NotesTreeNode>
): Promise<void> {
  notesTree.clearFilter();
  if (treeView) {
    treeView.message = undefined;
  }
}

export async function revealNoteInOsCommand(
  notesStore: NotesStore,
  notesTree: NotesTreeProvider | undefined,
  node: unknown
): Promise<void> {
  const record = notesTree?.getNoteFromNode(node);
  if (!record) {
    return;
  }
  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(notesStore.absolutePath(record)));
}

export async function openNotesFolderCommand(notesStore: NotesStore): Promise<void> {
  const root = path.join(notesStore.getPanelHome(), "notes");
  await fs.mkdir(root, { recursive: true });
  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(root));
}

export async function copyNotePathCommand(
  notesStore: NotesStore,
  notesTree: NotesTreeProvider | undefined,
  node: unknown
): Promise<void> {
  const record = notesTree?.getNoteFromNode(node);
  if (!record) {
    return;
  }
  await vscode.env.clipboard.writeText(notesStore.absolutePath(record));
  vscode.window.showInformationMessage(t("notification.notePathCopied"));
}

export async function insertNoteImageCommand(notesStore: NotesStore): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const abs = editor.document.uri.fsPath;
  const notes = notesStore.getAllNotes();
  const record = notes.find((n) => notesStore.absolutePath(n) === abs);
  if (!record) {
    vscode.window.showWarningMessage(t("notification.insertImageNotANote"));
    return;
  }

  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { Images: ["png", "jpg", "jpeg", "gif", "webp", "svg"] }
  });
  if (!uris?.length) {
    return;
  }

  const source = uris[0];
  const assetsDir = await notesStore.ensureAssetsForNote(record);
  const base = path.basename(source.fsPath);
  const dest = path.join(assetsDir, base);
  await fs.copyFile(source.fsPath, dest);
  const rel = `./${noteAssetsDirName(record.filename)}/${base}`;
  const snippet = `![${base}](${rel})`;
  await editor.edit((builder) => {
    builder.insert(editor.selection.active, snippet);
  });
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
