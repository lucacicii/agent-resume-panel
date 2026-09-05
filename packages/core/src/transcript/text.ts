import { PreviewMessage, MAX_PREVIEW_MESSAGES } from "./types";

const TOOL_BLOCK_TYPES = new Set([
  "tool_result",
  "tool_use",
  "tool-result",
  "tool-use",
  "function_call",
  "function_call_output"
]);

const THINKING_BLOCK_TYPES = new Set(["thinking", "reasoning", "reason"]);

const NOISE_TEXT = /^(?:<(?:tool_result|tool-use|command-name|command-message|command-args|local-command-stdout|local-command-stderr|total_tokens|task-notification)\b|\[Request interrupted\b)/i;

export type ExtractedPreviewContent = {
  text: string;
  thinking: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isToolishBlock(block: Record<string, unknown>): boolean {
  const type = typeof block.type === "string" ? block.type : "";
  if (TOOL_BLOCK_TYPES.has(type)) return true;
  if (typeof block.tool_use_id === "string" || typeof block.toolUseId === "string") return true;
  return false;
}

function blockType(block: Record<string, unknown>): string {
  return typeof block.type === "string" ? block.type : "";
}

const INPUT_TEXT_TYPE_ALIASES = new Set(["input_text", "input-text", "inputText"]);
const INJECTED_INPUT_TEXT_PREFIXES = ["# agents.md instructions", "<environment_context>", "<environment-context>"];

function blockText(block: Record<string, unknown>, type: string): string {
  if (typeof block.text === "string") return block.text;
  if (typeof block.input === "string") return block.input;
  if (typeof block.content === "string") return block.content;
  if (INPUT_TEXT_TYPE_ALIASES.has(type)) {
    for (const key of ["text", "input", "content", "value"] as const) {
      const value = (block as Record<string, unknown>)[key];
      if (typeof value === "string") return value;
    }
  }
  return "";
}

function pushBlockText(
  block: Record<string, unknown>,
  textParts: string[],
  thinkingParts: string[]
): void {
  if (isToolishBlock(block)) return;
  const type = blockType(block);
  const raw = blockText(block, type);
  if (!raw.trim() || THINKING_BLOCK_TYPES.has(type)) {
    const thinkingText =
      typeof block.thinking === "string"
        ? block.thinking
        : type && THINKING_BLOCK_TYPES.has(type) && typeof block.text === "string"
          ? block.text
          : "";
    if (thinkingText.trim()) thinkingParts.push(thinkingText);
    return;
  }
  const marker = raw.trimStart().slice(0, 32).toLowerCase();
  if (INJECTED_INPUT_TEXT_PREFIXES.some((prefix) => marker.startsWith(prefix))) return;
  textParts.push(raw);
}

function collectParts(content: unknown, textParts: string[], thinkingParts: string[]): void {
  if (typeof content === "string") {
    if (content.trim()) textParts.push(content);
    return;
  }
  const blocks = Array.isArray(content) ? content : isRecord(content) ? [content] : [];
  for (const block of blocks) {
    if (typeof block === "string") {
      if (block.trim()) textParts.push(block);
      continue;
    }
    if (!isRecord(block)) continue;
    pushBlockText(block, textParts, thinkingParts);
  }
}

export function extractPreviewContent(content: unknown): ExtractedPreviewContent {
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  collectParts(content, textParts, thinkingParts);
  return {
    text: normalizePreviewText(textParts.join("\n")),
    thinking: normalizePreviewText(thinkingParts.join("\n\n"))
  };
}

export function extractTextFromContent(content: unknown): string {
  return extractPreviewContent(content).text;
}

export function normalizePreviewText(input: string): string {
  return input.trim();
}

export function isUserOrAssistantRole(role: unknown): role is "user" | "assistant" {
  return role === "user" || role === "assistant";
}

export function isConversationPreviewText(text: string): boolean {
  const trimmed = text.trim();
  return Boolean(trimmed) && !NOISE_TEXT.test(trimmed);
}

export interface FinalizePreviewOptions {
  /** Cap on returned messages. Omit or pass Infinity for no cap (import flows). */
  maxMessages?: number;
}

export function finalizePreviewMessages(
  title: string,
  messages: PreviewMessage[],
  warning?: string,
  options?: FinalizePreviewOptions
): { title: string; messages: PreviewMessage[]; truncated?: boolean; warning?: string } {
  const merged: PreviewMessage[] = [];
  for (const message of messages) {
    const text = message.text.trim();
    const thinking = message.thinking?.trim() || "";
    if (!isUserOrAssistantRole(message.role)) continue;
    if (message.role === "user") {
      if (!isConversationPreviewText(text)) continue;
      merged.push(message.timestamp ? { role: "user", text, timestamp: message.timestamp } : { role: "user", text });
      continue;
    }
    if (!isConversationPreviewText(text) && !thinking) continue;
    const previous = merged.at(-1);
    if (previous && previous.role === "assistant") {
      if (text && isConversationPreviewText(text)) {
        previous.text = previous.text ? `${previous.text}\n\n${text}` : text;
      }
      if (thinking) {
        previous.thinking = previous.thinking ? `${previous.thinking}\n\n${thinking}` : thinking;
      }
      if (!previous.timestamp && message.timestamp) previous.timestamp = message.timestamp;
      continue;
    }
    merged.push({
      role: "assistant",
      text: isConversationPreviewText(text) ? text : "",
      ...(thinking ? { thinking } : {}),
      ...(message.timestamp ? { timestamp: message.timestamp } : {})
    });
  }

  const visible = merged.filter((message) => message.role === "user" || message.text || message.thinking);
  const cap = options?.maxMessages ?? MAX_PREVIEW_MESSAGES;
  if (!Number.isFinite(cap) || cap <= 0 || visible.length <= cap) {
    return { title, messages: visible, warning };
  }

  return {
    title,
    messages: visible.slice(-cap),
    truncated: true,
    warning
  };
}
