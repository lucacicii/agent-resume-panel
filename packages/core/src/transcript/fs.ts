import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isNodeError } from "./jsonl";

/**
 * Classify a directory entry, following links.
 *
 * `Dirent.isDirectory()` is false for symlinks and NTFS junctions, and both are
 * common for agent homes on Windows (and for iCloud/OneDrive "online" folders).
 * `stat` follows them; a dangling link is simply skipped.
 */
async function entryKind(
  entry: import("node:fs").Dirent,
  fullPath: string
): Promise<"directory" | "file" | "other"> {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (!entry.isSymbolicLink()) return "other";
  try {
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) return "directory";
    if (stat.isFile()) return "file";
  } catch {
    // Dangling link (or a junction whose target is offline).
  }
  return "other";
}

/**
 * Visit each directory once by canonical path.
 *
 * Following links without this guard would loop forever on a cyclic junction.
 */
async function visitDirectory(
  dir: string,
  visited: Set<string>,
  visit: (directory: string) => Promise<void>
): Promise<void> {
  let canonical = dir;
  try {
    canonical = await fs.realpath(dir);
  } catch {
    // Keep the lexical path; readdir below will report the real error.
  }
  if (visited.has(canonical)) return;
  visited.add(canonical);
  await visit(dir);
}

export async function listJsonlFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  const visited = new Set<string>();

  async function visit(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const kind = await entryKind(entry, fullPath);
      if (kind === "directory") {
        await visitDirectory(fullPath, visited, visit);
      } else if (kind === "file" && entry.name.endsWith(".jsonl")) {
        output.push(fullPath);
      }
    }
  }

  await visitDirectory(root, visited, visit);
  return output;
}

export async function findFilesByName(
  root: string,
  fileName: string,
  maxDepth = 8
): Promise<string[]> {
  const output: string[] = [];
  const visited = new Set<string>();

  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const kind = await entryKind(entry, fullPath);
      if (kind === "directory") {
        await visitDirectory(fullPath, visited, (next) => visit(next, depth + 1));
      } else if (kind === "file" && entry.name === fileName) {
        output.push(fullPath);
      }
    }
  }

  await visitDirectory(root, visited, (dir) => visit(dir, 0));
  return output;
}
