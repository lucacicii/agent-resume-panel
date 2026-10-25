import { clipboard, dialog, nativeImage, shell } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  absFromRelMdPath,
  buildNoteDocument,
  effectivePanelHome,
  expandHome,
  extractTitle,
  knowledgeText,
  loadSettings,
  mergeTaskProjects,
  noteAssetsDirName,
  NotesStore,
  notesRoot,
  normalizeTaskDocument,
  parseNoteDocument,
  splitSessionKey,
  type AgentProvider,
  type GtdStatus,
  type ImportNotesResult,
  type NoteLink,
  type NoteOwner,
  type NoteRecord,
  type NoteSubtree,
  type TaskRecord,
  type TaskSessionLink
} from "@agent-resume/core";
import { desktopT } from "./i18nService";
import { loadPanelDbPaths } from "./panelDatabases";

let notesStore: NotesStore | null = null;
let notesStoreKey = "";
let lastReconcileMs = 0;
const RECONCILE_THROTTLE_MS = 5_000;

type DesktopNoteRecord = NoteRecord;

async function getDesktopNotesStore(): Promise<NotesStore> {
  const settings = await loadSettings();
  const panelHome = effectivePanelHome(settings);
  const paths = await loadPanelDbPaths(settings);
  const dbPath = paths.catalogDb;
  const key = `${dbPath}::${panelHome}`;
  if (!notesStore || notesStoreKey !== key) {
    notesStore = new NotesStore(dbPath, panelHome);
    await notesStore.initialize();
    notesStoreKey = key;
    lastReconcileMs = Date.now();
  }
  return notesStore;
}

async function maybeReloadNotesStore(store: NotesStore, force = false): Promise<void> {
  const now = Date.now();
  if (force || now - lastReconcileMs > RECONCILE_THROTTLE_MS) {
    await store.reload();
    lastReconcileMs = now;
  }
}

export async function notesList(): Promise<DesktopNoteRecord[]> {
  const store = await getDesktopNotesStore();
  await maybeReloadNotesStore(store);
  return store.getAllNotes();
}

/** Project notes marked `work: true` — the board's unit of management. */
export async function notesListTasks(options?: { includeArchived?: boolean }): Promise<TaskRecord[]> {
  const settings = await loadSettings();
  const panelHome = effectivePanelHome(settings);
  const store = await getDesktopNotesStore();
  await maybeReloadNotesStore(store);
  let items = await store.listTasks();
  if (options?.includeArchived === false) {
    items = items.filter((item) => item.archivedAtMs == null);
  }
  if (!items.length) return items;

  // `projects` is referenced, not owned: the union of declared projects and the
  // projects of linked sessions, derived in SQL from the session index table.
  // Sessions that ran in the neutral workspace are filtered out; that directory
  // is the panel's own, not a repository the task references.
  const sessionProjects = await store.listTaskSessionProjects();
  return items.map((item) => {
    const list = mergeTaskProjects(panelHome, item.work.projects ?? [], sessionProjects[item.noteId] ?? []);
    return {
      ...item,
      work: { ...item.work, projects: list, primaryProject: item.work.primaryProject ?? list[0] }
    };
  });
}

/** Indexed task ↔ session links, for the session → task reverse lookup. */
export async function notesListTaskSessionLinks(): Promise<TaskSessionLink[]> {
  const store = await getDesktopNotesStore();
  await maybeReloadNotesStore(store);
  return store.listTaskSessionLinks();
}

/**
 * A GTD task's execution context for AI chat / external agents: title, status,
 * background markdown, referenced repositories and the note path. The primary
 * repository (first one present on this machine) is what a chat uses as its
 * working root; a task without one runs from home.
 */
export async function notesGetTaskWorkspaceContext(noteId: string): Promise<{
  title: string;
  status: string;
  backgroundMd: string;
  projects: string[];
  primaryDir?: string;
  noteAbsPath: string;
}> {
  const settings = await loadSettings();
  const panelHome = effectivePanelHome(settings);
  const store = await getDesktopNotesStore();
  const { record, content } = await notesRead(noteId);
  const doc = parseNoteDocument(content);

  const declared = (doc.frontmatter.projects ?? []).map((entry) => entry.trim()).filter(Boolean);
  const fromSessions = await store.listTaskSessionProjects();
  const projects = mergeTaskProjects(panelHome, declared, fromSessions[noteId] ?? []);

  const existing = await Promise.all(
    projects.map(async (projectPath) => [projectPath, await fs.stat(projectPath).then(() => true).catch(() => false)] as const)
  );

  return {
    title: record.title || extractTitle(doc.body) || record.filename || noteId,
    status: record.gtdStatus ?? "inbox",
    backgroundMd: knowledgeText(doc.body) || doc.body.trim(),
    projects,
    ...(existing.find(([, ok]) => ok) ? { primaryDir: existing.find(([, ok]) => ok)![0] } : {}),
    noteAbsPath: absFromRelMdPath(panelHome, record.relMdPath)
  };
}

/** The task a session belongs to, when it is linked to one. */
export async function notesTaskNoteIdForSession(args: {
  provider: string;
  sessionId: string;
}): Promise<string | undefined> {
  const store = await getDesktopNotesStore();
  return store.findTaskNoteIdForSession(args.provider, args.sessionId);
}

export async function notesCreateTask(args: {
  title?: string;
  next?: string;
  decision?: string;
  sessions?: string[];
  projects?: string[];
  primaryProject?: string;
  status?: GtdStatus;
}): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  const record = await store.createTask(args);
  await store.setNoteGtdStatus(record.noteId, args.status ?? "inbox");
  return record;
}

/**
 * Rename a task. The name is the note's front-matter `title` (and heading),
 * so it is rewritten as a document rather than a filename change.
 */
export async function notesRenameTask(noteId: string, title: string): Promise<NoteRecord> {
  const name = title.trim();
  if (!name) throw new Error("A task name is required.");
  const store = await getDesktopNotesStore();
  const content = await store.readNoteContent(noteId);
  const doc = parseNoteDocument(content);
  if (!doc.frontmatter.work) {
    throw new Error("Note is not a task.");
  }
  const normalized = normalizeTaskDocument(doc.frontmatter, doc.body, { name });
  const updated = await store.writeNoteContent(noteId, buildNoteDocument(normalized.frontmatter, normalized.body));
  return updated;
}

/**
 * Append a session to a task (and reference its project). This is how a
 * session started inside a task workspace becomes part of that task,
 * which is what lets one task span several repositories.
 */
export async function notesLinkSessionToTask(args: {
  noteId: string;
  sessionKey: string;
  projectPath?: string;
}): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  const content = await store.readNoteContent(args.noteId);
  const doc = parseNoteDocument(content);
  if (!doc.frontmatter.work) {
    throw new Error("Note is not a task.");
  }
  // A session belongs to at most one task. Strip the key from the previous
  // owner's front-matter first so the markdown source of truth matches the
  // work_item_sessions index that replaceTaskSessions maintains.
  const parts = splitSessionKey(args.sessionKey.trim());
  if (parts) {
    const previousOwner = await store.findTaskNoteIdForSession(parts.provider, parts.sessionId);
    if (previousOwner && previousOwner !== args.noteId) {
      const previousDoc = parseNoteDocument(await store.readNoteContent(previousOwner));
      const remaining = (previousDoc.frontmatter.sessions ?? []).filter((key) => key !== args.sessionKey);
      await store.writeNoteContent(
        previousOwner,
        buildNoteDocument({ ...previousDoc.frontmatter, sessions: remaining }, previousDoc.body)
      );
    }
  }
  const sessions = new Set(doc.frontmatter.sessions ?? []);
  sessions.add(args.sessionKey);
  const frontmatter = { ...doc.frontmatter, sessions: [...sessions] };
  // A session running in the panel's own data directories does not make that
  // directory a repository of the task; only the session link is recorded.
  const panelHome = effectivePanelHome(await loadSettings());
  const insidePanelData = (candidate: string): boolean => {
    const rel = path.relative(path.resolve(panelHome), path.resolve(candidate));
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  const referenceable = args.projectPath && !insidePanelData(args.projectPath) ? args.projectPath : undefined;
  if (referenceable) {
    const projects = new Set(doc.frontmatter.projects ?? []);
    projects.add(referenceable);
    frontmatter.projects = [...projects];
    if (!frontmatter.primaryProject) frontmatter.primaryProject = referenceable;
  }
  const updated = await store.writeNoteContent(args.noteId, buildNoteDocument(frontmatter, doc.body));
  return updated;
}

/**
 * Reference a project from a task without a session yet. Normally the
 * project list is derived from the task's sessions; this is the manual
 * path for a brand-new task.
 */
export async function notesAddTaskProject(args: {
  noteId: string;
  projectPath: string;
}): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  const content = await store.readNoteContent(args.noteId);
  const doc = parseNoteDocument(content);
  if (!doc.frontmatter.work) {
    throw new Error("Note is not a task.");
  }
  const projects = new Set(doc.frontmatter.projects ?? []);
  projects.add(args.projectPath);
  const frontmatter = {
    ...doc.frontmatter,
    projects: [...projects],
    primaryProject: doc.frontmatter.primaryProject ?? args.projectPath
  };
  const updated = await store.writeNoteContent(args.noteId, buildNoteDocument(frontmatter, doc.body));
  return updated;
}

/**
 * Drop a referenced project from a task. Sessions whose cwd is that
 * project leave the task with it (the sessions themselves are untouched),
 * otherwise the derived project list would immediately bring the project back.
 */
export async function notesRemoveTaskProject(args: {
  noteId: string;
  projectPath: string;
}): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  const content = await store.readNoteContent(args.noteId);
  const doc = parseNoteDocument(content);
  if (!doc.frontmatter.work) {
    throw new Error("Note is not a task.");
  }

  const details = await store.listTaskSessionDetails(args.noteId);
  const droppedSessions = new Set(
    details
      .filter((detail) => detail.projectPath === args.projectPath)
      .map((detail) => `${detail.provider}:${detail.sessionId}`)
  );

  const projects = (doc.frontmatter.projects ?? []).filter((projectPath) => projectPath !== args.projectPath);
  const sessions = (doc.frontmatter.sessions ?? []).filter((key) => !droppedSessions.has(key));
  const frontmatter = { ...doc.frontmatter, projects, sessions };
  if (frontmatter.primaryProject === args.projectPath) {
    frontmatter.primaryProject = projects[0];
  }

  const updated = await store.writeNoteContent(args.noteId, buildNoteDocument(frontmatter, doc.body));
  return updated;
}

export async function notesSetGtdStatus(noteId: string, status: GtdStatus | null): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  return status === null
    ? store.clearNoteGtdStatus(noteId)
    : store.setNoteGtdStatus(noteId, status);
}

/** Archive or restore tasks. The whole batch shares one timestamp. */
export async function notesSetArchived(noteIds: string[], archived: boolean): Promise<void> {
  const store = await getDesktopNotesStore();
  if (archived) {
    await store.archiveTasks(noteIds);
  } else {
    await store.unarchiveTasks(noteIds);
  }
}

export async function notesRead(noteId: string): Promise<{ record: DesktopNoteRecord; content: string }> {
  const store = await getDesktopNotesStore();
  const record = await store.getNote(noteId);
  if (!record) {
    throw new Error("Note not found.");
  }
  const content = await store.readNoteContent(noteId);
  return { record, content };
}

export async function notesWrite(
  noteId: string,
  content: string
): Promise<NoteRecord & { content?: string }> {
  const store = await getDesktopNotesStore();
  const updated = await store.writeNoteContent(noteId, content);
  // Editing a task (including its background knowledge) keeps the
  // workspace's address table in step; other notes have no workspace.
  if (parseNoteDocument(updated.content ?? content).frontmatter.work) {
  }
  return updated;
}

export async function notesCreate(args: {
  scope: "library" | "session";
  projectPath?: string;
  provider?: string;
  sessionId?: string;
  body?: string;
}): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  if (args.scope === "library") {
    return store.createLibraryNote(args.body || "");
  }
  if (!args.provider?.trim() || !args.sessionId?.trim()) {
    throw new Error("provider and sessionId are required.");
  }
  return store.createSessionNote({
    provider: args.provider as AgentProvider,
    id: args.sessionId,
    projectPath: args.projectPath || ""
  }, args.body || "");
}

export async function notesDelete(noteId: string): Promise<{ ok: boolean; deletedNoteIds: string[] }> {
  const store = await getDesktopNotesStore();
  const descendants = await store.collectNoteDescendantIds(noteId);
  const deletedNoteIds = [...descendants, noteId];
  for (const id of deletedNoteIds) {
    await store.deleteNote(id);
  }
  return { ok: true, deletedNoteIds };
}

export async function notesRename(noteId: string, filename: string): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  const renamed = await store.renameNote(noteId, filename);
  // The address table points at the note; a rename moves the target.
  return renamed;
}

export async function notesImport(owner: NoteOwner): Promise<ImportNotesResult> {
  const settings = await loadSettings();
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: desktopT(settings, "desktop.dialog.markdown"), extensions: ["md"] }]
  });
  if (result.canceled || !result.filePaths.length) {
    return { imported: 0, skipped: 0, errors: [], records: [] };
  }
  const store = await getDesktopNotesStore();
  return store.importMarkdownFiles(owner, result.filePaths);
}

export async function notesPasteImage(noteId: string): Promise<{ snippet: string } | null> {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return null;
  }

  const store = await getDesktopNotesStore();
  const record = await store.getNote(noteId);
  if (!record) {
    throw new Error("Note not found.");
  }

  const assetsDir = await store.ensureAssetsForNote(record);
  const base = `paste-${Date.now()}.png`;
  const dest = path.join(assetsDir, base);
  const png = imageToPngBuffer(image);
  await fs.writeFile(dest, png);
  const rel = `./${noteAssetsDirName(record.filename)}/${base}`;
  return { snippet: `![${base}](${rel})` };
}

function imageToPngBuffer(image: Electron.NativeImage): Buffer {
  const png = image.toPNG();
  if (png.length > 0) {
    return png;
  }
  const jpeg = image.toJPEG(92);
  if (jpeg.length > 0) {
    return nativeImage.createFromBuffer(jpeg).toPNG();
  }
  return png;
}

export async function notesOpenFolder(): Promise<{ ok: boolean }> {
  const store = await getDesktopNotesStore();
  const root = notesRoot(store.getPanelHome());
  await shell.openPath(root);
  return { ok: true };
}

export async function settingsOpenPanelHome(): Promise<{ ok: boolean }> {
  const settings = await loadSettings();
  const home = expandHome(effectivePanelHome(settings));
  await shell.openPath(home);
  return { ok: true };
}

export async function notesReveal(noteId: string): Promise<{ ok: boolean }> {
  const store = await getDesktopNotesStore();
  const record = await store.getNote(noteId);
  if (!record) {
    throw new Error("Note not found.");
  }
  const absPath = path.resolve(store.absolutePath(record));
  shell.showItemInFolder(absPath);
  return { ok: true };
}

export async function notesCopyPath(noteId: string): Promise<{ path: string }> {
  const store = await getDesktopNotesStore();
  const record = await store.getNote(noteId);
  if (!record) {
    throw new Error("Note not found.");
  }
  const abs = store.absolutePath(record);
  clipboard.writeText(abs);
  return { path: abs };
}

export async function notesListRootNotes(): Promise<DesktopNoteRecord[]> {
  const store = await getDesktopNotesStore();
  await store.reload();
  // Project notes are an extension-only capability; Desktop never surfaces them.
  return (await store.listRootNotes()).filter((note) => note.scope !== "project");
}

export async function notesListLinks(): Promise<NoteLink[]> {
  const store = await getDesktopNotesStore();
  return store.listNoteLinks();
}

export async function notesGetParent(noteId: string): Promise<NoteLink | null> {
  const store = await getDesktopNotesStore();
  return (await store.getNoteParent(noteId)) ?? null;
}

export async function notesSetParent(
  childNoteId: string,
  parentNoteId: string | null
): Promise<{ ok: boolean }> {
  const store = await getDesktopNotesStore();
  await store.setNoteParent(childNoteId, parentNoteId);
  return { ok: true };
}

export async function notesCreateLinkedChild(parentNoteId: string): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  return store.createLinkedChildNote(parentNoteId);
}

export async function notesGetSubtree(rootNoteId: string): Promise<NoteSubtree> {
  const store = await getDesktopNotesStore();
  return store.getNoteSubtree(rootNoteId);
}

export async function notesResolveLinkRoot(noteId: string): Promise<{ rootNoteId: string }> {
  const store = await getDesktopNotesStore();
  const rootNoteId = await store.resolveNoteLinkRoot(noteId);
  return { rootNoteId };
}

export async function notesListLinkedChildIds(): Promise<string[]> {
  const store = await getDesktopNotesStore();
  return [...(await store.listLinkedChildIds())];
}

export async function notesListChildCounts(): Promise<Record<string, number>> {
  const store = await getDesktopNotesStore();
  const map = await store.listNoteChildCounts();
  return Object.fromEntries(map.entries());
}

export function invalidateNotesStore(): void {
  notesStore = null;
  notesStoreKey = "";
  lastReconcileMs = 0;
}
