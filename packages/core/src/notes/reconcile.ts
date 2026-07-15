import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentProvider } from "../catalog/types";
import { normalizeProjectPath } from "../pathUtils";
import {
  deleteNoteRecord,
  getCatalogMeta,
  listAllNotes,
  listLegacyProjectNotes,
  listLegacySessionNotes,
  setCatalogMeta,
  upsertNoteRecord,
  type NoteRecord
} from "./catalogNotes";
import { contentPreview, extractTitle, parseNoteDocument } from "./frontmatter";
import { formatNoteFilename, localDateString } from "./naming";
import { fileMtimeMs, newNoteId, writeNewNoteFile } from "./fs";
import { NoteOwner, notesRoot, ownerRelDir, parseOwnerJson } from "./paths";

const LEGACY_MIGRATION_KEY = "notes_disk_migrated_v1";

export async function migrateLegacyNotesToDisk(dbPath: string, panelHome: string): Promise<void> {
  const flag = await getCatalogMeta(dbPath, LEGACY_MIGRATION_KEY);
  if (flag === "1") {
    return;
  }

  const legacySessions = await listLegacySessionNotes(dbPath);
  const legacyProjects = await listLegacyProjectNotes(dbPath);

  for (const row of legacySessions) {
    const owner: NoteOwner = {
      scope: "session",
      provider: row.provider as AgentProvider,
      sessionId: row.agent_session_id
    };
    const date = new Date(row.updated_at_ms || Date.now());
    const filename = formatNoteFilename(localDateString(date), 1);
    const noteId = newNoteId();
    const { absPath } = await writeNewNoteFile({
      panelHome,
      owner,
      filename,
      noteId,
      body: row.content,
      createdAtMs: row.updated_at_ms || Date.now()
    });
    const mtime = await fileMtimeMs(absPath);
    await upsertNoteRecord(dbPath, {
      noteId,
      scope: "session",
      provider: row.provider,
      agentSessionId: row.agent_session_id,
      filename,
      relDir: ownerRelDir(owner),
      relMdPath: path.join("notes", ownerRelDir(owner), filename),
      title: extractTitle(row.content),
      contentPreview: contentPreview(row.content),
      createdAtMs: row.updated_at_ms || Date.now(),
      updatedAtMs: row.updated_at_ms || Date.now(),
      fsMtimeMs: mtime
    });
  }

  for (const row of legacyProjects) {
    const owner: NoteOwner = {
      scope: "project",
      projectPath: normalizeProjectPath(row.project_path)
    };
    const date = new Date(row.updated_at_ms || Date.now());
    const filename = formatNoteFilename(localDateString(date), 1);
    const noteId = newNoteId();
    const { absPath } = await writeNewNoteFile({
      panelHome,
      owner,
      filename,
      noteId,
      body: row.content,
      createdAtMs: row.updated_at_ms || Date.now()
    });
    const mtime = await fileMtimeMs(absPath);
    await upsertNoteRecord(dbPath, {
      noteId,
      scope: "project",
      projectPath: owner.projectPath,
      filename,
      relDir: ownerRelDir(owner),
      relMdPath: path.join("notes", ownerRelDir(owner), filename),
      title: extractTitle(row.content),
      contentPreview: contentPreview(row.content),
      createdAtMs: row.updated_at_ms || Date.now(),
      updatedAtMs: row.updated_at_ms || Date.now(),
      fsMtimeMs: mtime
    });
  }

  await setCatalogMeta(dbPath, LEGACY_MIGRATION_KEY, "1");
}

export async function reconcileNotesIndex(dbPath: string, panelHome: string): Promise<void> {
  await migrateLegacyNotesToDisk(dbPath, panelHome);

  const root = notesRoot(panelHome);
  await fs.mkdir(root, { recursive: true });

  const onDisk = await scanNoteMarkdownFiles(panelHome);
  const existing = await listAllNotes(dbPath);
  const byRel = new Map(existing.map((n) => [n.relMdPath, n]));
  const seen = new Set<string>();

  for (const entry of onDisk) {
    seen.add(entry.relMdPath);
    const prev = byRel.get(entry.relMdPath);
    if (prev && prev.fsMtimeMs === entry.mtimeMs && prev.noteId) {
      continue;
    }
    const raw = await fs.readFile(entry.absPath, "utf8");
    const doc = parseNoteDocument(raw);
    const noteId = doc.frontmatter.id || prev?.noteId || newNoteId();
    const owner = entry.owner;
    const record: NoteRecord = {
      noteId,
      scope: owner.scope,
      provider: owner.scope === "session" ? owner.provider : undefined,
      agentSessionId: owner.scope === "session" ? owner.sessionId : undefined,
      projectPath:
        owner.scope === "project"
          ? owner.projectPath
          : owner.scope === "session"
            ? owner.projectPath ?? doc.frontmatter.projectPath
            : undefined,
      filename: entry.filename,
      relDir: ownerRelDir(owner),
      relMdPath: entry.relMdPath,
      title: extractTitle(doc.body),
      contentPreview: contentPreview(doc.body),
      createdAtMs: prev?.createdAtMs ?? entry.mtimeMs,
      updatedAtMs: entry.mtimeMs,
      fsMtimeMs: entry.mtimeMs
    };
    await upsertNoteRecord(dbPath, record);
  }

  for (const note of existing) {
    if (!seen.has(note.relMdPath)) {
      await deleteNoteRecord(dbPath, note.noteId);
    }
  }
}

interface ScannedNote {
  absPath: string;
  relMdPath: string;
  filename: string;
  mtimeMs: number;
  owner: NoteOwner;
}

async function scanNoteMarkdownFiles(panelHome: string): Promise<ScannedNote[]> {
  const root = notesRoot(panelHome);
  const results: ScannedNote[] = [];

  const libraryRoot = path.join(root, "library");
  try {
    const owner: NoteOwner = { scope: "library" };
    await collectMarkdown(libraryRoot, owner, results);
  } catch {
    // no library yet
  }

  const projectsRoot = path.join(root, "projects");
  try {
    const projectDirs = await fs.readdir(projectsRoot, { withFileTypes: true });
    for (const dirent of projectDirs) {
      if (!dirent.isDirectory()) {
        continue;
      }
      const ownerDir = path.join(projectsRoot, dirent.name);
      const owner = await readOwnerOrInfer(ownerDir, { kind: "project", dirName: dirent.name });
      if (!owner || owner.scope !== "project") {
        continue;
      }
      await collectMarkdown(ownerDir, owner, results);
    }
  } catch {
    // no projects yet
  }

  const sessionsRoot = path.join(root, "sessions");
  try {
    const providers = await fs.readdir(sessionsRoot, { withFileTypes: true });
    for (const providerEnt of providers) {
      if (!providerEnt.isDirectory()) {
        continue;
      }
      const providerDir = path.join(sessionsRoot, providerEnt.name);
      const sessionDirs = await fs.readdir(providerDir, { withFileTypes: true });
      for (const sessionEnt of sessionDirs) {
        if (!sessionEnt.isDirectory()) {
          continue;
        }
        const ownerDir = path.join(providerDir, sessionEnt.name);
        const owner = await readOwnerOrInfer(ownerDir, {
          kind: "session",
          provider: providerEnt.name,
          dirName: sessionEnt.name
        });
        if (!owner || owner.scope !== "session") {
          continue;
        }
        await collectMarkdown(ownerDir, owner, results);
      }
    }
  } catch {
    // no sessions yet
  }

  return results;
}

async function collectMarkdown(
  ownerDir: string,
  owner: NoteOwner,
  results: ScannedNote[]
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(ownerDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.startsWith(".")) {
      continue;
    }
    const absPath = path.join(ownerDir, entry.name);
    const relMdPath = path.join("notes", ownerRelDir(owner), entry.name);
    const mtimeMs = await fileMtimeMs(absPath);
    results.push({
      absPath,
      relMdPath,
      filename: entry.name,
      mtimeMs,
      owner
    });
  }
}

async function readOwnerOrInfer(
  ownerDir: string,
  hint:
    | { kind: "project"; dirName: string }
    | { kind: "session"; provider: string; dirName: string }
): Promise<NoteOwner | undefined> {
  try {
    const raw = await fs.readFile(path.join(ownerDir, ".owner.json"), "utf8");
    const parsed = parseOwnerJson(JSON.parse(raw));
    if (parsed) {
      return parsed;
    }
  } catch {
    // fall through
  }

  if (hint.kind === "project") {
    return undefined;
  }

  try {
    const sessionId = Buffer.from(hint.dirName, "base64url").toString("utf8");
    if (!sessionId) {
      return undefined;
    }
    return {
      scope: "session",
      provider: hint.provider as AgentProvider,
      sessionId
    };
  } catch {
    return undefined;
  }
}