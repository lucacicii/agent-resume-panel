import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildNoteDocument, NoteFrontmatter } from "./frontmatter";
import { noteAssetsDirName } from "./naming";
import { NoteOwner, ownerAbsDir, ownerJsonPath, serializeOwner } from "./paths";

export async function ensureOwnerDir(panelHome: string, owner: NoteOwner): Promise<string> {
  const dir = ownerAbsDir(panelHome, owner);
  await fs.mkdir(dir, { recursive: true });
  const metaPath = ownerJsonPath(dir);
  try {
    await fs.access(metaPath);
  } catch {
    await fs.writeFile(metaPath, `${JSON.stringify(serializeOwner(owner), null, 2)}\n`, "utf8");
  }
  return dir;
}

export async function listMarkdownFilenames(ownerDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(ownerDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function writeNewNoteFile(options: {
  panelHome: string;
  owner: NoteOwner;
  filename: string;
  noteId: string;
  body?: string;
  createdAtMs?: number;
}): Promise<{ absPath: string; noteId: string }> {
  const { panelHome, owner, filename, noteId } = options;
  const ownerDir = await ensureOwnerDir(panelHome, owner);
  const absPath = path.join(ownerDir, filename);
  const createdAtMs = options.createdAtMs ?? Date.now();
  const fm: NoteFrontmatter = {
    id: noteId,
    scope: owner.scope,
    createdAt: new Date(createdAtMs).toISOString()
  };
  if (owner.scope === "project") {
    fm.projectPath = owner.projectPath;
  } else {
    fm.provider = owner.provider;
    fm.sessionId = owner.sessionId;
    if (owner.projectPath) {
      fm.projectPath = owner.projectPath;
    }
  }
  const content = buildNoteDocument(fm, options.body ?? "");
  await fs.writeFile(absPath, content, "utf8");
  return { absPath, noteId };
}

export async function readNoteFile(absPath: string): Promise<string> {
  return fs.readFile(absPath, "utf8");
}

export async function deleteNoteFiles(ownerDir: string, filename: string): Promise<void> {
  const mdPath = path.join(ownerDir, filename);
  const assetsPath = path.join(ownerDir, noteAssetsDirName(filename));
  await fs.rm(mdPath, { force: true });
  await fs.rm(assetsPath, { recursive: true, force: true });
}

export async function renameNoteFiles(
  ownerDir: string,
  oldFilename: string,
  newFilename: string,
  rewriteContent: (raw: string) => string
): Promise<{ absPath: string }> {
  const oldMd = path.join(ownerDir, oldFilename);
  const newMd = path.join(ownerDir, newFilename);
  if (oldMd === newMd) {
    return { absPath: newMd };
  }

  if (await pathExists(newMd)) {
    throw new Error(`Note file already exists: ${newFilename}`);
  }

  const raw = await fs.readFile(oldMd, "utf8");
  const next = rewriteContent(raw);
  await fs.writeFile(newMd, next, "utf8");
  await fs.rm(oldMd, { force: true });

  const oldAssets = path.join(ownerDir, noteAssetsDirName(oldFilename));
  const newAssets = path.join(ownerDir, noteAssetsDirName(newFilename));
  if (oldAssets !== newAssets && (await pathExists(oldAssets))) {
    if (await pathExists(newAssets)) {
      throw new Error(`Assets folder already exists: ${noteAssetsDirName(newFilename)}`);
    }
    await fs.rename(oldAssets, newAssets);
  }

  return { absPath: newMd };
}

export async function ensureAssetsDir(ownerDir: string, filename: string): Promise<string> {
  const assetsDir = path.join(ownerDir, noteAssetsDirName(filename));
  await fs.mkdir(assetsDir, { recursive: true });
  return assetsDir;
}

export function newNoteId(): string {
  return randomUUID();
}

export async function pathExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function fileMtimeMs(absPath: string): Promise<number> {
  const stat = await fs.stat(absPath);
  return Math.floor(stat.mtimeMs);
}