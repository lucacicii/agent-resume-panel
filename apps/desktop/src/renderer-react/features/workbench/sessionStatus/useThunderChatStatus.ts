/**
 * Thunder chat status.
 *
 * Thunder runs report what they are doing themselves, through the
 * execution-status plugin's `agent_status` custom event — a phase, the tool it
 * is running, and the turn. This hook turns that into the same dot vocabulary
 * the daemon's verdicts use, so a Thunder pane in the workbench finally has an
 * identity in the session indicator system (before this, `cli:thunder` panes
 * were permanently `open`).
 *
 * Like ACP chats, a Thunder chat is not a PTY pane: its state is broadcast to
 * every renderer rather than owned by the pane that started it, so it is
 * tracked here and merged with the daemon's answer when the dots are assembled.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { ThunderAgentPhase, ThunderAgentStatus } from "@agent-resume/core";
import type { SessionDotRuntime, SessionDotStatus } from "./types";

/** Minimal shape of the Thunder stream payload this hook cares about. */
export type ThunderStatusEvent = {
  sessionId?: string;
  event?: { type?: string; kind?: string; payload?: unknown };
};

/** Every phase thunder can report. Anything else is a newer thunder than us. */
const PHASES: ReadonlySet<string> = new Set<ThunderAgentPhase>([
  "idle",
  "thinking",
  "streaming",
  "tool",
  "awaiting_user",
  "paused",
  "compacting",
  "done",
  "error"
]);

/**
 * The dot a phase deserves.
 *
 * The two holds (`awaiting_user`, `paused`) both mean "this will not move until
 * you act" — the agent looked up and stopped, whether it asked a question or the
 * user parked it — so they share the urgent dot. `error` is its own. Everything
 * that is actively working is `running`, and a resting run (`done`) shows
 * nothing: the transcript already says the answer is in, and a dot that stays
 * lit after every run stops meaning anything.
 */
export function agentPhaseToDotStatus(phase: ThunderAgentPhase): SessionDotStatus {
  switch (phase) {
    case "awaiting_user":
    case "paused":
      return "awaiting_user";
    case "error":
      return "error";
    case "thinking":
    case "streaming":
    case "tool":
    case "compacting":
      return "running";
    case "idle":
    case "done":
      return "open";
  }
  return "open";
}

/**
 * Whether `next` reports a later state of the run than `held`.
 *
 * `seq` only moves when the published snapshot actually changes, so dropping
 * anything that does not move forward is what keeps a duplicated or re-ordered
 * frame from walking the dot backwards. A new run restarts the clock, which is
 * the other way "this is newer" can be expressed — and the only one that holds
 * across a daemon restart, where `seq` starts over.
 */
export function isNewerAgentStatus(
  next: ThunderAgentStatus,
  held: ThunderAgentStatus | null
): boolean {
  if (!held) return true;
  if (next.session_id !== held.session_id) return true;
  return next.seq > held.seq || next.started_at_ms !== held.started_at_ms;
}

export function useThunderChatStatus(): {
  ingest: (payload: ThunderStatusEvent) => void;
  /** Thunder conversation id → dot status. */
  bySessionId: ReadonlyMap<string, SessionDotRuntime>;
} {
  const frames = useRef(new Map<string, ThunderAgentStatus>());
  const [version, setVersion] = useState(0);

  const ingest = useCallback((payload: ThunderStatusEvent) => {
    const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
    const ev = payload?.event;
    if (!sessionId || !ev || ev.type !== "custom" || ev.kind !== "agent_status") return;

    const parsed = parseAgentStatus(ev.payload, sessionId);
    if (parsed.kind === "noise") return;
    if (parsed.kind === "unexpressible") {
      // A phase this build has never heard of: the run stops being expressible
      // in our vocabulary, so its record goes rather than going stale.
      if (frames.current.delete(sessionId)) setVersion((current) => current + 1);
      return;
    }

    const frame = parsed.frame;
    if (!isNewerAgentStatus(frame, frames.current.get(sessionId) ?? null)) return;
    frames.current.set(sessionId, frame);
    setVersion((current) => current + 1);
  }, []);

  const bySessionId = useMemo(() => {
    const map = new Map<string, SessionDotRuntime>();
    for (const [sessionId, frame] of frames.current) {
      map.set(sessionId, { status: agentPhaseToDotStatus(frame.phase) });
    }
    return map;
    // `version` is the change signal for the ref above.
  }, [version]);

  return { ingest, bySessionId };
}

/**
 * What a payload turned out to be.
 *
 * The three cases are worth telling apart: a phase we do not know is still a
 * real report (a newer thunder speaking), while a payload that is not a frame
 * at all is not a report about anything.
 */
type ParsedPayload =
  | { kind: "frame"; frame: ThunderAgentStatus }
  | { kind: "unexpressible" }
  | { kind: "noise" };

/**
 * The payload as a frame.
 *
 * An unreadable frame is noise; a readable one carrying a phase outside this
 * build's vocabulary is `unexpressible`, which the caller answers by forgetting
 * the run — the same direction the rest of the dot system fails, where a missed
 * cue costs less than a false "waiting for you".
 */
function parseAgentStatus(payload: unknown, sessionId: string): ParsedPayload {
  if (!payload || typeof payload !== "object") return { kind: "noise" };
  const raw = payload as Record<string, unknown>;
  if (typeof raw.phase !== "string") return { kind: "noise" };
  const seq = typeof raw.seq === "number" ? raw.seq : Number.NaN;
  const startedAtMs = typeof raw.started_at_ms === "number" ? raw.started_at_ms : Number.NaN;
  if (!Number.isFinite(seq) || !Number.isFinite(startedAtMs)) return { kind: "noise" };
  if (!PHASES.has(raw.phase)) return { kind: "unexpressible" };
  return {
    kind: "frame",
    frame: {
      session_id: typeof raw.session_id === "string" && raw.session_id ? raw.session_id : sessionId,
      phase: raw.phase as ThunderAgentPhase,
      tool: typeof raw.tool === "string" ? raw.tool : undefined,
      turn: typeof raw.turn === "number" ? raw.turn : 0,
      detail: typeof raw.detail === "string" ? raw.detail : undefined,
      started_at_ms: startedAtMs,
      seq
    }
  };
}
