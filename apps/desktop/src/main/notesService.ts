import { clipboard, dialog, nativeImage, shell } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  effectivePanelHome,
  expandHome,
  loadSettings,
  noteAssetsDirName,
  NotesStore,
  notesRoot,
  parseNoteGtdTasks,
  type AgentProvider,
  type ExecutableNoteProbe,
  type GtdStatus,
  type ImportNotesResult,
  type NoteGtdTask,
  type NoteLink,
  type NoteOwner,
  type NoteRecord,
  type NoteRunRow,
  type NoteSessionBinding,
  type NoteSubtree
} from "@agent-resume/core";
import { desktopT } from "./i18nService";
import { loadPanelDbPaths } from "./panelDatabases";

let notesStore: NotesStore | null = null;
let notesStoreKey = "";

export type DesktopNoteRecord = NoteRecord;

const NOTES_CLI_PROVIDERS = new Set<string>([
  "codex",
  "claude",
  "agy",
  "grok",
  "opencode",
  "pi",
  "cursor"
]);

/** Resolve the Notes default session provider (independent of Workbench). */
async function notesDefaultProvider(): Promise<string> {
  const settings = await loadSettings();
  const provider = settings.notes?.defaultSessionProvider;
  return provider && NOTES_CLI_PROVIDERS.has(provider) ? provider : "codex";
}

async function getNotesStore(): Promise<NotesStore> {
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
  const store = await getNotesStore();
  await store.reload();
  return store.getAllNotes();
}

export interface DesktopNoteGtdTask extends NoteGtdTask {
  noteId: string;
  noteTitle: string;
  scope: string;
  relMdPath: string;
  projectPath?: string;
  updatedAtMs: number;
}

export async function notesListGtd(args?: {
  query?: string;
  status?: GtdStatus;
}): Promise<DesktopNoteGtdTask[]> {
  const store = await getNotesStore();
  await store.reload();
  const query = args?.query?.trim().toLocaleLowerCase() || "";
  const tasks: DesktopNoteGtdTask[] = [];

  for (const record of store.getAllNotes()) {
    try {
      const content = await store.readNoteContent(record.noteId);
      for (const task of parseNoteGtdTasks(content)) {
        const searchable = `${task.text} ${record.title || record.filename} ${record.relMdPath} ${record.projectPath || ""} ${task.status}`.toLocaleLowerCase();
        if ((args?.status == null || task.status === args.status) && (!query || searchable.includes(query))) {
          tasks.push({
            ...task,
            noteId: record.noteId,
            noteTitle: record.title || record.filename,
            scope: record.scope,
            relMdPath: record.relMdPath,
            projectPath: record.projectPath,
            updatedAtMs: record.updatedAtMs
          });
        }
      }
    } catch {
      // Keep a damaged or externally removed note from hiding valid tasks elsewhere.
    }
  }

  return tasks.sort((left, right) => Number(left.status === "done") - Number(right.status === "done")
    || right.updatedAtMs - left.updatedAtMs
    || left.noteTitle.localeCompare(right.noteTitle)
    || left.line - right.line);
}

export async function notesRead(noteId: string): Promise<{ record: DesktopNoteRecord; content: string }> {
  const store = await getNotesStore();
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
): Promise<NoteRecord & { content?: string; materialized?: boolean }> {
  const store = await getNotesStore();
  return store.writeNoteContent(noteId, content, { defaultProvider: await notesDefaultProvider() });
}

export async function notesExecutableParse(noteId: string) {
  const store = await getNotesStore();
  return store.parseExecutable(noteId);
}

export async function notesExecutableApproveRun(
  noteId: string,
  args?: { runIndex?: number; defaultProvider?: string }
) {
  const store = await getNotesStore();
  return store.approveExecutableRun(noteId, {
    runIndex: args?.runIndex,
    defaultProvider: args?.defaultProvider || (await notesDefaultProvider())
  });
}

export async function notesExecutableBindSession(args: {
  noteId: string;
  provider: string;
  agentSessionId: string;
  runId?: string;
  role?: string;
  status?: string;
}) {
  const store = await getNotesStore();
  return store.bindExecutableSession(args);
}

export async function notesExecutableSettleChild(args: {
  parentNoteId: string;
  childNoteId: string;
  outcome: "completed" | "failed";
  summary: string;
  runId?: string;
  defaultProvider?: string;
  bubble?: boolean;
}) {
  const store = await getNotesStore();
  if (args.bubble === false) {
    return store.settleExecutableChild(args);
  }
  return store.settleExecutableChildWithBubble({
    parentNoteId: args.parentNoteId,
    childNoteId: args.childNoteId,
    outcome: args.outcome,
    summary: args.summary,
    runId: args.runId,
    defaultProvider: args.defaultProvider || (await notesDefaultProvider())
  });
}

export async function notesExecutableResolveLeaf(
  noteId: string,
  args?: { defaultProvider?: string; maxDepth?: number }
) {
  const store = await getNotesStore();
  return store.resolveExecutableLeaf(noteId, {
    defaultProvider: args?.defaultProvider || (await notesDefaultProvider()),
    maxDepth: args?.maxDepth
  });
}

export async function notesExecutableIsComposite(noteId: string): Promise<boolean> {
  const store = await getNotesStore();
  return store.isCompositeExecutableNote(noteId);
}

export async function notesExecutableListBindings(noteId: string): Promise<NoteSessionBinding[]> {
  const store = await getNotesStore();
  return store.listExecutableBindings(noteId);
}

export async function notesExecutableListRuns(noteId: string): Promise<NoteRunRow[]> {
  const store = await getNotesStore();
  return store.listExecutableRuns(noteId);
}

export async function notesExecutableProbe(noteId: string): Promise<ExecutableNoteProbe> {
  const store = await getNotesStore();
  return store.probeExecutableNote(noteId);
}

export async function notesExecutableSetRunStatus(
  noteId: string,
  status: "draft" | "awaiting_approval" | "executing" | "completed" | "partial" | "failed"
) {
  const store = await getNotesStore();
  return store.setExecutableRunStatus(noteId, status);
}

export async function notesExecutableSetChildStatus(
  childNoteId: string,
  status: "idle" | "planned" | "running" | "done" | "failed"
) {
  const store = await getNotesStore();
  return store.setExecutableChildStatus(childNoteId, status);
}

export async function notesExecutableSetSessionStatus(
  noteId: string,
  status: "idle" | "planned" | "running" | "settled" | "failed"
) {
  const store = await getNotesStore();
  return store.setExecutableSessionStatus(noteId, status);
}

export async function notesExecutableAppendStep(
  parentNoteId: string,
  text?: string
): Promise<{ content: string; childNoteId: string }> {
  const store = await getNotesStore();
  return store.appendExecutableStep(parentNoteId, text, {
    defaultProvider: await notesDefaultProvider()
  });
}

export async function notesCreate(args: {
  scope: "library" | "project" | "session";
  projectPath?: string;
  provider?: string;
  sessionId?: string;
}): Promise<NoteRecord> {
  const store = await getNotesStore();
  if (args.scope === "library") {
    return store.createLibraryNote();
  }
  if (args.scope === "project") {
    if (!args.projectPath?.trim()) {
      throw new Error("projectPath is required.");
    }
    return store.createProjectNote(args.projectPath);
  }
  if (!args.provider?.trim() || !args.sessionId?.trim()) {
    throw new Error("provider and sessionId are required.");
  }
  return store.createSessionNote({
    provider: args.provider as AgentProvider,
    id: args.sessionId,
    projectPath: args.projectPath || ""
  });
}

export async function notesMove(noteId: string, owner: NoteOwner): Promise<NoteRecord> {
  const store = await getNotesStore();
  return store.moveNote(noteId, owner);
}

export async function notesDelete(noteId: string): Promise<{ ok: boolean; deletedNoteIds: string[] }> {
  const store = await getNotesStore();
  const descendants = await store.collectNoteDescendantIds(noteId);
  const deletedNoteIds = [...descendants, noteId];
  for (const id of deletedNoteIds) {
    await store.deleteNote(id);
  }
  return { ok: true, deletedNoteIds };
}

export async function notesRename(noteId: string, filename: string): Promise<NoteRecord> {
  const store = await getNotesStore();
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
  const store = await getNotesStore();
  return store.importMarkdownFiles(owner, result.filePaths);
}

export async function notesPasteImage(noteId: string): Promise<{ snippet: string } | null> {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return null;
  }

  const store = await getNotesStore();
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
  const store = await getNotesStore();
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
  const store = await getNotesStore();
  const record = await store.getNote(noteId);
  if (!record) {
    throw new Error("Note not found.");
  }
  const absPath = path.resolve(store.absolutePath(record));
  shell.showItemInFolder(absPath);
  return { ok: true };
}

export async function notesCopyPath(noteId: string): Promise<{ path: string }> {
  const store = await getNotesStore();
  const record = await store.getNote(noteId);
  if (!record) {
    throw new Error("Note not found.");
  }
  const abs = store.absolutePath(record);
  clipboard.writeText(abs);
  return { path: abs };
}

export async function notesListRootNotes(): Promise<DesktopNoteRecord[]> {
  const store = await getNotesStore();
  await store.reload();
  return store.listRootNotes();
}

export async function notesListLinks(): Promise<NoteLink[]> {
  const store = await getNotesStore();
  return store.listNoteLinks();
}

export async function notesGetParent(noteId: string): Promise<NoteLink | null> {
  const store = await getNotesStore();
  return (await store.getNoteParent(noteId)) ?? null;
}

export async function notesSetParent(
  childNoteId: string,
  parentNoteId: string | null
): Promise<{ ok: boolean }> {
  const store = await getNotesStore();
  await store.setNoteParent(childNoteId, parentNoteId);
  return { ok: true };
}

export async function notesCreateLinkedChild(parentNoteId: string): Promise<NoteRecord> {
  const store = await getNotesStore();
  return store.createLinkedChildNote(parentNoteId);
}

export async function notesGetSubtree(rootNoteId: string): Promise<NoteSubtree> {
  const store = await getNotesStore();
  return store.getNoteSubtree(rootNoteId);
}

export async function notesResolveLinkRoot(noteId: string): Promise<{ rootNoteId: string }> {
  const store = await getNotesStore();
  const rootNoteId = await store.resolveNoteLinkRoot(noteId);
  return { rootNoteId };
}

export async function notesListLinkedChildIds(): Promise<string[]> {
  const store = await getNotesStore();
  return [...(await store.listLinkedChildIds())];
}

export async function notesListChildCounts(): Promise<Record<string, number>> {
  const store = await getNotesStore();
  const map = await store.listNoteChildCounts();
  return Object.fromEntries(map.entries());
}

export function invalidateNotesStore(): void {
  notesStore = null;
  notesStoreKey = "";
}
