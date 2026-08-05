import { desktopApi } from "../../bridge";

export type LaunchSessionRequest = {
  requestId: string;
  channel: "cli" | "acp";
  provider: string;
  cwd: string;
  title?: string;
  noteId: string;
  initialPrompt: string;
  executionMode: "note-yolo";
  /** Flow identity allows Workbench to persist a late catalog match even after the launch waiter expires. */
  flowId?: string;
  flowNodeId?: string;
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
  noteId?: string;
  knownKeys?: Set<string>;
  notBeforeMs?: number;
}): Promise<{ catalogProvider: string; sessionId: string } | null> {
  const api = desktopApi();
  if (typeof api.listSessions !== "function") return null;
  let list: Array<{ provider: string; id: string; title: string; projectPath: string; updatedAt: number }> = [];
  try {
    list = await api.listSessions();
  } catch {
    return null;
  }
  const cwdKey = projectPathKey(args.cwd);
  const known = args.knownKeys || new Set<string>();
  const notBefore = args.notBeforeMs ?? Date.now() - 120_000;
  const providerWanted = args.provider?.trim().toLowerCase();
  const noteId = args.noteId?.trim();

  const candidates = list
    .filter((session) => {
      if (session.provider === "chat") return false;
      const key = sessionKeyOf(session.provider, session.id);
      // The Flow prompt contains the Note ID in the catalog title. This lets us
      // recover a session that was indexed before the waiter started or after
      // a delayed sync, without binding an unrelated old session.
      const noteMatch = Boolean(noteId && session.title?.includes(noteId));
      if (known.has(key) && !noteMatch) return false;
      if (projectPathKey(session.projectPath) !== cwdKey && !noteMatch) return false;
      if (session.updatedAt < notBefore && !noteMatch) return false;
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
  noteId?: string;
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
      noteId: args.noteId,
      knownKeys: args.knownKeys,
      notBeforeMs: args.notBeforeMs
    });
    if (found) return found;
  }
  // One last attempt without delay.
  return findRecentCatalogSession({
    cwd: args.cwd,
    provider: args.provider,
    noteId: args.noteId,
    knownKeys: args.knownKeys,
    notBeforeMs: args.notBeforeMs
  });
}

export function requestWorkbenchSessionLaunch(
  request: Omit<LaunchSessionRequest, "requestId">,
  timeoutMs = 150_000
): Promise<LaunchSessionResult> {
  const requestId = `flow-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

