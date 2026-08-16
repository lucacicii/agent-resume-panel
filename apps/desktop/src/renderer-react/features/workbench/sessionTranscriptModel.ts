export const TRANSCRIPT_OUTLINE_TITLE_MAX = 48;

export type TranscriptMessageRole = "user" | "assistant";

export type TranscriptPreviewMessage = {
  role: string;
  text: string;
  timestamp?: string;
};

export type TranscriptMessage = {
  id: string;
  role: TranscriptMessageRole;
  text: string;
  timestamp?: string;
};

export type TranscriptOutlineItem = {
  id: string;
  messageId: string;
  index: number;
  title: string;
};

export type SessionTranscriptModel = {
  messages: TranscriptMessage[];
  outline: TranscriptOutlineItem[];
};

function isTranscriptRole(role: string): role is TranscriptMessageRole {
  return role === "user" || role === "assistant";
}

export function transcriptOutlineTitle(text: string, max = TRANSCRIPT_OUTLINE_TITLE_MAX): string {
  const firstLine = text.replace(/\r\n/g, "\n").split("\n").find((line) => line.trim()) || "";
  const compact = firstLine.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function buildSessionTranscriptModel(
  messages: readonly TranscriptPreviewMessage[]
): SessionTranscriptModel {
  const nextMessages: TranscriptMessage[] = [];
  const outline: TranscriptOutlineItem[] = [];

  for (const [index, message] of messages.entries()) {
    const text = message.text.trim();
    if (!text || !isTranscriptRole(message.role)) continue;
    const id = `transcript-msg-${index}`;
    nextMessages.push({
      id,
      role: message.role,
      text,
      timestamp: message.timestamp
    });
    if (message.role === "user") {
      outline.push({
        id: `transcript-turn-${outline.length + 1}`,
        messageId: id,
        index: outline.length + 1,
        title: transcriptOutlineTitle(text)
      });
    }
  }

  return { messages: nextMessages, outline };
}

export function filterSessionTranscript(
  model: SessionTranscriptModel,
  query: string
): SessionTranscriptModel {
  const needle = query.trim().toLowerCase();
  if (!needle) return model;

  const matchedIds = new Set<string>();
  for (const message of model.messages) {
    if (message.text.toLowerCase().includes(needle)) matchedIds.add(message.id);
  }
  if (!matchedIds.size) {
    return { messages: [], outline: [] };
  }

  return {
    messages: model.messages.filter((message) => matchedIds.has(message.id)),
    outline: model.outline.filter((item) => matchedIds.has(item.messageId))
  };
}
