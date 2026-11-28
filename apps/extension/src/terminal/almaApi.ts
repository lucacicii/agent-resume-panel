import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_ALMA_API_URL = "http://localhost:23001";

export function getAlmaApiUrl(): string {
  return process.env.ALMA_API_URL?.trim() || DEFAULT_ALMA_API_URL;
}

async function requestAlmaJson<T>(
  route: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const response = await fetch(`${getAlmaApiUrl()}${route}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? 5000)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Alma API HTTP ${response.status}${text ? `: ${text}` : ""}`);
  }

  return (await response.json()) as T;
}

export async function isAlmaApiRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${getAlmaApiUrl()}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(2500)
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForAlmaApi(timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isAlmaApiRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

export async function openAlmaThreadRef(threadId: string): Promise<void> {
  const result = await requestAlmaJson<{ ok?: boolean }>("/api/refs/open", {
    method: "POST",
    body: { uri: `alma://thread/${threadId}` }
  });
  if (result.ok === false) {
    throw new Error(`Alma failed to open thread ${threadId}.`);
  }
}

interface AlmaWorkspaceRecord {
  id: string;
  name?: string;
  path?: string;
  isTemporary?: boolean;
}

function normalizeDir(dir: string): string {
  const trimmed = dir.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return fs.realpathSync(trimmed);
  } catch {
    return path.resolve(trimmed);
  }
}

export async function ensureAlmaWorkspaceId(projectPath: string, name: string): Promise<string | undefined> {
  const normalizedTarget = normalizeDir(projectPath);
  if (!normalizedTarget) {
    return undefined;
  }

  const workspaces = await requestAlmaJson<AlmaWorkspaceRecord[]>("/api/workspaces");
  if (Array.isArray(workspaces)) {
    const existing = workspaces.find(
      (ws) => !ws.isTemporary && typeof ws.path === "string" && normalizeDir(ws.path) === normalizedTarget
    );
    if (existing?.id) {
      return existing.id;
    }
  }

  const created = await requestAlmaJson<AlmaWorkspaceRecord>("/api/workspaces", {
    method: "POST",
    body: {
      name: name.trim() || path.basename(normalizedTarget) || "Project",
      path: normalizedTarget
    }
  });
  return created?.id;
}

export async function createAlmaThread(title: string, workspaceId?: string): Promise<{ id: string; title?: string }> {
  const body: { title: string; workspaceId?: string } = {
    title: title.trim() || "New Thread"
  };
  if (workspaceId) {
    body.workspaceId = workspaceId;
  }
  return requestAlmaJson<{ id: string; title?: string }>("/api/threads", {
    method: "POST",
    body
  });
}

export async function sendAlmaThreadMessage(threadId: string, text: string): Promise<void> {
  await requestAlmaJson<unknown>(`/api/threads/${encodeURIComponent(threadId)}/send`, {
    method: "POST",
    body: { text },
    timeoutMs: 10_000
  });
}

export async function renameAlmaThreadViaApi(threadId: string, title: string): Promise<void> {
  await requestAlmaJson<unknown>(`/api/threads/${encodeURIComponent(threadId)}`, {
    method: "PUT",
    body: { title, skipUpdatedAt: true }
  });
}
