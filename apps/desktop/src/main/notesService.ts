import { clipboard, dialog, shell } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  catalogDbFromSettings,
  effectivePanelHome,
  loadSettings,
  noteAssetsDirName,
  NotesStore,
  notesRoot,
  type AgentProvider,
  type ImportNotesResult,
  type NoteOwner,
  type NoteRecord
} from "@agent-resume/core";

let notesStore: NotesStore | null = null;
let notesStoreKey = "";

async function getNotesStore(): Promise<NotesStore> {
  const settings = await loadSettings();
  const panelHome = effectivePanelHome(settings);
  const dbPath = catalogDbFromSettings(settings);
  const key = `${dbPath}::${panelHome}`;
  if (!notesStore || notesStoreKey !== key) {
    notesStore = new NotesStore(dbPath, panelHome);
    await notesStore.initialize();
    notesStoreKey = key;
  }
  return notesStore;
}

export async function notesList(): Promise<NoteRecord[]> {
  const store = await getNotesStore();
  await store.reload();
  return store.getAllNotes();
}

export async function notesRead(noteId: string): Promise<{ record: NoteRecord; content: string }> {
  const store = await getNotesStore();
  const record = await store.getNote(noteId);
  if (!record) {
    throw new Error("Note not found.");
  }
  const content = await store.readNoteContent(noteId);
  return { record, content };
}

export async function notesWrite(noteId: string, content: string): Promise<NoteRecord> {
  const store = await getNotesStore();
  return store.writeNoteContent(noteId, content);
}

export async function notesCreate(args: {
  scope: "project" | "session";
  projectPath?: string;
  provider?: string;
  sessionId?: string;
}): Promise<NoteRecord> {
  const store = await getNotesStore();
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

export async function notesDelete(noteId: string): Promise<{ ok: boolean }> {
  const store = await getNotesStore();
  await store.deleteNote(noteId);
  return { ok: true };
}

export async function notesRename(noteId: string, filename: string): Promise<NoteRecord> {
  const store = await getNotesStore();
  return store.renameNote(noteId, filename);
}

export async function notesImport(owner: NoteOwner): Promise<ImportNotesResult> {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Markdown", extensions: ["md"] }]
  });
  if (result.canceled || !result.filePaths.length) {
    return { imported: 0, skipped: 0, errors: [], records: [] };
  }
  const store = await getNotesStore();
  return store.importMarkdownFiles(owner, result.filePaths);
}

export async function notesInsertImage(noteId: string): Promise<{ snippet: string } | null> {
  const store = await getNotesStore();
  const record = await store.getNote(noteId);
  if (!record) {
    throw new Error("Note not found.");
  }
  const pick = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"]
      }
    ]
  });
  if (pick.canceled || !pick.filePaths[0]) {
    return null;
  }
  const source = pick.filePaths[0];
  const assetsDir = await store.ensureAssetsForNote(record);
  const base = path.basename(source);
  const dest = path.join(assetsDir, base);
  await fs.copyFile(source, dest);
  const rel = `./${noteAssetsDirName(record.filename)}/${base}`;
  return { snippet: `![${base}](${rel})` };
}

export async function notesOpenFolder(): Promise<{ ok: boolean }> {
  const store = await getNotesStore();
  const root = notesRoot(store.getPanelHome());
  await shell.openPath(root);
  return { ok: true };
}

export async function notesReveal(noteId: string): Promise<{ ok: boolean }> {
  const store = await getNotesStore();
  const record = await store.getNote(noteId);
  if (!record) {
    throw new Error("Note not found.");
  }
  shell.showItemInFolder(store.absolutePath(record));
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

export function invalidateNotesStore(): void {
  notesStore = null;
  notesStoreKey = "";
}