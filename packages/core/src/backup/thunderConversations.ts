import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Thunder keeps its chat history outside the panel home:
 * `~/.thunder/conversations/index.json` plus `<sessionId>/conversation.json`.
 * Per-session `traces/` hold runtime traces (tool logs, spans) that are large and
 * not needed to restore a conversation, so they are never collected.
 *
 * The source store is never modified; callers copy the returned files into the
 * backup payload and record them in the manifest.
 */
export interface ThunderConversationFile {
  absolute: string;
  /** Portable path inside the artifact root (`index.json`, `sessions/<id>/conversation.json`). */
  relative: string;
  size: number;
  mtimeMs: number;
}

export interface ThunderConversationCollection {
  files: ThunderConversationFile[];
  /** Bytes of the files that were considered (not counting traces/config). */
  sourceBytes: number;
  warnings: string[];
}

export interface CollectThunderConversationsOptions {
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024;

/** `~/.thunder/conversations`; the only Thunder data this app backs up. */
export function defaultThunderConversationsDir(home = os.homedir()): string {
  return path.join(home, ".thunder", "conversations");
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * List the conversation files worth backing up.
 *
 * Only `index.json` and per-session `conversation.json` are collected. Anything
 * else in the store (traces, attachments written by other tools, partial files)
 * is left alone. A conversation whose JSON exceeds the per-file limit is skipped
 * with a warning instead of failing the whole Thunder artifact, matching the
 * per-provider fail-soft behaviour of the other native collectors.
 */
export async function collectThunderConversationFiles(
  conversationsDir: string,
  options: CollectThunderConversationsOptions = {}
): Promise<ThunderConversationCollection> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const warnings: string[] = [];
  let rows: import("node:fs").Dirent[];
  try {
    rows = await fs.readdir(conversationsDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { files: [], sourceBytes: 0, warnings };
    }
    throw error;
  }

  const files: ThunderConversationFile[] = [];
  let sourceBytes = 0;

  const consider = async (absolute: string, relative: string, label: string): Promise<void> => {
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.lstat(absolute);
    } catch {
      return;
    }
    // Symlinks could point outside the store; refuse them outright.
    if (!stat.isFile()) return;
    if (stat.size > maxFileBytes) {
      warnings.push(`Skipped Thunder conversation ${label}: ${formatBytes(stat.size)} exceeds the ${formatBytes(maxFileBytes)} per-file limit.`);
      return;
    }
    sourceBytes += stat.size;
    files.push({ absolute, relative, size: stat.size, mtimeMs: stat.mtimeMs });
  };

  for (const row of rows) {
    if (row.isSymbolicLink()) continue;
    if (row.isFile() && row.name === "index.json") {
      await consider(path.join(conversationsDir, row.name), "index.json", "index");
      continue;
    }
    if (!row.isDirectory()) continue;
    // A session directory is a plain id; skip anything that could escape the root.
    if (!row.name || row.name === "." || row.name === ".." || row.name.includes(path.sep)) continue;
    await consider(
      path.join(conversationsDir, row.name, "conversation.json"),
      `sessions/${row.name}/conversation.json`,
      row.name
    );
  }

  return { files, sourceBytes, warnings };
}
