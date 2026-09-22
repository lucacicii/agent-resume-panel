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

export interface ThunderModelInfo {
  id: string;
  provider: string;
  name: string;
  selection_id: string;
  available: boolean;
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
      };
    }
  | { type: "turn_end"; turn: number; stats?: unknown }
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
