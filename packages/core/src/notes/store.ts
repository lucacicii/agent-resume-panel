import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ensureExtensionCatalogSchema } from "../catalog/db";
import type { AgentProvider, AgentSession } from "../catalog/types";
import { sessionGtdKey } from "../gtd/store";
import {
  clearNoteGtdStatus as clearCatalogNoteGtdStatus,
  setNoteGtdStatus as setCatalogNoteGtdStatus
} from "./gtd";
import {
  archiveNotes as archiveCatalogNotes,
  unarchiveNotes as unarchiveCatalogNotes
} from "./archive";
import type { GtdStatus } from "../gtd/types";
import { resolvePanelHome } from "../panelHome";
import { normalizeProjectPath } from "../pathUtils";
import {
  deleteNoteRecord,
  getCatalogMeta,
  getNoteById,
  listAllNotes,
  listLibraryNotes,
  listProjectNotes,
  listSessionNotes,
  loadProjectNoteFlags,
  loadSessionNoteFlags,
  listTaskSessionDetails,
  listTaskSessionLinks,
  listTaskSessionProjects,
  listTasks,
  findTaskNoteIdForSession,
  setCatalogMeta,
  upsertNoteRecord,
  type NoteRecord,
  type TaskRecord,
  type TaskSessionDetail,
  type TaskSessionLink
} from "./catalogNotes";
import {
  buildNoteDocument,
  contentPreview,
  noteTitle,
  parseNoteDocument,
  type NoteFrontmatter,
  type NoteWorkFields
} from "./frontmatter";
import {
  isTaskFrontmatter,
  normalizeTaskDocument,
  newTaskBody,
  isUntitledTaskName,
  UNTITLED_TASK_NAME
} from "./taskNote";
import { syncNoteWorkFromFrontmatter, ensureTaskSessionIndex, isWorkNote } from "./work";
import {
  nextNoteFilename,
  normalizeNoteFilename,
  noteAssetsDirName,
  noteStem,
  parseNoteFilename,
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
import {
  clearParentLink,
  collectDescendantIds,
  deleteLinksForNote,
  getNoteSubtree,
  getParentLink,
  listAllNoteLinks,
  listChildCounts,
  listChildLinks,
  listLinkedChildNoteIds,
  resolveLinkRoot,
  setParentLink,
  type NoteLink,
  type NoteSubtree,
  type NoteTreeNode
} from "./links";
export interface ImportNotesResult {
  imported: number;
  skipped: number;
  errors: string[];
  records: NoteRecord[];
}

export type { NoteLink, NoteSubtree, NoteTreeNode };

export class NotesStore {
  private sessionFlags = new Set<string>();
  private projectFlags = new Set<string>();
  private cachedNotes: NoteRecord[] = [];
  private panelHome: string;

  constructor(
    private readonly dbPath: string,
    panelHome?: string,
    private readonly ensureSchema: (dbPath: string) => Promise<void> = ensureExtensionCatalogSchema
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
    await this.ensureSchema(this.dbPath);
    await fs.mkdir(notesRoot(this.panelHome), { recursive: true });
    await this.reload();
    // One-time mirror of existing task session links into the index table.
    await ensureTaskSessionIndex(this.dbPath);
    // One-time rewrite of existing tasks onto the title/heading convention.
    await this.migrateTaskNotes();
    // One-time recovery of names the old file-rename flow left only in the file name.
    await this.migrateTaskNames();
    // One-time cleanup of the legacy heading reminder suffix.
    await this.migrateTaskNotesDropSuffix();
    // One-time rename of task files onto the file-follows-name rule.
    await this.migrateTaskFilesToTitles();
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

  /**
   * One-time rewrite of existing tasks onto the title/heading convention:
   * the name moves into front-matter `title`, the heading gains the reminder
   * suffix, and the knowledge region is added without dropping any content.
   */
  private async migrateTaskNotes(): Promise<void> {
    const key = "work_item_notes_migrated_v1";
    if ((await getCatalogMeta(this.dbPath, key)) === "1") {
      return;
    }
    const items = await listTasks(this.dbPath);
    for (const item of items) {
      try {
        const absPath = absFromRelMdPath(this.panelHome, item.relMdPath);
        const raw = await fs.readFile(absPath, "utf8");
        const doc = parseNoteDocument(raw);
        if (!isTaskFrontmatter(doc.frontmatter)) {
          continue;
        }
        const normalized = normalizeTaskDocument(
          doc.frontmatter,
          doc.body
        );
        const next = buildNoteDocument(normalized.frontmatter, normalized.body);
        if (next !== raw) {
          await fs.writeFile(absPath, next, "utf8");
        }
        await this.refreshNoteFromDisk(item);
      } catch {
        // A single unreadable file must not block startup; reconcile catches up later.
      }
    }
    await setCatalogMeta(this.dbPath, key, "1");
  }

  /**
   * Notes that predate the name field were "renamed" by renaming their file. Recover
   * those names once, but never invent one from an allocated date-sequence file name.
   */
  private async migrateTaskNames(): Promise<void> {
    const key = "work_item_notes_names_migrated_v1";
    if ((await getCatalogMeta(this.dbPath, key)) === "1") {
      return;
    }
    const items = await listTasks(this.dbPath);
    for (const item of items) {
      try {
        if (!isUntitledTaskName(item.title)) {
          continue;
        }
        if (parseNoteFilename(item.filename)) {
          continue;
        }
        await this.renameNote(item.noteId, noteStem(item.filename));
      } catch {
        // A single unreadable file must not block startup.
      }
    }
    await setCatalogMeta(this.dbPath, key, "1");
  }

  /**
   * One-time cleanup of the legacy heading reminder suffix: headings become the
   * plain name and the `titleSuffix` front-matter field is dropped.
   */
  private async migrateTaskNotesDropSuffix(): Promise<void> {
    const key = "work_item_notes_suffix_dropped_v1";
    if ((await getCatalogMeta(this.dbPath, key)) === "1") {
      return;
    }
    for (const item of await listTasks(this.dbPath)) {
      try {
        const absPath = absFromRelMdPath(this.panelHome, item.relMdPath);
        const raw = await fs.readFile(absPath, "utf8");
        const doc = parseNoteDocument(raw);
        if (!isTaskFrontmatter(doc.frontmatter)) {
          continue;
        }
        const normalized = normalizeTaskDocument(doc.frontmatter, doc.body);
        const next = buildNoteDocument(normalized.frontmatter, normalized.body);
        if (next !== raw) {
          await fs.writeFile(absPath, next, "utf8");
        }
        await this.refreshNoteFromDisk(item);
      } catch {
        // A single unreadable file must not block startup; reconcile catches up later.
      }
    }
    await setCatalogMeta(this.dbPath, key, "1");
  }

  /**
   * One-time rename of task files allocated before the file-follows-name
   * rule (e.g. a file still called 未命名任务.md under a real name). The
   * address table surfaces the file path to agents, so it must carry the name.
   */
  private async migrateTaskFilesToTitles(): Promise<void> {
    const key = "work_item_files_follow_title_v1";
    if ((await getCatalogMeta(this.dbPath, key)) === "1") {
      return;
    }
    for (const item of await listTasks(this.dbPath)) {
      try {
        await this.renameTaskFileToTitle(item, item.title);
      } catch {
        // A single unreadable file must not block startup; reconcile catches up later.
      }
    }
    await setCatalogMeta(this.dbPath, key, "1");
  }

  /** Project notes marked `work: true`, with their work fields and GTD status. */
  async listTasks(): Promise<TaskRecord[]> {
    return listTasks(this.dbPath);
  }

  /** Indexed task ↔ session links (session → task reverse lookup). */
  async listTaskSessionLinks(): Promise<TaskSessionLink[]> {
    return listTaskSessionLinks(this.dbPath);
  }

  /** The task a session belongs to, when it is linked to one. */
  async findTaskNoteIdForSession(provider: string, sessionId: string): Promise<string | undefined> {
    return findTaskNoteIdForSession(this.dbPath, provider, sessionId);
  }

  /** `note_id` → project paths derived from the task's linked sessions. */
  async listTaskSessionProjects(): Promise<Record<string, string[]>> {
    return listTaskSessionProjects(this.dbPath);
  }

  /** Linked sessions of one task, with each session's project path. */
  async listTaskSessionDetails(noteId: string): Promise<TaskSessionDetail[]> {
    return listTaskSessionDetails(this.dbPath, noteId);
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

  async listLibraryNotes(): Promise<NoteRecord[]> {
    return listLibraryNotes(this.dbPath);
  }

  async getNote(noteId: string): Promise<NoteRecord | undefined> {
    return getNoteById(this.dbPath, noteId);
  }

  async setNoteGtdStatus(noteId: string, status: GtdStatus): Promise<NoteRecord> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    await setCatalogNoteGtdStatus(this.dbPath, noteId, status);
    const updated = await getNoteById(this.dbPath, noteId);
    if (!updated) {
      throw new Error("Note not found after setting GTD status.");
    }
    this.cachedNotes = this.cachedNotes.map((note) => note.noteId === noteId ? updated : note);
    return updated;
  }

  async clearNoteGtdStatus(noteId: string): Promise<NoteRecord> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    await clearCatalogNoteGtdStatus(this.dbPath, noteId);
    const updated = await getNoteById(this.dbPath, noteId);
    if (!updated) {
      throw new Error("Note not found after clearing GTD status.");
    }
    this.cachedNotes = this.cachedNotes.map((note) => note.noteId === noteId ? updated : note);
    return updated;
  }

  /** Mark notes archived. Re-archiving just refreshes the archive timestamp. */
  async archiveTasks(noteIds: readonly string[]): Promise<void> {
    await archiveCatalogNotes(this.dbPath, noteIds);
    await this.refreshCachedNotes(noteIds);
  }

  /** Restore notes from the archive. Ids that are not archived are ignored. */
  async unarchiveTasks(noteIds: readonly string[]): Promise<void> {
    await unarchiveCatalogNotes(this.dbPath, noteIds);
    await this.refreshCachedNotes(noteIds);
  }

  /** Re-read the given notes so `cachedNotes` matches the archive table. */
  private async refreshCachedNotes(noteIds: readonly string[]): Promise<void> {
    const updates = await Promise.all(noteIds.map((noteId) => getNoteById(this.dbPath, noteId)));
    const byId = new Map(
      updates.filter((note): note is NoteRecord => Boolean(note)).map((note) => [note.noteId, note])
    );
    if (byId.size === 0) return;
    this.cachedNotes = this.cachedNotes.map((note) => byId.get(note.noteId) ?? note);
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

  async writeNoteContent(noteId: string, content: string): Promise<NoteRecord & { content?: string }> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) throw new Error("Note not found.");
    const next = this.normalizeTaskContent(content);
    const synced = await this.syncTaskFileToContent(record, next);
    await fs.writeFile(this.absolutePath(synced.record), synced.content, "utf8");
    await this.refreshNoteFromDisk(synced.record);
    const updated = await getNoteById(this.dbPath, noteId);
    if (!updated) throw new Error("Note not found after write.");
    return { ...updated, content: synced.content };
  }

  /**
   * Tasks keep their name in front-matter and put `<name><suffix>` in the
   * heading, so the reminder survives agent writes. Editing the heading renames
   * the task; a body that lost its heading gets one back.
   */
  private normalizeTaskContent(content: string): string {
    const doc = parseNoteDocument(content);
    if (!isTaskFrontmatter(doc.frontmatter)) {
      return content;
    }
    const normalized = normalizeTaskDocument(
      doc.frontmatter,
      doc.body
    );
    return buildNoteDocument(normalized.frontmatter, normalized.body);
  }

  /**
   * Rename a task's file to follow its front-matter name. Collisions with
   * another note's file get a numeric suffix, so renaming never fails. The DB
   * record is kept in step; content writes are left to the caller.
   */
  private async renameTaskFileToTitle(record: NoteRecord, title: string | undefined): Promise<NoteRecord> {
    const desired = normalizeNoteFilename(title?.trim() || "");
    if (!desired || desired === record.filename) {
      return record;
    }
    const ownerDir = path.join(this.panelHome, "notes", record.relDir);
    const existing = await listMarkdownFilenames(ownerDir);
    const newFilename = uniqueNoteFilename(desired, existing);
    if (newFilename === record.filename) {
      return record;
    }
    await renameNoteFiles(ownerDir, record.filename, newFilename, (content) =>
      rewriteAssetReferences(content, record.filename, newFilename)
    );
    const updated: NoteRecord = {
      ...record,
      filename: newFilename,
      relMdPath: path.join("notes", record.relDir, newFilename)
    };
    await upsertNoteRecord(this.dbPath, updated);
    this.cachedNotes = this.cachedNotes.map((note) => (note.noteId === updated.noteId ? updated : note));
    return updated;
  }

  /**
   * Keep a task's file in step with the name in the content about to be
   * written, and adjust the content's asset references when the file moved.
   */
  private async syncTaskFileToContent(
    record: NoteRecord,
    content: string
  ): Promise<{ record: NoteRecord; content: string }> {
    const doc = parseNoteDocument(content);
    if (!isTaskFrontmatter(doc.frontmatter)) {
      return { record, content };
    }
    const renamed = await this.renameTaskFileToTitle(record, doc.frontmatter.title);
    if (renamed.filename === record.filename) {
      return { record: renamed, content };
    }
    return { record: renamed, content: rewriteAssetReferences(content, record.filename, renamed.filename) };
  }

  /** Write already-validated note content with an atomic rename and no materialization. */
  async writeValidatedNoteContent(noteId: string, content: string): Promise<NoteRecord> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) throw new Error("Note not found.");
    const next = this.normalizeTaskContent(content);
    const synced = await this.syncTaskFileToContent(record, next);
    const target = this.absolutePath(synced.record);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporary, synced.content, "utf8");
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    await this.refreshNoteFromDisk(synced.record);
    const updated = await getNoteById(this.dbPath, noteId);
    if (!updated) throw new Error("Note disappeared after write.");
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

  /**
   * Create a task. Tasks are library-scoped: they reference projects
   * instead of belonging to one, so a single task can span repositories.
   */
  async createTask(
    input: {
      title?: string;
      next?: string;
      decision?: string;
      sessions?: string[];
      projects?: string[];
      primaryProject?: string;
    } = {}
  ): Promise<NoteRecord> {
    const owner: NoteOwner = { scope: "library" };
    const ownerDir = await ensureOwnerDir(this.panelHome, owner);
    const existing = await listMarkdownFilenames(ownerDir);
    const name = input.title?.trim() || UNTITLED_TASK_NAME;
    // The file carries the task's name from the start — the address table
    // surfaces the path to agents, so a placeholder allocation would leak.
    const filename = uniqueNoteFilename(name, existing);
    const noteId = newNoteId();
    const createdAtMs = Date.now();
    const fm: NoteFrontmatter = {
      id: noteId,
      scope: "library",
      createdAt: new Date(createdAtMs).toISOString(),
      work: true
    };
    fm.title = name;
    const work: NoteWorkFields = {};
    if (input.next) { fm.next = input.next; work.next = input.next; }
    if (input.decision) { fm.decision = input.decision; work.decision = input.decision; }
    const sessions = (input.sessions ?? []).map((entry) => entry.trim()).filter(Boolean);
    if (sessions.length > 0) { fm.sessions = sessions; work.sessions = sessions; }
    const projects = (input.projects ?? []).map((entry) => normalizeProjectPath(entry.trim())).filter(Boolean);
    if (projects.length > 0) { fm.projects = projects; work.projects = projects; }
    const primary = input.primaryProject ? normalizeProjectPath(input.primaryProject.trim()) : projects[0];
    if (primary) { fm.primaryProject = primary; work.primaryProject = primary; }
    const body = newTaskBody(name);
    const relDir = ownerRelDir(owner);
    const absPath = path.join(ownerDir, filename);
    await fs.writeFile(absPath, buildNoteDocument(fm, body), "utf8");
    const mtime = await fileMtimeMs(absPath);
    const record: NoteRecord = {
      noteId,
      scope: "library",
      filename,
      relDir,
      relMdPath: path.join("notes", relDir, filename),
      title: noteTitle(fm, body),
      contentPreview: contentPreview(body),
      createdAtMs,
      updatedAtMs: mtime,
      fsMtimeMs: mtime,
      work
    };
    await upsertNoteRecord(this.dbPath, record);
    await syncNoteWorkFromFrontmatter(this.dbPath, noteId, fm);
    await this.refreshFlagsFromCacheInsert(record);
    return record;
  }

  async createLibraryNote(body = ""): Promise<NoteRecord> {
    return this.createNote({ scope: "library" }, body);
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
      projectPath:
        owner.scope === "project"
          ? owner.projectPath
          : owner.scope === "session"
            ? owner.projectPath
            : undefined,
      filename,
      relDir: ownerRelDir(owner),
      relMdPath: path.join("notes", ownerRelDir(owner), filename),
      title: noteTitle(undefined, body),
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
        const fm: NoteFrontmatter = {
          id: noteId,
          scope: owner.scope,
          createdAt: new Date(createdAtMs).toISOString()
        };
        if (owner.scope === "project") {
          fm.projectPath = owner.projectPath;
        } else if (owner.scope === "session") {
          fm.provider = owner.provider;
          fm.sessionId = owner.sessionId;
          if (owner.projectPath) {
            fm.projectPath = owner.projectPath;
          }
        }
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
          projectPath:
            owner.scope === "project"
              ? owner.projectPath
              : owner.scope === "session"
                ? owner.projectPath
                : undefined,
          filename,
          relDir: ownerRelDir(owner),
          relMdPath: path.join("notes", ownerRelDir(owner), filename),
          title: noteTitle(fm, body),
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
    await deleteLinksForNote(this.dbPath, noteId);
    await deleteNoteRecord(this.dbPath, noteId);
    this.cachedNotes = this.cachedNotes.filter((n) => n.noteId !== noteId);
    await this.rebuildFlagsFromCache();
  }

  // --- Note links (tree associations among project notes) ---

  async listNoteLinks(): Promise<NoteLink[]> {
    return listAllNoteLinks(this.dbPath);
  }

  async getNoteParent(noteId: string): Promise<NoteLink | undefined> {
    return getParentLink(this.dbPath, noteId);
  }

  async listNoteChildren(parentNoteId: string): Promise<NoteLink[]> {
    return listChildLinks(this.dbPath, parentNoteId);
  }

  async listLinkedChildIds(): Promise<Set<string>> {
    return listLinkedChildNoteIds(this.dbPath);
  }

  async listNoteChildCounts(): Promise<Map<string, number>> {
    return listChildCounts(this.dbPath);
  }

  /**
   * Root notes for list UI: library/session always roots; linked notes are not.
   */
  async listRootNotes(): Promise<NoteRecord[]> {
    const childIds = await listLinkedChildNoteIds(this.dbPath);
    return this.cachedNotes.filter((note) => !childIds.has(note.noteId));
  }

  async setNoteParent(childNoteId: string, parentNoteId: string | null): Promise<void> {
    await setParentLink(this.dbPath, childNoteId, parentNoteId);
  }

  async clearNoteParent(childNoteId: string): Promise<void> {
    await clearParentLink(this.dbPath, childNoteId);
  }

  async createLinkedChildNote(parentNoteId: string, body = ""): Promise<NoteRecord> {
    const parent = await getNoteById(this.dbPath, parentNoteId);
    if (!parent) {
      throw new Error("Parent note not found.");
    }
    // Tasks live in the library bucket, so that is where their children go:
    // the notes vector index only covers notes, not the task workspace.
    const parentIsTask = await isWorkNote(this.dbPath, parentNoteId);
    if (!parentIsTask && (parent.scope !== "project" || !parent.projectPath)) {
      throw new Error(
        "Linked children can only be created under a project note or a task."
      );
    }
    const child = parentIsTask
      ? await this.createLibraryNote(body)
      : await this.createProjectNote(parent.projectPath as string, body);
    try {
      await setParentLink(this.dbPath, child.noteId, parentNoteId);
    } catch (error) {
      await this.deleteNote(child.noteId);
      throw error;
    }
    return child;
  }

  async getNoteSubtree(rootNoteId: string): Promise<NoteSubtree> {
    return getNoteSubtree(this.dbPath, rootNoteId);
  }

  async resolveNoteLinkRoot(noteId: string): Promise<string> {
    return resolveLinkRoot(this.dbPath, noteId);
  }

  async collectNoteDescendantIds(rootNoteId: string): Promise<Set<string>> {
    return collectDescendantIds(this.dbPath, rootNoteId);
  }

  async moveNote(noteId: string, newOwner: NoteOwner): Promise<NoteRecord> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    if (record.filename === "todolist.md") {
      throw new Error("Cannot move session to-do list.");
    }

    const currentOwner = recordToOwner(record);
    if (ownersEqual(currentOwner, newOwner)) {
      return record;
    }

    const oldOwnerDir = path.join(this.panelHome, "notes", record.relDir);
    const newOwnerDir = await ensureOwnerDir(this.panelHome, newOwner);
    const existing = await listMarkdownFilenames(newOwnerDir);
    let newFilename = record.filename;
    if (existing.includes(newFilename)) {
      newFilename = uniqueNoteFilename(newFilename, existing);
    }

    const oldMd = path.join(oldOwnerDir, record.filename);
    const newMd = path.join(newOwnerDir, newFilename);
    const raw = await fs.readFile(oldMd, "utf8");
    const doc = parseNoteDocument(raw);
    let body = doc.body;
    if (newFilename !== record.filename) {
      body = parseNoteDocument(rewriteAssetReferences(raw, record.filename, newFilename)).body;
    }

    const fm = frontmatterForOwner(doc.frontmatter, newOwner, record.noteId);
    if (fm.work) {
      // Keep the title/heading convention intact across a move.
      const normalized = normalizeTaskDocument(fm, body);
      Object.assign(fm, normalized.frontmatter);
      body = normalized.body;
    }
    await fs.writeFile(newMd, buildNoteDocument(fm, body), "utf8");

    const oldAssets = path.join(oldOwnerDir, noteAssetsDirName(record.filename));
    const newAssets = path.join(newOwnerDir, noteAssetsDirName(newFilename));
    if (await pathExists(oldAssets)) {
      if (await pathExists(newAssets)) {
        throw new Error(`Assets folder already exists: ${noteAssetsDirName(newFilename)}`);
      }
      try {
        await fs.rename(oldAssets, newAssets);
      } catch {
        await copyDirectoryRecursive(oldAssets, newAssets);
        await fs.rm(oldAssets, { recursive: true, force: true });
      }
    }

    await fs.rm(oldMd, { force: true });

    const mtime = await fileMtimeMs(newMd);
    const updated: NoteRecord = {
      noteId: record.noteId,
      scope: newOwner.scope,
      provider: newOwner.scope === "session" ? newOwner.provider : undefined,
      agentSessionId: newOwner.scope === "session" ? newOwner.sessionId : undefined,
      projectPath:
        newOwner.scope === "project"
          ? newOwner.projectPath
          : newOwner.scope === "session"
            ? newOwner.projectPath
            : undefined,
      filename: newFilename,
      relDir: ownerRelDir(newOwner),
      relMdPath: path.join("notes", ownerRelDir(newOwner), newFilename),
      title: noteTitle(fm, body),
      contentPreview: contentPreview(body),
      gtdStatus: record.gtdStatus,
      createdAtMs: record.createdAtMs,
      updatedAtMs: mtime,
      fsMtimeMs: mtime
    };
    await upsertNoteRecord(this.dbPath, updated);
    await syncNoteWorkFromFrontmatter(this.dbPath, updated.noteId, fm);
    this.cachedNotes = this.cachedNotes.map((n) => (n.noteId === updated.noteId ? updated : n));
    await this.rebuildFlagsFromCache();
    return updated;
  }

  async renameNote(noteId: string, desiredName: string): Promise<NoteRecord> {
    const record = await getNoteById(this.dbPath, noteId);
    if (!record) {
      throw new Error("Note not found.");
    }
    const absPath = this.absolutePath(record);
    const raw = await fs.readFile(absPath, "utf8");
    const doc = parseNoteDocument(raw);
    if (isTaskFrontmatter(doc.frontmatter)) {
      // A task is identified by its front-matter name, and its file follows
      // that name (collision-suffixed), so paths surfaced to agents always carry
      // the real name.
      const normalized = normalizeTaskDocument(
        doc.frontmatter,
        doc.body,
        { name: noteStem(normalizeNoteFilename(desiredName) || desiredName) }
      );
      const next = buildNoteDocument(normalized.frontmatter, normalized.body);
      const synced = await this.syncTaskFileToContent(record, next);
      const targetPath = this.absolutePath(synced.record);
      await fs.writeFile(targetPath, synced.content, "utf8");
      const mtime = await fileMtimeMs(targetPath);
      const updated: NoteRecord = {
        ...synced.record,
        title: normalized.frontmatter.title,
        updatedAtMs: mtime,
        fsMtimeMs: mtime
      };
      await upsertNoteRecord(this.dbPath, updated);
      this.cachedNotes = this.cachedNotes.map((n) => (n.noteId === updated.noteId ? updated : n));
      return updated;
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

    const { absPath: renamedPath } = await renameNoteFiles(ownerDir, record.filename, newFilename, (content) =>
      rewriteAssetReferences(content, record.filename, newFilename)
    );

    const renamedRaw = await fs.readFile(renamedPath, "utf8");
    const renamedDoc = parseNoteDocument(renamedRaw);
    const mtime = await fileMtimeMs(renamedPath);
    const updated: NoteRecord = {
      ...record,
      filename: newFilename,
      relMdPath: path.join("notes", record.relDir, newFilename),
      title: noteTitle(renamedDoc.frontmatter, renamedDoc.body),
      contentPreview: contentPreview(renamedDoc.body),
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
      title: noteTitle(doc.frontmatter, doc.body),
      contentPreview: contentPreview(doc.body),
      updatedAtMs: mtime,
      fsMtimeMs: mtime
    };
    await upsertNoteRecord(this.dbPath, updated);
    await syncNoteWorkFromFrontmatter(this.dbPath, record.noteId, doc.frontmatter);
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

function recordToOwner(record: NoteRecord): NoteOwner {
  if (record.scope === "library") {
    return { scope: "library" };
  }
  if (record.scope === "project" && record.projectPath) {
    return { scope: "project", projectPath: record.projectPath };
  }
  if (record.scope === "session" && record.provider && record.agentSessionId) {
    return {
      scope: "session",
      provider: record.provider as AgentProvider,
      sessionId: record.agentSessionId,
      projectPath: record.projectPath
    };
  }
  throw new Error("Invalid note record owner.");
}

function ownersEqual(a: NoteOwner, b: NoteOwner): boolean {
  if (a.scope !== b.scope) {
    return false;
  }
  if (a.scope === "library") {
    return true;
  }
  if (a.scope === "project" && b.scope === "project") {
    return normalizeProjectPath(a.projectPath) === normalizeProjectPath(b.projectPath);
  }
  if (a.scope === "session" && b.scope === "session") {
    return a.provider === b.provider && a.sessionId === b.sessionId;
  }
  return false;
}

function frontmatterForOwner(
  source: NoteFrontmatter,
  owner: NoteOwner,
  fallbackId: string
): NoteFrontmatter {
  const fm: NoteFrontmatter = {
    id: source.id || fallbackId,
    scope: owner.scope,
    createdAt: source.createdAt
  };
  if (owner.scope === "project") {
    fm.projectPath = owner.projectPath;
  } else if (owner.scope === "session") {
    fm.provider = owner.provider;
    fm.sessionId = owner.sessionId;
    if (owner.projectPath) {
      fm.projectPath = owner.projectPath;
    }
  }
  // Task fields survive moves; they are not derivable from the owner.
  if (source.work) {
    fm.work = true;
  }
  if (source.title) {
    fm.title = source.title;
  }
  if (source.next) {
    fm.next = source.next;
  }
  if (source.decision) {
    fm.decision = source.decision;
  }
  if (source.sessions && source.sessions.length > 0) {
    fm.sessions = source.sessions;
  }
  if (source.projects && source.projects.length > 0) {
    fm.projects = source.projects;
  }
  if (source.primaryProject) {
    fm.primaryProject = source.primaryProject;
  }
  return fm;
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
