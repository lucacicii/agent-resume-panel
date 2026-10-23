import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTraceCollector } from "./useTraceCollector";
import type { ThunderAgentEvent } from "@agent-resume/core";

describe("useTraceCollector", () => {
  it("initializes empty spans and footprint", () => {
    const { result } = renderHook(() => useTraceCollector());
    expect(result.current.spans).toEqual([]);
    expect(result.current.fileChanges).toEqual([]);
    expect(result.current.isCollecting).toBe(false);
  });

  it("accumulates turn, reasoning, token and tool spans, with the write in the footprint", () => {
    const { result } = renderHook(() => useTraceCollector());

    // 1. Start task
    act(() => {
      result.current.startTaskTrace({
        taskId: "task_123",
        sessionId: "sess_456",
        model: "openai/gpt-4o",
        workspaceDir: "/ws",
        prompt: "Run tests and update config"
      });
    });

    expect(result.current.isCollecting).toBe(true);

    // 2. Turn 1 start
    act(() => {
      const ev: ThunderAgentEvent = {
        type: "turn_start",
        turn: 1,
        timestamp: Date.now()
      };
      result.current.recordEvent(ev, "task_123");
    });

    expect(result.current.spans.some((s) => s.id === "turn_1")).toBe(true);

    // 3. Reasoning delta
    act(() => {
      const ev: ThunderAgentEvent = {
        type: "reasoning_delta",
        turn: 1,
        delta: "Thinking about bash command..."
      };
      result.current.recordEvent(ev, "task_123");
    });

    expect(result.current.spans.some((s) => s.type === "thinking")).toBe(true);

    // 4. Token delta
    act(() => {
      const ev: ThunderAgentEvent = {
        type: "token_delta",
        turn: 1,
        delta: "I will execute bash now."
      };
      result.current.recordEvent(ev, "task_123");
    });

    expect(result.current.spans.some((s) => s.type === "token")).toBe(true);

    // 5. Bash Tool exec start & result
    act(() => {
      const startEv: ThunderAgentEvent = {
        type: "tool_exec_start",
        turn: 1,
        tool_call_id: "call_bash_1",
        name: "bash",
        arguments: { command: "cargo test", cwd: "/ws" }
      };
      result.current.recordEvent(startEv, "task_123");
    });

    expect(result.current.spans.find((s) => s.id === "call_bash_1")?.status).toBe("running");

    act(() => {
      const resEv: ThunderAgentEvent = {
        type: "tool_exec_result",
        turn: 1,
        tool_call_id: "call_bash_1",
        name: "bash",
        result: {
          tool_call_id: "call_bash_1",
          output: "test result: ok. 25 passed",
          is_error: false,
          duration_ms: 1200
        }
      };
      result.current.recordEvent(resEv, "task_123");
    });

    const bashSpan = result.current.spans.find((s) => s.id === "call_bash_1");
    expect(bashSpan?.status).toBe("completed");
    expect(bashSpan?.durationMs).toBe(1200);

    // 6. The footprint comes from the tool arguments, not from a `file_change`
    // event: thunder's kernel no longer emits one.
    act(() => {
      const writeStart: ThunderAgentEvent = {
        type: "tool_exec_start",
        turn: 1,
        tool_call_id: "call_write_1",
        name: "write_file",
        arguments: { path: "/ws/src/config.json", content: "{}" }
      };
      result.current.recordEvent(writeStart, "task_123");
      const writeDone: ThunderAgentEvent = {
        type: "tool_exec_result",
        turn: 1,
        tool_call_id: "call_write_1",
        name: "write_file",
        result: {
          tool_call_id: "call_write_1",
          output: "written 256 bytes",
          is_error: false,
          duration_ms: 40
        }
      };
      result.current.recordEvent(writeDone, "task_123");
    });

    expect(result.current.fileChanges).toHaveLength(1);
    expect(result.current.fileChanges[0].path).toBe("/ws/src/config.json");
    expect(result.current.fileChanges[0].tool).toBe("write_file");
    expect(result.current.fileChanges[0].turn).toBe(1);

    // 7. A shell command names no file, so it leaves no footprint.
    act(() => {
      const bashStart: ThunderAgentEvent = {
        type: "tool_exec_start",
        turn: 1,
        tool_call_id: "call_bash_2",
        name: "bash",
        arguments: { command: "echo hi > /ws/out.txt" }
      };
      result.current.recordEvent(bashStart, "task_123");
      const bashDone: ThunderAgentEvent = {
        type: "tool_exec_result",
        turn: 1,
        tool_call_id: "call_bash_2",
        name: "bash",
        result: {
          tool_call_id: "call_bash_2",
          output: "",
          is_error: false,
          duration_ms: 10
        }
      };
      result.current.recordEvent(bashDone, "task_123");
    });
    expect(result.current.fileChanges).toHaveLength(1);

    // 8. Turn end
    act(() => {
      const endEv: ThunderAgentEvent = {
        type: "turn_end",
        turn: 1,
        stats: { duration_ms: 1500 }
      };
      result.current.recordEvent(endEv, "task_123");
    });

    // 9. Finish
    act(() => {
      result.current.finishTaskTrace();
    });

    expect(result.current.isCollecting).toBe(false);
    expect(result.current.spans.every((span) => span.status !== "running")).toBe(true);
  });

  it("normalizes a seconds-resolution turn_start timestamp to milliseconds", () => {
    const { result } = renderHook(() => useTraceCollector());

    act(() => {
      result.current.startTaskTrace({
        taskId: "task_ts",
        sessionId: "sess_ts",
        model: "openai/gpt-4o",
        workspaceDir: "/ws",
        prompt: "hello"
      });
    });

    // Older daemons emitted turn_start.timestamp in SECONDS (10 digits).
    const secondsTs = Math.floor(Date.now() / 1000);
    act(() => {
      const ev: ThunderAgentEvent = {
        type: "turn_start",
        turn: 1,
        timestamp: secondsTs
      };
      result.current.recordEvent(ev, "task_ts");
    });

    const turnSpan = result.current.spans.find((s) => s.id === "turn_1");
    // The stored start must be milliseconds, not a raw seconds value.
    expect(turnSpan?.startedAtMs).toBe(secondsTs * 1000);

    act(() => {
      const ev: ThunderAgentEvent = {
        type: "turn_end",
        turn: 1,
        stats: { duration_ms: 1500 }
      };
      result.current.recordEvent(ev, "task_ts");
    });

    const ended = result.current.spans.find((s) => s.id === "turn_1");
    // Must be a plausible duration (< 1 minute), never ~1.78e9 seconds.
    expect(ended?.durationMs).toBeDefined();
    expect(ended!.durationMs!).toBeLessThan(60_000);
    expect(ended!.durationMs!).toBeGreaterThanOrEqual(0);
  });
});
