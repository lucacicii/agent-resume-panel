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
  ThunderActiveStreamSnapshot,
  ThunderMetricsSnapshot,
  ThunderPermissionMode,
  ThunderModeChanged,
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
  | { kind: "tools"; tools: ActiveToolInfo[] }
  /**
   * Something the run did to itself, worth saying out loud: today only context
   * compaction. Rendered as a one-line note inside the turn that triggered it, so
   * the timeline explains the shorter context instead of leaving the user to notice.
   */
  | { kind: "notice"; text: string };

/** A chat message plus the ordered segments this renderer watched it stream in. */
export type RenderedChatMessage = ThunderChatMessage & {
  segments?: LiveSegment[];
  /**
   * What this user turn actually sent, when it differs from `content`.
   *
   * `content` is the user's own words — the row the feed paints — while the
   * agent received the compiled blocks (@note / #file / skill instructions)
   * under this. Kept in memory so "resend" repeats the same run; a reload drops
   * it and resend falls back to the visible text.
   */
  agentPrompt?: string;
  /**
   * The run's turns, when this row stands for a whole run — the row a reopened
   * session reads back, and the row a run leaves behind when it finishes. Empty
   * on the row a run is streaming into, whose turns live on the session stream
   * until the run ends.
   */
  turns?: LiveTurn[];
};

/**
 * One engine turn (step) of a run, with the segments it produced.
 *
 * Thunder stamps every observation event with `turn`, so a run splits at those
 * boundaries into turns; the chat view shows only the running one and folds the
 * rest behind a row of dots, where each dot can be opened to read that turn's
 * thinking and tool calls back.
 *
 * Held on the session stream (not React state) because several sessions stream
 * at once and only the visible one should drive a render.
 */
export interface LiveTurn {
  turn: number;
  /** The turn's segments; while it runs this is the same array the stream appends to. */
  segments: LiveSegment[];
  status: "running" | "done" | "error";
  toolCount: number;
  /** Wall clock (ms) when the turn opened, for a live duration on the running dot. */
  startedAtMs: number;
  durationMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
}

interface SessionStream {
  taskId: string;
  streamingText: string;
  streamingReasoning: string;
  streamingTools: ActiveToolInfo[];
  segments: LiveSegment[];
  /** Every turn of this run, in order; the last one is the running (or last) turn. */
  turns: LiveTurn[];
  /** The turn events are currently being appended to. Null between turns and once the run ends. */
  currentTurn: LiveTurn | null;
  /** Wall clock (ms) when the run started, for per-turn offsets. */
  runStartedAtMs: number;
  /** Total estimated tokens from completed turns in this run. */
  completedTokens: number;
  /** Total estimated reasoning tokens from completed turns in this run. */
  completedReasoningTokens: number;
  /** Total active generation duration (ms) from completed turns in this run. */
  completedGenMs: number;
  /** Timestamp (ms) when the current turn's first token/reasoning delta arrived. */
  turnFirstTokenAt: number | null;
  /** Estimated answer tokens accumulated in the current turn so far. */
  turnTextTokens: number;
  /** Estimated reasoning tokens accumulated in the current turn so far. */
  turnReasoningTokens: number;
  /** Whether the current turn's generation time has already been recorded. */
  turnGenSettled: boolean;
}

/**
 * Fast token count estimator matching thunder-agent-loop's `estimate_token_count`:
 * - CJK / Kana / Hangul: ~1.5 tokens per char
 * - ASCII (half-weighting whitespace): ~3.7 chars per token
 * - Punctuation (ASCII + CJK): +0.2 tokens per char
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  let cjkCount = 0;
  let whitespaceCount = 0;
  let punctuationCount = 0;
  let totalChars = 0;

  for (const ch of text) {
    totalChars += 1;
    const u = ch.codePointAt(0) ?? 0;
    if (
      (u >= 0x4e00 && u <= 0x9fff) ||
      (u >= 0x3400 && u <= 0x4dbf) ||
      (u >= 0x3040 && u <= 0x30ff) ||
      (u >= 0xac00 && u <= 0xd7af)
    ) {
      cjkCount += 1;
    } else if (u <= 0x20 && (u === 0x20 || u === 0x09 || u === 0x0a || u === 0x0d || u === 0x0b || u === 0x0c)) {
      whitespaceCount += 1;
    } else if (
      (u >= 0x21 && u <= 0x2f) ||
      (u >= 0x3a && u <= 0x40) ||
      (u >= 0x5b && u <= 0x60) ||
      (u >= 0x7b && u <= 0x7e) ||
      (u >= 0x3000 && u <= 0x303f) ||
      (u >= 0xff00 && u <= 0xffef)
    ) {
      punctuationCount += 1;
    } else if (/\s/.test(ch)) {
      whitespaceCount += 1;
    }
  }

  if (totalChars === 0) return 0;
  const asciiCount = Math.max(0, totalChars - cjkCount);
  const cjkTokens = Math.ceil((cjkCount * 15) / 10);
  const effectiveAscii = Math.max(0, asciiCount - Math.floor(whitespaceCount / 2));
  const asciiTokens = Math.ceil((effectiveAscii * 10) / 37);
  const punctTokens = Math.ceil((punctuationCount * 2) / 10);

  return Math.max(1, cjkTokens + asciiTokens + punctTokens);
}

function createSessionStream(taskId: string): SessionStream {
  return {
    taskId,
    streamingText: "",
    streamingReasoning: "",
    streamingTools: [],
    segments: [],
    turns: [],
    currentTurn: null,
    runStartedAtMs: Date.now(),
    completedTokens: 0,
    completedReasoningTokens: 0,
    completedGenMs: 0,
    turnFirstTokenAt: null,
    turnTextTokens: 0,
    turnReasoningTokens: 0,
    turnGenSettled: false
  };
}

function computeLiveStreamMetrics(
  stream: SessionStream | undefined,
  nowMs: number = Date.now()
): { tokensCount: number; reasoningCount: number; tps: number } {
  if (!stream) return { tokensCount: 0, reasoningCount: 0, tps: 0 };
  const tokensCount = stream.completedTokens + stream.turnTextTokens + stream.turnReasoningTokens;
  const reasoningCount = stream.completedReasoningTokens + stream.turnReasoningTokens;
  const currentTurnMs =
    stream.turnFirstTokenAt !== null ? Math.max(0, nowMs - stream.turnFirstTokenAt) : 0;
  const totalGenSec = (stream.completedGenMs + currentTurnMs) / 1000;
  const tps = tokensCount > 0 && totalGenSec > 0.2 ? tokensCount / totalGenSec : 0;
  return { tokensCount, reasoningCount, tps };
}

/**
 * A question the agent is parked on. It is owned by the session that raised it,
 * so a run blocked in one conversation can never dock its bubble over another.
 */
interface PendingQuestion {
  questionId: string;
  taskId: string;
  sessionId: string;
  questions: ThunderQuestionItem[];
}

/**
 * A run that ends on anything but `done` produced no answer, so the transcript
 * must say why. The daemon's `loop_complete` carries only the finish reason;
 * the message behind an `error` comes from the run's `error` event.
 */
function failureNoticeForFinishReason(reason: string, detail?: string): string | undefined {
  switch (reason) {
    case "error":
      return `⚠️ **Task failed**: ${
        detail?.trim() || "Thunder ended the run with an error (see daemon logs for details)."
      }`;
    case "max_turns_exceeded":
      return "⚠️ **Task stopped**: the agent reached its maximum number of turns without producing an answer.";
    case "budget_exceeded":
      return "⚠️ **Task stopped**: the agent reached its token budget without producing an answer.";
    default:
      return undefined;
  }
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

/** Append a standalone note to the turn's segments. */
function appendNotice(segments: LiveSegment[], text: string): void {
  segments.push({ kind: "notice", text });
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
 * Move the stream onto the turn the event belongs to.
 *
 * Any turn-bearing event drives this, so a dropped `turn_start` cannot shift the
 * boundaries. Opening a turn swaps in a fresh `segments` array — the previous
 * turn keeps the array it was filling, which is what freezes it.
 *
 * Must be called *before* appending the event's payload.
 */
function ensureTurn(stream: SessionStream, turn: number): LiveTurn {
  const current = stream.currentTurn;
  const turnNo = Number.isFinite(turn) && turn > 0 ? turn : (current?.turn ?? 1);
  if (current && current.turn === turnNo) return current;
  if (current) current.status = "done";
  const next: LiveTurn = {
    turn: turnNo,
    segments: [],
    status: "running",
    toolCount: 0,
    startedAtMs: Date.now()
  };
  stream.turns.push(next);
  stream.currentTurn = next;
  stream.segments = next.segments;
  return next;
}

/**
 * Every segment of a run, turn by turn.
 *
 * `stream.segments` now points at the *running* turn only, so anything that wants
 * the whole run (freezing a finished message, salvaging a cancelled one) has to
 * concatenate the turns instead.
 */
function runSegmentsOf(stream: SessionStream | undefined): LiveSegment[] | undefined {
  if (!stream) return undefined;
  if (stream.turns.length === 0) return stream.segments;
  return stream.turns.flatMap((turn) => turn.segments);
}

/** Settle a turn's bookkeeping from its `turn_end` stats (or from the clock). */
function settleTurn(
  turn: LiveTurn,
  stats: ThunderTurnStats | undefined,
  nowMs: number,
  finishReason?: string
): void {
  turn.status = finishReason === "error" ? "error" : "done";
  if (finishReason) turn.finishReason = finishReason;
  turn.durationMs =
    typeof stats?.duration_ms === "number" ? stats.duration_ms : Math.max(0, nowMs - turn.startedAtMs);
  if (typeof stats?.prompt_tokens === "number") turn.promptTokens = stats.prompt_tokens;
  if (typeof stats?.completion_tokens === "number") turn.completionTokens = stats.completion_tokens;
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
 * Rebuild a buffered run's turns from the same event log `rebuildSegments` reads.
 *
 * A renderer that remounts mid-answer (pane switch, reload) has no live state, so
 * the split has to be replayed rather than remembered. Reusing the live insert
 * rules keeps a resumed run's dots identical to one that never unmounted.
 */
function rebuildTurns(
  events: ThunderActiveStreamSnapshot["events"]
): { turns: LiveTurn[]; currentTurn: LiveTurn | null } {
  const stream = createSessionStream("rebuild");
  for (const observed of events) {
    const ev = observed?.event as { type?: string } & Record<string, any>;
    if (!ev?.type) continue;
    const turnNo = typeof ev.turn === "number" ? ev.turn : 0;
    switch (ev.type) {
      case "token_delta":
        ensureTurn(stream, turnNo);
        appendDelta(stream.segments, "text", ev.delta || "");
        break;
      case "reasoning_delta":
        ensureTurn(stream, turnNo);
        appendDelta(stream.segments, "reasoning", ev.delta || "");
        break;
      case "tool_exec_start": {
        const turn = ensureTurn(stream, turnNo);
        const toolCallId = String(ev.tool_call_id || `tool_${stream.segments.length}`);
        const tool: ActiveToolInfo = {
          toolCallId,
          name: ev.name || "tool",
          arguments: ev.arguments || {},
          isRunning: true
        };
        if (!updateTool(stream.segments, toolCallId, () => tool)) {
          appendTool(stream.segments, tool);
          turn.toolCount += 1;
        }
        break;
      }
      case "tool_exec_result": {
        ensureTurn(stream, turnNo);
        const toolCallId = String(ev.tool_call_id || "");
        updateTool(stream.segments, toolCallId, (tool) => ({
          ...tool,
          isRunning: false,
          result: ev.result?.output,
          isError: Boolean(ev.result?.is_error)
        }));
        break;
      }
      case "turn_end": {
        const turn = ensureTurn(stream, turnNo);
        settleTurn(turn, ev.stats, Date.now(), ev.finish_reason);
        stream.currentTurn = null;
        break;
      }
      default:
        break;
    }
  }
  return { turns: stream.turns, currentTurn: stream.currentTurn };
}

/**
 * The question a buffered run is still parked on, recovered from the main
 * process's event log so a renderer that remounts mid-run re-docks the bubble
 * over the conversation that raised it. The main process drops the entry once
 * the question is answered, so an already-answered one cannot come back.
 */
function parkedQuestionFromSnapshot(
  snapshot: ThunderActiveStreamSnapshot | null | undefined
): PendingQuestion | null {
  const events = snapshot?.events;
  if (!snapshot || !events?.length) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = (events[i] as { event?: unknown })?.event as
      | ({ type?: string } & Record<string, any>)
      | undefined;
    if (ev?.type !== "user_question") continue;
    const questionId = String(ev.question_id || "");
    if (!questionId) return null;
    return {
      questionId,
      taskId: snapshot.taskId,
      sessionId: snapshot.sessionId,
      questions: Array.isArray(ev.questions) ? ev.questions : []
    };
  }
  return null;
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

/**
 * Shape a conversation read back from disk into the rows the feed paints.
 *
 * Two jobs, in this order:
 *
 * 1. Fold the wire shape into one row per answer: tool results belong to the
 *    call that produced them, so they are absorbed into that assistant row
 *    instead of standing as rows of their own.
 * 2. Fold a run's turns into the run: thunder writes one assistant message per
 *    engine turn, so a run on disk is a stretch of consecutive assistant
 *    messages between the user messages that bracket it. The feed shows a run
 *    the way it looked while it streamed — one reply, its turns behind the pile
 *    of dots that hangs off it — and a run that reads back as a flat list of
 *    per-turn blocks is a different thing from the run the user just watched.
 */
/**
 * Strip the machine prefixes this app prepends for the agent's benefit from a
 * user turn read back out of a conversation.
 *
 * The transcript is a record of what the user said; the blocks below are
 * transport (workspace, granted roots, task context) and never something a
 * person typed. A reopened session reads the daemon's copy, so cleaning here is
 * what keeps that row identical to the one the composer showed when it was sent.
 */
export function stripPromptEnvelope(content: string): string {
  let text = content;
  // Leading machine lines, in the order they are assembled.
  const leading = [
    /^\[Additional workspace roots \(read\/write\):[^\]]*\]\n*/,
    /^\[Active Workspace:[^\]]*\]\n*/,
    /^\[Workspace [^\]]*\](?:\n(?!\n)[^\n]*)*\n*/,
    /^\[GTD Task Context\][\s\S]*?\[End Task Context\]\n*/
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of leading) {
      const next = text.replace(pattern, "");
      if (next !== text) {
        text = next;
        changed = true;
      }
    }
  }
  return text.trim() ? text : content;
}

export function buildConversationRows(rawMessages: ThunderChatMessage[]): RenderedChatMessage[] {
  const result: RenderedChatMessage[] = [];
  const toolResultsByCallId = new Map<string, string>();
  /** The consecutive assistant messages being collected into the run's row. */
  let run: ThunderChatMessage[] = [];

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
      // A user message ends the run before it: runs start from one, so nothing
      // on the far side of it can belong to the run being collected.
      flushRun(result, run);
      run = [];
      const display = typeof msg.content === "string" ? stripPromptEnvelope(msg.content) : msg.content;
      result.push({
        ...msg,
        content: display,
        ...(display !== msg.content ? { agentPrompt: msg.content ?? undefined } : {})
      });
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

      // Consecutive assistant messages are the turns of one run: the pile of
      // dots that hangs off the run's reply is where they are read back, one
      // dot per turn.
      run.push({
        ...msg,
        tool_executions: executions.length > 0 ? executions : msg.tool_executions
      });
    }
  }
  flushRun(result, run);

  return result;
}

/** The run's turns, folded into the row the feed shows for the run. */
function flushRun(rows: RenderedChatMessage[], run: ThunderChatMessage[]): void {
  if (run.length === 0) return;
  const turns = run.map((message, index) => turnFromMessage(message, index + 1));
  const content = run.map((message) => message.content ?? "").join("");
  const executions = run.flatMap((message) => message.tool_executions ?? []);

  rows.push({
    // The run's identity is its reply, and its reply is the last turn's message;
    // everything per turn is moved into `turns` below.
    ...run[run.length - 1],
    // The turns' own text, glued in the order it was produced — exactly what the
    // stream accumulated while the same run was live.
    content,
    turns,
    // Thinking and tool calls are per turn, and the pile is where a turn is read
    // back: left on the row they would paint a second, staler copy of what the
    // dots already hold.
    reasoning: undefined,
    tool_calls: undefined,
    // Kept for the file-change scan, which wants the whole run's calls and has
    // nowhere else to read them from once the run is on disk.
    tool_executions: executions.length > 0 ? executions : undefined,
    // A turn's stats describe one turn; this row stands for all of them.
    stats: undefined
  });
}

/** One persisted assistant message as the turn the pile shows a dot for. */
function turnFromMessage(message: ThunderChatMessage, positionInRun: number): LiveTurn {
  const segments: LiveSegment[] = [];
  if (message.reasoning) segments.push({ kind: "reasoning", text: message.reasoning });
  if (message.content) segments.push({ kind: "text", text: message.content });
  const tools = message.tool_executions ?? [];
  if (tools.length > 0) {
    segments.push({ kind: "tools", tools: tools.map((tool) => ({ ...tool, isRunning: false })) });
  }

  const stats = message.stats;
  return {
    // A run numbers its turns from 1; a turn cut short before its `turn_end`
    // carries no stats, and falls back to where it sits in the run.
    turn: stats?.turn ?? positionInRun,
    segments,
    // A run on disk is over, and nothing is persisted about how it ended: its
    // turns read as done rather than as the failure the session may have hit.
    status: "done",
    toolCount: tools.length,
    startedAtMs: 0,
    durationMs: stats?.duration_ms,
    promptTokens: stats?.prompt_tokens,
    completionTokens: stats?.completion_tokens
  };
}

/**
 * The `review` answers that count as approving the plan under review. The
 * daemon matches the answer against the label it sent, so the check is on the
 * exact option strings (see ChatUiRequestCard: the clicked label travels back
 * verbatim). Anything else on a `review` is "keep planning" or unknown.
 */
export function useThunderChat() {
  const [conversations, setConversations] = useState<ThunderConversationSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RenderedChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  /**
   * Set by `task_paused`: the run stopped at a tool boundary and waits for us.
   * `null` while running — the pause button does not pretend an instant pause,
   * the banner only flips when the daemon confirms it.
   */
  const [pausedTask, setPausedTask] = useState<{ taskId: string; reason: string } | null>(null);
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

  /**
   * Every turn of the in-flight run, for the dots row above the feed. Like
   * `liveSegments` this mirrors only the visible session; the real per-session
   * state lives on the session stream.
   */
  const [liveTurns, setLiveTurns] = useState<LiveTurn[]>([]);

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
  const [liveStreamingTps, setLiveStreamingTps] = useState(0);

  /**
   * What thunder says the run is doing — the only authority for that question.
   *
   * Read rather than derived: the chat used to infer a phase from the raw
   * stream, which cannot see the one state that matters most (a run parked on
   * an approval gate emits nothing at all).
   */
  /** The frame the state above was built from, for the out-of-order guard. */

  // A question the agent is blocked on; rendered as a bubble until answered.
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  /**
   * Every parked question this renderer has seen, keyed by the session that
   * raised it. The daemon broadcasts events for all sessions, so the bubble has
   * to be derived from the session on screen rather than from the last event
   * that happened to arrive.
   */
  const pendingQuestionsRef = useRef<Map<string, PendingQuestion>>(new Map());

  /**
   * The approval mode this session is judged by.
   *
   * Empty until hydrated, deliberately: the truth lives in the daemon per
   * session and is *not* part of the stored conversation, so seeding a default
   * here would show a confident wrong value — `yolo` is Thunder's own default,
   * but `.thunder`'s `agent.defaultMode` may name anything.
   */
  const [permissionMode, setPermissionMode] = useState<ThunderPermissionMode | "">("");
  /**
   * Whether the user has actually chosen a mode this session.
   *
   * Only a chosen mode is pinned onto a run. Sending one unconditionally would
   * silently override `agent.defaultMode` for every ARP session.
   */
  const permissionModeDirtyRef = useRef(false);

  /** A dialog the agent is blocked on; rendered as a card until answered. */
  /**
   * Every parked dialog this renderer has seen, keyed by session — same reason
   * as `pendingQuestionsRef`: the daemon broadcasts for all sessions, so what
   * docks must be derived from the session on screen.
   */

  // End-to-end task trace and file modification tracking
  const {
    spans: traceSpans,
    fileChanges,
    isCollecting: isCollectingTrace,
    startTaskTrace,
    recordEvent: recordTraceEvent,
    finishTaskTrace,
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
  /** Last engine error per task id: an error turn streams no content, so its
   *  `loop_complete` has to report the failure instead of an empty answer. */
  const taskErrorMessagesRef = useRef<Map<string, string>>(new Map());

  /** Dock the parked question of `sessionId`; no session (or none parked) clears it. */
  const syncPendingQuestion = useCallback((sessionId: string | null) => {
    setPendingQuestion(sessionId ? pendingQuestionsRef.current.get(sessionId) ?? null : null);
  }, []);

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
      // Commit the switch synchronously too: everything that must answer "is
      // this still the session on screen?" runs before React re-renders.
      activeSessionIdRef.current = sessionId;
      // The bubble follows its conversation: opening a session docks its own
      // parked question (if any) and drops the one left behind.
      syncPendingQuestion(sessionId);
      // The approval mode is the daemon's per-session state, not part of the
      // stored conversation (unlike `model` / `thinking_level`, which the
      // conversation record carries), so it has to be asked for. Not awaited:
      // the chip can fill in a moment later, and a mode change pushes a
      // correction anyway.
      setPermissionMode("");
      permissionModeDirtyRef.current = false;
      void desktopApi()
        .thunderChatGetPermissionState({ sessionId })
        .then((state) => {
          // A fast switch to another session must not have this land on it.
          if (activeSessionIdRef.current === sessionId && state?.mode) {
            setPermissionMode(state.mode);
          }
        })
        .catch((err) => {
          console.warn("[thunder-chat] could not read the session's mode:", err);
        });
      const conv = await desktopApi().thunderChatGetConversation({ sessionId });
      // A fast switch to another session must not have this land on it: loads
      // resolve in arrival order, not call order.
      if (activeSessionIdRef.current !== sessionId) return;
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
            // Same race as the conversation load above: the lookup resolved
            // after the user moved on, so its binding belongs nowhere on screen.
            if (activeSessionIdRef.current !== sessionId) return;
            if (linkedNoteId) {
              setTaskNoteId(linkedNoteId);
              setWorkspaceSource("gtd");
              try {
                localStorage.setItem("chat-workspace-source", "gtd");
                localStorage.setItem("chat-selected-task-note-id", linkedNoteId);
              } catch {
                // ignore
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
          setMessages(buildConversationRows(conv.messages));

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
        // The buffered stream belongs to the session it was fetched for, not
        // to whatever session is on screen now.
        if (activeSessionIdRef.current !== sessionId) return;
        if (snapshot && !snapshot.isRunning) snapshot = null;
        if (snapshot) {
          const textTok = estimateTokenCount(snapshot.streamingText);
          const reasonTok = estimateTokenCount(snapshot.streamingReasoning);
          const firstDeltaEv = snapshot.events.find(
            (e) =>
              e.event?.type === "token_delta" ||
              e.event?.type === "reasoning_delta"
          );
          const firstTs =
            (firstDeltaEv as { timestamp_ms?: number } | undefined)?.timestamp_ms ||
            snapshot.startedAtMs ||
            Date.now();
          const rebuilt = rebuildTurns(snapshot.events);
          stream = {
            ...createSessionStream(snapshot.taskId),
            streamingText: snapshot.streamingText,
            streamingReasoning: snapshot.streamingReasoning,
            streamingTools: snapshot.streamingTools,
            segments: rebuildSegments(snapshot.events),
            turns: rebuilt.turns,
            currentTurn: rebuilt.currentTurn,
            runStartedAtMs: snapshot.startedAtMs || Date.now(),
            turnFirstTokenAt: textTok + reasonTok > 0 ? firstTs : null,
            turnTextTokens: textTok,
            turnReasoningTokens: reasonTok
          };
          activeStreamsRef.current.set(sessionId, stream);
        }
      }
      // A run parked on a question is session state, not a one-off notification:
      // when the renderer that watched the question arrive is gone (reload, pane
      // remount), recover it from the buffered event log.
      const parked = parkedQuestionFromSnapshot(snapshot);
      if (parked) {
        pendingQuestionsRef.current.set(sessionId, parked);
        if (activeSessionIdRef.current === sessionId) setPendingQuestion(parked);
      }
      if (stream) {
        const live = computeLiveStreamMetrics(stream);
        const snapMetrics = snapshot?.metrics;
        setIsStreaming(true);
        setActiveTaskId(stream.taskId);
        // The pause banner is per-task live state; a snapshot restore does not
        // carry it, so start clean rather than show another session's banner.
        setPausedTask(null);
        setLiveSegments(stream.segments);
        setLiveTurns(stream.turns.map((turn) => ({ ...turn })));
        setStreamTokensCount(snapMetrics ? snapMetrics.live_tokens : live.tokensCount);
        setStreamReasoningCount(snapMetrics ? snapMetrics.live_reasoning_tokens : live.reasoningCount);
        setLiveStreamingTps(snapMetrics ? snapMetrics.live_tps : live.tps);
      } else {
        setIsStreaming(false);
        setActiveTaskId(null);
        setLiveSegments([]);
        setLiveTurns([]);
        setStreamTokensCount(0);
        setStreamReasoningCount(0);
        setLiveStreamingTps(0);
      }

      // No server-side trace to hydrate from: it answered `traces: []` for every
      // session, and its disk fallback pointed at a directory nothing writes. The
      // badge is filled by the run's own events (`turn_end`, `loop_complete`) and
      // from the stored conversation's stats below.
      if (conv && conv.stats) {
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
  }, [models, restoreFromSnapshot, setFileChanges, syncPendingQuestion]);

  const createNewSession = useCallback(() => {
    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    setMessages([]);
    setIsStreaming(false);
    setActiveTaskId(null);
    // A bubble belongs to the session that raised it.
    setPendingQuestion(null);
    // A brand-new session has no mode yet: leave it to the daemon, so
    // `.thunder`'s `agent.defaultMode` still decides its first run.
    setPermissionMode("");
    permissionModeDirtyRef.current = false;
    setQueued({ steering: [], followUp: [] });
    setLiveSegments([]);
    setLiveTurns([]);
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

  /**
   * A cold start with no remembered workspace runs from home.
   *
   * The board chat and Quick Agent carry no workspace picker, so without this a
   * fresh conversation would have no directory at all — git and search would
   * refuse to run until the user typed an `@` pack. Workbench panes bind their
   * project before this lands, so they are unaffected.
   */
  useEffect(() => {
    if (workspaceDir.trim()) return;
    if (typeof desktopApi().homePath !== "function") return;
    let cancelled = false;
    void desktopApi()
      .homePath()
      .then((home) => {
        if (cancelled || !home) return;
        setWorkspaceDir((current) => (current.trim() ? current : home));
        setWorkspaceSource("finder");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Deliberately keyed on "is there a workspace yet", not on its value: a
    // directory the user picked later must not be overwritten by home.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /**
   * Choose the approval mode for this session.
   *
   * Optimistic, then reconciled: the chip moves at once, and snaps back if the
   * daemon refuses (an unknown value, or a daemon that predates `set_mode`).
   * The daemon also pushes a `mode_changed` for a real change, so a stale
   * optimistic value corrects itself even when the command succeeded.
   *
   * Before the first message there is no session to name, so the choice is kept
   * locally and travels on the first run instead — minting a session id here
   * would leave the daemon holding an entry for a session that may never run.
   */
  const handleSelectPermissionMode = useCallback(
    (next: ThunderPermissionMode) => {
      const previous = permissionMode;
      setPermissionMode(next);
      permissionModeDirtyRef.current = true;
      const sessionId = activeSessionIdRef.current;
      if (!sessionId) return;
      void desktopApi()
        .thunderChatSetMode({ sessionId, mode: next })
        .catch((err) => {
          console.warn("[thunder-chat] set_mode refused, keeping the old mode:", err);
          setPermissionMode(previous);
        });
    },
    [permissionMode]
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

  /**
   * A mention pointed the conversation at another directory.
   *
   * The run continues in the same conversation — no new session — so the only
   * thing the user needs to know is that the working directory moved under it.
   */
  useEffect(() => {
    const onWorkspaceChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; path?: string }>).detail;
      const path = detail?.path?.trim();
      if (!path) return;
      const label = detail?.id?.trim();
      setTitleNotice({
        kind: "success",
        text: `上下文已调整：工作区切换到${label ? ` ${label} ·` : ""} ${path}`
      });
    };
    window.addEventListener("agent-resume:workspace-context-changed", onWorkspaceChanged);
    return () => window.removeEventListener("agent-resume:workspace-context-changed", onWorkspaceChanged);
  }, []);

  const finalizeSessionTurn = useCallback(
    (opts: {
      sessionId: string;
      taskId?: string;
      finalContent?: string;
      finalReasoning?: string;
      finalTools?: ActiveToolInfo[];
      finalSegments?: LiveSegment[];
      finishReason?: string;
      /** Rendered instead of the answer when the run ended without one. */
      failureNotice?: string;
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
        taskErrorMessagesRef.current.delete(effectiveTaskId);
        if (finalizedTasksRef.current.size > 200) {
          const first = finalizedTasksRef.current.values().next().value;
          if (first) finalizedTasksRef.current.delete(first);
        }
      }

      // A finished run cannot be paused anymore; drop the banner only if it
      // belonged to this task.
      setPausedTask((prev) => (!prev || prev.taskId === effectiveTaskId ? null : prev));

      const streamed = opts.finalContent ?? streamState?.streamingText ?? "";
      // Partial text still belongs to the transcript: show it under the failure.
      const content = opts.failureNotice
        ? `${opts.failureNotice}${streamed ? `\n\n${streamed}` : ""}`
        : streamed;
      const reasoning = opts.finalReasoning ?? streamState?.streamingReasoning ?? undefined;
      const rawTools = opts.finalTools ?? (streamState && streamState.streamingTools.length > 0 ? streamState.streamingTools : undefined);
      // The run's own segments may hold a turn that never saw `turn_end`
      // (cancel, daemon error): settle it so its dot cannot read "running" forever.
      if (streamState?.currentTurn) {
        settleTurn(streamState.currentTurn, undefined, Date.now(), finishReason);
        streamState.currentTurn = null;
      }
      // The run's turns outlive it: the dots stay on the agent's reply once the
      // run is over, so the finished run's thinking and tool calls keep their
      // home instead of being flattened onto the answer message. A run that
      // opened no turn at all has no pile to keep them in, so it falls back to
      // the message carrying its segments.
      const runTurns = streamState ? streamState.turns.map((turn) => ({ ...turn })) : [];
      const keepsTurns = runTurns.length > 0;
      const streamedSegments = keepsTurns ? [] : opts.finalSegments ?? runSegmentsOf(streamState);
      // A turn that streamed anything renders its segments instead of `content`,
      // so the failure notice has to become a segment of its own to stay visible.
      const segments =
        opts.failureNotice && streamedSegments && streamedSegments.length > 0
          ? [...streamedSegments, { kind: "text" as const, text: opts.failureNotice }]
          : streamedSegments;
      const toolExecutions = rawTools?.map((t) => ({
        toolCallId: t.toolCallId,
        name: t.name,
        arguments: t.arguments,
        result: t.result,
        isError: t.isError,
        isRunning: false
      }));

      // Finish trace collector span/timing
      finishTaskTrace();

      const assistantMsg: RenderedChatMessage = keepsTurns
        ? // Its thinking and tool calls have a home in the pile now, so the reply
          // is the answer and nothing else. The turns ride along on the row, the
          // way a reopened session reads them back off disk, so the pile outlives
          // the run's own state. (The chat's file-change derivation reads the
          // tools off those turns instead — see `ChatMain`.)
          { role: "assistant", content: content || "(No response output)", turns: runTurns }
        : {
            role: "assistant",
            content: content || "(No response output)",
            reasoning: reasoning || undefined,
            tool_executions: toolExecutions,
            segments: segments && segments.length > 0 ? freezeSegments(segments, content) : undefined
          };

      const isCurrentSession = activeSessionIdRef.current === sessionId;

      // The run is over: any question it parked died with it, in every session.
      pendingQuestionsRef.current.delete(sessionId);

      if (isCurrentSession) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last?.content === assistantMsg.content) {
            // The answer is already on the feed (the daemon's final content and
            // the loop's completion can both land here): keep that row, but hand
            // it the turns — the pile is theirs, and only the row can paint it.
            return assistantMsg.turns
              ? [...prev.slice(0, -1), { ...last, ...assistantMsg }]
              : prev;
          }
          return [...prev, assistantMsg];
        });
        setPendingQuestion(null);
        setLiveSegments([]);
        // Kept, not cleared: a drawer left open on the running turn holds an
        // index into these, and re-publishing the settled copies is what flips a
        // last turn that never saw `turn_end` from "running" to done. The row
        // carries the same turns — that copy is the one a reload reads back, and
        // the one the feed paints the pile from once the run is over.
        setLiveTurns(runTurns);
        setStreamTokensCount(0);
        setStreamReasoningCount(0);
        setLiveStreamingTps(0);
        setIsStreaming(false);
        setActiveTaskId(null);
        setQueued({ steering: [], followUp: [] });
      }

      // Always clear the stream from active streams map
      activeStreamsRef.current.delete(sessionId);
    },
    [finishTaskTrace]
  );

  const sendMessage = useCallback(
    async (
      prompt: string,
      options?: {
        model?: string;
        workspaceDir?: string;
        thinking_level?: string;
        roleContext?: string;
        extraWorkspaceDirs?: string[];
        /** Compiled context the agent receives, when it differs from the shown text. */
        agentPrompt?: string;
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

      const agentPrompt = (options?.agentPrompt ?? prompt).trim() || trimmed;
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

      const userMsg: RenderedChatMessage = {
        role: "user",
        content: trimmed,
        parts,
        ...(agentPrompt !== trimmed ? { agentPrompt } : {})
      };

      setMessages((prev) => [...prev, userMsg]);
      setLiveSegments([]);
      setLiveTurns([]);
      setStreamTokensCount(0);
      setStreamReasoningCount(0);
      setLiveStreamingTps(0);
      // The badge promises "发送新消息后重新计算": without this the previous
      // run's elapsed time sat there until the first turn of the new one ended.
      // The snapshot refills it from the run's first frame.
      setLastRunMetrics(null);
      setIsStreaming(true);
      // A fresh run starts moving; any leftover pause banner from the previous
      // one is stale.
      setPausedTask(null);

      const taskId = `task_${Date.now()}`;
      setActiveTaskId(taskId);
      taskErrorMessagesRef.current.delete(taskId);

      activeStreamsRef.current.set(effectiveSessionId, createSessionStream(taskId));

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
        prompt: agentPrompt
      });

      try {
        const effectiveTaskNoteId =
          workspaceSource === "gtd" && taskNoteId ? taskNoteId : undefined;

        const result = await desktopApi().thunderChatRunTask({
          taskId,
          prompt: agentPrompt,
          roleContext: options?.roleContext,
          extraWorkspaceDirs: options?.extraWorkspaceDirs,
          sessionId: effectiveSessionId,
          model,
          workspaceDir: ws,
          taskNoteId: effectiveTaskNoteId,
          thinking_level: thinking,
          // Only a mode the user actually chose is pinned onto the run. Sending
          // one unconditionally would make `.thunder`'s `agent.defaultMode` dead
          // for every ARP session.
          mode: permissionModeDirtyRef.current && permissionMode ? permissionMode : undefined,
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
          finishTaskTrace();
          const errMsg: ThunderChatMessage = {
            role: "assistant",
            content: `⚠️ **Task failed**: ${err instanceof Error ? err.message : String(err)}`
          };
          pendingQuestionsRef.current.delete(effectiveSessionId);
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
    [finalizeSessionTurn, finishTaskTrace, loadConversations, models, permissionMode, selectedModel, startTaskTrace, taskNoteId, thinkingLevel, workspaceDir, workspaceSource]
  );

  const prefillComposer = useCallback((text: string) => {
    setComposerPrefill({ text, id: Date.now() });
  }, []);

  const resendUserMessage = useCallback(
    async (userIndex: number, options?: { model?: string; workspaceDir?: string }) => {
      if (isStreaming || userIndex < 0 || userIndex >= messages.length) return;
      const targetMsg = messages[userIndex];
      if (targetMsg.role !== "user" || !targetMsg.content) return;

      const prompt = targetMsg.agentPrompt ?? targetMsg.content;

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
      pendingQuestionsRef.current.delete(pending.sessionId);
      setPendingQuestion(null);
      try {
        await desktopApi().thunderChatAnswerQuestion({
          questionId: pending.questionId,
          sessionId: pending.sessionId,
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
    const parked = curSessId ? pendingQuestionsRef.current.get(curSessId) : undefined;
    if (parked && (!targetTaskId || parked.taskId === targetTaskId)) {
      pendingQuestionsRef.current.delete(parked.sessionId);
      setPendingQuestion((prev) => (prev?.questionId === parked.questionId ? null : prev));
      void desktopApi()
        .thunderChatAnswerQuestion({
          questionId: parked.questionId,
          sessionId: parked.sessionId,
          cancelled: true
        })
        .catch(() => undefined);
    }

    // Force stop locally immediately so UI never gets stuck
    if (curSessId && stream) {
      finalizeSessionTurn({
        sessionId: curSessId,
        taskId: targetTaskId || stream.taskId,
        finalContent: stream.streamingText || "(Cancelled)",
        finalReasoning: stream.streamingReasoning || undefined,
        finalTools: stream.streamingTools.length > 0 ? stream.streamingTools : undefined,
        // Read only when the run opened no turn at all — there is no pile to
        // hold them then. The whole run, not just the turn that happened to be
        // open, so a cancel mid-run never drops the earlier turns' thinking.
        finalSegments: runSegmentsOf(stream),
        finishReason: "cancelled"
      });
    } else {
      setIsStreaming(false);
      setActiveTaskId(null);
      setLiveSegments([]);
      setLiveTurns([]);
      setStreamTokensCount(0);
      setStreamReasoningCount(0);
      setLiveStreamingTps(0);
    }

    try {
      if (targetTaskId) {
        await desktopApi().thunderChatCancelTask({ taskId: targetTaskId });
      }
    } catch (err) {
      console.error("Failed to cancel thunder task:", err);
    }
  }, [finalizeSessionTurn, isStreaming, prefillComposer]);

  /**
   * Pause the run at its next tool boundary. The button does not flip state on
   * its own: the daemon's `task_paused` frame is what the banner waits for,
   * because the tool in flight still runs to completion.
   */
  const pauseCurrentTask = useCallback(async (): Promise<boolean> => {
    const taskId = activeTaskIdRef.current;
    if (!taskId) return false;
    try {
      return await desktopApi().thunderChatPauseTask({ taskId });
    } catch (err) {
      console.error("Failed to pause thunder task:", err);
      return false;
    }
  }, []);

  /** Resume a paused run; drops the banner only when the daemon accepted it. */
  const resumeCurrentTask = useCallback(async (): Promise<boolean> => {
    const taskId = pausedTask?.taskId || activeTaskIdRef.current;
    if (!taskId) return false;
    try {
      const resumed = await desktopApi().thunderChatResumeTask({ taskId });
      if (resumed) setPausedTask(null);
      return resumed;
    } catch (err) {
      console.error("Failed to resume thunder task:", err);
      return false;
    }
  }, [pausedTask]);

  // Subscribe to real-time events from Thunder daemon
  useEffect(() => {
    const unsub = desktopApi().onThunderChatEvent((payload: ThunderChatStreamPayload) => {
      const { taskId, sessionId, event } = payload;
      const ev = event?.event;
      if (!ev) return;

      const isCurrentSession = activeSessionIdRef.current === sessionId;

      let stream = activeStreamsRef.current.get(sessionId);
      if (!stream) {
        stream = createSessionStream(taskId);
        activeStreamsRef.current.set(sessionId, stream);
      }
      const activeStream = stream;

      // One state write per event keeps the transcript in true time order: the
      // segments are mutated in place and a shallow copy is published, so React
      // re-renders the live turn without the hook rebuilding the array itself.
      const publishSegments = () => {
        if (isCurrentSession) setLiveSegments([...activeStream.segments]);
      };

      // A shallow copy per turn: the turn objects are mutated in place as the
      // turn runs, so React needs a new array to see the change.
      const publishTurns = () => {
        if (isCurrentSession) setLiveTurns(activeStream.turns.map((turn) => ({ ...turn })));
      };

      /**
       * Move onto `turnNo`, publishing the dots row only when that opens a turn.
       *
       * Every turn-bearing event routes through here, so a run that never emits
       * `turn_start` still gets its row.
       */
      const openTurn = (turnNo: number) => {
        const before = activeStream.turns.length;
        const turn = ensureTurn(activeStream, turnNo);
        if (activeStream.turns.length !== before) publishTurns();
        return turn;
      };

      const publishStreamMetrics = (nowMs: number) => {
        if (!isCurrentSession) return;
        const live = computeLiveStreamMetrics(activeStream, nowMs);
        setStreamTokensCount(live.tokensCount);
        setStreamReasoningCount(live.reasoningCount);
        setLiveStreamingTps(live.tps);
      };

      const settleTurnGenerationWindow = (nowMs: number, stats?: ThunderTurnStats) => {
        if (stream.turnFirstTokenAt !== null) {
          stream.completedGenMs += Math.max(0, nowMs - stream.turnFirstTokenAt);
          stream.turnFirstTokenAt = null;
        } else if (!stream.turnGenSettled && stats) {
          const ct = typeof stats.completion_tokens === "number" ? stats.completion_tokens : 0;
          if (
            typeof stats.tokens_per_second === "number" &&
            stats.tokens_per_second > 0 &&
            ct > 0
          ) {
            stream.completedGenMs += Math.round((ct / stats.tokens_per_second) * 1000);
          } else if (typeof stats.duration_ms === "number" && stats.duration_ms > 0 && ct > 0) {
            stream.completedGenMs += stats.duration_ms;
          }
        }
        const turnComp =
          stats && typeof stats.completion_tokens === "number" && stats.completion_tokens > 0
            ? stats.completion_tokens
            : stream.turnTextTokens + stream.turnReasoningTokens;
        const turnReas =
          stats && typeof stats.reasoning_tokens === "number" && stats.reasoning_tokens > 0
            ? stats.reasoning_tokens
            : stream.turnReasoningTokens;
        stream.completedTokens += turnComp;
        stream.completedReasoningTokens += turnReas;
        stream.turnTextTokens = 0;
        stream.turnReasoningTokens = 0;
        stream.turnGenSettled = false;
        stream.streamingText = "";
        stream.streamingReasoning = "";
      };

      const nowMs = Date.now();

      // `event` is the loose `ThunderAgentEvent` union: the variants that carry a
      // turn are typed, but `error` is not, so the field is read defensively.
      const rawTurn = (ev as { turn?: unknown }).turn;
      const turnNo = typeof rawTurn === "number" ? rawTurn : 0;

      switch (ev.type) {
        case "turn_start": {
          // Opening a turn swaps in a fresh segments array, so the previous
          // turn's thinking and tools stop being appended to and the main feed
          // (which renders `liveSegments`) goes straight to the new turn.
          openTurn(turnNo);
          publishSegments();
          break;
        }
        case "token_delta": {
          const delta = typeof ev.delta === "string" ? ev.delta : "";
          openTurn(turnNo);
          if (stream.turnFirstTokenAt === null) {
            stream.turnFirstTokenAt = nowMs;
          }
          stream.streamingText += delta;
          stream.turnTextTokens = estimateTokenCount(stream.streamingText);
          appendDelta(stream.segments, "text", delta);
          if (isCurrentSession) {
            publishSegments();
            publishStreamMetrics(nowMs);
          }
          break;
        }
        case "reasoning_delta": {
          const delta = typeof ev.delta === "string" ? ev.delta : "";
          openTurn(turnNo);
          if (stream.turnFirstTokenAt === null) {
            stream.turnFirstTokenAt = nowMs;
          }
          stream.streamingReasoning += delta;
          stream.turnReasoningTokens = estimateTokenCount(stream.streamingReasoning);
          appendDelta(stream.segments, "reasoning", delta);
          if (isCurrentSession) {
            publishSegments();
            publishStreamMetrics(nowMs);
          }
          break;
        }
        case "tool_exec_start": {
          const turn = openTurn(turnNo);
          if (stream.turnFirstTokenAt !== null) {
            stream.completedGenMs += Math.max(0, nowMs - stream.turnFirstTokenAt);
            stream.turnFirstTokenAt = null;
            stream.turnGenSettled = true;
          }
          const toolCallId = typeof ev.tool_call_id === "string" && ev.tool_call_id ? ev.tool_call_id : `tool_${nowMs}`;
          const name = typeof ev.name === "string" && ev.name ? ev.name : "tool";
          const args = (ev.arguments && typeof ev.arguments === "object" ? ev.arguments : {}) as Record<string, unknown>;
          const exists = stream.streamingTools.find((t) => t.toolCallId === toolCallId);
          if (!exists) {
            const tool: ActiveToolInfo = { toolCallId, name, arguments: args, isRunning: true };
            stream.streamingTools.push(tool);
            if (!updateTool(stream.segments, toolCallId, () => tool)) {
              appendTool(stream.segments, tool);
              turn.toolCount += 1;
            }
          }
          publishSegments();
          publishTurns();
          publishStreamMetrics(nowMs);
          break;
        }
        case "tool_exec_result": {
          openTurn(turnNo);
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
        case "context_compacted": {
          // The kernel rebuilt the context to fit: say so, in the turn it happened in.
          // Nothing is lost silently in a chat that has this line, and the next turn's
          // smaller `prompt_tokens` reads as expected rather than as a bug.
          const before = (ev as { tokens_before?: number }).tokens_before ?? 0;
          const after = (ev as { tokens_after?: number }).tokens_after ?? 0;
          const turnOfEvent = openTurn(turnNo);
          appendNotice(
            turnOfEvent.segments,
            `上下文已压缩：${Math.round(before / 1000)}k → ${Math.round(after / 1000)}k`
          );
          publishSegments();
          break;
        }
        case "turn_end": {
          const stats = ev.stats as ThunderTurnStats | undefined;
          // Freeze before the metrics publish: the dot flips to done in the same
          // commit that the numbers land.
          const finishReason = (ev as { finish_reason?: unknown }).finish_reason;
          settleTurn(openTurn(turnNo), stats, nowMs, typeof finishReason === "string" ? finishReason : undefined);
          stream.currentTurn = null;
          publishTurns();
          settleTurnGenerationWindow(nowMs, stats);
          publishStreamMetrics(nowMs);
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
            finishReason: finishReason ? String(finishReason) : "done",
            failureNotice: failureNoticeForFinishReason(
              finishReason ? String(finishReason) : "done",
              taskErrorMessagesRef.current.get(taskId)
            )
          });
          break;
        }
        // Thunder's kernel emits exactly two custom kinds — `budget_notice` and
        // `loop_recovered` — and this surface renders neither. Everything the
        // metrics badge shows is accumulated locally from `turn_start` /
        // `turn_end` / `loop_complete`; the phase chip that used to be driven by
        // `agent_status` was removed with the plugin that emitted it.
        case "custom":
          break;
        case "user_question": {
          const q = ev as any;
          const parked: PendingQuestion = {
            questionId: String(q.question_id || ""),
            taskId,
            sessionId,
            questions: Array.isArray(q.questions) ? q.questions : []
          };
          // Events arrive for every conversation on the daemon: remember the
          // question for the session that raised it, and dock the bubble only
          // when that session is the one on screen.
          if (parked.questionId) {
            pendingQuestionsRef.current.set(sessionId, parked);
            if (isCurrentSession) setPendingQuestion(parked);
          }
          break;
        }
        case "task_paused": {
          const reason = String((ev as any).reason || "");
          // Keyed to the session on screen: a pause in a background conversation
          // must not hang a banner over this one.
          if (isCurrentSession && taskId) {
            setPausedTask({ taskId, reason });
          }
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
          const message = String((ev as any).message || "").trim();
          // Keep it for `loop_complete`: the failure reason must reach the transcript.
          if (message) taskErrorMessagesRef.current.set(taskId, message);
          if (stream.currentTurn) {
            stream.currentTurn.status = "error";
            publishTurns();
          }
          console.warn("[thunder-event:error]", message);
          break;
        }
      }

      if (isCurrentSession) {
        recordTraceEvent(ev, taskId);
      }
    });

    return () => unsub?.();
  }, [finalizeSessionTurn, recordTraceEvent]);

  // Approval-mode changes arrive *outside* the task stream: the daemon pushes
  // them whether or not a run is live, because the user may toggle plan mode
  // before sending anything. Routed by session, like a parked question.
  useEffect(() => {
    const unsub = desktopApi().onThunderModeChanged((payload: ThunderModeChanged) => {
      if (payload.sessionId !== activeSessionIdRef.current) return;
      setPermissionMode(payload.mode);
      // A change the user did not make is worth saying out loud — the chip
      // moving on its own would otherwise look like a glitch.
      if (payload.source === "planApproved") {
        setTitleNotice({
          kind: "success",
          text: `Plan approved — approval mode is now ${payload.mode}`
        });
      }
    });
    return () => unsub?.();
  }, []);

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

  // Live streaming TPS is updated on each delta / turn settle in `liveStreamingTps`.
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
    liveTurns,
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
    /** The daemon's per-session approval mode; `""` until hydrated. */
    permissionMode,
    setPermissionMode: handleSelectPermissionMode,
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
    pausedTask,
    pauseCurrentTask,
    resumeCurrentTask,
    pendingQuestion,
    answerQuestion,
    dismissQuestion,
    refreshDaemonStatus,
    traceSpans,
    fileChanges,
    isCollectingTrace,
    lastRunMetrics,
    streamingMetrics: {
      tokensCount: streamTokensCount,
      tps: liveStreamingTps,
      reasoningCount: streamReasoningCount
    },
    sessionTotalTokens,
    currentContextTokens,
    contextWindowLimit,
    /** What thunder reports the run is doing; `null` when nothing is running. */
  };
}
