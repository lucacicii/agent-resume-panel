import type { AgentProvider } from "@agent-resume/core";
import { desktopApi } from "../../bridge";

export type ExecutableRunSnapshot = {
  runStatus?: string;
  runId?: string;
  childCount: number;
  currentChildIndex: number;
  currentChildNoteId?: string;
  currentChildStatus?: string;
  currentSessionProvider?: string;
  currentSessionNative?: string;
  canApprove: boolean;
  canStartStep: boolean;
  canSettle: boolean;
};

export type SessionBlockLike = {
  provider: string;
  status: string;
  native?: string;
  text: string;
};

export type NoteChildLike = {
  index: number;
  noteId?: string;
  status: string;
  text: string;
};

export type RunBlockLike = {
  status: string;
  text: string;
};

export function snapshotFromParsed(input: {
  runs: RunBlockLike[];
  noteChildren: NoteChildLike[];
  /** Optional preloaded session for the current child. */
  currentSession?: SessionBlockLike | null;
  runId?: string;
}): ExecutableRunSnapshot {
  const run = input.runs[0];
  const children = input.noteChildren;
  const runningIndex = children.findIndex((c) => c.status === "running");
  const currentChildIndex =
    runningIndex >= 0
      ? runningIndex
      : children.findIndex((c) => c.status === "planned" || c.status === "idle");
  const current = currentChildIndex >= 0 ? children[currentChildIndex] : undefined;
  const canApprove = Boolean(run && (run.status === "awaiting_approval" || run.status === "draft"));
  const canStartStep = Boolean(
    run?.status === "executing" &&
      current?.noteId &&
      (current.status === "running" || current.status === "planned") &&
      !input.currentSession?.native
  );
  // While run is executing, allow settle (Desktop may target nested leaf via execLeaf).
  const canSettle = Boolean(run?.status === "executing" && current?.noteId);
  return {
    runStatus: run?.status,
    runId: input.runId,
    childCount: children.length,
    currentChildIndex: currentChildIndex >= 0 ? currentChildIndex : 0,
    currentChildNoteId: current?.noteId,
    currentChildStatus: current?.status,
    currentSessionProvider: input.currentSession?.provider,
    currentSessionNative: input.currentSession?.native,
    canApprove,
    canStartStep,
    canSettle
  };
}

export function buildStepPrompt(input: {
  parentTitle: string;
  childTitle: string;
  childBody: string;
  sessionText?: string;
}): string {
  const sessionText = input.sessionText?.trim();
  if (sessionText) return sessionText;
  const body = input.childBody
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^#\s+.+\n+/, "")
    .replace(/:::session[\s\S]*?:::/g, "")
    .trim();
  const parts = [
    `You are executing a step from note "${input.parentTitle}".`,
    `## Task: ${input.childTitle}`,
    body ? body : undefined,
    "Follow repository instructions (AGENTS.md). Do not modify Java code."
  ].filter(Boolean);
  return parts.join("\n\n");
}

export type LaunchSessionRequest = {
  requestId: string;
  channel: "cli" | "acp";
  provider: string;
  cwd: string;
  title?: string;
  initialPrompt?: string;
};

export type LaunchSessionResult = {
  requestId: string;
  ok: boolean;
  error?: string;
  /** Catalog provider used for resume/bind. */
  catalogProvider?: string;
  sessionId?: string;
};

const LAUNCH_EVENT = "agent-resume:workbench-launch-session";
const LAUNCH_RESULT_EVENT = "agent-resume:workbench-session-launched";

function projectPathKey(value = ""): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "");
}

function sessionKeyOf(provider: string, id: string): string {
  return `${provider}:${id}`;
}

/** Find a newly appeared catalog session for bind (CLI only). */
export async function findRecentCatalogSession(args: {
  cwd: string;
  provider?: string;
  knownKeys?: Set<string>;
  notBeforeMs?: number;
}): Promise<{ catalogProvider: string; sessionId: string } | null> {
  const api = desktopApi();
  if (typeof api.listSessions !== "function") return null;
  let list: Array<{ provider: string; id: string; projectPath: string; updatedAt: number }> = [];
  try {
    list = await api.listSessions();
  } catch {
    return null;
  }
  const cwdKey = projectPathKey(args.cwd);
  const known = args.knownKeys || new Set<string>();
  const notBefore = args.notBeforeMs ?? Date.now() - 120_000;
  const providerWanted = args.provider?.trim().toLowerCase();

  const candidates = list
    .filter((session) => {
      if (session.provider === "chat") return false;
      const key = sessionKeyOf(session.provider, session.id);
      if (known.has(key)) return false;
      if (projectPathKey(session.projectPath) !== cwdKey) return false;
      if (session.updatedAt < notBefore) return false;
      return true;
    })
    .sort((a, b) => {
      const aMatch = providerWanted && a.provider.toLowerCase() === providerWanted ? 0 : 1;
      const bMatch = providerWanted && b.provider.toLowerCase() === providerWanted ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return b.updatedAt - a.updatedAt;
    });

  const hit = candidates[0];
  if (!hit) return null;
  return { catalogProvider: hit.provider, sessionId: hit.id };
}

export async function waitForCatalogSession(args: {
  cwd: string;
  provider?: string;
  knownKeys?: Set<string>;
  notBeforeMs?: number;
  timeoutMs?: number;
  pollMs?: number[];
}): Promise<{ catalogProvider: string; sessionId: string } | null> {
  const polls = args.pollMs || [500, 1_000, 2_000, 3_000, 5_000, 8_000, 12_000, 20_000, 30_000];
  const deadline = Date.now() + (args.timeoutMs ?? 90_000);
  for (const delay of polls) {
    if (Date.now() > deadline) break;
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    const found = await findRecentCatalogSession({
      cwd: args.cwd,
      provider: args.provider,
      knownKeys: args.knownKeys,
      notBeforeMs: args.notBeforeMs
    });
    if (found) return found;
  }
  // One last attempt without delay.
  return findRecentCatalogSession({
    cwd: args.cwd,
    provider: args.provider,
    knownKeys: args.knownKeys,
    notBeforeMs: args.notBeforeMs
  });
}

export function requestWorkbenchSessionLaunch(
  request: Omit<LaunchSessionRequest, "requestId">,
  timeoutMs = 150_000
): Promise<LaunchSessionResult> {
  const requestId = `notes-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: LaunchSessionResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener(LAUNCH_RESULT_EVENT, onResult as EventListener);
      resolve(result);
    };
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<LaunchSessionResult>).detail;
      if (!detail || detail.requestId !== requestId) return;
      finish(detail);
    };
    const timer = window.setTimeout(() => {
      finish({
        requestId,
        ok: false,
        error: "Timed out waiting for Workbench session launch."
      });
    }, timeoutMs);
    window.addEventListener(LAUNCH_RESULT_EVENT, onResult as EventListener);
    // Switch tab first so Workbench is active, then launch on next frame.
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent(LAUNCH_EVENT, {
          detail: { ...request, requestId } satisfies LaunchSessionRequest
        })
      );
      // Re-dispatch once more shortly after, in case the first frame listener was mid-remount.
      window.setTimeout(() => {
        if (settled) return;
        window.dispatchEvent(
          new CustomEvent(LAUNCH_EVENT, {
            detail: { ...request, requestId } satisfies LaunchSessionRequest
          })
        );
      }, 250);
    });
  });
}

export function emitWorkbenchSessionLaunched(result: LaunchSessionResult): void {
  window.dispatchEvent(new CustomEvent(LAUNCH_RESULT_EVENT, { detail: result }));
}

export function onWorkbenchLaunchSession(
  handler: (request: LaunchSessionRequest) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<LaunchSessionRequest>).detail;
    if (detail?.requestId) handler(detail);
  };
  window.addEventListener(LAUNCH_EVENT, listener as EventListener);
  return () => window.removeEventListener(LAUNCH_EVENT, listener as EventListener);
}

export type ExecutablePathNode = { noteId: string; title: string; composite: boolean };

/** Spawn + bind a leaf step (CLI Workbench session). */
export async function startExecutableCurrentStep(args: {
  parentNoteId: string;
  parentTitle: string;
  childNoteId: string;
  runId?: string;
  projectPath: string;
}): Promise<{ catalogProvider: string; sessionId: string; content: string }> {
  const api = desktopApi();
  const parsed = await api.notesExecutableParse({ noteId: args.childNoteId });
  const session = (parsed.sessions[0] || null) as SessionBlockLike | null;
  const provider = (session?.provider || "codex").trim() || "codex";
  const childRead = await api.notesRead({ noteId: args.childNoteId });
  const childTitle =
    childRead.record.title || childRead.record.filename.replace(/\.md$/i, "") || args.childNoteId;
  const prompt = buildStepPrompt({
    parentTitle: args.parentTitle,
    childTitle,
    childBody: childRead.content,
    sessionText: session?.text
  });
  const cwd = args.projectPath.trim();
  if (!cwd) {
    throw new Error("Project path is required to start a session.");
  }

  // Snapshot known sessions so we can detect the new CLI session even if Workbench
  // opened the terminal but catalog matching was slow/strict.
  const knownKeys = new Set<string>();
  const startedAt = Date.now();
  try {
    for (const item of await api.listSessions()) {
      knownKeys.add(sessionKeyOf(item.provider, item.id));
    }
  } catch {
    // Optional snapshot.
  }

  // Executable note runs always use CLI Workbench sessions (no ACP).
  const launched = await requestWorkbenchSessionLaunch({
    channel: "cli",
    provider,
    cwd,
    title: childTitle,
    initialPrompt: prompt
  });

  let catalogProvider = launched.catalogProvider;
  let sessionId = launched.sessionId;

  if (!launched.ok || !sessionId || !catalogProvider) {
    // Fallback: terminal may already be running; bind the newest matching catalog session.
    const found = await waitForCatalogSession({
      cwd,
      provider,
      knownKeys,
      notBeforeMs: startedAt - 30_000,
      timeoutMs: 60_000
    });
    if (!found) {
      throw new Error(
        launched.error ||
          "Workbench terminal may be open, but no catalog session was found to bind. Wait for session sync, then click Start session."
      );
    }
    catalogProvider = found.catalogProvider;
    sessionId = found.sessionId;
  }

  const bound = await api.notesExecutableBindSession({
    noteId: args.childNoteId,
    provider: catalogProvider as AgentProvider | string as string,
    agentSessionId: sessionId,
    runId: args.runId,
    status: "running"
  });

  return { catalogProvider, sessionId, content: bound.content };
}

/**
 * Dive nested composite runs to a leaf, then open CLI for that leaf.
 * `startNoteId` is any note that currently holds (or will hold) an executing run.
 */
export async function startExecutableLeafFromNote(args: {
  startNoteId: string;
  rootTitle: string;
  projectPath: string;
  defaultProvider?: string;
}): Promise<{
  path: ExecutablePathNode[];
  leafNoteId: string;
  leafParentNoteId: string;
  runIdsByNoteId: Record<string, string>;
  started: { catalogProvider: string; sessionId: string };
}> {
  const api = desktopApi();
  if (typeof api.notesExecutableResolveLeaf !== "function") {
    throw new Error("Nested executable runs require a rebuilt Desktop (notesExecutableResolveLeaf missing).");
  }
  const leaf = await api.notesExecutableResolveLeaf({
    noteId: args.startNoteId,
    defaultProvider: args.defaultProvider
  });
  const parentRunId = leaf.runIdsByNoteId[leaf.leafParentNoteId];
  const started = await startExecutableCurrentStep({
    parentNoteId: leaf.leafParentNoteId,
    parentTitle: args.rootTitle,
    childNoteId: leaf.leafNoteId,
    runId: parentRunId,
    projectPath: args.projectPath
  });
  return {
    path: leaf.path,
    leafNoteId: leaf.leafNoteId,
    leafParentNoteId: leaf.leafParentNoteId,
    runIdsByNoteId: leaf.runIdsByNoteId,
    started: { catalogProvider: started.catalogProvider, sessionId: started.sessionId }
  };
}

export async function approveExecutableRunAndStart(args: {
  parentNoteId: string;
  parentTitle: string;
  projectPath: string;
  defaultProvider?: string;
}): Promise<{
  runId: string;
  parentContent: string;
  childNoteIds: string[];
  path: ExecutablePathNode[];
  leafNoteId?: string;
  leafParentNoteId?: string;
  started?: { catalogProvider: string; sessionId: string };
}> {
  const api = desktopApi();
  const approved = await api.notesExecutableApproveRun({
    noteId: args.parentNoteId,
    defaultProvider: args.defaultProvider
  });
  if (!approved.childNoteIds.length) {
    return {
      runId: approved.runId,
      parentContent: approved.content,
      childNoteIds: approved.childNoteIds,
      path: []
    };
  }

  const leafStart = await startExecutableLeafFromNote({
    startNoteId: args.parentNoteId,
    rootTitle: args.parentTitle,
    projectPath: args.projectPath,
    defaultProvider: args.defaultProvider
  });

  return {
    runId: approved.runId,
    parentContent: approved.content,
    childNoteIds: approved.childNoteIds,
    path: leafStart.path,
    leafNoteId: leafStart.leafNoteId,
    leafParentNoteId: leafStart.leafParentNoteId,
    started: leafStart.started
  };
}
