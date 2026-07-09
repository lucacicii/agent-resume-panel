import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { ensureCatalogSchema } from "../catalog/db";
import {
  deleteNoteRecord,
  getNoteById,
  listAllNotes,
  listProjectNotes,
  listSessionNotes,
  loadProjectNoteFlags,
  loadSessionNoteFlags,
  NoteRecord,
  upsertNoteRecord
} from "../catalog/notes";
import { sessionGtdKey } from "../catalog/gtd";
import { AgentSession } from "../history/types";
import { normalizeProjectPath } from "../projects/projectAliases";
import { contentPreview, extractTitle, parseNoteDocument } from "./noteFrontmatter";
import { nextNoteFilename, normalizeNoteFilename, rewriteAssetReferences } from "./noteNaming";
import {
  absFromRelMdPath,
  NoteOwner,
  notesRoot,
  ownerRelDir,
  resolvePanelHome
} from "./notesPaths";
import {
  deleteNoteFiles,
  ensureAssetsDir,
  ensureOwnerDir,
  fileMtimeMs,
  listMarkdownFilenames,
  newNoteId,
  pathExists,
  renameNoteFiles,
  writeNewNoteFile
} from "./notesFs";
import { reconcileNotesIndex } from "./notesReconcile";

export class NotesStore {
  private sessionFlags = new Set<string>();
  private projectFlags = new Set<string>();
  private cachedNotes: NoteRecord[] = [];
  private panelHome: string;

  constructor(
    private readonly dbPath: string,
    panelHome?: string
  ) {
    this.panelHome = resolvePanelHome(panelHome);
  }

  getPanelHome(): string {
    return this.panelHome;
  }

  setPanelHome(panelHome: string): void {
    this.panelHome = resolvePanelHome(panelHome);
  }

  async initialize(): Promise<void> {
    await ensureCatalogSchema(this.dbPath);
    await fs.mkdir(notesRoot(this.panelHome), { recursive: true });
    await this.reload();
  }

  async reload(): Promise<void> {
    await reconcileNotesIndex(this.dbPath, this.panelHome);
    this.cachedNotes = await listAllNotes(this.dbPath);
    this.sessionFlags = await loadSessionNoteFlags(this.dbPath);
    this.projectFlags = await loadProjectNoteFlags(this.dbPath);
  }

  getAllNotes(): NoteRecord[] {
    return this.cachedNotes;
  }

  hasSessionNote(session: Pick<AgentSession, "provider" | "id">): boolean {
    return this.sessionFlags.has(sessionGtdKey(session));
  }

  hasProjectNote(projectPath: string): boolean {
    return this.projectFlags.has(normalizeProjectPath(projectPath));
  }

  async listSessionNotes(session: Pick<AgentSession, "provider" | "id">): Promise<NoteRecord[]> {
    return listSessionNotes(this.dbPath, session.provider, session.id);
  }

  async listProjectNotes(projectPath: string): Promise<NoteRecord[]> {
    return listProjectNotes(this.dbPath, projectPath);
  }

  async getNote(noteId: string): Promise<NoteRecord | undefined> {
    return getNoteById(this.dbPath, noteId);
  }

  absolutePath(record: NoteRecord): string {
    return absFromRelMdPath(this.panelHome, record.relMdPath);
  }

  async createSessionNote(
    session: Pick<AgentSession, "provider" | "id" | "projectPath">,
    body = ""
  ): Promise<NoteRecord> {
    const owner: NoteOwner = {
      scope: "session",
      provider: session.provider,
      sessionId: session.id,
      projectPath: session.projectPath
    };
    return this.createNote(owner, body);
  }

  async createProjectNote(projectPath: string, body = ""): Promise<NoteRecord> {
    const owner: NoteOwner = {
      scope: "project",
      projectPath: normalizeProjectPath(projectPath)
    };
    return this.createNote(owner, body);
  }

  async createNote(owner: NoteOwner, body = ""): Promise<NoteRecord> {
    const ownerDir = await ensureOwnerDir(this.panelHome, owner);
    const existing = await listMarkdownFilenames(ownerDir);
    const filename = nextNoteFilename(existing);
    const noteId = newNoteId();
    const createdAtMs = Date.now();
    const { absPath } = await writeNewNoteFile({
      panelHome: this.panelHome,
      owner,
      filename,
      noteId,
      body,
      createdAtMs
    });
    const mtime = await fileMtimeMs(absPath);
    const record: NoteRecord = {
      noteId,
      scope: owner.scope,
      provider: owner.scope === "session" ? owner.provider : undefined,
      agentSessionId: owner.scope === "session" ? owner.sessionId : undefined,
      projectPath: owner.scope === "project" ? owner.projectPath : owner.projectPath,
      filename,
      relDir: ownerRelDir(owner),
      relMdPath: path.join("notes", ownerRelDir(owner), filename),
      title: extractTitle(body),
      contentPreview: contentPreview(body),
      createdAtMs,
      updatedAtMs: mtime,
      fsMtimeMs: mtime
    };
    await upsertNoteRecord(this.dbPath, record);
    await this.refreshFlagsFromCacheInsert(record);
    return record;
  }

  async deleteNote(noteId: string): Promise<void> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      return;
    }
    const ownerDir = path.join(this.panelHome, "notes", record.relDir);
    await deleteNoteFiles(ownerDir, record.filename);
    await deleteNoteRecord(this.dbPath, noteId);
    this.cachedNotes = this.cachedNotes.filter((n) => n.noteId !== noteId);
    await this.rebuildFlagsFromCache();
  }

  async renameNote(noteId: string, desiredName: string): Promise<NoteRecord> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    const newFilename = normalizeNoteFilename(desiredName);
    if (!newFilename) {
      throw new Error("Invalid note name.");
    }
    if (newFilename === record.filename) {
      return record;
    }

    const ownerDir = path.join(this.panelHome, "notes", record.relDir);
    const existing = await listMarkdownFilenames(ownerDir);
    if (existing.includes(newFilename)) {
      throw new Error(`A note named "${newFilename}" already exists.`);
    }

    const oldAbs = this.absolutePath(record);
    const { absPath } = await renameNoteFiles(ownerDir, record.filename, newFilename, (raw) =>
      rewriteAssetReferences(raw, record.filename, newFilename)
    );

    const raw = await fs.readFile(absPath, "utf8");
    const doc = parseNoteDocument(raw);
    const mtime = await fileMtimeMs(absPath);
    const updated: NoteRecord = {
      ...record,
      filename: newFilename,
      relMdPath: path.join("notes", record.relDir, newFilename),
      title: extractTitle(doc.body),
      contentPreview: contentPreview(doc.body),
      updatedAtMs: mtime,
      fsMtimeMs: mtime
    };
    await upsertNoteRecord(this.dbPath, updated);
    this.cachedNotes = this.cachedNotes.map((n) => (n.noteId === updated.noteId ? updated : n));

    await rebindNoteEditors(oldAbs, absPath);
    return updated;
  }

  async deleteSessionNotes(session: Pick<AgentSession, "provider" | "id">): Promise<number> {
    const notes = await listSessionNotes(this.dbPath, session.provider, session.id);
    for (const note of notes) {
      await this.deleteNote(note.noteId);
    }
    return notes.length;
  }

  async deleteProjectNotes(projectPath: string): Promise<number> {
    const notes = await listProjectNotes(this.dbPath, projectPath);
    for (const note of notes) {
      await this.deleteNote(note.noteId);
    }
    return notes.length;
  }

  async touchFromDisk(absPath: string): Promise<void> {
    await this.reload();
    void absPath;
  }

  async refreshNoteFromDisk(record: NoteRecord): Promise<void> {
    const abs = this.absolutePath(record);
    if (!(await pathExists(abs))) {
      await deleteNoteRecord(this.dbPath, record.noteId);
      this.cachedNotes = this.cachedNotes.filter((n) => n.noteId !== record.noteId);
      await this.rebuildFlagsFromCache();
      return;
    }
    const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
    const text = Buffer.from(raw).toString("utf8");
    const doc = parseNoteDocument(text);
    const mtime = await fileMtimeMs(abs);
    const updated: NoteRecord = {
      ...record,
      title: extractTitle(doc.body),
      contentPreview: contentPreview(doc.body),
      updatedAtMs: mtime,
      fsMtimeMs: mtime
    };
    await upsertNoteRecord(this.dbPath, updated);
    this.cachedNotes = this.cachedNotes.map((n) => (n.noteId === updated.noteId ? updated : n));
  }

  async ensureAssetsForNote(record: NoteRecord): Promise<string> {
    const ownerDir = path.join(this.panelHome, "notes", record.relDir);
    return ensureAssetsDir(ownerDir, record.filename);
  }

  private async refreshFlagsFromCacheInsert(record: NoteRecord): Promise<void> {
    this.cachedNotes = [record, ...this.cachedNotes.filter((n) => n.noteId !== record.noteId)];
    if (record.scope === "session" && record.provider && record.agentSessionId) {
      this.sessionFlags.add(
        sessionGtdKey({ provider: record.provider as AgentSession["provider"], id: record.agentSessionId })
      );
    }
    if (record.scope === "project" && record.projectPath) {
      this.projectFlags.add(normalizeProjectPath(record.projectPath));
    }
  }

  private async rebuildFlagsFromCache(): Promise<void> {
    this.sessionFlags = new Set();
    this.projectFlags = new Set();
    for (const note of this.cachedNotes) {
      if (note.scope === "session" && note.provider && note.agentSessionId) {
        this.sessionFlags.add(
          sessionGtdKey({
            provider: note.provider as AgentSession["provider"],
            id: note.agentSessionId
          })
        );
      }
      if (note.scope === "project" && note.projectPath) {
        this.projectFlags.add(normalizeProjectPath(note.projectPath));
      }
    }
  }
}

async function rebindNoteEditors(oldAbs: string, newAbs: string): Promise<void> {
  const openDocs = vscode.workspace.textDocuments.filter(
    (doc) => doc.uri.scheme === "file" && doc.uri.fsPath === oldAbs
  );
  if (!openDocs.length) {
    return;
  }

  for (const doc of openDocs) {
    if (doc.isDirty) {
      await doc.save();
    }
  }

  const newDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(newAbs));
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.fsPath === oldAbs) {
      await vscode.window.showTextDocument(newDoc, {
        viewColumn: editor.viewColumn,
        preview: false,
        preserveFocus: false
      });
    }
  }

  // Close leftover tabs for the old path when VS Code still shows them as deleted.
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { uri?: vscode.Uri } | undefined;
      if (input?.uri?.fsPath === oldAbs) {
        await vscode.window.tabGroups.close(tab);
      }
    }
  }
}
