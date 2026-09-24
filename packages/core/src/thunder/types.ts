export type ScheduleTriggerType = "interval" | "daily" | "cron" | "manual";
export type ScheduleStatus = "idle" | "running" | "success" | "failed";
export type ScheduleRunStatus = "running" | "completed" | "failed" | "cancelled";
export type ScheduleRunTriggerSource = "schedule" | "manual";

export interface ThunderSchedule {
  id: string;
  name: string;
  prompt: string;
  workspaceDir?: string;
  model?: string;
  triggerType: ScheduleTriggerType;
  triggerValue: string;
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

/** A role as reported by the Thunder daemon (`list_roles`). */
export interface ThunderRoleInfo {
  id: string;
  name: string;
  aliases?: string[];
  description?: string;
  /** Capability tier enforced host-side. */
  permission: "read" | "write" | "bash" | string;
  persona?: string;
  model?: string | null;
  thinking_level?: string | null;
  ask_user?: boolean;
  exit_gate?: boolean;
}

export interface ThunderModelInfo {
  id: string;
  provider: string;
  name: string;
  selection_id: string;
  available: boolean;
  reasoning?: boolean;
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

export interface ThunderTurnStats {
  turn: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  duration_ms: number;
  tool_calls_count: number;
  tokens_per_second?: number;
}

export interface ThunderAgentStats {
  total_turns: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_cached_tokens?: number;
  total_duration_ms: number;
  total_tool_executions: number;
  total_tool_time_ms: number;
  avg_tokens_per_second?: number;
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
  finish_reason?: string;
  stats?: ThunderAgentStats;
  final_content?: string;
  events?: ThunderObservedEvent[];
  file_changes?: ThunderFileChangeRecord[];
  telemetry_notices?: ThunderTelemetryNotice[];
}

export type ThunderAgentEvent =
  | { type: "turn_start"; turn: number; timestamp: number }
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
      type: "file_change";
      turn: number;
      tool_call_id: string;
      path: string;
      action: "written" | "created" | "modified" | "deleted" | "failed" | string;
      bytes?: number;
      tool_name: string;
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

export interface ThunderChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
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

export interface ThunderChatTaskOptions {
  taskId: string;
  prompt: string;
  sessionId?: string;
  model?: string;
  workspaceDir?: string;
  taskNoteId?: string;
  thinking_level?: string;
  useMock?: boolean;
}

export interface ThunderChatTaskResult {
  finalContent?: string;
  finishReason: string;
  activePlugins?: string[];
}

