import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useThunderChat } from "./useThunderChat";

interface HarnessEvent {
  taskId: string;
  sessionId: string;
  event: { agent_id: string; event: Record<string, unknown>; timestamp_ms: number };
}

interface Harness {
  emit(payload: HarnessEvent): void;
  resolveRun(value: unknown): void;
  rejectRun(error: unknown): void;
}

/** The daemon's model list, as the settings pane receives it. */
function thunderStatus() {
  return {
    available: true,
    daemonPath: "/opt/thunder-daemon",
    source: "settings",
    models: [
      {
        id: "m",
        provider: "magpie",
        name: "M",
        selection_id: "magpie/m",
        available: true,
        reasoning: true,
        thinking_levels: ["low", "high"],
        default_thinking_level: "high"
      }
    ]
  };
}

function installHarness(): Harness {
  let emit: ((payload: HarnessEvent) => void) | undefined;
  let resolveRun: ((value: unknown) => void) | undefined;
  let rejectRun: ((reason?: unknown) => void) | undefined;

  window.agentResume = {
    thunderGetStatus: vi.fn().mockResolvedValue(thunderStatus()),
    thunderChatListConversations: vi.fn().mockResolvedValue([]),
    thunderChatGetConversation: vi.fn().mockResolvedValue(null),
    thunderChatGetActiveStream: vi.fn().mockResolvedValue(null),
    thunderChatGetTrace: vi.fn().mockResolvedValue(null),
    thunderChatRunTask: vi.fn().mockImplementation(
      () =>
        new Promise<unknown>((resolve, reject) => {
          resolveRun = resolve;
          rejectRun = reject;
        })
    ),
    onThunderChatEvent: vi.fn().mockImplementation((callback: (payload: HarnessEvent) => void) => {
      emit = callback;
      return () => {
        emit = undefined;
      };
    }),
    onThunderModelsChanged: vi.fn().mockReturnValue(() => {})
  } as unknown as typeof window.agentResume;

  return {
    emit: (payload) => emit?.(payload),
    resolveRun: (value) => resolveRun?.(value),
    rejectRun: (error) => rejectRun?.(error)
  };
}

/** Start a turn and hand back the ids the daemon would report. */
async function startTurn(result: { current: ReturnType<typeof useThunderChat> }) {
  await waitFor(() => expect(result.current.models.length).toBe(1));
  act(() => {
    void result.current.sendMessage("只输出两个字：好的");
  });
  await waitFor(() => expect(result.current.activeTaskId).toBeTruthy());
  return { taskId: result.current.activeTaskId as string, sessionId: result.current.activeSessionId as string };
}

function observed(taskId: string, sessionId: string, event: Record<string, unknown>): HarnessEvent {
  return { taskId, sessionId, event: { agent_id: "root", event, timestamp_ms: Date.now() } };
}

describe("useThunderChat turn finalization", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports why an error turn produced no answer instead of an empty one", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    const failure = "magpie API error (403): this request came through a proxy or tunnel";
    act(() => harness.emit(observed(taskId, sessionId, { type: "error", turn: 1, message: failure })));
    act(() =>
      harness.emit(
        observed(taskId, sessionId, {
          type: "loop_complete",
          finish_reason: "error",
          final_content: null,
          stats: { total_turns: 1, total_duration_ms: 10 }
        })
      )
    );

    const assistant = result.current.messages.at(-1);
    expect(assistant?.role).toBe("assistant");
    expect(assistant?.content).toContain(`⚠️ **Task failed**: ${failure}`);
    expect(assistant?.content).not.toBe("(No response output)");

    // The daemon's own task_failed arrives after loop_complete: it must not
    // replace the message that already carries the reason.
    const before = result.current.messages.length;
    await act(async () => {
      harness.rejectRun(new Error("Thunder agent task ended with FinishReason::Error"));
    });
    expect(result.current.messages.length).toBe(before);
  });

  it("keeps partial output under the failure notice when the turn already streamed", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() => harness.emit(observed(taskId, sessionId, { type: "token_delta", turn: 1, delta: "西湖位于" })));
    act(() =>
      harness.emit(
        observed(taskId, sessionId, {
          type: "loop_complete",
          finish_reason: "max_turns_exceeded",
          final_content: null,
          stats: { total_turns: 4, total_duration_ms: 20 }
        })
      )
    );

    const assistant = result.current.messages.at(-1);
    expect(assistant?.content).toContain("⚠️ **Task stopped**");
    expect(assistant?.content).toContain("西湖位于");
    // Segments win over `content` in the transcript, so the notice needs one.
    const segments = assistant?.segments ?? [];
    expect(segments.at(-1)).toEqual({
      kind: "text",
      text: "⚠️ **Task stopped**: the agent reached its maximum number of turns without producing an answer."
    });
  });

  it("shows the answer of a run that finished normally", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() =>
      harness.emit(
        observed(taskId, sessionId, {
          type: "loop_complete",
          finish_reason: "done",
          final_content: "好的",
          stats: { total_turns: 1, total_duration_ms: 30 }
        })
      )
    );

    const assistant = result.current.messages.at(-1);
    expect(assistant?.content).toBe("好的");
  });
});
