export type {
  ThunderConversationSummary,
  ThunderConversation,
  ThunderChatMessage,
  ThunderContentPart,
  ThunderImageAttachment,
  ThunderToolExecutionRecord,
  ThunderChatStreamPayload,
  ThunderChatTaskOptions,
  ThunderChatTaskResult,
  ThunderTelemetryNotice,
  ThunderFileChangeRecord,
  ThunderTraceSpan,
  ThunderTaskTrace,
  ThunderTurnStats,
  ThunderAgentStats,
  ThunderModelInfo
} from "@agent-resume/core";

/** Result of AI-title generation or manual title setting (errors are structured, never thrown). */
export interface ThunderTitleResult {
  ok: boolean;
  title?: string;
  /** Machine-readable error kind: no_utility_model | client_error | api_error | empty_title | store_error | manual_locked | not_found | invalid_title | unknown */
  errorKind?: string;
  /** Human-readable error detail for display */
  error?: string;
}

/** One selectable option inside a question bubble. */
export interface ThunderQuestionOption {
  label: string;
  description?: string;
}

/** One question the agent is blocked on, rendered as a bubble. */
export interface ThunderQuestionItem {
  question: string;
  header?: string;
  multi_select?: boolean;
  multiSelect?: boolean;
  options: ThunderQuestionOption[];
}

export type { ThunderModelsConfig, ThunderModelsProvider } from "@agent-resume/core";

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
        telemetry?: import("@agent-resume/core").ThunderTelemetryNotice;
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
  | { type: "turn_end"; turn: number; stats?: import("@agent-resume/core").ThunderTurnStats }
  | {
      type: "user_question";
      question_id: string;
      questions: ThunderQuestionItem[];
    }
  | { type: "task_paused"; reason: string }
  | {
      type: "steer_accepted";
      turn: number;
      /** `steer` or `follow_up` — which queue the message came from. */
      behavior: string;
      message: string;
    }
  | {
      /** Both queues in full, so the renderer never shows a stale count. */
      type: "task_queue_update";
      steering: string[];
      follow_up: string[];
    }
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
      /**
       * The run's terminal reason when one exists (`Cancelled`, `Error`, ...).
       * Absent when the daemon failed before a run started, which is what lets a
       * client tell "the agent stopped" from "we never got going".
       */
      finish_reason?: string;
    }
  | {
      type: "user_question";
      task_id: string;
      session_id?: string;
      question_id: string;
      questions: ThunderQuestionItem[];
    }
  | {
      type: "task_paused";
      task_id: string;
      session_id?: string;
      reason: string;
    }
  | {
      /**
       * The task's pending steering / follow-up queues changed.
       *
       * Always the complete queues, never a delta: a client that missed one
       * message would otherwise drift out of sync with the agent forever.
       */
      type: "task_queue_update";
      task_id: string;
      session_id?: string;
      steering: string[];
      follow_up: string[];
    };

/**
 * Where a queued message enters the run.
 *
 * The two placements are far apart, so the daemon refuses to guess: a caller
 * must state which one it means.
 */
export type ThunderQueueBehavior = "steer" | "follow_up";
