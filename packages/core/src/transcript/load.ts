import { AgentSession } from "../catalog/types";
import { previewAgySession } from "./agy";
import { previewAlmaSession } from "./alma";
import { previewClaudeSession } from "./claude";
import { previewCodexSession } from "./codex";
import { previewGrokSession } from "./grok";
import { previewOpenCodeSession } from "./opencode";
import { previewPiSession } from "./pi";
import { PreviewHomes, PreviewMessage, SessionPreviewResult } from "./types";

export async function loadSessionPreview(
  session: AgentSession,
  homes: PreviewHomes
): Promise<SessionPreviewResult> {
  switch (session.provider) {
    case "codex":
      return previewCodexSession(session, homes);
    case "claude":
      return previewClaudeSession(session, homes);
    case "agy":
      return previewAgySession(session, homes);
    case "grok":
      return previewGrokSession(session, homes);
    case "alma":
      return previewAlmaSession(session, homes);
    case "opencode":
      return previewOpenCodeSession(session, homes);
    case "pi":
      return previewPiSession(session, homes);
    default:
      throw new Error(`Preview is not supported for provider ${session.provider}.`);
  }
}

export function formatTranscript(messages: PreviewMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "Assistant" : "User";
    lines.push(`${role}: ${message.text}`);
  }
  return lines.join("\n\n");
}

export function truncateTranscript(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const truncated = text.slice(text.length - maxChars);
  const firstBreak = truncated.indexOf("\n\n");
  if (firstBreak >= 0 && firstBreak < 200) {
    return `[...truncated...]\n\n${truncated.slice(firstBreak + 2)}`;
  }

  return `[...truncated...]\n\n${truncated}`;
}

/**
 * Best-effort excerpt for memory digests. Returns null if unavailable.
 */
export async function loadSessionSnippet(
  session: AgentSession,
  homes: PreviewHomes,
  maxChars = 2500
): Promise<string | null> {
  try {
    const preview = await loadSessionPreview(session, homes);
    if (!preview.messages.length) {
      return null;
    }
    // Prefer recent turns for daily context
    const recent = preview.messages.slice(-12);
    const text = formatTranscript(recent);
    return truncateTranscript(text, maxChars);
  } catch {
    return null;
  }
}
