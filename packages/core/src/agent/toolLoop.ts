import { chatCompletionWithTools } from "../llm/chat";
import type { ChatMessage, LlmRuntimeConfig } from "../llm/types";
import type { UiText } from "../i18n/uiText";
import type { AgentExecutionStep, AgentToolImpact } from "./types";
import {
  convertMcpToolsToOpenAiFormat,
  type McpToolCallResult,
  type NoteMcpClient
} from "../mcp/client";

const DEFAULT_MAX_ITERATIONS = 5;

export type NoteOperation = "search" | "read" | "create" | "write" | "append" | "delete" | "rename" | "move" | "link";
export type SessionOperation = "search" | "list" | "read";

export interface TouchedNote {
  noteId: string;
  title?: string;
  scope?: string;
  relMdPath?: string;
  projectPath?: string;
  contentPreview?: string;
  operation: NoteOperation;
}

export interface TouchedSession {
  provider: string;
  sessionId: string;
  title?: string;
  projectPath?: string;
  contentPreview?: string;
  score?: number;
  operation: SessionOperation;
}

export interface ToolLoopOptions {
  llm: LlmRuntimeConfig;
  messages: ChatMessage[];
  mcpClient: NoteMcpClient;
  maxTokens?: number;
  maxIterations?: number;
  signal?: AbortSignal;
  onToolCall?: (call: { id: string; toolName: string; impact: AgentToolImpact; args: Record<string, unknown> }) => void | Promise<void>;
  onToolResult?: (call: { id: string; toolName: string; impact: AgentToolImpact; result: string; error?: string; status: "succeeded" | "failed" | "rejected"; durationMs: number }) => void | Promise<void>;
  onExecution?: (step: AgentExecutionStep) => void | Promise<void>;
  onProgress?: (message: string, iteration?: number) => void | Promise<void>;
  requestToolApproval?: (call: { id: string; toolName: string; impact: AgentToolImpact; args: Record<string, unknown> }) => Promise<boolean>;
  uiText?: UiText;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export interface ToolLoopResult {
  content: string;
  iterations: number;
  toolCallsExecuted: number;
  touchedNotes: TouchedNote[];
  touchedSessions: TouchedSession[];
  toolTrace: AgentExecutionStep[];
}

function toolImpact(toolName: string): AgentToolImpact {
  if (toolName === "note_delete") return "delete";
  if (["note_create", "note_write", "note_append", "note_set_gtd", "note_set_parent", "note_move", "note_rename", "session_set_gtd"].includes(toolName)) return "write";
  if (toolName === "session_resume") return "launch";
  return "read";
}

const TRACE_SECRET_KEY = /(?:api[_-]?key|authorization|password|secret|token)/i;
const MAX_TRACE_TEXT_CHARS = 16 * 1024;

function truncateTraceText(value: string): string {
  return value.length > MAX_TRACE_TEXT_CHARS
    ? `${value.slice(0, MAX_TRACE_TEXT_CHARS)}\n[truncated]`
    : value;
}

function redactTraceValue(value: unknown): unknown {
  if (typeof value === "string") return truncateTraceText(value);
  if (Array.isArray(value)) return value.map(redactTraceValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, TRACE_SECRET_KEY.test(key) ? "[redacted]" : redactTraceValue(item)]));
  }
  return value;
}

function redactTraceText(value: string): string {
  return truncateTraceText(value
    .replace(/((?:api[_-]?key|authorization|password|secret|token)\s*[=:]\s*["']?)([^\s,"'}]+)/gi, "$1[redacted]")
    .replace(/("(?:api[_-]?key|authorization|password|secret|token)"\s*:\s*")[^"]*(")/gi, "$1[redacted]$2"));
}

function extractToolResultText(result: McpToolCallResult): string {
  if (!result.content || result.content.length === 0) {
    return "(no output)";
  }
  return result.content
    .map((block) => (block.type === "text" ? block.text || "" : ""))
    .join("\n")
    .trim();
}

const NOTE_TOOL_OPERATIONS: Record<string, NoteOperation> = {
  note_search: "search",
  note_read: "read",
  note_create: "create",
  note_write: "write",
  note_append: "append",
  note_set_gtd: "write",
  note_delete: "delete",
  note_tree_read: "read",
  note_set_parent: "link",
  note_move: "move",
  note_rename: "rename"
};

const SESSION_TOOL_OPERATIONS: Record<string, SessionOperation> = {
  session_search: "search",
  session_list: "list",
  session_read: "read",
  session_read_transcript: "read",
  session_set_gtd: "read",
  session_resume: "read"
};

/**
 * Extract structured note summaries embedded in MCP tool result text.
 * note_search returns an array of summaries; all other note tools return a
 * single summary object in the text. Returns an empty array when no JSON
 * summary is found (e.g. "No notes found").
 */
function extractTouchedNotes(toolName: string, text: string): TouchedNote[] {
  const operation = NOTE_TOOL_OPERATIONS[toolName];
  if (!operation) {
    return [];
  }

  const candidates = extractJsonObjects(text);
  const notes: TouchedNote[] = [];
  const seen = new Map<string, TouchedNote>();

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    const noteId = typeof item.noteId === "string" ? item.noteId : undefined;
    if (noteId) {
      const next: TouchedNote = {
        noteId,
        title: typeof item.title === "string" ? item.title : undefined,
        scope: typeof item.scope === "string" ? item.scope : undefined,
        relMdPath: typeof item.relMdPath === "string" ? item.relMdPath : undefined,
        projectPath: typeof item.projectPath === "string" ? item.projectPath : undefined,
        contentPreview: typeof item.contentPreview === "string" ? item.contentPreview : undefined,
        operation
      };
      const existing = seen.get(noteId);
      if (existing) {
        Object.assign(existing, {
          title: next.title || existing.title,
          scope: next.scope || existing.scope,
          relMdPath: next.relMdPath || existing.relMdPath,
          projectPath: next.projectPath || existing.projectPath,
          contentPreview: next.contentPreview || existing.contentPreview
        });
      } else {
        seen.set(noteId, next);
        notes.push(next);
      }
    }
    for (const child of Object.values(item)) visit(child);
  }

  for (const obj of candidates) visit(obj);

  return notes;
}

function sessionKey(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

/**
 * Extract session hits from session_* tool results (JSON arrays/objects).
 * session_read_transcript may only have a text header; callers can pass args.
 */
export function extractTouchedSessions(
  toolName: string,
  text: string,
  args?: Record<string, unknown>
): TouchedSession[] {
  const operation = SESSION_TOOL_OPERATIONS[toolName];
  if (!operation) {
    return [];
  }

  const sessions: TouchedSession[] = [];
  const seen = new Set<string>();

  function push(partial: {
    provider?: string;
    sessionId?: string;
    title?: string;
    projectPath?: string;
    contentPreview?: string;
    score?: number;
  }): void {
    const provider = partial.provider?.trim();
    const sessionId = partial.sessionId?.trim();
    if (!provider || !sessionId) {
      return;
    }
    const key = sessionKey(provider, sessionId);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    sessions.push({
      provider,
      sessionId,
      title: partial.title,
      projectPath: partial.projectPath,
      contentPreview: partial.contentPreview,
      score: partial.score,
      operation
    });
  }

  const candidates = extractJsonObjects(text);
  for (const obj of candidates) {
    const arrays = Array.isArray(obj) ? obj : [obj];
    for (const item of arrays) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const row = item as Record<string, unknown>;
      const provider = typeof row.provider === "string" ? row.provider : undefined;
      const sessionId =
        typeof row.sessionId === "string"
          ? row.sessionId
          : typeof row.agentSessionId === "string"
            ? row.agentSessionId
            : undefined;
      const summary =
        typeof row.sessionSummary === "string"
          ? row.sessionSummary
          : typeof row.summaryPreview === "string"
            ? row.summaryPreview
            : typeof row.contentPreview === "string"
              ? row.contentPreview
              : undefined;
      push({
        provider,
        sessionId,
        title: typeof row.title === "string" ? row.title : undefined,
        projectPath: typeof row.projectPath === "string" ? row.projectPath : undefined,
        contentPreview: summary,
        score: typeof row.score === "number" ? row.score : undefined
      });
    }
  }

  if (!sessions.length && (toolName === "session_read" || toolName === "session_read_transcript")) {
    const provider = typeof args?.provider === "string" ? args.provider : undefined;
    const sessionId = typeof args?.sessionId === "string" ? args.sessionId : undefined;
    let contentPreview: string | undefined;
    if (toolName === "session_read_transcript" && text.trim()) {
      // Strip the header line when present.
      const body = text.replace(/^Transcript excerpt for[^\n]*\n\n?/i, "").trim();
      contentPreview = body.slice(0, 600) || undefined;
    }
    push({ provider, sessionId, contentPreview });
  }

  return sessions;
}

/**
 * Greedily extract all top-level JSON objects/arrays from a text blob.
 * Handles the MCP tool output format where JSON is embedded after a label line.
 */
function extractJsonObjects(text: string): unknown[] {
  const results: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    const openIdx = findNextJsonOpen(text, i);
    if (openIdx === -1) {
      break;
    }
    const parsed = tryParseJsonAt(text, openIdx);
    if (parsed !== undefined) {
      results.push(parsed.value);
      i = parsed.endIdx + 1;
    } else {
      i = openIdx + 1;
    }
  }
  return results;
}

function findNextJsonOpen(text: string, from: number): number {
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      return i;
    }
  }
  return -1;
}

function tryParseJsonAt(
  text: string,
  start: number
): { value: unknown; endIdx: number } | undefined {
  const openChar = text[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return { value: JSON.parse(slice), endIdx: i };
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

export async function runToolLoop(options: ToolLoopOptions): Promise<ToolLoopResult> {
  const maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
  const maxTokens = options.maxTokens || 2000;
  const pt = options.uiText ?? ((key: string, ...args: (string | number)[]) =>
    args.length ? `${key} ${args.join(" ")}` : key);

  options.onProgress?.(pt("desktop.agent.fetchingTools"));
  const toolsList = await options.mcpClient.listTools();
  const tools = convertMcpToolsToOpenAiFormat(toolsList);
  options.onProgress?.(pt("desktop.agent.toolsReady", toolsList.map((t) => t.name).join(", ")));

  let messages = [...options.messages];
  let iterations = 0;
  let toolCallsExecuted = 0;
  let lastContent = "";
  const toolTrace: AgentExecutionStep[] = [];
  const touchedMap = new Map<string, TouchedNote>();
  const touchedSessionMap = new Map<string, TouchedSession>();

  function mergeTouched(notes: TouchedNote[]): void {
    for (const note of notes) {
      touchedMap.set(note.noteId, note);
    }
  }

  function mergeTouchedSessions(sessions: TouchedSession[]): void {
    for (const session of sessions) {
      const key = sessionKey(session.provider, session.sessionId);
      const existing = touchedSessionMap.get(key);
      if (!existing) {
        touchedSessionMap.set(key, session);
        continue;
      }
      const preferIncoming =
        (session.operation === "read" && existing.operation !== "read") ||
        (!existing.contentPreview && Boolean(session.contentPreview)) ||
        (!existing.title && Boolean(session.title));
      if (preferIncoming) {
        touchedSessionMap.set(key, {
          ...existing,
          ...session,
          title: session.title || existing.title,
          projectPath: session.projectPath || existing.projectPath,
          contentPreview: session.contentPreview || existing.contentPreview,
          score: session.score ?? existing.score
        });
      }
    }
  }

  function finish(content: string): ToolLoopResult {
    return {
      content,
      iterations,
      toolCallsExecuted,
      touchedNotes: Array.from(touchedMap.values()),
      touchedSessions: Array.from(touchedSessionMap.values()),
      toolTrace
    };
  }

  while (iterations < maxIterations) {
    throwIfAborted(options.signal);
    iterations++;
    const llmStartedAtMs = Date.now();
    const llmStep: AgentExecutionStep = {
      id: `llm-${iterations}`,
      kind: "llm",
      status: "running",
      startedAtMs: llmStartedAtMs,
      title: "LLM request",
      source: { kind: "llm", name: options.llm.model },
      iteration: iterations
    };
    toolTrace.push(llmStep);
    await options.onExecution?.({ ...llmStep });
    await options.onProgress?.(
      iterations === 1
        ? pt("desktop.agent.requestingLlm")
        : pt("desktop.agent.requestingLlmRound", iterations),
      iterations
    );

    const result = await chatCompletionWithTools(
      options.llm,
      messages,
      tools,
      maxTokens,
      options.signal
    );
    llmStep.status = "succeeded";
    llmStep.completedAtMs = Date.now();
    await options.onExecution?.({ ...llmStep });

    lastContent = result.content;

    if (!result.toolCalls || result.toolCalls.length === 0 || result.finishReason === "stop") {
      if (!lastContent) {
        return finish(pt("desktop.agent.toolsNoResponse"));
      }
      return finish(result.content);
    }

    messages.push({
      role: "assistant",
      content: result.content || "",
      tool_calls: result.toolCalls
    });

    for (const toolCall of result.toolCalls) {
      throwIfAborted(options.signal);
      const toolName = toolCall.function.name;
      const id = toolCall.id || `tool-${iterations}-${toolCallsExecuted + 1}`;
      const impact = toolImpact(toolName);
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = toolCall.function.arguments
          ? JSON.parse(toolCall.function.arguments)
          : {};
      } catch {
        parsedArgs = {};
      }

      const traceArgs = redactTraceValue(parsedArgs) as Record<string, unknown>;
      const step: AgentExecutionStep = {
        id,
        kind: "tool",
        status: "pending",
        startedAtMs: Date.now(),
        title: toolName,
        capability: "mcp",
        source: { kind: "mcp", name: "Built-in MCP" },
        toolName,
        impact,
        args: traceArgs
      };
      toolTrace.push(step);
      await options.onExecution?.({ ...step });
      await options.onToolCall?.({ id, toolName, impact, args: traceArgs });

      if (options.requestToolApproval && impact !== "read") {
        step.status = "awaiting_approval";
        await options.onExecution?.({ ...step });
        const approved = await options.requestToolApproval({ id, toolName, impact, args: traceArgs });
        throwIfAborted(options.signal);
        if (!approved) {
          const denied = "Tool execution was denied by the user.";
          step.status = "rejected";
          step.result = denied;
          step.completedAtMs = Date.now();
          await options.onExecution?.({ ...step });
          await options.onToolResult?.({ id, toolName, impact, result: denied, status: "rejected", durationMs: step.completedAtMs - step.startedAtMs });
          messages.push({ role: "tool", content: denied, tool_call_id: toolCall.id, name: toolName });
          continue;
        }
      }

      let toolResultText: string;
      let toolError: string | undefined;
      step.status = "running";
      await options.onExecution?.({ ...step });
      try {
        const rawResult = await options.mcpClient.callTool(toolName, parsedArgs);
        toolResultText = extractToolResultText(rawResult);
        if (rawResult.isError) {
          toolError = toolResultText;
        } else {
          mergeTouched(extractTouchedNotes(toolName, toolResultText));
          mergeTouchedSessions(extractTouchedSessions(toolName, toolResultText, parsedArgs));
        }
        step.status = toolError ? "failed" : "succeeded";
      } catch (error) {
        toolError = error instanceof Error ? error.message : String(error);
        toolResultText = `Error: ${toolError}`;
        step.status = "failed";
      }

      const traceResult = redactTraceText(toolResultText);
      step.result = traceResult;
      const traceError = toolError ? redactTraceText(toolError) : undefined;
      step.error = traceError;
      step.completedAtMs = Date.now();
      await options.onExecution?.({ ...step });
      await options.onToolResult?.({ id, toolName, impact, result: traceResult, error: traceError, status: step.status === "succeeded" ? "succeeded" : "failed", durationMs: step.completedAtMs - step.startedAtMs });

      toolCallsExecuted++;

      messages.push({
        role: "tool",
        content: toolResultText,
        tool_call_id: toolCall.id,
        name: toolName
      });
    }
  }

  return finish(lastContent || pt("desktop.agent.toolsMaxIterations"));
}
