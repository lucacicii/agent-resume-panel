import { afterEach, describe, expect, it } from "vitest";
import type { ThunderObservedEvent } from "./thunderProtocol";
import {
  accumulateStreamEvent,
  createActiveStreamSnapshot,
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
});
