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
  type AgentProvider,
  type GtdStatus,
  type ImportNotesResult,
  type NoteLink,
  type NoteOwner,
  type NoteRecord,
  type NoteSubtree
} from "@agent-resume/core";
import { desktopT } from "./i18nService";
import { loadPanelDbPaths } from "./panelDatabases";

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
