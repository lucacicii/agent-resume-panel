import { PreviewMessage, MAX_PREVIEW_MESSAGES } from "./types";

export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return normalizePreviewText(content);
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== "object") {
      continue;
    }

    const record = block as Record<string, unknown>;
    if (typeof record.text === "string") {
      parts.push(record.text);
      continue;
    }
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
      continue;
    }
    if (record.type === "input_text" && typeof record.text === "string") {
      parts.push(record.text);
      continue;
    }
    if (record.type === "output_text" && typeof record.text === "string") {
      parts.push(record.text);
    }
  }

  return normalizePreviewText(parts.join("\n"));
}

export function normalizePreviewText(input: string): string {
  return input.trim();
}

export function isUserOrAssistantRole(role: unknown): role is "user" | "assistant" {
  return role === "user" || role === "assistant";
}

export function finalizePreviewMessages(
  title: string,
  messages: PreviewMessage[],
  warning?: string
): { title: string; messages: PreviewMessage[]; truncated?: boolean; warning?: string } {
  const filtered = messages
    .map((message) => ({
      ...message,
      text: message.text.trim()
    }))
    .filter((message) => message.text.length > 0);

  if (filtered.length <= MAX_PREVIEW_MESSAGES) {
    return { title, messages: filtered, warning };
  }

  return {
    title,
    messages: filtered.slice(-MAX_PREVIEW_MESSAGES),
    truncated: true,
    warning
  };
}