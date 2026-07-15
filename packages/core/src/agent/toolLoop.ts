import { chatCompletionWithTools } from "../llm/chat";
import type { ChatMessage, LlmRuntimeConfig } from "../llm/types";
import {
  convertMcpToolsToOpenAiFormat,
  type McpToolCallResult,
  type NoteMcpClient
} from "../mcp/client";

const DEFAULT_MAX_ITERATIONS = 5;

export type NoteOperation = "search" | "read" | "create" | "write" | "append" | "delete";

export interface TouchedNote {
  noteId: string;
  title?: string;
  scope?: string;
  relMdPath?: string;
  projectPath?: string;
  contentPreview?: string;
  operation: NoteOperation;
}

export interface ToolLoopOptions {
  llm: LlmRuntimeConfig;
  messages: ChatMessage[];
  mcpClient: NoteMcpClient;
  maxTokens?: number;
  maxIterations?: number;
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void;
  onToolResult?: (toolName: string, result: McpToolCallResult, error?: string) => void;
  onProgress?: (message: string) => void;
}

export interface ToolLoopResult {
  content: string;
  iterations: number;
  toolCallsExecuted: number;
  touchedNotes: TouchedNote[];
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
  note_delete: "delete"
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

  for (const obj of candidates) {
    const arrays = Array.isArray(obj) ? obj : [obj];
    for (const item of arrays) {
      const noteId = typeof item?.noteId === "string" ? item.noteId : undefined;
      if (!noteId) {
        continue;
      }
      notes.push({
        noteId,
        title: typeof item.title === "string" ? item.title : undefined,
        scope: typeof item.scope === "string" ? item.scope : undefined,
        relMdPath: typeof item.relMdPath === "string" ? item.relMdPath : undefined,
        projectPath: typeof item.projectPath === "string" ? item.projectPath : undefined,
        contentPreview: typeof item.contentPreview === "string" ? item.contentPreview : undefined,
        operation
      });
    }
  }

  return notes;
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

  options.onProgress?.("正在获取工具列表…");
  const toolsList = await options.mcpClient.listTools();
  const tools = convertMcpToolsToOpenAiFormat(toolsList);
  options.onProgress?.(`工具就绪: ${toolsList.map((t) => t.name).join(", ")}`);

  let messages = [...options.messages];
  let iterations = 0;
  let toolCallsExecuted = 0;
  let lastContent = "";
  const touchedMap = new Map<string, TouchedNote>();

  function mergeTouched(notes: TouchedNote[]): void {
    for (const note of notes) {
      touchedMap.set(note.noteId, note);
    }
  }

  while (iterations < maxIterations) {
    iterations++;
    options.onProgress?.(
      iterations === 1 ? "正在请求 LLM…" : `第 ${iterations} 轮请求 LLM…`
    );

    const result = await chatCompletionWithTools(options.llm, messages, tools, maxTokens);

    lastContent = result.content;

    if (!result.toolCalls || result.toolCalls.length === 0 || result.finishReason === "stop") {
      if (!lastContent) {
        return {
          content: "LLM 未返回有效回答（可能是端点不支持 function calling）。请在设置中确认你的 LLM 端点支持 tools 参数。",
          iterations,
          toolCallsExecuted,
          touchedNotes: Array.from(touchedMap.values())
        };
      }
      return { content: result.content, iterations, toolCallsExecuted, touchedNotes: Array.from(touchedMap.values()) };
    }

    messages.push({
      role: "assistant",
      content: result.content || "",
      tool_calls: result.toolCalls
    });

    for (const toolCall of result.toolCalls) {
      const toolName = toolCall.function.name;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = toolCall.function.arguments
          ? JSON.parse(toolCall.function.arguments)
          : {};
      } catch {
        parsedArgs = {};
      }

      options.onToolCall?.(toolName, parsedArgs);

      let toolResultText: string;
      let toolError: string | undefined;
      try {
        const rawResult = await options.mcpClient.callTool(toolName, parsedArgs);
        toolResultText = extractToolResultText(rawResult);
        if (rawResult.isError) {
          toolError = toolResultText;
        } else {
          mergeTouched(extractTouchedNotes(toolName, toolResultText));
        }
        options.onToolResult?.(toolName, rawResult, toolError);
      } catch (error) {
        toolError = error instanceof Error ? error.message : String(error);
        toolResultText = `Error: ${toolError}`;
        options.onToolResult?.(toolName, { content: [{ type: "text", text: toolResultText }], isError: true }, toolError);
      }

      toolCallsExecuted++;

      messages.push({
        role: "tool",
        content: toolResultText,
        tool_call_id: toolCall.id,
        name: toolName
      });
    }
  }

  return {
    content: lastContent || "已达到工具调用次数上限，请缩小请求范围后重试。",
    iterations,
    toolCallsExecuted,
    touchedNotes: Array.from(touchedMap.values())
  };
}
