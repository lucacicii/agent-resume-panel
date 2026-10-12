import { afterEach, describe, expect, it } from "vitest";
import type { ThunderObservedEvent } from "./thunderProtocol";
import {
  accumulateStreamEvent,
  createActiveStreamSnapshot,
  dropPendingQuestion,
  finishActiveStream,
  getActiveStream,
  resetActiveStreams
} from "./thunderStreamBuffer";

function observed(event: Record<string, unknown>): ThunderObservedEvent {
  return { agent_id: "task_1", event: event as ThunderObservedEvent["event"] };
}

describe("thunderStreamBuffer", () => {
  afterEach(() => {
    resetActiveStreams();
  });

  it("accumulates text, reasoning and tool calls for a session", () => {
    const snapshot = createActiveStreamSnapshot({
      sessionId: "sess_1",
      taskId: "task_1",
      prompt: "do work",
      model: "openai/gpt-4o",
      workspaceDir: "/work/repo"
    });

    accumulateStreamEvent(snapshot, observed({ type: "token_delta", turn: 1, delta: "Hel" }));
    accumulateStreamEvent(snapshot, observed({ type: "token_delta", turn: 1, delta: "lo" }));
    accumulateStreamEvent(snapshot, observed({ type: "reasoning_delta", turn: 1, delta: "think" }));
    accumulateStreamEvent(
      snapshot,
      observed({ type: "tool_exec_start", turn: 1, tool_call_id: "t1", name: "bash", arguments: { command: "ls" } })
    );
    accumulateStreamEvent(
      snapshot,
      observed({
        type: "tool_exec_result",
        turn: 1,
        tool_call_id: "t1",
        name: "bash",
        result: { tool_call_id: "t1", output: "file.txt", is_error: false }
      })
    );

    expect(snapshot.streamingText).toBe("Hello");
    expect(snapshot.streamingReasoning).toBe("think");
    expect(snapshot.streamingTools).toEqual([
      {
        toolCallId: "t1",
        name: "bash",
        arguments: { command: "ls" },
        isRunning: false,
        result: "file.txt",
        isError: false
      }
    ]);
    expect(snapshot.events).toHaveLength(5);
    expect(snapshot.isRunning).toBe(true);
  });

  it("exposes the running snapshot and drops it when the task finishes", () => {
    const snapshot = createActiveStreamSnapshot({ sessionId: "sess_2", taskId: "task_2" });
    accumulateStreamEvent(snapshot, observed({ type: "token_delta", turn: 1, delta: "x" }));

    expect(getActiveStream("sess_2")).toBe(snapshot);

    finishActiveStream("sess_2", "task_2");
    expect(getActiveStream("sess_2")).toBeNull();
  });

  it("ignores a finish call for a different task on the same session", () => {
    const snapshot = createActiveStreamSnapshot({ sessionId: "sess_3", taskId: "task_3" });
    finishActiveStream("sess_3", "other_task");
    expect(getActiveStream("sess_3")).toBe(snapshot);
  });

  it("stops offering an answered question while the run keeps streaming", () => {
    const snapshot = createActiveStreamSnapshot({ sessionId: "sess_4", taskId: "task_4" });
    accumulateStreamEvent(
      snapshot,
      observed({ type: "user_question", question_id: "q1", questions: [{ question: "A or B?" }] })
    );
    accumulateStreamEvent(snapshot, observed({ type: "token_delta", turn: 2, delta: "A" }));

    dropPendingQuestion("sess_4", "q1");

    expect(snapshot.events.filter((e) => e.event.type === "user_question")).toHaveLength(0);
    // Only the question goes: the turn that resumed after the answer stays.
    expect(snapshot.streamingText).toBe("A");
    expect(getActiveStream("sess_4")).toBe(snapshot);
  });

  it("drops every parked question of a session when no id is given", () => {
    const snapshot = createActiveStreamSnapshot({ sessionId: "sess_5", taskId: "task_5" });
    accumulateStreamEvent(snapshot, observed({ type: "user_question", question_id: "q1" }));
    accumulateStreamEvent(snapshot, observed({ type: "user_question", question_id: "q2" }));

    dropPendingQuestion("sess_5");

    expect(snapshot.events).toHaveLength(0);
  });
});
