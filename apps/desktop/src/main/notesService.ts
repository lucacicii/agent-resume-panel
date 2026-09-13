import { clipboard, dialog, nativeImage, shell } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildNoteDocument,
  effectivePanelHome,
  expandHome,
  extractTitle,
  loadSettings,
  noteAssetsDirName,
  NotesStore,
  notesRoot,
  parseNoteDocument,
  type AgentProvider,
  type GtdStatus,
  type ImportNotesResult,
  type NoteLink,
  type NoteOwner,
  type NoteRecord,
  type NoteSubtree,
  type WorkItemRecord,
  type WorkItemSessionLink
} from "@agent-resume/core";
import { desktopT } from "./i18nService";
import { loadPanelDbPaths } from "./panelDatabases";
import {
  ensureWorkItemWorkspace,
  workItemWorkspaceDir,
  type WorkItemAddress
} from "./workItemWorkspace";

let notesStore: NotesStore | null = null;
let notesStoreKey = "";

export type DesktopNoteRecord = NoteRecord;

export async function getDesktopNotesStore(): Promise<NotesStore> {
  const settings = await loadSettings();
  const panelHome = effectivePanelHome(settings);
  const paths = await loadPanelDbPaths(settings);
  const dbPath = paths.catalogDb;
  const key = `${dbPath}::${panelHome}`;
  if (!notesStore || notesStoreKey !== key) {
    notesStore = new NotesStore(dbPath, panelHome);
    await notesStore.initialize();
    notesStoreKey = key;
  }
  return notesStore;
}

export async function notesList(): Promise<DesktopNoteRecord[]> {
  const store = await getDesktopNotesStore();
  await store.reload();
  return store.getAllNotes();
}

/** Project notes marked `work: true` — the board's unit of management. */
export async function notesListWorkItems(): Promise<WorkItemRecord[]> {
  const store = await getDesktopNotesStore();
  await store.reload();
  const items = await store.listWorkItems();
  if (!items.length) return items;

  // `projects` is referenced, not owned: the union of declared projects and the
  // projects of linked sessions, derived in SQL from the session index table.
  const sessionProjects = await store.listWorkItemSessionProjects();
  return items.map((item) => {
    const projects = new Set(item.work.projects ?? []);
    for (const projectPath of sessionProjects[item.noteId] ?? []) projects.add(projectPath);
    const list = [...projects];
    return {
      ...item,
      work: { ...item.work, projects: list, primaryProject: item.work.primaryProject ?? list[0] }
    };
  });
}

/** Indexed work-item ↔ session links, for the session → work item reverse lookup. */
export async function notesListWorkItemSessionLinks(): Promise<WorkItemSessionLink[]> {
  const store = await getDesktopNotesStore();
  await store.reload();
  return store.listWorkItemSessionLinks();
}

function projectLabel(projectPath: string): string {
  return projectPath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || projectPath;
}

/**
 * Allocate (idempotently) the work item's neutral workspace and refresh the
 * address table in its `AGENTS.md` / `CLAUDE.md`.
 */
export async function notesEnsureWorkItemWorkspace(noteId: string): Promise<{ dir: string }> {
  const settings = await loadSettings();
  const panelHome = effectivePanelHome(settings);
  const paths = await loadPanelDbPaths(settings);
  const store = await getDesktopNotesStore();
  const { record, content } = await notesRead(noteId);
  const doc = parseNoteDocument(content);

  const declared = (doc.frontmatter.projects ?? []).map((entry) => entry.trim()).filter(Boolean);
  const derived = new Set(declared);
  const fromSessions = await store.listWorkItemSessionProjects();
  for (const projectPath of fromSessions[noteId] ?? []) derived.add(projectPath);

  const address: WorkItemAddress = {
    noteId,
    title: record.title || extractTitle(doc.body) || record.filename || noteId,
    status: record.gtdStatus ?? "inbox",
    next: doc.frontmatter.next,
    decision: doc.frontmatter.decision,
    noteRelPath: record.relMdPath,
    projects: await Promise.all([...derived].map(async (projectPath) => ({
      path: projectPath,
      label: projectLabel(projectPath),
      exists: await fs.stat(projectPath).then(() => true).catch(() => false)
    })))
  };

  const { dir } = await ensureWorkItemWorkspace({ panelHome, catalogDb: paths.catalogDb, address });
  return { dir };
}

/** Best-effort refresh: the workspace must never block the primary write. */
async function refreshWorkItemWorkspace(noteId: string): Promise<void> {
  try {
    await notesEnsureWorkItemWorkspace(noteId);
  } catch {
    /* degrade to "no address table" rather than failing the caller */
  }
}

/** Create a work item. It references projects instead of belonging to one. */
export async function notesCreateWorkItem(args: {
  title?: string;
  next?: string;
  decision?: string;
  sessions?: string[];
  projects?: string[];
  primaryProject?: string;
}): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  const record = await store.createWorkItem(args);
  await store.setNoteGtdStatus(record.noteId, "inbox");
  await refreshWorkItemWorkspace(record.noteId);
  return record;
}

/**
 * Append a session to a work item (and reference its project). This is how a
 * session started inside a work-item workspace becomes part of that work item,
 * which is what lets one work item span several repositories.
 */
export async function notesLinkSessionToWorkItem(args: {
  noteId: string;
  sessionKey: string;
  projectPath?: string;
}): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  const content = await store.readNoteContent(args.noteId);
  const doc = parseNoteDocument(content);
  if (!doc.frontmatter.work) {
    throw new Error("Note is not a work item.");
  }
  const sessions = new Set(doc.frontmatter.sessions ?? []);
  sessions.add(args.sessionKey);
  const frontmatter = { ...doc.frontmatter, sessions: [...sessions] };
  if (args.projectPath) {
    const projects = new Set(doc.frontmatter.projects ?? []);
    projects.add(args.projectPath);
    frontmatter.projects = [...projects];
    if (!frontmatter.primaryProject) frontmatter.primaryProject = args.projectPath;
  }
  const updated = await store.writeNoteContent(args.noteId, buildNoteDocument(frontmatter, doc.body));
  await refreshWorkItemWorkspace(args.noteId);
  return updated;
}

/**
 * Reference a project from a work item without a session yet. Normally the
 * project list is derived from the work item's sessions; this is the manual
 * path for a brand-new work item.
 */
export async function notesAddWorkItemProject(args: {
  noteId: string;
  projectPath: string;
}): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  const content = await store.readNoteContent(args.noteId);
  const doc = parseNoteDocument(content);
  if (!doc.frontmatter.work) {
    throw new Error("Note is not a work item.");
  }
  const projects = new Set(doc.frontmatter.projects ?? []);
  projects.add(args.projectPath);
  const frontmatter = {
    ...doc.frontmatter,
    projects: [...projects],
    primaryProject: doc.frontmatter.primaryProject ?? args.projectPath
  };
  const updated = await store.writeNoteContent(args.noteId, buildNoteDocument(frontmatter, doc.body));
  await refreshWorkItemWorkspace(args.noteId);
  return updated;
}

/**
 * On quit: turn sessions that were waiting for the user into GTD inbox work
 * items, so "the agent needs me" outlives the process without persisting the
 * transient runtime state itself. Best-effort — quitting must never fail.
 */
export async function promoteAwaitingSessionsToInbox(
  sessions: Array<{ sessionKey: string; title: string; projectPath: string }>
): Promise<number> {
  const store = await getDesktopNotesStore();
  await store.reload();
  const known = new Set<string>();
  for (const item of await store.listWorkItems()) {
    for (const key of item.work.sessions ?? []) known.add(key);
  }
  let promoted = 0;
  for (const session of sessions) {
    const key = session.sessionKey?.trim();
    const projectPath = session.projectPath?.trim();
    if (!key || !projectPath || known.has(key)) continue;
    try {
      const record = await store.createWorkItem({
        title: session.title?.trim() || key,
        decision: `Agent was waiting for your input when the app closed (${key}).`,
        sessions: [key],
        projects: [projectPath],
        primaryProject: projectPath
      });
      await store.setNoteGtdStatus(record.noteId, "inbox");
      known.add(key);
      promoted += 1;
    } catch {
      /* one un-writable note must not block the quit */
    }
  }
  return promoted;
}

export async function notesSetGtdStatus(noteId: string, status: GtdStatus | null): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  return status === null
    ? store.clearNoteGtdStatus(noteId)
    : store.setNoteGtdStatus(noteId, status);
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
  return store.writeNoteContent(noteId, content);
}

export async function notesCreate(args: {
  scope: "library" | "project" | "session";
  projectPath?: string;
  provider?: string;
  sessionId?: string;
  body?: string;
}): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  if (args.scope === "library") {
    return store.createLibraryNote(args.body || "");
  }
  if (args.scope === "project") {
    if (!args.projectPath?.trim()) {
      throw new Error("projectPath is required.");
    }
    return store.createProjectNote(args.projectPath, args.body || "");
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

export async function notesMove(noteId: string, owner: NoteOwner): Promise<NoteRecord> {
  const store = await getDesktopNotesStore();
  return store.moveNote(noteId, owner);
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
  return store.renameNote(noteId, filename);
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
  return store.listRootNotes();
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
}
