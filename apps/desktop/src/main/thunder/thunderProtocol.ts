export type {
  ThunderConversationSummary,
  ThunderConversation,
  ThunderChatMessage,
  ThunderChatStreamPayload,
  ThunderChatTaskOptions,
  ThunderChatTaskResult
} from "@agent-resume/core";

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

export interface ThunderObservedEvent {
  agent_id: string;
  event: ThunderAgentEvent;
}

export type ThunderDaemonIncoming =
  | {
      type: "response";
      id?: string;
      success: boolean;
      data?: Record<string, unknown>;
      error?: string;
    }
  | {
      type: "observed_event";
      task_id: string;
      event: ThunderObservedEvent;
    }
  | {
      type: "task_completed";
      task_id: string;
      session_id: string;
      final_content?: string;
      finish_reason: string;
      active_plugins?: string[];
    }
  | {
      type: "task_failed";
      task_id: string;
      session_id?: string;
      error: string;
    };
