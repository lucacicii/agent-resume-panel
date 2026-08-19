import { DEFAULT_CATALOG_OUTPUT_LANGUAGE } from "../i18n/outputLanguage";
import { chatCompletionDetailed } from "../llm/chat";
import { LlmRuntimeConfig } from "../llm/types";
import { formatTranscript, truncateTranscript } from "../transcript/load";
import { PreviewMessage } from "../transcript/types";
import {
  buildRenameSystemPrompt,
  buildRenameUserPrompt,
  buildSummarizeSystemPrompt,
  buildSummarizeUserPrompt,
  normalizeSuggestedTitle
} from "./prompts";

function buildTranscript(messages: PreviewMessage[], maxContextChars: number): string {
  if (!messages.length) {
    throw new Error("Session has no messages to analyze.");
  }
  return truncateTranscript(formatTranscript(messages), maxContextChars);
}

export async function summarizeSessionMessages(
  config: LlmRuntimeConfig,
  messages: PreviewMessage[]
): Promise<{ summary: string; model?: string; usage?: import("../usage/types").TokenUsage; durationMs: number }> {
  const lang = config.outputLanguage?.trim() || DEFAULT_CATALOG_OUTPUT_LANGUAGE;
  const maxChars = config.maxContextChars ?? 120_000;
  const transcript = buildTranscript(messages, maxChars);
  const result = await chatCompletionDetailed(
    config,
    [
      { role: "system", content: buildSummarizeSystemPrompt(lang) },
      { role: "user", content: buildSummarizeUserPrompt(transcript, lang) }
    ],
    4000
  );
  return {
    summary: result.content,
    model: result.model,
    usage: result.usage,
    durationMs: result.durationMs
  };
}

export async function suggestSessionTitleFromMessages(
  config: LlmRuntimeConfig,
  currentTitle: string,
  messages: PreviewMessage[]
): Promise<{ title: string; model?: string; usage?: import("../usage/types").TokenUsage; durationMs: number }> {
  const lang = config.outputLanguage?.trim() || DEFAULT_CATALOG_OUTPUT_LANGUAGE;
  const maxChars = config.maxContextChars ?? 120_000;
  const transcript = buildTranscript(messages, maxChars);
  const result = await chatCompletionDetailed(
    config,
    [
      { role: "system", content: buildRenameSystemPrompt(lang) },
      { role: "user", content: buildRenameUserPrompt(transcript, currentTitle, lang) }
    ],
    4000
  );
  const title = normalizeSuggestedTitle(result.content);
  if (!title) {
    throw new Error("LLM returned an empty title.");
  }
  return {
    title,
    model: result.model,
    usage: result.usage,
    durationMs: result.durationMs
  };
}
