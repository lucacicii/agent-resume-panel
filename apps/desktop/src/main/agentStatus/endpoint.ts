/**
 * Endpoint, socket, and state file IO for the agent-status daemon.
 *
 * Everything written here is `0600` inside a `0700` directory: the payload is
 * pane metadata, never transcripts or credentials, but the discovery handle is
 * still restricted to the owning user.
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { AgentStatusPaths } from "./paths";

export type AgentStatusEndpoint = {
  apiVersion: number;
  appVersion: string;
  pid: number;
  socketPath: string;
  startedAt: number;
  updatedAt: number;
};

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export async function ensureAgentStatusDir(paths: AgentStatusPaths): Promise<void> {
  await mkdir(paths.dir, { recursive: true, mode: DIR_MODE });
  // mkdir ignores mode on an existing directory, and umask can shave it off a
  // fresh one — assert it either way.
  await chmod(paths.dir, DIR_MODE);
}

async function writeFileAtomic(target: string, data: string): Promise<void> {
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, data, { encoding: "utf8", mode: FILE_MODE });
  await rename(temporary, target);
  await chmod(target, FILE_MODE);
}

export async function writeEndpointFile(
  paths: AgentStatusPaths,
  endpoint: AgentStatusEndpoint
): Promise<void> {
  await ensureAgentStatusDir(paths);
  await writeFileAtomic(paths.endpoint, `${JSON.stringify(endpoint, null, 2)}\n`);
}

/** Read the endpoint file. Returns null for a missing or malformed handle. */
export async function readEndpointFile(
  paths: AgentStatusPaths
): Promise<AgentStatusEndpoint | null> {
  let raw: string;
  try {
    raw = await readFile(paths.endpoint, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AgentStatusEndpoint>;
    if (
      typeof parsed?.apiVersion !== "number"
      || typeof parsed?.pid !== "number"
      || typeof parsed?.socketPath !== "string"
    ) {
      return null;
    }
    return {
      apiVersion: parsed.apiVersion,
      appVersion: typeof parsed.appVersion === "string" ? parsed.appVersion : "unknown",
      pid: parsed.pid,
      socketPath: parsed.socketPath,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0
    };
  } catch {
    return null;
  }
}

export async function readStateFile(paths: AgentStatusPaths): Promise<unknown | null> {
  try {
    const raw = await readFile(paths.state, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function writeStateFile(paths: AgentStatusPaths, payload: unknown): Promise<void> {
  await ensureAgentStatusDir(paths);
  await writeFileAtomic(paths.state, `${JSON.stringify(payload, null, 2)}\n`);
}

export async function removeFile(target: string): Promise<void> {
  try {
    await rm(target, { force: true });
  } catch {
    // Removing a discovery handle must never fail a shutdown.
  }
}

/** The pid is alive when signal 0 succeeds (or fails with EPERM). */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

/**
 * An endpoint is live when its process still exists *and* the socket file is
 * still on disk. A pid can be recycled, so the socket is the real evidence.
 */
export async function readLiveEndpoint(
  paths: AgentStatusPaths
): Promise<AgentStatusEndpoint | null> {
  const endpoint = await readEndpointFile(paths);
  if (!endpoint) return null;
  if (!isProcessAlive(endpoint.pid)) return null;
  return endpoint;
}
