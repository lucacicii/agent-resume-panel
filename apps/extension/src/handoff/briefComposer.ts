import { PreviewMessage } from "../history/preview/types";
import { HandoffBrief, HandoffSessionContext } from "./types";

interface ComposeHandoffMessageOptions {
  brief: HandoffBrief;
  context: HandoffSessionContext;
  attachRecentVerbatim: number;
}

/**
 * Deterministic stand-in for the LLM brief: the handoff itself must not fail
 * because the summarizing request failed, so the receiving agent gets the
 * failure reason plus the verbatim transcript tail.
 */
export function buildFallbackBrief(reason: string): HandoffBrief {
  return {
    body: [
      `Note: the automatic handoff summary could not be generated (${reason}).`,
      "",
      "Next step:",
      "Continue from the last user request in the recent verbatim exchanges below."
    ].join("\n"),
    truncated: false
  };
}

export function composeHandoffMessage(options: ComposeHandoffMessageOptions): string {
  const { brief, context, attachRecentVerbatim } = options;
  const parts: string[] = [
    "# Session Handoff",
    `Source: ${context.sourceProvider} ${context.sourceKind} session \`${context.sessionId}\``,
    `Project: ${context.projectPath}`
  ];

  if (context.branch) {
    parts.push(`Branch: ${context.branch}`);
  }
  if (context.model) {
    parts.push(`Model: ${context.model}`);
  }

  parts.push("", brief.body);

  if (attachRecentVerbatim > 0) {
    const verbatim = formatRecentVerbatim(context.messages, attachRecentVerbatim);
    if (verbatim) {
      parts.push("", "---", "Recent verbatim exchanges:", "", verbatim);
    }
  }

  parts.push(
    "",
    "---",
    "Please read relevant files in the workspace before making changes. Continue from the Next step above."
  );

  if (brief.truncated || context.truncationWarning) {
    parts.push("", `Note: ${context.truncationWarning ?? "Conversation was truncated for handoff."}`);
  }

  return parts.join("\n");
}

function formatRecentVerbatim(messages: PreviewMessage[], count: number): string {
  if (count <= 0 || !messages.length) {
    return "";
  }

  const recent = messages.slice(-count);
  return recent
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : "User";
      return `${role}: ${message.text}`;
    })
    .join("\n\n");
}