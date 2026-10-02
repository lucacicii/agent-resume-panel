import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTraceCollector } from "./useTraceCollector";
import type { ThunderAgentEvent } from "@agent-resume/core";

describe("useTraceCollector", () => {
  it("initializes empty trace and spans", () => {
    const { result } = renderHook(() => useTraceCollector());
    expect(result.current.currentTrace).toBeNull();
    expect(result.current.spans).toEqual([]);
    expect(result.current.fileChanges).toEqual([]);
    expect(result.current.telemetryNotices).toEqual([]);
    expect(result.current.isCollecting).toBe(false);
  });

  it("accumulates full chain: turn, reasoning, token, bash tool, write_file, telemetry, file_change", () => {
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
    expect(result.current.currentTrace?.task_id).toBe("task_123");

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

    // 6. File change event
    act(() => {
      const fileEv: ThunderAgentEvent = {
        type: "file_change",
        turn: 1,
        tool_call_id: "call_write_1",
        path: "/ws/src/config.json",
        action: "written",
        bytes: 256,
        tool_name: "write_file"
      };
      result.current.recordEvent(fileEv, "task_123");
    });

    expect(result.current.fileChanges).toHaveLength(1);
    expect(result.current.fileChanges[0].path).toBe("/ws/src/config.json");
    expect(result.current.fileChanges[0].tool).toBe("write_file");

    // 7. Telemetry notice event
    act(() => {
      const telemEv: ThunderAgentEvent = {
        type: "telemetry_notice",
        turn: 1,
        tool_call_id: "call_write_1",
        layer: "Transaction",
        action: "Atomic shadow write & rename completed",
        ground_truth: "Target file written 256 bytes safely",
        self_healed: "Temp shadow cleaned up",
        guidance: "File ready on disk"
      };
      result.current.recordEvent(telemEv, "task_123");
    });

    expect(result.current.telemetryNotices).toHaveLength(1);
    expect(result.current.telemetryNotices[0].layer).toBe("Transaction");

    // 8. Turn end
    act(() => {
      const endEv: ThunderAgentEvent = {
        type: "turn_end",
        turn: 1,
        stats: { duration_ms: 1500 }
      };
      result.current.recordEvent(endEv, "task_123");
    });

    // 9. Finish task trace
    act(() => {
      result.current.finishTaskTrace({
        finishReason: "done",
        finalContent: "All completed!"
      });
    });

    expect(result.current.isCollecting).toBe(false);
    expect(result.current.currentTrace?.finish_reason).toBe("done");
    expect(result.current.currentTrace?.final_content).toBe("All completed!");
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
