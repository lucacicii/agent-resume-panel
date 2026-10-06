import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../bridge";
import type {
  ThunderChatMessage,
  ThunderConversation,
  ThunderConversationSummary,
  ThunderModelInfo,
  ThunderChatStreamPayload,
  ThunderFileChangeRecord,
  ThunderTurnStats,
  ThunderAgentStats,
  ThunderQuestionItem,
  ThunderImageAttachment,
  ThunderActiveStreamSnapshot
} from "@agent-resume/core";
import { useTraceCollector } from "./useTraceCollector";

export interface ChatRunMetrics {
  tps?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  durationMs?: number;
}

export interface ActiveToolInfo {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  isRunning?: boolean;
  isError?: boolean;
}

/**
 * One run of the in-flight turn, in the order its events arrived.
 *
 * The chat is a single chronological stream: thinking, the answer and tool
 * calls interleave the way they were produced instead of being regrouped into
 * one "thinking" lane above one "tools" lane above one "answer" lane.
 */
export type LiveSegment =
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tools"; tools: ActiveToolInfo[] };

/** A chat message plus the ordered segments this renderer watched it stream in. */
export type RenderedChatMessage = ThunderChatMessage & { segments?: LiveSegment[] };

interface SessionStream {
  taskId: string;
  streamingText: string;
  streamingReasoning: string;
  streamingTools: ActiveToolInfo[];
  segments: LiveSegment[];
}

/** Append a delta to the trailing run of the same kind, or open a new run. */
function appendDelta(segments: LiveSegment[], kind: "reasoning" | "text", delta: string): void {
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) {
    last.text += delta;
    return;
  }
  segments.push({ kind, text: delta });
}

/** Add a tool call to the trailing tool run, or open a new run. */
function appendTool(segments: LiveSegment[], tool: ActiveToolInfo): void {
  const last = segments[segments.length - 1];
  if (last && last.kind === "tools") {
    last.tools.push(tool);
    return;
  }
  segments.push({ kind: "tools", tools: [tool] });
}

/** Fold a tool result into the run that announced the call. */
function updateTool(
  segments: LiveSegment[],
  toolCallId: string,
  update: (tool: ActiveToolInfo) => ActiveToolInfo
): boolean {
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment.kind !== "tools") continue;
    const index = segment.tools.findIndex((t) => t.toolCallId === toolCallId);
    if (index !== -1) {
      segment.tools[index] = update(segment.tools[index]);
      return true;
    }
  }
  return false;
}

/**
 * Rebuild the ordered segments of an in-flight turn from the main process's
 * buffered event log, so a renderer that remounted mid-answer resumes with the
 * real interleaving instead of three regrouped lanes.
 */
function rebuildSegments(events: ThunderActiveStreamSnapshot["events"]): LiveSegment[] {
  const segments: LiveSegment[] = [];
  for (const observed of events) {
    const ev = observed?.event as { type?: string } & Record<string, any>;
    if (!ev?.type) continue;
    switch (ev.type) {
      case "token_delta":
        appendDelta(segments, "text", ev.delta || "");
        break;
      case "reasoning_delta":
        appendDelta(segments, "reasoning", ev.delta || "");
        break;
      case "tool_exec_start": {
        const toolCallId = String(ev.tool_call_id || `tool_${segments.length}`);
        const tool: ActiveToolInfo = {
          toolCallId,
          name: ev.name || "tool",
          arguments: ev.arguments || {},
          isRunning: true
        };
        if (!updateTool(segments, toolCallId, () => tool)) appendTool(segments, tool);
        break;
      }
      case "tool_exec_result": {
        const toolCallId = String(ev.tool_call_id || "");
        updateTool(segments, toolCallId, (tool) => ({
          ...tool,
          isRunning: false,
          result: ev.result?.output,
          isError: Boolean(ev.result?.is_error)
        }));
        break;
      }
    }
  }
  return segments;
}

/**
 * Freeze the live segments onto the finished message: tool runs stop spinning,
 * and a body that never streamed (a daemon `final_content`, or "(Cancelled)")
 * is appended as its own run so it still shows.
 */
function freezeSegments(segments: LiveSegment[], content: string): LiveSegment[] {
  const frozen: LiveSegment[] = segments.map((segment) =>
    segment.kind === "tools"
      ? {
          kind: "tools",
          tools: segment.tools.map((tool) => ({ ...tool, isRunning: false }))
        }
      : { ...segment }
  );
  const streamed = frozen
    .filter((segment): segment is { kind: "text"; text: string } => segment.kind === "text")
    .map((segment) => segment.text)
    .join("");
  if (!streamed && content) frozen.push({ kind: "text", text: content });
  return frozen;
}

function normalizeConversationMessages(rawMessages: ThunderChatMessage[]): ThunderChatMessage[] {
  const result: ThunderChatMessage[] = [];
  const toolResultsByCallId = new Map<string, string>();

  // Collect tool outputs first
  for (const msg of rawMessages) {
    if (msg.role === "tool" && msg.tool_call_id && msg.content) {
      toolResultsByCallId.set(msg.tool_call_id, msg.content);
    }
  }

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];
    if (msg.role === "system") {
      // The system prompt is engine plumbing, not conversation: the daemon
      // splices it into each request's prefix, so the feed must not render it.
      // Filtered explicitly rather than left to fall through the branches below.
      continue;
    }

    if (msg.role === "tool") {
      // Standalone tool messages are absorbed into the assistant turn's tool_executions
      continue;
    }

    if (msg.role === "user") {
      result.push(msg);
      continue;
    }

    if (msg.role === "assistant") {
      const executions: ActiveToolInfo[] = [];
      if (Array.isArray(msg.tool_executions)) {
        executions.push(...msg.tool_executions);
      } else if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let argsObj: Record<string, unknown> = {};
          try {
            argsObj = JSON.parse(tc.function.arguments);
          } catch {
            argsObj = { raw: tc.function.arguments };
          }
          executions.push({
            toolCallId: tc.id,
            name: tc.function.name,
            arguments: argsObj,
            result: toolResultsByCallId.get(tc.id),
            isRunning: false
          });
        }
      }

      // One block per engine step: the agent loop emits one assistant message
      // per step, and merging consecutive steps glued different turns' output
      // into one block. Keeping them apart is what makes the feed a faithful,
      // chronologically ordered transcript.
      result.push({
        ...msg,
        tool_executions: executions.length > 0 ? executions : msg.tool_executions
      });
    }
  }

  return result;
}

export function useThunderChat() {
  const [conversations, setConversations] = useState<ThunderConversationSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RenderedChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  /**
   * Input queued into the running task.
   *
   * `steering` enters at the next turn boundary (after the tool calls already
   * in flight), `followUp` only once the run has nothing else to do.
   */
  const [queued, setQueued] = useState<{ steering: string[]; followUp: string[] }>({
    steering: [],
    followUp: []
  });

  /**
   * The in-flight turn, in the exact order its events arrived. Cleared when the
   * run finalizes; the finished message keeps the same segments so the feed
   * does not reflow when the answer lands.
   */
  const [liveSegments, setLiveSegments] = useState<LiveSegment[]>([]);

  // Composer prefill trigger for editing previous prompts
  const [composerPrefill, setComposerPrefill] = useState<{ text: string; id: number } | null>(null);

  // Environment & configuration
  const [models, setModels] = useState<ThunderModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [thinkingLevel, setThinkingLevel] = useState<string>("");
  const [workspaceSource, setWorkspaceSource] = useState<"finder" | "gtd">(() => {
    try {
      return (localStorage.getItem("chat-workspace-source") as "finder" | "gtd") || "finder";
    } catch {
      return "finder";
    }
  });
  const [taskNoteId, setTaskNoteId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("chat-selected-task-note-id") || null;
    } catch {
      return null;
    }
  });
  const [workspaceDir, setWorkspaceDir] = useState<string>(() => {
    try {
      return (
        localStorage.getItem("chat-selected-workspace") ||
        localStorage.getItem("workbench-selected-project") ||
        ""
      );
    } catch {
      return "";
    }
  });
  const [daemonStatus, setDaemonStatus] = useState<{
    available: boolean;
    repoPath: string | null;
    daemonPath: string | null;
    models: ThunderModelInfo[];
    /** Discovery rule that matched (env / settings / bundled / dev-sibling / …). */
    source?: string;
    /** Paths probed, in priority order. */
    candidates?: string[];
    error?: string;
  } | null>(null);

  // Performance & Token metrics
  const [lastRunMetrics, setLastRunMetrics] = useState<ChatRunMetrics | null>(null);
  const [titleNotice, setTitleNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [sessionTotalTokens, setSessionTotalTokens] = useState<number>(0);
  const [currentContextTokens, setCurrentContextTokens] = useState<number>(0);
  const [streamTokensCount, setStreamTokensCount] = useState(0);
  const [streamReasoningCount, setStreamReasoningCount] = useState(0);
  const [streamStartTime, setStreamStartTime] = useState<number | null>(null);

  // A question the agent is blocked on; rendered as a bubble until answered.
  const [pendingQuestion, setPendingQuestion] = useState<{
    questionId: string;
    taskId: string;
    questions: ThunderQuestionItem[];
  } | null>(null);

  // End-to-end task trace and file modification tracking
  const {
    currentTrace,
    spans: traceSpans,
    fileChanges,
    telemetryNotices,
    isCollecting: isCollectingTrace,
    startTaskTrace,
    recordEvent: recordTraceEvent,
    finishTaskTrace,
    loadTrace,
    restoreFromSnapshot,
    resetTrace,
    setFileChanges
  } = useTraceCollector();

  const activeTaskIdRef = useRef<string | null>(null);
  activeTaskIdRef.current = activeTaskId;

  const activeSessionIdRef = useRef<string | null>(null);
  activeSessionIdRef.current = activeSessionId;

  const activeStreamsRef = useRef<Map<string, SessionStream>>(new Map());
  const finalizedTasksRef = useRef<Set<string>>(new Set());

  const refreshDaemonStatus = useCallback(async () => {
    try {
      const status = await desktopApi().thunderGetStatus();
      setDaemonStatus(status);
      if (status.models && status.models.length > 0) {
        setModels(status.models);
        setSelectedModel((prev) => {
          if (prev && status.models.some((m) => (m.selection_id || m.id) === prev)) {
            return prev;
          }
          return status.models[0].selection_id || status.models[0].id;
        });
        setThinkingLevel((prev) => {
          if (prev) return prev;
          const target = status.models[0];
          return target?.default_thinking_level || (target?.reasoning ? "medium" : "off");
        });
      }
    } catch (err) {
      console.warn("Failed to get thunder daemon status:", err);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      setLoading(true);
      const list = await desktopApi().thunderChatListConversations();
      setConversations(list);
    } catch (err) {
      console.error("Failed to load conversations:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectSession = useCallback(async (sessionId: string) => {
    try {
      setLoading(true);
      setActiveSessionId(sessionId);
      const conv = await desktopApi().thunderChatGetConversation({ sessionId });
      if (conv) {
        if (conv.model) {
          setSelectedModel(conv.model);
        }
        if (conv.workspace) {
          setWorkspaceDir(conv.workspace);
          try {
            localStorage.setItem("chat-selected-workspace", conv.workspace);
          } catch {
            // ignore
          }
        }

        // Restore GTD task binding if session is associated with a task
        if (typeof desktopApi().notesTaskNoteIdForSession === "function") {
          try {
            const linkedNoteId = await desktopApi().notesTaskNoteIdForSession({
              provider: "chat",
              sessionId
            });
            if (linkedNoteId) {
              setTaskNoteId(linkedNoteId);
              setWorkspaceSource("gtd");
              try {
                localStorage.setItem("chat-workspace-source", "gtd");
                localStorage.setItem("chat-selected-task-note-id", linkedNoteId);
              } catch {
                // ignore
              }
            } else if (conv.workspace && conv.workspace.includes("/workspaces/")) {
              const match = conv.workspace.match(/\/workspaces\/([a-zA-Z0-9_-]+)/);
              if (match && match[1]) {
                setTaskNoteId(match[1]);
                setWorkspaceSource("gtd");
                try {
                  localStorage.setItem("chat-workspace-source", "gtd");
                  localStorage.setItem("chat-selected-task-note-id", match[1]);
                } catch {
                  // ignore
                }
              } else {
                setTaskNoteId(null);
                setWorkspaceSource("finder");
              }
            } else {
              setTaskNoteId(null);
              setWorkspaceSource("finder");
            }
          } catch {
            // ignore
          }
        }
        if (conv.thinking_level) {
          setThinkingLevel(conv.thinking_level);
        } else if (conv.model) {
          const target = models.find((m) => (m.selection_id || m.id) === conv.model);
          if (target?.default_thinking_level) {
            setThinkingLevel(target.default_thinking_level);
          }
        }
        if (Array.isArray(conv.messages)) {
          setMessages(normalizeConversationMessages(conv.messages));

          // Backfill file modification records from conversation tool calls
          const extractedFiles: ThunderFileChangeRecord[] = [];
          for (const msg of conv.messages) {
            if (Array.isArray(msg.tool_executions)) {
              for (const te of msg.tool_executions) {
                if (te.name === "write_file") {
                  const p = (te.arguments?.path as string) || "";
                  if (p) {
                    extractedFiles.push({
                      path: p,
                      tool: "write_file",
                      action: te.isError ? "failed" : "written",
                      timestamp: conv.updated_at_ms || Date.now()
                    });
                  }
                }
              }
            }
          }
          if (extractedFiles.length > 0) {
            setFileChanges(extractedFiles);
          }
        } else {
          setMessages([]);
        }
      } else {
        setMessages([]);
      }
      // Track session total tokens. Prefer the daemon's cumulative provider usage
      // (includes cache reads/writes); `total_tokens` is only the working-context
      // estimate and used to mix in fresh usage on every save.
      const totTokens = conv?.stats?.total_used_tokens ?? conv?.stats?.total_tokens ?? 0;
      setSessionTotalTokens(totTokens);

      // Estimate current context occupancy. Prefer the daemon's estimated working
      // context; fall back to per-message stats and finally a rough character
      // heuristic when older conversations carry neither.
      let ctxTokens = 0;
      const lastAssistant = [...(conv?.messages || [])].reverse().find((m) => m.role === "assistant");
      if (lastAssistant?.stats?.prompt_tokens && lastAssistant?.stats?.completion_tokens) {
        ctxTokens = lastAssistant.stats.prompt_tokens + lastAssistant.stats.completion_tokens;
      } else if (typeof conv?.stats?.total_tokens === "number" && conv.stats.total_tokens > 0) {
        ctxTokens = conv.stats.total_tokens;
      } else if (Array.isArray(conv?.messages) && conv.messages.length > 0) {
        ctxTokens = conv.messages.reduce(
          (acc, m) => acc + Math.max(1, Math.ceil((m.content || "").length / 3)),
          0
        );
      }
      setCurrentContextTokens(ctxTokens);

      // Check if this session has an active background stream
      let stream = activeStreamsRef.current.get(sessionId);
      let snapshot: ThunderActiveStreamSnapshot | null = null;
      const lastMsg = Array.isArray(conv?.messages) && conv.messages.length > 0
        ? conv.messages[conv.messages.length - 1]
        : null;
      if (stream && lastMsg && lastMsg.role === "assistant" && lastMsg.content) {
        // If the persisted conversation already has the assistant's response, clean up stale background stream
        activeStreamsRef.current.delete(sessionId);
        stream = undefined;
      }
      if (!stream) {
        // This renderer may have unmounted while the daemon kept streaming; the
        // main process buffered the in-flight task so we can resume it here.
        snapshot = await desktopApi()
          .thunderChatGetActiveStream({ sessionId })
          .catch(() => null);
        if (snapshot && !snapshot.isRunning) snapshot = null;
        if (snapshot) {
          stream = {
            taskId: snapshot.taskId,
            streamingText: snapshot.streamingText,
            streamingReasoning: snapshot.streamingReasoning,
            streamingTools: snapshot.streamingTools,
            segments: rebuildSegments(snapshot.events)
          };
          activeStreamsRef.current.set(sessionId, stream);
        }
      }
      if (stream) {
        setIsStreaming(true);
        setActiveTaskId(stream.taskId);
        setLiveSegments(stream.segments);
      } else {
        setIsStreaming(false);
        setActiveTaskId(null);
        setLiveSegments([]);
      }

      // Load persistent trace for this conversation and populate run metrics
      const trace = await loadTrace(sessionId);
      if (trace?.stats) {
        setLastRunMetrics({
          tps: trace.stats.avg_tokens_per_second,
          promptTokens: trace.stats.total_prompt_tokens,
          completionTokens: trace.stats.total_completion_tokens,
          cachedTokens: trace.stats.total_cached_tokens ?? 0,
          reasoningTokens: trace.stats.total_reasoning_tokens,
          totalTokens: (trace.stats.total_prompt_tokens || 0) + (trace.stats.total_completion_tokens || 0),
          // Prefer the daemon's wall-clock task time (user message -> task end)
          durationMs: trace.wall_duration_ms ?? trace.stats.total_duration_ms ?? trace.duration_ms
        });
      } else if (trace && typeof trace.wall_duration_ms === "number") {
        setLastRunMetrics({
          durationMs: trace.wall_duration_ms ?? trace.duration_ms,
          cachedTokens: 0
        });
      } else if (conv && conv.stats) {
        setLastRunMetrics({
          totalTokens: conv.stats.total_used_tokens ?? conv.stats.total_tokens,
          durationMs: conv.stats.duration_ms,
          cachedTokens: 0
        });
      } else {
        setLastRunMetrics(null);
      }

      // Replace the disk trace with the live in-flight trace when resuming.
      if (snapshot) {
        restoreFromSnapshot(snapshot);
      }
    } catch (err) {
      console.error("Failed to load conversation:", err);
    } finally {
      setLoading(false);
    }
  }, [loadTrace, models, restoreFromSnapshot, setFileChanges]);

  const createNewSession = useCallback(() => {
    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    setMessages([]);
    setIsStreaming(false);
    setActiveTaskId(null);
    // A bubble belongs to the session that raised it.
    setPendingQuestion(null);
    setQueued({ steering: [], followUp: [] });
    setLiveSegments([]);
    setSessionTotalTokens(0);
    setCurrentContextTokens(0);
    resetTrace();
    const target = models.find((m) => (m.selection_id || m.id) === selectedModel);
    if (target) {
      const nextDef = target.default_thinking_level || (target.reasoning ? "medium" : "off");
      setThinkingLevel(nextDef);
    }
  }, [models, resetTrace, selectedModel]);

  const setWorkspaceGtdTask = useCallback((noteId: string, dir: string) => {
    setTaskNoteId(noteId);
    setWorkspaceSource("gtd");
    setWorkspaceDir(dir);
    try {
      localStorage.setItem("chat-workspace-source", "gtd");
      localStorage.setItem("chat-selected-task-note-id", noteId);
      localStorage.setItem("chat-selected-workspace", dir);
    } catch {
      // ignore
    }
  }, []);

  const setWorkspaceFinderDir = useCallback((dir: string) => {
    setTaskNoteId(null);
    setWorkspaceSource("finder");
    setWorkspaceDir(dir);
    try {
      localStorage.setItem("chat-workspace-source", "finder");
      localStorage.setItem("chat-selected-task-note-id", "");
      localStorage.setItem("chat-selected-workspace", dir);
    } catch {
      // ignore
    }
  }, []);

  const handleSelectModel = useCallback(
    (modelId: string) => {
      setSelectedModel(modelId);
      const target = models.find((m) => (m.selection_id || m.id) === modelId);
      if (target) {
        const nextDef = target.default_thinking_level || (target.reasoning ? "medium" : "off");
        setThinkingLevel(nextDef);
      }
    },
    [models]
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await desktopApi().thunderChatDeleteConversation({ sessionId });
        if (activeSessionId === sessionId) {
          createNewSession();
        }
        await loadConversations();
      } catch (err) {
        console.error("Failed to delete conversation:", err);
      }
    },
    [activeSessionId, createNewSession, loadConversations]
  );

  /** AI-rename a conversation via the daemon's utility model; surfaces errors to the UI. */
  const aiRenameSession = useCallback(
    async (sessionId: string, force = false) => {
      const res = await desktopApi()
        .thunderChatGenerateTitle({ sessionId, force })
        .catch((err) => ({ ok: false as const, errorKind: "unknown", error: String(err) }));
      if (res.ok && res.title) {
        setTitleNotice({ kind: "success", text: `已重命名：「${res.title}」` });
      } else {
        setTitleNotice({
          kind: "error",
          text: `AI 命名失败${res.errorKind ? ` (${res.errorKind})` : ""}：${res.error || "未知错误"}`
        });
      }
      await loadConversations();
    },
    [loadConversations]
  );

  /** Manually rename a conversation; manual titles are protected from auto-renames. */
  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      const res = await desktopApi()
        .thunderChatSetTitle({ sessionId, title })
        .catch((err) => ({ ok: false as const, errorKind: "unknown", error: String(err) }));
      if (res.ok) {
        setTitleNotice({ kind: "success", text: `已重命名：「${res.title || title}」` });
      } else {
        setTitleNotice({
          kind: "error",
          text: `重命名失败${res.errorKind ? ` (${res.errorKind})` : ""}：${res.error || "未知错误"}`
        });
      }
      await loadConversations();
      return res.ok;
    },
    [loadConversations]
  );

  const dismissTitleNotice = useCallback(() => setTitleNotice(null), []);

  const finalizeSessionTurn = useCallback(
    (opts: {
      sessionId: string;
      taskId?: string;
      finalContent?: string;
      finalReasoning?: string;
      finalTools?: ActiveToolInfo[];
      finalSegments?: LiveSegment[];
      finishReason?: string;
    }) => {
      const { sessionId, taskId, finishReason } = opts;
      const streamState = activeStreamsRef.current.get(sessionId);
      const effectiveTaskId = taskId || streamState?.taskId;

      // Idempotency: if already finalized for this task, do not duplicate message or stats
      if (effectiveTaskId && finalizedTasksRef.current.has(effectiveTaskId)) {
        return;
      }
      if (effectiveTaskId) {
        finalizedTasksRef.current.add(effectiveTaskId);
        if (finalizedTasksRef.current.size > 200) {
          const first = finalizedTasksRef.current.values().next().value;
          if (first) finalizedTasksRef.current.delete(first);
        }
      }

      const content = opts.finalContent ?? streamState?.streamingText ?? "";
      const reasoning = opts.finalReasoning ?? streamState?.streamingReasoning ?? undefined;
      const rawTools = opts.finalTools ?? (streamState && streamState.streamingTools.length > 0 ? streamState.streamingTools : undefined);
      const segments = opts.finalSegments ?? streamState?.segments;
      const toolExecutions = rawTools?.map((t) => ({
        toolCallId: t.toolCallId,
        name: t.name,
        arguments: t.arguments,
        result: t.result,
        isError: t.isError,
        isRunning: false
      }));

      // Finish trace collector span/timing
      finishTaskTrace({
        finishReason: finishReason || "Done",
        finalContent: content
      });

      const assistantMsg: RenderedChatMessage = {
        role: "assistant",
        content: content || "(No response output)",
        reasoning: reasoning || undefined,
        tool_executions: toolExecutions,
        segments: segments && segments.length > 0 ? freezeSegments(segments, content) : undefined
      };

      const isCurrentSession = activeSessionIdRef.current === sessionId;

      if (isCurrentSession) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last?.content === assistantMsg.content) {
            return prev;
          }
          return [...prev, assistantMsg];
        });
        setPendingQuestion(null);
        setLiveSegments([]);
        setStreamTokensCount(0);
        setStreamReasoningCount(0);
        setStreamStartTime(null);
        setIsStreaming(false);
        setActiveTaskId(null);
        setQueued({ steering: [], followUp: [] });

        // Guarantee sync with finalized trace metrics on disk
        void (async () => {
          try {
            const latestTrace = await loadTrace(sessionId, effectiveTaskId);
            if (latestTrace?.stats) {
              setLastRunMetrics({
                tps: latestTrace.stats.avg_tokens_per_second,
                promptTokens: latestTrace.stats.total_prompt_tokens,
                completionTokens: latestTrace.stats.total_completion_tokens,
                cachedTokens: latestTrace.stats.total_cached_tokens ?? 0,
                reasoningTokens: latestTrace.stats.total_reasoning_tokens,
                totalTokens: (latestTrace.stats.total_prompt_tokens || 0) + (latestTrace.stats.total_completion_tokens || 0),
                // Prefer the daemon's wall-clock task time (user message -> task end)
                durationMs: latestTrace.wall_duration_ms ?? latestTrace.stats.total_duration_ms ?? latestTrace.duration_ms
              });
            } else if (latestTrace && typeof latestTrace.wall_duration_ms === "number") {
              setLastRunMetrics({
                durationMs: latestTrace.wall_duration_ms ?? latestTrace.duration_ms,
                cachedTokens: 0
              });
            }
          } catch {
            // keep live metrics
          }
        })();
      }

      // Always clear the stream from active streams map
      activeStreamsRef.current.delete(sessionId);
    },
    [finishTaskTrace, loadTrace]
  );

  const sendMessage = useCallback(
    async (
      prompt: string,
      options?: {
        model?: string;
        workspaceDir?: string;
        thinking_level?: string;
        attachments?: ThunderImageAttachment[];
      }
    ) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;

      const effectiveSessionId = activeSessionIdRef.current || `sess_${Date.now()}`;
      if (!activeSessionIdRef.current) {
        setActiveSessionId(effectiveSessionId);
        activeSessionIdRef.current = effectiveSessionId;
      }

      // Prevent starting duplicate tasks in the same session while it is streaming
      if (activeStreamsRef.current.has(effectiveSessionId)) return;

      const parts = options?.attachments?.length
        ? [
            { type: "text" as const, text: trimmed },
            ...options.attachments.map((att) => ({
              type: "image" as const,
              mimeType: att.mimeType || "image/png",
              data: att.data,
              path: att.path,
              name: att.name
            }))
          ]
        : undefined;

      const userMsg: ThunderChatMessage = {
        role: "user",
        content: trimmed,
        parts
      };

      setMessages((prev) => [...prev, userMsg]);
      setLiveSegments([]);
      setStreamTokensCount(0);
      setStreamReasoningCount(0);
      setStreamStartTime(null);
      setIsStreaming(true);

      const taskId = `task_${Date.now()}`;
      setActiveTaskId(taskId);

      activeStreamsRef.current.set(effectiveSessionId, {
        taskId,
        streamingText: "",
        streamingReasoning: "",
        streamingTools: [],
        segments: []
      });

      const model = options?.model || selectedModel || (models[0]?.selection_id ?? "mock");
      const currentModelInfo = models.find((m) => (m.selection_id || m.id) === model);
      const thinking =
        options?.thinking_level ||
        thinkingLevel ||
        currentModelInfo?.default_thinking_level ||
        (currentModelInfo?.reasoning ? "medium" : "off");
      const ws =
        options?.workspaceDir ||
        workspaceDir ||
        (() => {
          try {
            return (
              localStorage.getItem("chat-selected-workspace") ||
              localStorage.getItem("workbench-selected-project") ||
              undefined
            );
          } catch {
            return undefined;
          }
        })();

      if (ws && ws !== workspaceDir) {
        setWorkspaceDir(ws);
      }

      startTaskTrace({
        taskId,
        sessionId: effectiveSessionId,
        model,
        workspaceDir: ws,
        prompt: trimmed
      });

      try {
        const effectiveTaskNoteId =
          workspaceSource === "gtd" && taskNoteId ? taskNoteId : undefined;

        const result = await desktopApi().thunderChatRunTask({
          taskId,
          prompt: trimmed,
          sessionId: effectiveSessionId,
          model,
          workspaceDir: ws,
          taskNoteId: effectiveTaskNoteId,
          thinking_level: thinking,
          attachments: options?.attachments
        });

        // Task finalized via IPC invoke return
        finalizeSessionTurn({
          sessionId: effectiveSessionId,
          taskId,
          finalContent: result.finalContent,
          finishReason: result.finishReason
        });

        // Reload conversation list and session if newly created
        await loadConversations();
      } catch (err) {
        console.error("Thunder task execution failed:", err);
        if (!finalizedTasksRef.current.has(taskId)) {
          finishTaskTrace({
            finishReason: "error",
            finalContent: err instanceof Error ? err.message : String(err)
          });
          const errMsg: ThunderChatMessage = {
            role: "assistant",
            content: `⚠️ **Task failed**: ${err instanceof Error ? err.message : String(err)}`
          };
          if (activeSessionIdRef.current === effectiveSessionId) {
            setMessages((prev) => [...prev, errMsg]);
            setPendingQuestion(null);
            setIsStreaming(false);
            setActiveTaskId(null);
          }
        }
      } finally {
        activeStreamsRef.current.delete(effectiveSessionId);
        if (activeSessionIdRef.current === effectiveSessionId) {
          setIsStreaming(false);
          setActiveTaskId(null);
        }
      }
    },
    [finalizeSessionTurn, finishTaskTrace, loadConversations, models, selectedModel, startTaskTrace, taskNoteId, thinkingLevel, workspaceDir, workspaceSource]
  );

  const prefillComposer = useCallback((text: string) => {
    setComposerPrefill({ text, id: Date.now() });
  }, []);

  const resendUserMessage = useCallback(
    async (userIndex: number, options?: { model?: string; workspaceDir?: string }) => {
      if (isStreaming || userIndex < 0 || userIndex >= messages.length) return;
      const targetMsg = messages[userIndex];
      if (targetMsg.role !== "user" || !targetMsg.content) return;

      const prompt = targetMsg.content;

      // Truncate in-memory messages to before this user message
      setMessages((prev) => prev.slice(0, userIndex));

      // Truncate disk conversation if active session exists
      if (activeSessionId) {
        try {
          await desktopApi().thunderChatTruncateConversation({
            sessionId: activeSessionId,
            keepCount: userIndex
          });
        } catch (err) {
          console.warn("Failed to truncate disk conversation on resend:", err);
        }
      }

      // Extract attachments from the user message if it had any
      const attachments: ThunderImageAttachment[] = [];
      for (const p of targetMsg.parts || []) {
        if (p.type === "image") {
          attachments.push({
            mimeType: p.mimeType,
            data: p.data,
            path: p.path,
            name: p.name
          });
        }
      }

      // Re-send the prompt
      await sendMessage(prompt, {
        ...options,
        attachments: attachments.length > 0 ? attachments : undefined
      });
    },
    [activeSessionId, isStreaming, messages, sendMessage]
  );

  const regenerateResponse = useCallback(
    async (assistantIndex: number, options?: { model?: string; workspaceDir?: string }) => {
      if (isStreaming || assistantIndex < 0 || assistantIndex >= messages.length) return;

      // Find preceding user prompt
      let userIndex = -1;
      for (let i = assistantIndex - 1; i >= 0; i--) {
        if (messages[i].role === "user" && messages[i].content) {
          userIndex = i;
          break;
        }
      }

      if (userIndex === -1) return;

      const targetUser = messages[userIndex];
      const prompt = targetUser.content!;
      const attachments: ThunderImageAttachment[] = [];
      for (const p of targetUser.parts || []) {
        if (p.type === "image") {
          attachments.push({
            mimeType: p.mimeType,
            data: p.data,
            path: p.path,
            name: p.name
          });
        }
      }

      // Truncate in-memory messages to before this user turn
      setMessages((prev) => prev.slice(0, userIndex));

      // Truncate disk conversation
      if (activeSessionId) {
        try {
          await desktopApi().thunderChatTruncateConversation({
            sessionId: activeSessionId,
            keepCount: userIndex
          });
        } catch (err) {
          console.warn("Failed to truncate disk conversation on regenerate:", err);
        }
      }

      // Re-send the prompt
      await sendMessage(prompt, {
        ...options,
        attachments: attachments.length > 0 ? attachments : undefined
      });
    },
    [activeSessionId, isStreaming, messages, sendMessage]
  );

  const answerQuestion = useCallback(
    async (answers: Record<string, string> | undefined, cancelled = false) => {
      const pending = pendingQuestion;
      if (!pending) return;
      setPendingQuestion(null);
      try {
        await desktopApi().thunderChatAnswerQuestion({
          questionId: pending.questionId,
          answers,
          cancelled
        });
      } catch (err) {
        console.warn("[thunder-chat] failed to answer question:", err);
      }
    },
    [pendingQuestion]
  );

  const dismissQuestion = useCallback(async () => {
    await answerQuestion(undefined, true);
  }, [answerQuestion]);

  /**
   * Queue text into the running task.
   *
   * `steer` enters at the next turn boundary — after the tool calls already in
   * flight, before the next model request — and can keep alive a run that was
   * about to conclude. `follow_up` enters only once the run has nothing else
   * to do. Neither interrupts a tool that is executing.
   */
  const queueIntoRunningTask = useCallback(
    async (
      message: string,
      behavior: "steer" | "follow_up",
      attachments?: ThunderImageAttachment[]
    ): Promise<boolean> => {
      const text = message.trim();
      const targetTaskId = activeTaskIdRef.current;
      if ((!text && !attachments?.length) || !targetTaskId) return false;
      try {
        const result = await desktopApi().thunderChatSteerTask({
          taskId: targetTaskId,
          message: text,
          behavior,
          attachments
        });
        return result !== null;
      } catch (err) {
        console.error("Failed to queue message into thunder task:", err);
        return false;
      }
    },
    []
  );

  const steerRunningTask = useCallback(
    (message: string, attachments?: ThunderImageAttachment[]) =>
      queueIntoRunningTask(message, "steer", attachments),
    [queueIntoRunningTask]
  );

  const followUpRunningTask = useCallback(
    (message: string, attachments?: ThunderImageAttachment[]) =>
      queueIntoRunningTask(message, "follow_up", attachments),
    [queueIntoRunningTask]
  );

  const cancelCurrentTask = useCallback(async () => {
    const curSessId = activeSessionIdRef.current;
    const stream = curSessId ? activeStreamsRef.current.get(curSessId) : null;
    const targetTaskId = stream?.taskId || activeTaskIdRef.current;
    if (!targetTaskId && !isStreaming) return;

    // Hand queued input back to the composer before cancelling: dropping it
    // silently is the one thing a user cannot recover from.
    if (targetTaskId) {
      try {
        const cleared = await desktopApi().thunderChatClearTaskQueue({ taskId: targetTaskId });
        const restored = [...(cleared?.steering ?? []), ...(cleared?.followUp ?? [])]
          .filter((t) => t.trim())
          .join("\n\n");
        if (restored) prefillComposer(restored);
      } catch {
        // Best-effort: the cancel below must still happen.
      }
      setQueued({ steering: [], followUp: [] });
    }

    // Cancelling frees a parked question: tell the daemon so its routing table
    // does not keep a dangling oneshot, then drop the bubble locally.
    setPendingQuestion((prev) => {
      if (prev && (!targetTaskId || prev.taskId === targetTaskId)) {
        void desktopApi()
          .thunderChatAnswerQuestion({ questionId: prev.questionId, cancelled: true })
          .catch(() => undefined);
        return null;
      }
      return prev;
    });

    // Force stop locally immediately so UI never gets stuck
    if (curSessId && stream) {
      finalizeSessionTurn({
        sessionId: curSessId,
        taskId: targetTaskId || stream.taskId,
        finalContent: stream.streamingText || "(Cancelled)",
        finalReasoning: stream.streamingReasoning || undefined,
        finalTools: stream.streamingTools.length > 0 ? stream.streamingTools : undefined,
        finalSegments: stream.segments,
        finishReason: "cancelled"
      });
    } else {
      setIsStreaming(false);
      setActiveTaskId(null);
      setLiveSegments([]);
      setStreamTokensCount(0);
      setStreamReasoningCount(0);
      setStreamStartTime(null);
    }

    try {
      if (targetTaskId) {
        await desktopApi().thunderChatCancelTask({ taskId: targetTaskId });
      }
    } catch (err) {
      console.error("Failed to cancel thunder task:", err);
    }
  }, [finalizeSessionTurn, isStreaming, prefillComposer]);

  // Subscribe to real-time events from Thunder daemon
  useEffect(() => {
    const unsub = desktopApi().onThunderChatEvent((payload: ThunderChatStreamPayload) => {
      const { taskId, sessionId, event } = payload;
      const ev = event?.event;
      if (!ev) return;

      const isCurrentSession = activeSessionIdRef.current === sessionId;

      let stream = activeStreamsRef.current.get(sessionId);
      if (!stream) {
        stream = {
          taskId,
          streamingText: "",
          streamingReasoning: "",
          streamingTools: [],
          segments: []
        };
        activeStreamsRef.current.set(sessionId, stream);
      }
      const activeStream = stream;

      // One state write per event keeps the transcript in true time order: the
      // segments are mutated in place and a shallow copy is published, so React
      // re-renders the live turn without the hook rebuilding the array itself.
      const publishSegments = () => {
        if (isCurrentSession) setLiveSegments([...activeStream.segments]);
      };

      switch (ev.type) {
        case "token_delta": {
          const delta = (ev as any).delta || "";
          stream.streamingText += delta;
          appendDelta(stream.segments, "text", delta);
          if (isCurrentSession) {
            publishSegments();
            setStreamTokensCount((prev) => prev + 1);
            setStreamStartTime((prev) => prev || Date.now());
          }
          break;
        }
        case "reasoning_delta": {
          const delta = (ev as any).delta || "";
          stream.streamingReasoning += delta;
          appendDelta(stream.segments, "reasoning", delta);
          if (isCurrentSession) {
            publishSegments();
            setStreamTokensCount((prev) => prev + 1);
            setStreamReasoningCount((prev) => prev + 1);
            setStreamStartTime((prev) => prev || Date.now());
          }
          break;
        }
        case "tool_exec_start": {
          const toolCallId = (ev as any).tool_call_id || `tool_${Date.now()}`;
          const name = (ev as any).name || "tool";
          const args = (ev as any).arguments || {};
          const exists = stream.streamingTools.find((t) => t.toolCallId === toolCallId);
          if (!exists) {
            const tool: ActiveToolInfo = { toolCallId, name, arguments: args, isRunning: true };
            stream.streamingTools.push(tool);
            if (!updateTool(stream.segments, toolCallId, () => tool)) {
              appendTool(stream.segments, tool);
            }
          }
          publishSegments();
          break;
        }
        case "tool_exec_result": {
          const toolCallId = (ev as any).tool_call_id;
          const result = (ev as any).result;
          stream.streamingTools = stream.streamingTools.map((t) => {
            if (t.toolCallId === toolCallId) {
              return {
                ...t,
                isRunning: false,
                result: result?.output,
                isError: Boolean(result?.is_error)
              };
            }
            return t;
          });
          updateTool(stream.segments, toolCallId, (t) => ({
            ...t,
            isRunning: false,
            result: result?.output,
            isError: Boolean(result?.is_error)
          }));
          publishSegments();
          break;
        }
        case "turn_end": {
          const stats = (ev as any).stats as ThunderTurnStats | undefined;
          if (stats && isCurrentSession) {
            const pt = typeof stats.prompt_tokens === "number" ? stats.prompt_tokens : undefined;
            const ct = typeof stats.completion_tokens === "number" ? stats.completion_tokens : undefined;
            const cached = typeof stats.cached_tokens === "number"
              ? stats.cached_tokens
              : (pt !== undefined ? 0 : undefined);
            const reasoning = typeof stats.reasoning_tokens === "number" ? stats.reasoning_tokens : undefined;
            const dur = typeof stats.duration_ms === "number" ? stats.duration_ms : 0;
            const tps = typeof stats.tokens_per_second === "number" && Number.isFinite(stats.tokens_per_second)
              ? stats.tokens_per_second
              : (dur > 0 && ct !== undefined ? ct / (dur / 1000) : undefined);
            const turnTotal = (pt !== undefined || ct !== undefined) ? (pt || 0) + (ct || 0) : undefined;
            setLastRunMetrics({
              tps,
              promptTokens: pt,
              completionTokens: ct,
              cachedTokens: cached,
              reasoningTokens: reasoning,
              totalTokens: turnTotal,
              durationMs: dur
            });

            if (turnTotal !== undefined && turnTotal > 0) {
              setSessionTotalTokens((prev) => prev + turnTotal);
              setCurrentContextTokens(turnTotal);
            }
          }
          break;
        }
        case "loop_complete": {
          const stats = (ev as any).stats as ThunderAgentStats | undefined;
          const finishReason = (ev as any).finish_reason as string | undefined;
          const finalContent = (ev as any).final_content as string | undefined;

          if (stats && isCurrentSession) {
            const pt = typeof stats.total_prompt_tokens === "number" ? stats.total_prompt_tokens : undefined;
            const ct = typeof stats.total_completion_tokens === "number" ? stats.total_completion_tokens : undefined;
            const cached = typeof stats.total_cached_tokens === "number" ? stats.total_cached_tokens : 0;
            const reasoning = typeof stats.total_reasoning_tokens === "number" ? stats.total_reasoning_tokens : undefined;
            const dur = typeof stats.total_duration_ms === "number" ? stats.total_duration_ms : 0;
            const tps = typeof stats.avg_tokens_per_second === "number" && Number.isFinite(stats.avg_tokens_per_second)
              ? stats.avg_tokens_per_second
              : (dur > 0 && ct !== undefined ? ct / (dur / 1000) : undefined);
            const total = (pt !== undefined || ct !== undefined) ? (pt || 0) + (ct || 0) : undefined;
            setLastRunMetrics({
              tps,
              promptTokens: pt,
              completionTokens: ct,
              cachedTokens: cached,
              reasoningTokens: reasoning,
              totalTokens: total,
              durationMs: dur
            });
          }

          // Authoritative loop completion from daemon: finalize turn immediately without waiting for disk trace
          finalizeSessionTurn({
            sessionId,
            taskId,
            finalContent,
            finishReason: finishReason ? String(finishReason) : "done"
          });
          break;
        }
        case "user_question": {
          const q = ev as any;
          setPendingQuestion({
            questionId: String(q.question_id || ""),
            taskId,
            questions: Array.isArray(q.questions) ? q.questions : []
          });
          break;
        }
        case "task_paused": {
          console.info("[thunder-event:task_paused]", (ev as any).reason);
          break;
        }
        case "steer_accepted": {
          // The queued message has joined the run: show it now rather than
          // waiting for the turn to finish.
          const text = String((ev as any).message || "");
          if (isCurrentSession && text) {
            setMessages((prev) => [...prev, { role: "user", content: text }]);
          }
          break;
        }
        case "task_queue_update": {
          if (isCurrentSession) {
            const steering = (ev as any).steering;
            const followUp = (ev as any).follow_up;
            setQueued({
              steering: Array.isArray(steering) ? steering : [],
              followUp: Array.isArray(followUp) ? followUp : []
            });
          }
          break;
        }
        case "error": {
          console.warn("[thunder-event:error]", (ev as any).message);
          break;
        }
      }

      if (isCurrentSession) {
        recordTraceEvent(ev, taskId);
      }
    });

    return () => unsub?.();
  }, [finalizeSessionTurn, recordTraceEvent]);

  // Initial load
  useEffect(() => {
    void refreshDaemonStatus();
    void loadConversations();
  }, [refreshDaemonStatus, loadConversations]);

  // Real-time updates when ~/.thunder/models.json or auth.json change on disk
  useEffect(() => {
    const unsub = desktopApi().onThunderModelsChanged?.(() => {
      void refreshDaemonStatus();
    });
    return () => unsub?.();
  }, [refreshDaemonStatus]);

  // Window focus auto-refresh
  useEffect(() => {
    const onFocus = () => {
      void refreshDaemonStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshDaemonStatus]);

  const isWorkspaceLocked = Boolean(activeSessionId && workspaceDir);

  const liveStreamingTps = useMemo(() => {
    if (!isStreaming || !streamStartTime || streamTokensCount === 0) return 0;
    const elapsedSec = (Date.now() - streamStartTime) / 1000;
    if (elapsedSec <= 0.2) return 0;
    return streamTokensCount / elapsedSec;
  }, [isStreaming, streamStartTime, streamTokensCount]);

  const contextWindowLimit = useMemo(() => {
    const currentModelInfo = models.find((m) => (m.selection_id || m.id) === selectedModel);
    return currentModelInfo?.context_window;
  }, [models, selectedModel]);

  return {
    conversations,
    activeSessionId,
    messages,
    loading,
    isStreaming,
    activeTaskId,
    queued,
    steerRunningTask,
    followUpRunningTask,
    liveSegments,
    models,
    selectedModel,
    thinkingLevel,
    workspaceDir,
    workspaceSource,
    taskNoteId,
    isWorkspaceLocked,
    daemonStatus,
    setSelectedModel: handleSelectModel,
    setThinkingLevel,
    setWorkspaceDir,
    setWorkspaceGtdTask,
    setWorkspaceFinderDir,
    loadConversations,
    selectSession,
    createNewSession,
    deleteSession,
    aiRenameSession,
    renameSession,
    titleNotice,
    dismissTitleNotice,
    sendMessage,
    resendUserMessage,
    regenerateResponse,
    composerPrefill,
    prefillComposer,
    cancelCurrentTask,
    pendingQuestion,
    answerQuestion,
    dismissQuestion,
    refreshDaemonStatus,
    currentTrace,
    traceSpans,
    fileChanges,
    telemetryNotices,
    isCollectingTrace,
    lastRunMetrics,
    streamingMetrics: {
      tokensCount: streamTokensCount,
      tps: liveStreamingTps,
      reasoningCount: streamReasoningCount
    },
    sessionTotalTokens,
    currentContextTokens,
    contextWindowLimit
  };
}
