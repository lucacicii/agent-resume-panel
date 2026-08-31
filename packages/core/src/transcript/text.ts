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
    if (!isRecord(block) || isToolishBlock(block)) continue;
    const type = blockType(block);
    const thinkingText = typeof block.thinking === "string"
      ? block.thinking
      : type && THINKING_BLOCK_TYPES.has(type) && typeof block.text === "string"
        ? block.text
        : "";
    if (thinkingText.trim()) {
      thinkingParts.push(thinkingText);
      continue;
    }
    if (typeof block.text === "string" && block.text.trim() && !THINKING_BLOCK_TYPES.has(type)) {
      textParts.push(block.text);
    }
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

export function finalizePreviewMessages(
  title: string,
  messages: PreviewMessage[],
  warning?: string
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
  if (visible.length <= MAX_PREVIEW_MESSAGES) {
    return { title, messages: visible, warning };
  }

  return {
    title,
    messages: visible.slice(-MAX_PREVIEW_MESSAGES),
    truncated: true,
    warning
  };
}
