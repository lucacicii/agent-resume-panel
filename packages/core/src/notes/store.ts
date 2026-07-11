import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ensureCatalogSchema } from "../catalog/db";
import type { AgentProvider, AgentSession } from "../catalog/types";
import { sessionGtdKey } from "../gtd/store";
import { resolvePanelHome } from "../panelHome";
import { normalizeProjectPath } from "../pathUtils";
import {
  deleteNoteRecord,
  getNoteById,
  listAllNotes,
  listProjectNotes,
  listSessionNotes,
  loadProjectNoteFlags,
  loadSessionNoteFlags,
  upsertNoteRecord,
  type NoteRecord
} from "./catalogNotes";
import {
  buildNoteDocument,
  contentPreview,
  extractTitle,
  parseNoteDocument
} from "./frontmatter";
import {
  nextNoteFilename,
  normalizeNoteFilename,
  noteAssetsDirName,
  noteStem,
  rewriteAssetReferences,
  uniqueNoteFilename
} from "./naming";
import {
  absFromRelMdPath,
  type NoteOwner,
  notesRoot,
  ownerRelDir
} from "./paths";
import {
  deleteNoteFiles,
  ensureAssetsDir,
  ensureOwnerDir,
  fileMtimeMs,
  listMarkdownFilenames,
  newNoteId,
  pathExists,
  readNoteFile,
  renameNoteFiles,
  writeNewNoteFile
} from "./fs";
import { reconcileNotesIndex } from "./reconcile";

export interface ImportNotesResult {
  imported: number;
  skipped: number;
  errors: string[];
  records: NoteRecord[];
}

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
    return this.sessionFlags.has(sessionGtdKey(session.provider, session.id));
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

  async readNoteContent(noteId: string): Promise<string> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    return readNoteFile(this.absolutePath(record));
  }

  async writeNoteContent(noteId: string, content: string): Promise<NoteRecord> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    await fs.writeFile(this.absolutePath(record), content, "utf8");
    await this.refreshNoteFromDisk(record);
    const updated = await getNoteById(this.dbPath, noteId);
    if (!updated) {
      throw new Error("Note not found after write.");
    }
    return updated;
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

  async importMarkdownFiles(owner: NoteOwner, sourcePaths: string[]): Promise<ImportNotesResult> {
    const ownerDir = await ensureOwnerDir(this.panelHome, owner);
    const existing = await listMarkdownFilenames(ownerDir);
    const result: ImportNotesResult = { imported: 0, skipped: 0, errors: [], records: [] };

    for (const sourcePath of sourcePaths) {
      try {
        if (!sourcePath.toLowerCase().endsWith(".md")) {
          result.skipped += 1;
          continue;
        }
        const sourceBase = path.basename(sourcePath);
        const filename = uniqueNoteFilename(sourceBase, existing);
        const raw = await fs.readFile(sourcePath, "utf8");
        const doc = parseNoteDocument(raw);
        const noteId = newNoteId();
        const createdAtMs = Date.now();
        const fm = {
          id: noteId,
          scope: owner.scope,
          createdAt: new Date(createdAtMs).toISOString(),
          projectPath: owner.scope === "project" ? owner.projectPath : owner.projectPath,
          provider: owner.scope === "session" ? owner.provider : undefined,
          sessionId: owner.scope === "session" ? owner.sessionId : undefined
        };
        let body = doc.body;
        body = rewriteAssetReferences(body, sourceBase.endsWith(".md") ? sourceBase : `${sourceBase}.md`, filename);
        const sourceStemAssets = `${noteStem(sourceBase)}.assets`;
        const destAssetsName = noteAssetsDirName(filename);
        if (sourceStemAssets !== destAssetsName) {
          body = body.split(sourceStemAssets).join(destAssetsName);
        }

        const content = buildNoteDocument(fm, body);
        const absPath = path.join(ownerDir, filename);
        await fs.writeFile(absPath, content, "utf8");

        const sourceAssets = path.join(path.dirname(sourcePath), noteAssetsDirName(sourceBase));
        const destAssets = path.join(ownerDir, destAssetsName);
        if (await pathExists(sourceAssets)) {
          await copyDirectoryRecursive(sourceAssets, destAssets);
        }

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
        existing.push(filename);
        result.records.push(record);
        result.imported += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(`${path.basename(sourcePath)}: ${message}`);
        result.skipped += 1;
      }
    }

    return result;
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
    const text = await fs.readFile(abs, "utf8");
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
      this.sessionFlags.add(sessionGtdKey(record.provider, record.agentSessionId));
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
        this.sessionFlags.add(sessionGtdKey(note.provider, note.agentSessionId));
      }
      if (note.scope === "project" && note.projectPath) {
        this.projectFlags.add(normalizeProjectPath(note.projectPath));
      }
    }
  }
}

async function copyDirectoryRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}