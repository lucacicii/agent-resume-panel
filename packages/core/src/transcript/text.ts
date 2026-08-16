import { PreviewMessage, MAX_PREVIEW_MESSAGES } from "./types";

const TOOL_BLOCK_TYPES = new Set([
  "tool_result",
  "tool_use",
  "tool-result",
  "tool-use",
  "function_call",
  "function_call_output"
]);

const NOISE_TEXT = /^(?:<(?:tool_result|tool-use|command-name|command-message|command-args|local-command-stdout|local-command-stderr|total_tokens|task-notification)\b|\[Request interrupted\b)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isToolishBlock(block: Record<string, unknown>): boolean {
  const type = typeof block.type === "string" ? block.type : "";
  if (TOOL_BLOCK_TYPES.has(type)) return true;
  if (typeof block.tool_use_id === "string" || typeof block.toolUseId === "string") return true;
  return false;
}

function collectTextParts(content: unknown, parts: string[]): void {
  if (typeof content === "string") {
    if (content.trim()) parts.push(content);
    return;
  }
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (typeof block === "string") {
      if (block.trim()) parts.push(block);
      continue;
    }
    if (!isRecord(block) || isToolishBlock(block)) continue;
    if (typeof block.text === "string" && block.text.trim()) {
      parts.push(block.text);
    }
  }
}

export function extractTextFromContent(content: unknown): string {
  const parts: string[] = [];
  collectTextParts(content, parts);
  return normalizePreviewText(parts.join("\n"));
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

export function finalizePreviewMessages(
  title: string,
  messages: PreviewMessage[],
  warning?: string
): { title: string; messages: PreviewMessage[]; truncated?: boolean; warning?: string } {
  const merged: PreviewMessage[] = [];
  for (const message of messages) {
    const text = message.text.trim();
    if (!isConversationPreviewText(text) || !isUserOrAssistantRole(message.role)) continue;
    const previous = merged.at(-1);
    if (previous && previous.role === "assistant" && message.role === "assistant") {
      previous.text = `${previous.text}\n\n${text}`;
      if (!previous.timestamp && message.timestamp) previous.timestamp = message.timestamp;
      continue;
    }
    merged.push({
      role: message.role,
      text,
      timestamp: message.timestamp
    });
  }

  if (merged.length <= MAX_PREVIEW_MESSAGES) {
    return { title, messages: merged, warning };
  }

  return {
    title,
    messages: merged.slice(-MAX_PREVIEW_MESSAGES),
    truncated: true,
    warning
  };
}
