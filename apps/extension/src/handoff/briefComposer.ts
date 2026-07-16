import { PreviewMessage } from "../history/preview/types";
import { HandoffBrief, HandoffSessionContext } from "./types";

export interface ComposeHandoffMessageOptions {
  brief: HandoffBrief;
  context: HandoffSessionContext;
  attachRecentVerbatim: number;
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