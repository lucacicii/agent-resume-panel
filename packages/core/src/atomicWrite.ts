/**
 * Atomic file replacement.
 *
 * `rename` over an existing file is atomic on POSIX. On Windows it maps to
 * `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` and intermittently fails with
 * `EPERM`/`EACCES`/`EBUSY` while an indexer, antivirus scanner, or another
 * handle is looking at the destination. A single attempt therefore turns a
 * perfectly ordinary settings save into a lost write.
 *
 * The helper keeps the temp file next to the target (same volume, so the
 * rename never becomes `EXDEV`), retries the rename with a short backoff, and
 * removes the temp file whatever happens.
 */

import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import * as path from "node:path";

const RETRY_DELAYS_MS = [10, 25, 50, 100, 200, 400];
const TRANSIENT_CODES = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);

function isTransient(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && TRANSIENT_CODES.has(code);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!isTransient(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      await delay(RETRY_DELAYS_MS[attempt]!);
    }
  }
}

export type AtomicWriteOptions = {
  /** File mode for the final file. Ignored where mode bits are meaningless (Windows). */
  mode?: number;
  /** fsync the file and the directory before renaming. Default true. */
  fsync?: boolean;
};

/**
 * Write `data` to `target` so readers only ever see the old or the new content.
 *
 * `target`'s directory must already exist.
 */
export async function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const dir = path.dirname(target);
  const base = path.basename(target);
  const temporary = path.join(dir, `.${base}.${process.pid}.${Date.now().toString(36)}.tmp`);
  const mode = options.mode ?? 0o600;
  const fsync = options.fsync !== false;

  const handle = await open(temporary, "w", mode);
  try {
    await handle.writeFile(data);
    if (fsync) await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await renameWithRetry(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }

  if (fsync) {
    // Persist the directory entry too; not supported on every platform (and
    // Windows rejects opening a directory), so a failure is not an error.
    try {
      const dirHandle = await open(dir, "r");
      try {
        await dirHandle.sync();
      } finally {
        await dirHandle.close();
      }
    } catch {
      // best effort
    }
  }
}

/**
 * Rename a file or directory, retrying transient Windows sharing violations.
 *
 * Directories are included because moving a tree over a just-created target is
 * a common migration step, and `MoveFileEx` fails while an indexer holds a
 * handle inside it.
 */
export async function renamePathWithRetry(from: string, to: string): Promise<void> {
  await renameWithRetry(from, to);
}

/**
 * Remove a directory tree, retrying transient Windows sharing violations.
 *
 * Used for lock directories and temp trees: on Windows a process that has a
 * handle open inside the tree makes `rm` fail where POSIX would succeed.
 */
export async function removeDirectoryWithRetry(target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isTransient(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      await delay(RETRY_DELAYS_MS[attempt]!);
    }
  }
}

function sleepSync(ms: number): void {
  // Only reached on a transient rename failure, so a blocking sleep is fine and
  // keeps the sync variant usable from synchronous callers.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameSyncWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (!isTransient(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      sleepSync(RETRY_DELAYS_MS[attempt]!);
    }
  }
}

/**
 * Synchronous `atomicWriteFile`.
 *
 * Exists for callers that already are synchronous (a replace-in-files loop over
 * a directory, for example). Same contract: the temp file sits next to the
 * target, the write is flushed, and the rename is retried.
 */
export function atomicWriteFileSync(
  target: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {}
): void {
  const dir = path.dirname(target);
  const base = path.basename(target);
  const temporary = path.join(dir, `.${base}.${process.pid}.${Date.now().toString(36)}.tmp`);
  const mode = options.mode ?? 0o600;
  const fsync = options.fsync !== false;

  const fd = openSync(temporary, "w", mode);
  try {
    writeFileSync(fd, data);
    if (fsync) fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  try {
    renameSyncWithRetry(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** True when `target` exists and is a directory. */
export async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}
