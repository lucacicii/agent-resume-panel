import { findTranscriptUserMessage } from "./composerTipMatch";

export const TRANSCRIPT_OUTLINE_TITLE_MAX = 48;
export const TRANSCRIPT_PENDING_USER_ID = "transcript-pending-user";
export const TRANSCRIPT_PENDING_ASSISTANT_ID = "transcript-pending-assistant";

export type TranscriptMessageRole = "user" | "assistant";

export type TranscriptPreviewMessage = {
  role: string;
  text: string;
  thinking?: string;
  timestamp?: string;
};

export type TranscriptMessage = {
  id: string;
  role: TranscriptMessageRole;
  text: string;
  thinking?: string;
  timestamp?: string;
  pending?: boolean;
};

export type TranscriptOutlineItem = {
  id: string;
  messageId: string;
  index: number;
  title: string;
  pending?: boolean;
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
  messages: readonly TranscriptPreviewMessage[],
  previous?: SessionTranscriptModel | null
): SessionTranscriptModel {
  const nextMessages: TranscriptMessage[] = [];
  const outline: TranscriptOutlineItem[] = [];

  for (const [index, message] of messages.entries()) {
    const text = message.text.trim();
    const thinking = message.thinking?.trim() || "";
    if (!isTranscriptRole(message.role) || (!text && !thinking)) continue;
    const id = `transcript-msg-${index}`;
    // Live previews replace the whole message list on every tick. Reusing the
    // unchanged rows keeps memoized message rows (and their markdown) intact.
    const cached = previous?.messages[index];
    const unchanged = cached
      && cached.id === id
      && cached.role === message.role
      && cached.text === text
      && (cached.thinking || "") === thinking
      && (cached.timestamp || "") === (message.timestamp || "");
    nextMessages.push(unchanged
      ? cached
      : {
          id,
          role: message.role,
          text,
          thinking: thinking || undefined,
          timestamp: message.timestamp
        });
    if (message.role === "user" && text) {
      const outlineId = `transcript-turn-${outline.length + 1}`;
      const cachedOutline = previous?.outline[outline.length];
      const title = transcriptOutlineTitle(text);
      outline.push(cachedOutline
        && cachedOutline.id === outlineId
        && cachedOutline.messageId === id
        && cachedOutline.title === title
        ? cachedOutline
        : { id: outlineId, messageId: id, index: outline.length + 1, title });
    }
  }

  return { messages: nextMessages, outline };
}

export type TranscriptPreviewSnapshot = {
  title?: string;
  messages: readonly TranscriptPreviewMessage[];
  truncated?: boolean;
  warning?: string;
};

export function sameTranscriptPreview(
  current: TranscriptPreviewSnapshot | null | undefined,
  next: TranscriptPreviewSnapshot | null | undefined
): boolean {
  if (current === next) return true;
  if (!current || !next) return false;
  if (
    (current.title || "") !== (next.title || "")
    || Boolean(current.truncated) !== Boolean(next.truncated)
    || (current.warning || "") !== (next.warning || "")
    || current.messages.length !== next.messages.length
  ) {
    return false;
  }
  return current.messages.every((message, index) => {
    const other = next.messages[index];
    return other !== undefined
      && message.role === other.role
      && message.text === other.text
      && (message.thinking || "") === (other.thinking || "")
      && (message.timestamp || "") === (other.timestamp || "");
  });
}

export function filterSessionTranscript(
  model: SessionTranscriptModel,
  query: string
): SessionTranscriptModel {
  const needle = query.trim().toLowerCase();
  if (!needle) return model;

  const matchedIds = new Set<string>();
  for (const message of model.messages) {
    if (message.text.toLowerCase().includes(needle) || message.thinking?.toLowerCase().includes(needle)) {
      matchedIds.add(message.id);
    }
  }
  if (!matchedIds.size) {
    return { messages: [], outline: [] };
  }

  return {
    messages: model.messages.filter((message) => matchedIds.has(message.id)),
    outline: model.outline.filter((item) => matchedIds.has(item.messageId))
  };
}

export type TranscriptPendingUser = {
  text: string;
  sentAtMs?: number;
};

/**
 * Where the blinking caret goes while the agent is answering.
 *
 * `inline` means the caret rides at the end of the streaming message's own
 * markdown (rendered by the markdown body, so it never re-parses anything), and
 * `tail` is the standalone caret row used when the running session has no
 * streaming markdown to attach to — reasoning-only turns, or a transcript that
 * still lags behind the agent.
 *
 * The caller decides "the agent is answering" from the session status; this
 * helper only maps that verdict onto the transcript that is on screen.
 */
export type TranscriptStreamCaret = "none" | "inline" | "tail";

export function transcriptStreamCaret(
  messages: readonly TranscriptMessage[],
  isRunning: boolean
): TranscriptStreamCaret {
  if (!isRunning) return "none";
  const last = messages.at(-1);
  if (!last) return "none";
  // The optimistic rows own their own signal: the waiting bubble rolls dots and
  // the user's own prompt is not an answer.
  if (last.pending) return "none";
  if (last.role === "assistant" && last.text.trim()) return "inline";
  return "tail";
}

function lastMessage(messages: readonly TranscriptMessage[]): TranscriptMessage | undefined {
  return messages[messages.length - 1];
}

function assistantHasContent(message: TranscriptMessage | undefined): boolean {
  return Boolean(message && message.role === "assistant" && (message.text.trim() || message.thinking?.trim()));
}

function samePendingRow(row: TranscriptMessage | undefined, text: string, timestamp?: string): row is TranscriptMessage {
  return Boolean(
    row
    && row.pending
    && row.text === text
    && (row.timestamp || "") === (timestamp || "")
  );
}

/**
 * Overlay a just-sent composer prompt and a waiting assistant bubble until
 * the on-disk transcript catches up. Pending rows never replace real content.
 *
 * Passing the previous merge result back in keeps those overlay rows stable
 * while the disk transcript is still flushing, so a live poll that changed
 * nothing visible does not re-render them.
 */
export function mergePendingTranscript(
  model: SessionTranscriptModel,
  options: {
    pendingUser?: TranscriptPendingUser | null;
    isRunning?: boolean;
    pendingTitle: string;
  },
  previous?: SessionTranscriptModel | null
): SessionTranscriptModel {
  const messages = [...model.messages];
  const outline = [...model.outline];
  const pendingText = options.pendingUser?.text.trim() || "";
  const sentAtMs = options.pendingUser?.sentAtMs;
  const pendingUserFresh = sentAtMs == null || Date.now() - sentAtMs < 120_000;
  const previousUserRow = previous?.messages.find((message) => message.id === TRANSCRIPT_PENDING_USER_ID);
  const previousAssistantRow = previous?.messages.find((message) => message.id === TRANSCRIPT_PENDING_ASSISTANT_ID);
  const previousUserOutline = previous?.outline.find((item) => item.messageId === TRANSCRIPT_PENDING_USER_ID);
  const previousAssistantOutline = previous?.outline.find((item) => item.messageId === TRANSCRIPT_PENDING_ASSISTANT_ID);

  if (pendingText && pendingUserFresh) {
    const matched = findTranscriptUserMessage(
      messages.filter((message) => message.role === "user"),
      pendingText,
      options.pendingUser?.sentAtMs
    );
    if (!matched) {
      const timestamp = options.pendingUser?.sentAtMs != null
        ? String(options.pendingUser.sentAtMs)
        : undefined;
      const reused = samePendingRow(previousUserRow, pendingText, timestamp) ? previousUserRow : null;
      messages.push(reused || {
        id: TRANSCRIPT_PENDING_USER_ID,
        role: "user",
        text: pendingText,
        timestamp,
        pending: true
      });
      outline.push(previousUserOutline?.title === transcriptOutlineTitle(pendingText) ? previousUserOutline : {
        id: "transcript-turn-pending-user",
        messageId: TRANSCRIPT_PENDING_USER_ID,
        index: outline.length + 1,
        title: transcriptOutlineTitle(pendingText),
        pending: true
      });
    }
  }

  const last = lastMessage(messages);
  const waitingForAssistant = Boolean(options.isRunning || pendingText) && !assistantHasContent(last);
  if (waitingForAssistant) {
    messages.push(previousAssistantRow || {
      id: TRANSCRIPT_PENDING_ASSISTANT_ID,
      role: "assistant",
      text: "",
      pending: true
    });
    outline.push(previousAssistantOutline?.title === options.pendingTitle ? previousAssistantOutline : {
      id: "transcript-turn-pending-assistant",
      messageId: TRANSCRIPT_PENDING_ASSISTANT_ID,
      index: outline.length + 1,
      title: options.pendingTitle,
      pending: true
    });
  }

  return { messages, outline };
}
