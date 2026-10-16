import type { ThunderConversation } from "../thunder/types";
import { finalizePreviewMessages } from "./text";
import type { FinalizePreviewOptions } from "./text";
import { PreviewMessage, SessionPreviewResult } from "./types";

/**
 * Thunder keeps its conversations in its own store rather than a per-provider
 * transcript file, so the host fetches the conversation and this maps it onto
 * the shared preview shape.
 *
 * The feed's own renderer reads `content` + `reasoning` per message and joins a
 * run's consecutive assistant messages, which is what `finalizePreviewMessages`
 * already does — so the observation split and the visual chat show the same
 * turns.
 */
export function previewThunderConversation(
  conversation: ThunderConversation,
  options?: FinalizePreviewOptions
): SessionPreviewResult {
  const messages: PreviewMessage[] = [];
  for (const message of conversation.messages ?? []) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    const text = (message.content ?? "").trim();
    const thinking = (message.reasoning ?? "").trim();
    if (!text && !thinking) {
      continue;
    }
    messages.push({ role: message.role, text, thinking: thinking || undefined });
  }

  return finalizePreviewMessages(conversation.title || conversation.id, messages, undefined, options);
}
