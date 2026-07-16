import { DEFAULT_CATALOG_OUTPUT_LANGUAGE } from "../i18n/outputLanguage";
import { chatCompletionDetailed } from "../llm/chat";
import { LlmRuntimeConfig } from "../llm/types";
import {
  buildCommitMessageSystemPrompt,
  buildCommitMessageUserPrompt,
  normalizeSuggestedCommitMessage
} from "./prompts";

const DEFAULT_MAX_DIFF_CHARS = 32_000;

function truncateDiff(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n\n[... diff truncated ...]`;
}

function uniqueFileNames(statusText: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of statusText.split("\n")) {
    if (!line.trim()) continue;
    let filePath = "";
    if (line.startsWith("?? ")) {
      filePath = line.slice(3).trim();
    } else if (line.length >= 4) {
      filePath = line.slice(3).trim();
      const arrow = filePath.indexOf(" -> ");
      if (arrow >= 0) filePath = filePath.slice(arrow + 4).trim();
    }
    if (!filePath) continue;
    const base = filePath.split("/").pop() || filePath;
    if (!seen.has(base)) {
      seen.add(base);
      names.push(base);
    }
  }
  return names;
}

/** Heuristic commit message when LLM is unavailable. */
export function buildHeuristicCommitMessage(statusText: string): string {
  const files = uniqueFileNames(statusText);
  if (!files.length) {
    return "Update project files";
  }
  if (files.length === 1) {
    return `Update ${files[0]}`;
  }
  if (files.length === 2) {
    return `Update ${files[0]} and ${files[1]}`;
  }
  return `Update ${files[0]}, ${files[1]} and ${files.length - 2} more files`;
}

export async function suggestCommitMessageFromGitContext(
  config: LlmRuntimeConfig,
  statusText: string,
  diffText: string
): Promise<{
  message: string;
  model?: string;
  usage?: import("../usage/types").TokenUsage;
  durationMs: number;
}> {
  const lang = config.outputLanguage?.trim() || DEFAULT_CATALOG_OUTPUT_LANGUAGE;
  const maxChars = Math.min(config.maxContextChars ?? DEFAULT_MAX_DIFF_CHARS, DEFAULT_MAX_DIFF_CHARS);
  const status = truncateDiff(statusText, 4000);
  const diff = truncateDiff(diffText, maxChars);
  const result = await chatCompletionDetailed(
    config,
    [
      { role: "system", content: buildCommitMessageSystemPrompt(lang) },
      { role: "user", content: buildCommitMessageUserPrompt(status, diff, lang) }
    ],
    500
  );
  const message = normalizeSuggestedCommitMessage(result.content);
  if (!message) {
    throw new Error("LLM returned an empty commit message.");
  }
  return {
    message,
    model: result.model,
    usage: result.usage,
    durationMs: result.durationMs
  };
}