import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ThunderAgentPhase, ThunderAgentStatus } from "@agent-resume/core";
import { agentPhaseToDotStatus, isNewerAgentStatus, useThunderChatStatus, type ThunderStatusEvent } from "./useThunderChatStatus";

function frame(overrides: Partial<ThunderAgentStatus> = {}): ThunderAgentStatus {
  return {
    session_id: "sess_1",
    phase: "thinking",
    turn: 1,
    started_at_ms: 1_000,
    seq: 1,
    ...overrides
  };
}

/** A `custom/agent_status` payload as it arrives from the daemon. */
function statusEvent(payload: unknown, sessionId = "sess_1") {
  return { sessionId, event: { type: "custom", kind: "agent_status", payload } };
}

/** Any other frame on the same stream, which the hook has no business reading. */
function otherEvent(event: Record<string, unknown>, sessionId = "sess_1") {
  return { sessionId, event: event as ThunderStatusEvent["event"] };
}

describe("agentPhaseToDotStatus", () => {
  it("shows the urgent dot for every phase that cannot move without a human", () => {
    expect(agentPhaseToDotStatus("awaiting_user")).toBe("awaiting_user");
    // A user-parked run is just as stuck as one that asked a question.
    expect(agentPhaseToDotStatus("paused")).toBe("awaiting_user");
  });

  it("shows the running dot for every phase that is making progress", () => {
    for (const phase of ["thinking", "streaming", "tool", "compacting"] as ThunderAgentPhase[]) {
      expect(agentPhaseToDotStatus(phase)).toBe("running");
    }
  });

  it("keeps the failure and hides the resting states", () => {
    expect(agentPhaseToDotStatus("error")).toBe("error");
    expect(agentPhaseToDotStatus("idle")).toBe("open");
    // A finished run is not news: the transcript already has the answer.
    expect(agentPhaseToDotStatus("done")).toBe("open");
  });
});

describe("isNewerAgentStatus", () => {
  it("accepts the first frame and any frame that moves forward", () => {
    const held = frame({ seq: 4 });
    expect(isNewerAgentStatus(frame({ seq: 1 }), null)).toBe(true);
    expect(isNewerAgentStatus(frame({ seq: 5 }), held)).toBe(true);
  });

  it("refuses a frame that would walk the run backwards", () => {
    expect(isNewerAgentStatus(frame({ seq: 4 }), frame({ seq: 4 }))).toBe(false);
    expect(isNewerAgentStatus(frame({ seq: 3 }), frame({ seq: 4 }))).toBe(false);
  });

  it("accepts a new run's first frame, whose clock restarts with it", () => {
    // A second run in the same session: same vocabulary, new wall clock.
    const held = frame({ seq: 9, phase: "done" });
    expect(isNewerAgentStatus(frame({ seq: 10, started_at_ms: 2_000 }), held)).toBe(true);
  });

  it("treats a frame for another session as unrelated, never as older", () => {
    expect(isNewerAgentStatus(frame({ session_id: "sess_2", seq: 1 }), frame({ seq: 99 }))).toBe(true);
  });
});

describe("useThunderChatStatus", () => {
  it("keeps one status per session and ignores everything that is not agent_status", () => {
    const { result } = renderHook(() => useThunderChatStatus());

    act(() => {
      result.current.ingest(statusEvent(frame()));
      result.current.ingest(statusEvent(frame({ session_id: "sess_2", phase: "tool", seq: 1 }), "sess_2"));
      // A metrics frame, a token delta, and a status for a session we cannot name.
      result.current.ingest(otherEvent({ type: "custom", kind: "metrics_update", payload: {} }));
      result.current.ingest(otherEvent({ type: "token_delta", delta: "x" }));
      result.current.ingest({ event: { type: "custom", kind: "agent_status", payload: frame() } });
    });

    expect(result.current.bySessionId.get("sess_1")?.status).toBe("running");
    expect(result.current.bySessionId.get("sess_2")?.status).toBe("running");
    expect(result.current.bySessionId.size).toBe(2);
  });

  it("follows a run from thinking through its tool to the wait and back", () => {
    const { result } = renderHook(() => useThunderChatStatus());
    const phases: Array<[unknown, string]> = [
      [frame({ seq: 1, phase: "thinking" }), "running"],
      [frame({ seq: 2, phase: "tool", tool: "bash" }), "running"],
      [frame({ seq: 3, phase: "awaiting_user" }), "awaiting_user"],
      [frame({ seq: 4, phase: "tool", tool: "bash" }), "running"],
      [frame({ seq: 5, phase: "done" }), "open"]
    ];

    for (const [payload, expected] of phases) {
      act(() => {
        result.current.ingest(statusEvent(payload));
      });
      expect(result.current.bySessionId.get("sess_1")?.status).toBe(expected);
    }
  });

  it("drops an out-of-order frame instead of walking the dot backwards", () => {
    const { result } = renderHook(() => useThunderChatStatus());

    act(() => {
      result.current.ingest(statusEvent(frame({ seq: 7, phase: "awaiting_user" })));
    });
    expect(result.current.bySessionId.get("sess_1")?.status).toBe("awaiting_user");

    // The buffered snapshot a late renderer fetched can land after a newer frame.
    act(() => {
      result.current.ingest(statusEvent(frame({ seq: 6, phase: "thinking" })));
    });
    expect(result.current.bySessionId.get("sess_1")?.status).toBe("awaiting_user");
  });

  it("drops a phase it does not know rather than guessing at it", () => {
    const { result } = renderHook(() => useThunderChatStatus());

    act(() => {
      result.current.ingest(statusEvent(frame({ seq: 1, phase: "thinking" })));
    });
    // A newer thunder reports a phase this build has never heard of.
    act(() => {
      result.current.ingest(statusEvent({ ...frame({ seq: 2 }), phase: "vibing" }));
    });
    expect(result.current.bySessionId.size).toBe(0);
  });

  it("ignores a payload that is not a frame at all", () => {
    const { result } = renderHook(() => useThunderChatStatus());

    act(() => {
      result.current.ingest(statusEvent(null));
      result.current.ingest(statusEvent("agent_status"));
      result.current.ingest(statusEvent({ phase: "thinking" })); // no seq, no clock
      result.current.ingest(statusEvent({ ...frame(), seq: "3" }));
    });

    expect(result.current.bySessionId.size).toBe(0);
  });

  it("files a run under the session the pane is keyed by", () => {
    const { result } = renderHook(() => useThunderChatStatus());

    act(() => {
      result.current.ingest(statusEvent(frame({ session_id: "sess_real" }), "sess_envelope"));
    });

    // Panes are keyed `thunder:<sessionId>` from the envelope the daemon picked,
    // so that is the key the dot has to be found under. The payload's own id
    // rides along on the frame as the run's own account of itself.
    expect(result.current.bySessionId.get("sess_envelope")?.status).toBe("running");
    expect(result.current.bySessionId.get("sess_real")).toBeUndefined();
  });

  it("still reports a frame that names no session of its own", () => {
    const { result } = renderHook(() => useThunderChatStatus());
    const { session_id: _omitted, ...nameless } = frame();

    act(() => {
      result.current.ingest(statusEvent(nameless));
    });

    expect(result.current.bySessionId.get("sess_1")?.status).toBe("running");
  });
});
