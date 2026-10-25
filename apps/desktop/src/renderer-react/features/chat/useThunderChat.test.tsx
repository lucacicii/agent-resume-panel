import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useThunderChat, buildConversationRows } from "./useThunderChat";

interface HarnessEvent {
  taskId: string;
  sessionId: string;
  event: { agent_id: string; event: Record<string, unknown>; timestamp_ms: number };
}

interface Harness {
  emit(payload: HarnessEvent): void;
  resolveRun(value: unknown): void;
  rejectRun(error: unknown): void;
  /** A pushed mode change, as the daemon's session-scoped channel delivers it. */
  emitMode(payload: {
    sessionId: string;
    taskId?: string;
    mode: string;
    previous?: string;
    source: string;
  }): void;
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
  let emitMode: ((payload: any) => void) | undefined;
  let resolveRun: ((value: unknown) => void) | undefined;
  let rejectRun: ((reason?: unknown) => void) | undefined;

  window.agentResume = {
    thunderGetStatus: vi.fn().mockResolvedValue(thunderStatus()),
    thunderChatListConversations: vi.fn().mockResolvedValue([]),
    thunderChatGetConversation: vi.fn().mockResolvedValue(null),
    thunderChatGetActiveStream: vi.fn().mockResolvedValue(null),
    thunderChatGetTrace: vi.fn().mockResolvedValue(null),
    thunderChatAnswerQuestion: vi.fn().mockResolvedValue(true),
    thunderChatGetPermissionState: vi.fn().mockResolvedValue({ mode: "yolo" }),
    thunderChatSetMode: vi.fn().mockResolvedValue({ mode: "yolo" }),
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
    onThunderModeChanged: vi.fn().mockImplementation((callback: (payload: any) => void) => {
      emitMode = callback;
      return () => {
        emitMode = undefined;
      };
    }),
    onThunderModelsChanged: vi.fn().mockReturnValue(() => {})
  } as unknown as typeof window.agentResume;

  return {
    emit: (payload) => emit?.(payload),
    resolveRun: (value) => resolveRun?.(value),
    rejectRun: (error) => rejectRun?.(error),
    emitMode: (payload) => emitMode?.(payload)
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

describe("useThunderChat context compaction", () => {
  it("leaves a line in the turn that explains the smaller context", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() => {
      harness.emit(
        observed(taskId, sessionId, {
          type: "context_compacted",
          turn: 1,
          tokens_before: 128_000,
          tokens_after: 42_000
        })
      );
    });

    const notice = result.current.liveSegments.find((segment) => segment.kind === "notice");
    expect(notice).toEqual({ kind: "notice", text: "上下文已压缩：128k → 42k" });
  });
});

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
    // The turn, not the message, is where its output lives now — and the notice
    // rides the message's own text, so nothing has to become a segment.
    expect(result.current.liveTurns[0].segments).toEqual([{ kind: "text", text: "西湖位于" }]);
    expect(assistant?.segments).toBeUndefined();
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

  
  it("forgets the previous run's figures when a new one starts", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    // The run's own `turn_end` is the only source of these figures now: the
    // `metrics_update` plugin frame that used to carry a live wall clock is gone.
    act(() => {
      harness.emit(
        observed(taskId, sessionId, {
          type: "turn_end",
          turn: 1,
          stats: { duration_ms: 12_000, prompt_tokens: 900, completion_tokens: 100 }
        })
      );
    });
    expect(result.current.lastRunMetrics?.durationMs).toBe(12_000);

    // End the run, then start another: a new message must not show the previous
    // run's elapsed time until its own first frame arrives.
    await act(async () => {
      harness.resolveRun({ finalContent: "done", finishReason: "done" });
    });
    act(() => {
      void result.current.sendMessage("next task");
    });
    expect(result.current.lastRunMetrics).toBeNull();
  });
});

describe("useThunderChat approval mode", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates the chip from the daemon when a session is opened", async () => {
    installHarness();
    // The mode is the daemon's per-session state and is not in the stored
    // conversation, so it has to be asked for rather than read off `conv`.
    (window.agentResume.thunderChatGetPermissionState as any).mockResolvedValue({ mode: "plan" });
    const { result } = renderHook(() => useThunderChat());

    await act(async () => {
      await result.current.selectSession("sess_a");
    });

    expect(window.agentResume.thunderChatGetPermissionState).toHaveBeenCalledWith({
      sessionId: "sess_a"
    });
    await waitFor(() => expect(result.current.permissionMode).toBe("plan"));
  });

  it("starts unknown rather than guessing a default", async () => {
    installHarness();
    const { result } = renderHook(() => useThunderChat());
    expect(result.current.permissionMode).toBe("");
  });

  it("sends the choice to the daemon and rolls the chip back when it is refused", async () => {
    installHarness();
    const { result } = renderHook(() => useThunderChat());
    await act(async () => {
      await result.current.selectSession("sess_a");
    });
    await waitFor(() => expect(result.current.permissionMode).toBe("yolo"));

    act(() => result.current.setPermissionMode("plan"));
    expect(result.current.permissionMode).toBe("plan");
    await waitFor(() =>
      expect(window.agentResume.thunderChatSetMode).toHaveBeenCalledWith({
        sessionId: "sess_a",
        mode: "plan"
      })
    );

    // A daemon that predates `set_mode` rejects; the chip must say so by going
    // back rather than showing a mode the session is not actually judged by.
    (window.agentResume.thunderChatSetMode as any).mockRejectedValueOnce(new Error("unknown method"));
    act(() => result.current.setPermissionMode("yolo"));
    await waitFor(() => expect(result.current.permissionMode).toBe("plan"));
  });

  it("keeps a pre-session choice local instead of minting a session for it", async () => {
    installHarness();
    const { result } = renderHook(() => useThunderChat());

    act(() => result.current.setPermissionMode("plan"));

    expect(result.current.permissionMode).toBe("plan");
    expect(window.agentResume.thunderChatSetMode).not.toHaveBeenCalled();
  });

  it("follows a pushed change for the open session and ignores other sessions", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    await act(async () => {
      await result.current.selectSession("sess_a");
    });
    await waitFor(() => expect(result.current.permissionMode).toBe("yolo"));

    act(() =>
      harness.emitMode({
        sessionId: "sess_b",
        mode: "plan",
        previous: "yolo",
        source: "user"
      })
    );
    expect(result.current.permissionMode).toBe("yolo");

    act(() =>
      harness.emitMode({
        sessionId: "sess_a",
        mode: "plan",
        previous: "yolo",
        source: "user"
      })
    );
    expect(result.current.permissionMode).toBe("plan");
  });

  it("announces an approval the plan dialog made, because the chip moved on its own", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    await act(async () => {
      await result.current.selectSession("sess_a");
    });

    act(() =>
      harness.emitMode({
        sessionId: "sess_a",
        taskId: "task_1",
        mode: "yolo",
        previous: "plan",
        source: "planApproved"
      })
    );

    expect(result.current.permissionMode).toBe("yolo");
    expect(result.current.titleNotice?.text).toContain("Plan approved");
  });

  it("passes the mode to the run once the user has chosen one", async () => {
    installHarness();
    const { result } = renderHook(() => useThunderChat());
    await waitFor(() => expect(result.current.models.length).toBe(1));

    act(() => result.current.setPermissionMode("plan"));
    act(() => {
      void result.current.sendMessage("只输出两个字：好的");
    });

    await waitFor(() => expect(window.agentResume.thunderChatRunTask).toHaveBeenCalled());
    expect((window.agentResume.thunderChatRunTask as any).mock.calls[0][0].mode).toBe("plan");
  });

  it("omits the mode when the user never touched the chip, so .thunder's defaultMode still applies", async () => {
    installHarness();
    const { result } = renderHook(() => useThunderChat());
    await waitFor(() => expect(result.current.models.length).toBe(1));

    act(() => {
      void result.current.sendMessage("只输出两个字：好的");
    });

    await waitFor(() => expect(window.agentResume.thunderChatRunTask).toHaveBeenCalled());
    expect((window.agentResume.thunderChatRunTask as any).mock.calls[0][0].mode).toBeUndefined();
  });
});

describe("useThunderChat session switching", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("drops a late conversation load when the user has moved on", async () => {
    installHarness();
    const conversations: Record<string, { id: string; messages: { role: string; content: string }[] }> = {
      sess_a: { id: "sess_a", messages: [{ role: "user", content: "aaa" }] },
      sess_b: { id: "sess_b", messages: [{ role: "user", content: "bbb" }] }
    };
    let releaseA: ((value: unknown) => void) | undefined;
    (window.agentResume.thunderChatGetConversation as any).mockImplementation(({ sessionId }: { sessionId: string }) => {
      if (sessionId === "sess_a") {
        return new Promise((resolve) => {
          releaseA = resolve as (value: unknown) => void;
        });
      }
      return Promise.resolve(conversations[sessionId] ?? null);
    });
    const { result } = renderHook(() => useThunderChat());

    // Start on A but hold its load; switch to B, whose load resolves first.
    let selectA: Promise<void> | undefined;
    act(() => {
      selectA = result.current.selectSession("sess_a");
    });
    await act(async () => {
      await result.current.selectSession("sess_b");
    });
    expect(result.current.messages.map((m) => m.content)).toEqual(["bbb"]);

    // A's load lands late: it must not repaint B's feed.
    await act(async () => {
      releaseA?.(conversations.sess_a);
      await selectA;
    });
    expect(result.current.activeSessionId).toBe("sess_b");
    expect(result.current.messages.map((m) => m.content)).toEqual(["bbb"]);
  });
});

describe("useThunderChat turn splitting", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens a turn per turn_start and keeps each turn's segments separate", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() => harness.emit(observed(taskId, sessionId, { type: "turn_start", turn: 1, timestamp: 1 })));
    act(() => harness.emit(observed(taskId, sessionId, { type: "reasoning_delta", turn: 1, delta: "想一" })));
    act(() => harness.emit(observed(taskId, sessionId, { type: "token_delta", turn: 1, delta: "答一" })));
    act(() =>
      harness.emit(
        observed(taskId, sessionId, {
          type: "tool_exec_start",
          turn: 1,
          tool_call_id: "t1",
          name: "read_file",
          arguments: {}
        })
      )
    );
    act(() =>
      harness.emit(
        observed(taskId, sessionId, {
          type: "turn_end",
          turn: 1,
          finish_reason: "tool_calls",
          stats: { turn: 1, prompt_tokens: 100, completion_tokens: 20, duration_ms: 1500, tool_calls_count: 1 }
        })
      )
    );

    expect(result.current.liveTurns).toHaveLength(1);
    const first = result.current.liveTurns[0];
    expect(first.turn).toBe(1);
    expect(first.status).toBe("done");
    expect(first.toolCount).toBe(1);
    expect(first.durationMs).toBe(1500);
    expect(first.promptTokens).toBe(100);
    expect(first.completionTokens).toBe(20);
    expect(first.segments.map((segment) => segment.kind)).toEqual(["reasoning", "text", "tools"]);

    // Turn 2: the previous turn freezes and the feed switches to the new one.
    act(() => harness.emit(observed(taskId, sessionId, { type: "turn_start", turn: 2, timestamp: 2 })));
    expect(result.current.liveTurns).toHaveLength(2);
    expect(result.current.liveTurns[0].status).toBe("done");

    // The feed goes empty the moment the turn opens, not on its first delta.
    expect(result.current.liveSegments).toHaveLength(0);

    act(() => harness.emit(observed(taskId, sessionId, { type: "token_delta", turn: 2, delta: "答二" })));

    // Turn 2 owns only its own text; turn 1's three segments are untouched.
    expect(result.current.liveSegments).toEqual([{ kind: "text", text: "答二" }]);
    expect(result.current.liveTurns[0].segments.map((segment) => segment.kind)).toEqual([
      "reasoning",
      "text",
      "tools"
    ]);
    expect(result.current.liveTurns[1].segments).toEqual([{ kind: "text", text: "答二" }]);
  });

  it("splits turns from event payloads alone, without relying on turn_start", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    // No `turn_start` frame at all: the deltas' own `turn` still splits the run.
    act(() => harness.emit(observed(taskId, sessionId, { type: "token_delta", turn: 1, delta: "一" })));
    act(() => harness.emit(observed(taskId, sessionId, { type: "token_delta", turn: 2, delta: "二" })));

    expect(result.current.liveTurns.map((turn) => turn.turn)).toEqual([1, 2]);
    expect(result.current.liveTurns[0].segments).toEqual([{ kind: "text", text: "一" }]);
    expect(result.current.liveTurns[1].segments).toEqual([{ kind: "text", text: "二" }]);
    expect(result.current.liveSegments).toEqual([{ kind: "text", text: "二" }]);
  });

  it("closes the running turn when the turn boundary moves on", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() => harness.emit(observed(taskId, sessionId, { type: "token_delta", turn: 1, delta: "半" })));
    act(() => harness.emit(observed(taskId, sessionId, { type: "token_delta", turn: 2, delta: "半二" })));

    // Opening turn 2 is what settles turn 1, even with no `turn_end` for it:
    // cutting over swaps the segments array, and only one turn can be running.
    expect(result.current.liveTurns.map((turn) => turn.status)).toEqual(["done", "running"]);
  });

  it("hands a finished run's turns to the pile instead of flattening them onto the answer", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() => harness.emit(observed(taskId, sessionId, { type: "token_delta", turn: 1, delta: "一" })));
    act(() => harness.emit(observed(taskId, sessionId, { type: "turn_end", turn: 1, stats: { turn: 1, duration_ms: 10, tool_calls_count: 0 } })));
    act(() => harness.emit(observed(taskId, sessionId, { type: "turn_start", turn: 2, timestamp: 2 })));
    act(() => harness.emit(observed(taskId, sessionId, { type: "token_delta", turn: 2, delta: "二" })));
    expect(result.current.liveTurns).toHaveLength(2);

    await act(async () => {
      harness.resolveRun({ finalContent: "一二", finishReason: "done" });
    });

    // The pile outlives the run: both turns are still there, the one that never
    // saw `turn_end` settled, and each keeps only its own segments — so the
    // thinking and tool calls stay reachable through the dots.
    expect(result.current.liveTurns.map((turn) => turn.turn)).toEqual([1, 2]);
    expect(result.current.liveTurns.map((turn) => turn.status)).toEqual(["done", "done"]);
    expect(result.current.liveTurns[0].segments).toEqual([{ kind: "text", text: "一" }]);
    expect(result.current.liveTurns[1].segments).toEqual([{ kind: "text", text: "二" }]);

    // And the answer message is the text alone, not a second, flat copy of the
    // run under the reply.
    const answer = result.current.messages.at(-1);
    expect(answer?.content).toBe("一二");
    expect(answer?.segments).toBeUndefined();
    // The turns ride on the row too: that copy is what a reload paints the pile
    // from, once the session stream it was read off is gone.
    expect(answer?.turns?.map((turn) => turn.turn)).toEqual([1, 2]);
  });

  it("marks the running turn failed when the daemon reports an error", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() => harness.emit(observed(taskId, sessionId, { type: "token_delta", turn: 1, delta: "x" })));
    act(() => harness.emit(observed(taskId, sessionId, { type: "error", turn: 1, message: "boom" })));

    expect(result.current.liveTurns[0].status).toBe("error");
  });

  it("keeps every turn's thinking in the pile when a run is cancelled", async () => {
    const harness = installHarness();
    const { result } = renderHook(() => useThunderChat());
    const { taskId, sessionId } = await startTurn(result);

    act(() => harness.emit(observed(taskId, sessionId, { type: "reasoning_delta", turn: 1, delta: "轮一思考" })));
    act(() => harness.emit(observed(taskId, sessionId, { type: "turn_end", turn: 1, stats: { turn: 1, duration_ms: 10, tool_calls_count: 0 } })));
    act(() => harness.emit(observed(taskId, sessionId, { type: "reasoning_delta", turn: 2, delta: "轮二思考" })));

    await act(async () => {
      await result.current.cancelCurrentTask();
    });

    // `stream.segments` only points at turn 2, so a cancel that read it alone
    // would drop turn 1's reasoning; the pile is what holds both now.
    const reasoning = result.current.liveTurns
      .flatMap((turn) => turn.segments)
      .filter((segment): segment is Extract<typeof segment, { kind: "reasoning" }> => segment.kind === "reasoning")
      .map((segment) => segment.text);
    expect(reasoning).toEqual(["轮一思考", "轮二思考"]);
    expect(result.current.messages.at(-1)?.segments).toBeUndefined();
  });
});

describe("buildConversationRows", () => {
  it("folds a run's turns into the reply they add up to, and leaves the next run alone", () => {
    const rows = buildConversationRows([
      { role: "user", content: "first" },
      {
        role: "assistant",
        content: "looking",
        reasoning: "think one",
        stats: { turn: 1, duration_ms: 1200 },
        tool_calls: [{ id: "t1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } }]
      },
      { role: "tool", content: "out1", tool_call_id: "t1" },
      { role: "assistant", content: "done", stats: { turn: 2, duration_ms: 800 } },
      { role: "user", content: "second" },
      { role: "assistant", content: "again", stats: { turn: 1, duration_ms: 100 } }
    ]);

    // A user message is the run boundary: two runs, one row each.
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "user", "assistant"]);

    const first = rows[1];
    // The turns' text, glued in the order the stream produced it.
    expect(first.content).toBe("lookingdone");
    expect(first.turns?.map((turn) => turn.turn)).toEqual([1, 2]);
    // Thinking and tool calls moved into the turn the dot stands for, results
    // paired with their call, and nothing left to paint flat on the row.
    expect(first.reasoning).toBeUndefined();
    expect(first.tool_calls).toBeUndefined();
    expect(first.turns?.[0].segments).toEqual([
      { kind: "reasoning", text: "think one" },
      { kind: "text", text: "looking" },
      {
        kind: "tools",
        tools: [{ toolCallId: "t1", name: "bash", arguments: { command: "ls" }, result: "out1", isRunning: false }]
      }
    ]);
    expect(first.turns?.[0].toolCount).toBe(1);
    expect(first.turns?.[0].durationMs).toBe(1200);
    // A run on disk is over: its turns read as done, never as still running.
    expect(first.turns?.map((turn) => turn.status)).toEqual(["done", "done"]);

    // The second run starts its own numbering and its own pile.
    expect(rows[3].turns?.map((turn) => turn.turn)).toEqual([1]);
    expect(rows[3].content).toBe("again");
  });

  it("numbers a turn that never reached its turn_end by where it sits in the run", () => {
    const rows = buildConversationRows([
      { role: "user", content: "go" },
      { role: "assistant", content: "one", stats: { turn: 1 } },
      // Cut short: no `stats`, because the run died before this turn ended.
      { role: "assistant", content: "two" }
    ]);

    expect(rows[1].turns?.map((turn) => turn.turn)).toEqual([1, 2]);
  });

  it("keeps the run's tool calls on the row for the file-change scan", () => {
    const rows = buildConversationRows([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "one",
        tool_executions: [{ toolCallId: "t1", name: "write_file", arguments: { path: "/w/a.ts" } }]
      },
      {
        role: "assistant",
        content: "two",
        tool_executions: [{ toolCallId: "t2", name: "write_file", arguments: { path: "/w/b.ts" } }]
      }
    ]);

    // The pile owns their paint, but the scan reads them off the row.
    expect(rows[1].tool_executions?.map((tool) => tool.name)).toEqual(["write_file", "write_file"]);
  });
});
