import type { ThunderActiveStreamSnapshot } from "@agent-resume/core";
import type { ThunderObservedEvent } from "./thunderProtocol";

/**
 * In-flight Thunder task buffers, keyed by session id.
 *
 * The renderer that started a task can unmount (board view switch, window
 * reload) while the daemon keeps streaming. The renderer-local buffer dies with
 * it, and the daemon only persists the assistant message at task end, so a
 * remount would resume "from the next increment". Buffering here — where the
 * observed events already flow through — lets any renderer re-read the full
 * state and continue seamlessly.
 */
const activeStreams = new Map<string, ThunderActiveStreamSnapshot>();

export function createActiveStreamSnapshot(args: {
  sessionId: string;
  taskId: string;
  prompt?: string;
  model?: string;
  workspaceDir?: string;
  startedAtMs?: number;
}): ThunderActiveStreamSnapshot {
  const snapshot: ThunderActiveStreamSnapshot = {
    sessionId: args.sessionId,
    taskId: args.taskId,
    prompt: args.prompt,
    model: args.model,
    workspaceDir: args.workspaceDir,
    startedAtMs: args.startedAtMs ?? Date.now(),
    isRunning: true,
    streamingText: "",
    streamingReasoning: "",
    streamingTools: [],
    events: []
  };
  activeStreams.set(args.sessionId, snapshot);
  return snapshot;
}

/** Fold one observed event into the snapshot (mirrors the renderer's accumulation). */
export function accumulateStreamEvent(
  snapshot: ThunderActiveStreamSnapshot,
  observed: ThunderObservedEvent
): void {
  const ev = observed?.event;
  if (!ev) return;

  switch (ev.type) {
    case "token_delta":
      snapshot.streamingText += ((ev as { delta?: string }).delta) || "";
      break;
    case "reasoning_delta":
      snapshot.streamingReasoning += ((ev as { delta?: string }).delta) || "";
      break;
    case "tool_exec_start": {
      const e = ev as { tool_call_id?: string; name?: string; arguments?: Record<string, unknown> };
      const toolCallId = e.tool_call_id || `tool_${snapshot.events.length}`;
      const name = e.name || "tool";
      const args = e.arguments || {};
      const existing = snapshot.streamingTools.find((t) => t.toolCallId === toolCallId);
      if (existing) {
        existing.name = name;
        existing.arguments = args;
        existing.isRunning = true;
      } else {
        snapshot.streamingTools.push({
          toolCallId,
          name,
          arguments: args,
          isRunning: true
        });
      }
      break;
    }
    case "tool_exec_result": {
      const e = ev as {
        tool_call_id?: string;
        result?: { output?: unknown; is_error?: boolean };
      };
      const toolCallId = e.tool_call_id;
      const result = e.result;
      snapshot.streamingTools = snapshot.streamingTools.map((tool) =>
        tool.toolCallId === toolCallId
          ? {
              ...tool,
              isRunning: false,
              result: result?.output,
              isError: Boolean(result?.is_error)
            }
          : tool
      );
      break;
    }
  }

  snapshot.events.push(observed as unknown as ThunderActiveStreamSnapshot["events"][number]);
}

/** Mark a buffered task finished and drop it. */
export function finishActiveStream(sessionId: string, taskId?: string): void {
  const snapshot = activeStreams.get(sessionId);
  if (!snapshot) return;
  if (taskId && snapshot.taskId !== taskId) return;
  snapshot.isRunning = false;
  activeStreams.delete(sessionId);
}

export function getActiveStream(sessionId: string): ThunderActiveStreamSnapshot | null {
  return activeStreams.get(sessionId) ?? null;
}

/** Test helper — clears every buffered stream. */
export function resetActiveStreams(): void {
  activeStreams.clear();
}
