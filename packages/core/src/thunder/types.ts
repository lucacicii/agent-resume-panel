export type ScheduleTriggerType = "interval" | "daily" | "cron" | "manual";
export type ScheduleCatchUpPolicy = "skip" | "once" | "all";
/**
 * Whether a schedule's runs share one Thunder session (`pinned`) or each get a
 * fresh one (`fresh`). Pinned keeps the prompt prefix cache-warm and makes the
 * schedule's history a single readable conversation; fresh guarantees runs
 * cannot influence each other through prior context.
 */
export type ScheduleSessionMode = "pinned" | "fresh";
export type ScheduleStatus = "idle" | "running" | "success" | "failed";
export type ScheduleRunStatus = "running" | "completed" | "failed" | "cancelled";
export type ScheduleRunTriggerSource = "schedule" | "manual" | "catch_up";

export interface ThunderSchedule {
  id: string;
  name: string;
  prompt: string;
  workspaceDir?: string;
  model?: string;
  triggerType: ScheduleTriggerType;
  triggerValue: string;
  /**
   * What to do about trigger points that came due while the scheduler was not
   * running. `skip` (default) treats an overdue run as stale; `once` replays
   * only the most recent; `all` replays every point.
   */
  catchUp?: ScheduleCatchUpPolicy;
  /** `pinned` (default) or `fresh`; see {@link ScheduleSessionMode}. */
  sessionMode?: ScheduleSessionMode;
  enabled: boolean;
  lastRunAtMs?: number;
  lastStatus?: ScheduleStatus;
  lastError?: string;
  lastOutput?: string;
  nextRunAtMs?: number;
  createdAtMs: number;
  updatedAtMs: number;
}

/** A question the agent is blocked on; rendered as a chat bubble. */
export interface ThunderQuestionOption {
  label: string;
  description?: string;
}

export interface ThunderQuestionItem {
  question: string;
  header?: string;
  multi_select?: boolean;
  multiSelect?: boolean;
  options: ThunderQuestionOption[];
}

/** Shape of `~/.thunder/models.json` (provider registry + utility model selection). */
export interface ThunderModelsConfig {
  providers: Record<string, ThunderModelsProvider>;
  utilityModel?: string;
}

export interface ThunderModelsProvider {
  name?: string;
  api?: string;
  apiKey?: string;
  baseUrl?: string;
  models?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ThunderModelInfo {
  id: string;
  provider: string;
  name: string;
  selection_id: string;
  available: boolean;
  reasoning?: boolean;
  input?: string[];
  thinking_levels?: string[];
  default_thinking_level?: string;
  context_window?: number;
  max_tokens?: number;
}

export interface ThunderTelemetryNotice {
  layer: string;
  action: string;
  ground_truth: string;
  self_healed?: string;
  guidance?: string;
}

export interface ThunderFileChangeRecord {
  path: string;
  tool: string;
  action: "written" | "created" | "modified" | "deleted" | "failed" | string;
  bytes?: number;
  turn?: number;
  timestamp?: number;
  toolCallId?: string;
}

/**
 * Payload of thunder's `file_change` custom event.
 *
 * Emitted by the tool layer (`thunder-agent-pack-code/src/file_change.rs`) as
 * `AgentEvent::Custom`, which reaches a host as
 * `{"type":"custom","kind":"file_change","payload":{…}}`. The event carries no
 * turn and no tool call id — the kernel does not interpret it, so only what the
 * tool itself knows is in here.
 */
export interface ThunderFileChangePayload {
  path: string;
  action: "written" | "created" | "modified" | "deleted" | "failed" | string;
  /** Present for `write_file`; `bash` reports a path and an action only. */
  bytes?: number;
  tool?: string;
}

export interface ThunderTurnStats {
  turn: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  duration_ms: number;
  tool_calls_count: number;
  tokens_per_second?: number;
}

export interface ThunderAgentStats {
  total_turns: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cached_tokens?: number;
  total_reasoning_tokens?: number;
  total_duration_ms: number;
  total_tool_executions: number;
  total_tool_time_ms: number;
  avg_tokens_per_second?: number;
}

export interface ThunderMetricsSnapshot {
  session_id: string;
  task_id?: string;
  model?: string;
  thinking_level?: string;
  is_running: boolean;
  turn: number;
  live_tps: number;
  avg_tps?: number;
  live_tokens: number;
  live_reasoning_tokens: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  total_tokens?: number;
  cached_tokens: number;
  cache_write_tokens?: number;
  cache_hit_percent?: number;
  context_tokens: number;
  context_window_limit?: number;
  context_usage_percent?: number;
  session_total_tokens: number;
  generation_duration_ms: number;
  tool_duration_ms: number;
  duration_ms?: number;
  wall_duration_ms?: number;
}

export interface ThunderTraceSpan {
  id: string;
  turn: number;
  type: "thinking" | "token" | "tool" | "telemetry" | "file";
  name: string;
  startedAtMs: number;
  durationMs?: number;
  status?: "running" | "completed" | "failed";
  data?: Record<string, unknown>;
}

export interface ThunderTaskTrace {
  task_id: string;
  session_id: string;
  model?: string;
  workspace_dir?: string;
  prompt?: string;
  started_at_ms: number;
  finished_at_ms?: number;
  duration_ms?: number;
  /** Wall-clock time from task receipt (user message) to completion. */
  wall_duration_ms?: number;
  finish_reason?: string;
  stats?: ThunderAgentStats;
  metrics?: ThunderMetricsSnapshot;
  final_content?: string;
  events?: ThunderObservedEvent[];
  file_changes?: ThunderFileChangeRecord[];
  telemetry_notices?: ThunderTelemetryNotice[];
}

export type ThunderAgentEvent =
  | {
      type: "turn_start";
      turn: number;
      timestamp: number;
      /** Estimated size of the prompt this turn sends (system prompt + tools included). */
      estimated_prompt_tokens?: number;
    }
  | { type: "token_delta"; turn: number; delta: string }
  | { type: "reasoning_delta"; turn: number; delta: string }
  | {
      type: "tool_call_ready";
      turn: number;
      tool_call: { id: string; name: string; arguments: string };
    }
  | {
      type: "tool_exec_start";
      turn: number;
      tool_call_id: string;
      name: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_exec_result";
      turn: number;
      tool_call_id: string;
      name: string;
      result: {
        tool_call_id: string;
        output: unknown;
        error?: string;
        is_error: boolean;
        duration_ms?: number;
        telemetry?: ThunderTelemetryNotice;
      };
    }
  | {
      /**
       * A host-defined event forwarded verbatim by the kernel. Thunder emits
       * `kind: "file_change"` from the tool layer; the payload shape is
       * `ThunderFileChangePayload`. Other kinds are safe to ignore.
       *
       * Note this is `type: "custom"` with a `kind` discriminator — NOT a
       * top-level `type: "file_change"`. The kernel deliberately does not
       * interpret custom events, so they arrive wrapped.
       */
      type: "custom";
      kind: string;
      payload: Record<string, unknown>;
    }
  | {
      type: "telemetry_notice";
      turn: number;
      tool_call_id: string;
      layer: string;
      action: string;
      ground_truth: string;
      self_healed?: string;
      guidance?: string;
    }
  | { type: "turn_end"; turn: number; stats?: ThunderTurnStats }
  | { type: "done"; stats?: unknown }
  | { type: "error"; message: string }
  | { type: string; [key: string]: unknown };

export interface ThunderScheduleRunLogEntry {
  timestamp: number;
  type: "token" | "reasoning" | "tool_start" | "tool_result" | "turn" | "info" | "error";
  turn?: number;
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
}

export interface ThunderScheduleRun {
  id: string;
  scheduleId: string;
  status: ScheduleRunStatus;
  triggerSource: ScheduleRunTriggerSource;
  prompt: string;
  workspaceDir?: string;
  model?: string;
  output?: string;
  error?: string;
  startedAtMs: number;
  finishedAtMs?: number;
  logsJson?: string;
}

export interface ThunderScheduleInput {
  name: string;
  prompt: string;
  workspaceDir?: string;
  model?: string;
  triggerType: ScheduleTriggerType;
  triggerValue: string;
  catchUp?: ScheduleCatchUpPolicy;
  sessionMode?: ScheduleSessionMode;
  enabled?: boolean;
}

export interface ThunderToolCallFunction {
  name: string;
  arguments: string;
}

export interface ThunderToolCall {
  id: string;
  type: string;
  function: ThunderToolCallFunction;
}

export interface ThunderToolExecutionRecord {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  isRunning?: boolean;
  isError?: boolean;
}

export type ThunderContentPart =
  | { type: "text"; text: string }
  | {
      type: "image";
      mimeType: string;
      data?: string;
      path?: string;
      sha256?: string;
      name?: string;
    };

export interface ThunderImageAttachment {
  mimeType?: string;
  name?: string;
  data?: string;
  path?: string;
  sizeBytes?: number;
}

export interface ThunderChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  parts?: ThunderContentPart[];
  name?: string;
  tool_calls?: ThunderToolCall[];
  tool_call_id?: string;
  reasoning?: string;
  tool_executions?: ThunderToolExecutionRecord[];
  stats?: {
    turn?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    duration_ms?: number;
    tool_calls_count?: number;
  };
}

export interface ThunderConversationSummary {
  id: string;
  title?: string;
  parent_id?: string;
  model?: string;
  workspace?: string;
  thinking_level?: string;
  status: string;
  message_count: number;
  turn_count: number;
  total_tokens: number;
  /** Cumulative provider-reported usage (includes cache reads/writes). */
  total_used_tokens?: number;
  tags?: string[];
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ThunderConversation {
  id: string;
  title?: string;
  parent_id?: string;
  system_prompt?: string;
  model?: string;
  workspace?: string;
  thinking_level?: string;
  status: string;
  messages: ThunderChatMessage[];
  stats?: {
    total_tokens?: number;
    /** Cumulative provider-reported usage across the conversation (includes cache). */
    total_used_tokens?: number;
    message_count?: number;
    turn_count?: number;
    tool_calls_count?: number;
    duration_ms?: number;
  };
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ThunderObservedEvent {
  agent_id: string;
  event: ThunderAgentEvent;
}

export interface ThunderChatStreamPayload {
  taskId: string;
  sessionId: string;
  event: ThunderObservedEvent;
}

/**
 * The approval mode a session is judged by, spelled the way Thunder spells it.
 *
 * These four are the canonical wire values; Thunder's parser also tolerates a
 * long tail of pre-0.4 aliases, but a host should only ever *send* these.
 */
export type ThunderPermissionMode = "plan" | "ask" | "acceptEdits" | "yolo";

/** The order `Shift+Tab` cycles in — Thunder's `Mode::ALL`. */
export const THUNDER_PERMISSION_MODES: ThunderPermissionMode[] = [
  "plan",
  "ask",
  "acceptEdits",
  "yolo"
];

/** What made a session's mode move. */
export type ThunderModeChangeSource = "user" | "planApproved" | "runOption";

/**
 * Pushed by the daemon whenever a session's approval mode changes — whatever
 * moved it: the user's own toggle, a run that pinned a mode, or an approved
 * plan. A no-op is never announced, so receiving one always means a real
 * change; `previous` is carried so a surface can render the transition rather
 * than diffing values itself.
 */
export interface ThunderModeChanged {
  sessionId: string;
  /** Present when the change happened inside a run (a plan approval). */
  taskId?: string;
  mode: ThunderPermissionMode;
  previous?: ThunderPermissionMode;
  source: ThunderModeChangeSource;
}

/** Who raised a dialog. See `ThunderUiRequest`. */
export type ThunderUiRequestSource = "host" | "plugin";

/**
 * A blocking dialog the agent — or a plugin — wants answered.
 *
 * `ui` picks the shape: `select` answers with one of `options`, `confirm` with
 * a boolean, `input`/`editor` with free text, and `review` with one of
 * `options` over a `content` document that IS the thing being approved.
 *
 * `source` is security-relevant: `host` marks a host-initiated interaction
 * (a permission approval or a plan review) and must be rendered with chrome a
 * plugin cannot imitate. A `plugin`-sourced request is display only and must
 * never be treated as an authorisation decision.
 */
export interface ThunderUiRequest {
  requestId: string;
  taskId?: string;
  sessionId?: string;
  source: ThunderUiRequestSource;
  ui: "select" | "confirm" | "input" | "editor" | "review";
  title: string;
  options?: string[];
  message?: string;
  placeholder?: string;
  prefill?: string;
  /** Where a reviewed document lives, for the header. */
  path?: string;
  /** The document under review, as markdown. */
  content?: string;
  timeoutMs?: number;
}

/**
 * The answer to a `ThunderUiRequest`.
 *
 * Only one field is meaningful: `value` for a choice, `confirmed` for a
 * yes/no, `cancelled` for a dismissal. Cancelling is how a surface says "nobody
 * is going to answer this" — the daemon then fails closed immediately instead
 * of holding the agent until `timeoutMs` elapses.
 */
export interface ThunderUiAnswer {
  requestId: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

/**
 * Live snapshot of an in-flight Thunder task, buffered in the main process so a
 * renderer that unmounted and remounted mid-answer can resume the stream instead
 * of restarting from the next incremental delta.
 */
export interface ThunderActiveStreamSnapshot {
  sessionId: string;
  taskId: string;
  prompt?: string;
  model?: string;
  workspaceDir?: string;
  startedAtMs: number;
  isRunning: boolean;
  streamingText: string;
  streamingReasoning: string;
  streamingTools: ThunderToolExecutionRecord[];
  metrics?: ThunderMetricsSnapshot;
  events: ThunderObservedEvent[];
}

export interface ThunderChatTaskOptions {
  taskId: string;
  prompt: string;
  sessionId?: string;
  model?: string;
  workspaceDir?: string;
  taskNoteId?: string;
  thinking_level?: string;
  /**
   * Pin this run's approval mode. Only sent once the user has actually chosen
   * one: omitting it leaves the session's remembered mode (or `.thunder`'s
   * `agent.defaultMode` for a first run) in charge.
   */
  mode?: ThunderPermissionMode;
  attachments?: ThunderImageAttachment[];
}

export interface ThunderChatTaskResult {
  finalContent?: string;
  finishReason: string;
  activePlugins?: string[];
}

