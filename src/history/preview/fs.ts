import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isNodeError } from "../jsonl";

export async function listJsonlFiles(root: string): Promise<string[]> {
  const output: string[] = [];

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
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        output.push(fullPath);
      }
    }
  }

  await visit(root);
  return output;
}

export async function findFilesByName(
  root: string,
  fileName: string,
  maxDepth = 8
): Promise<string[]> {
  const output: string[] = [];

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
      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name === fileName) {
        output.push(fullPath);
      }
    }
  }

  await visit(root, 0);
  return output;
}