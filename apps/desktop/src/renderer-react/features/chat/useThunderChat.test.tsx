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
    thunderChatAnswerQuestion: vi.fn().mockResolvedValue(true),
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

describe("useThunderChat parked questions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const question = (text: string) => [{ question: text, options: [{ label: "A" }, { label: "B" }] }];

  it("docks a question only over the conversation that asked it", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() => harness.emit(observed(taskId, sessionId, { type: "user_question", question_id: "q1", questions: question("A or B?") })));
    expect(result.current.pendingQuestion?.questionId).toBe("q1");

    // Another conversation asking does not take over the screen.
    act(() => harness.emit(observed("task_b", "sess_b", { type: "user_question", question_id: "q2", questions: question("C or D?") })));
    expect(result.current.pendingQuestion?.questionId).toBe("q1");

    // …and switching conversations swaps the bubble rather than leaking it.
    await act(async () => {
      await result.current.selectSession("sess_b");
    });
    expect(result.current.pendingQuestion?.questionId).toBe("q2");

    await act(async () => {
      await result.current.selectSession(sessionId);
    });
    expect(result.current.pendingQuestion?.questionId).toBe("q1");
  });

  it("drops the bubble when the conversation moves on without an answer", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() => harness.emit(observed(taskId, sessionId, { type: "user_question", question_id: "q1", questions: question("A or B?") })));
    act(() =>
      harness.emit(
        observed(taskId, sessionId, {
          type: "loop_complete",
          finish_reason: "cancelled",
          final_content: null,
          stats: { total_turns: 1, total_duration_ms: 10 }
        })
      )
    );

    expect(result.current.pendingQuestion).toBeNull();
    await act(async () => {
      await result.current.selectSession(sessionId);
    });
    expect(result.current.pendingQuestion).toBeNull();
  });

  it("re-docks a parked question from the daemon buffer after a remount", async () => {
    const harness = installHarness();
    window.agentResume.thunderChatGetActiveStream = vi.fn().mockResolvedValue({
      sessionId: "sess_parked",
      taskId: "task_parked",
      startedAtMs: Date.now(),
      isRunning: true,
      streamingText: "working",
      streamingReasoning: "",
      streamingTools: [],
      events: [
        { agent_id: "root", timestamp_ms: Date.now(), event: { type: "token_delta", delta: "working" } },
        {
          agent_id: "root",
          timestamp_ms: Date.now(),
          event: { type: "user_question", question_id: "q_parked", questions: question("A or B?") }
        }
      ]
    });

    const { result } = renderHook(() => useThunderChat());
    await act(async () => {
      await result.current.selectSession("sess_parked");
    });

    expect(result.current.pendingQuestion?.questionId).toBe("q_parked");
    expect(result.current.pendingQuestion?.sessionId).toBe("sess_parked");

    // Answering hands the question id and its session to the daemon once.
    await act(async () => {
      await result.current.answerQuestion({ "A or B?": "A" });
    });
    expect(window.agentResume.thunderChatAnswerQuestion).toHaveBeenCalledWith({
      questionId: "q_parked",
      sessionId: "sess_parked",
      answers: { "A or B?": "A" },
      cancelled: false
    });
    expect(result.current.pendingQuestion).toBeNull();
  });
});

describe("useThunderChat streaming token metrics", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("estimates real token counts from batched deltas and excludes tool execution time from live TPS", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    vi.useFakeTimers();
    const t0 = 1_700_000_000_000;
    vi.setSystemTime(t0);

    // First delta arrives at t0
    act(() => {
      harness.emit(
        observed(taskId, sessionId, {
          type: "reasoning_delta",
          turn: 1,
          delta: "思考分析问题结构与调用参数"
        })
      );
    });

    // 1 second of streaming batched CJK + code tokens (~60+ tokens in 1 chunk)
    vi.setSystemTime(t0 + 1000);
    act(() => {
      harness.emit(
        observed(taskId, sessionId, {
          type: "token_delta",
          turn: 1,
          delta: "这是一段批量刷新到达的中文回复内容，包含完整的句子与技术分析说明，用来验证流式速率计算不会按事件个数误算为几个 token。"
        })
      );
    });

    const tokensTurn1 = result.current.streamingMetrics.tokensCount;
    const tpsTurn1 = result.current.streamingMetrics.tps;
    // Must count actual estimated tokens (> 60), not 2 delta events
    expect(tokensTurn1).toBeGreaterThan(60);
    expect(result.current.streamingMetrics.reasoningCount).toBeGreaterThan(10);
    expect(tpsTurn1).toBeCloseTo(tokensTurn1 / 1.0, 1);

    // Tool starts at t0 + 1000ms and takes 10 seconds to execute
    act(() => {
      harness.emit(
        observed(taskId, sessionId, {
          type: "tool_exec_start",
          turn: 1,
          tool_call_id: "call_1",
          name: "bash",
          arguments: { command: "sleep 10" }
        })
      );
    });
    vi.setSystemTime(t0 + 11_000);
    act(() => {
      harness.emit(
        observed(taskId, sessionId, {
          type: "tool_exec_result",
          turn: 1,
          tool_call_id: "call_1",
          name: "bash",
          result: { output: "ok", is_error: false }
        })
      );
      harness.emit(
        observed(taskId, sessionId, {
          type: "turn_end",
          turn: 1,
          stats: {
            turn: 1,
            prompt_tokens: 1000,
            completion_tokens: 80,
            reasoning_tokens: 20,
            duration_ms: 1000,
            tool_calls_count: 1,
            tokens_per_second: 80
          }
        })
      );
    });

    // Turn 2 starts after 2s prefill wait (t0 + 13_000) and streams for 1s (t0 + 14_000)
    vi.setSystemTime(t0 + 13_000);
    act(() => {
      harness.emit(
        observed(taskId, sessionId, {
          type: "token_delta",
          turn: 2,
          delta: "开始第二轮流式输出内容，"
        })
      );
    });
    vi.setSystemTime(t0 + 14_000);
    act(() => {
      harness.emit(
        observed(taskId, sessionId, {
          type: "token_delta",
          turn: 2,
          delta: "工具执行的十秒钟等待以及首字延迟都不应当稀释模型的真实生成速率。"
        })
      );
    });

    // Active generation time is 1s (turn 1) + 1s (turn 2) = 2s, NOT 14s wall clock
    const totalTokens = result.current.streamingMetrics.tokensCount;
    const liveTps = result.current.streamingMetrics.tps;
    expect(totalTokens).toBeGreaterThan(120);
    expect(liveTps).toBeCloseTo(totalTokens / 2.0, 1);
    expect(liveTps).toBeGreaterThan(60);
  });

  it("adopts authoritative metrics_update snapshots emitted by Thunder's MetricsPlugin", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() => {
      harness.emit(
        observed(taskId, sessionId, {
          type: "custom",
          kind: "metrics_update",
          payload: {
            session_id: sessionId,
            task_id: taskId,
            is_running: true,
            turn: 1,
            live_tps: 78.6,
            live_tokens: 420,
            live_reasoning_tokens: 180,
            cached_tokens: 8000,
            context_tokens: 12420,
            session_total_tokens: 25000,
            generation_duration_ms: 5343,
            tool_duration_ms: 120
          }
        })
      );
    });

    expect(result.current.streamingMetrics).toEqual({
      tokensCount: 420,
      tps: 78.6,
      reasoningCount: 180
    });
    expect(result.current.currentContextTokens).toBe(12420);
    expect(result.current.sessionTotalTokens).toBe(25000);
  });
});
