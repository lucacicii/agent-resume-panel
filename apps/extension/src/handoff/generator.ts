import { t } from "../i18n";
import { LlmConfig } from "../llm/config";
import { chatCompletion } from "../llm/client";
import { formatTranscript, truncateTranscript } from "../llm/transcript";
import { buildHandoffSystemPrompt, buildHandoffUserPrompt } from "./prompts";
import { HandoffBrief, HandoffSessionContext } from "./types";

export async function generateHandoffBrief(
  context: HandoffSessionContext,
  config: LlmConfig,
  maxBriefTokens: number
): Promise<HandoffBrief> {
  if (!context.messages.length) {
    throw new Error(t("error.handoffEmptySession"));
  }

  const transcript = truncateTranscript(formatTranscript(context.messages), config.maxContextChars);
  const body = await chatCompletion(
    config,
    [
      { role: "system", content: buildHandoffSystemPrompt(config.outputLanguage) },
      { role: "user", content: buildHandoffUserPrompt(transcript, config.outputLanguage) }
    ],
    maxBriefTokens,
    { attempts: 3 }
  );

  return {
    body,
    truncated: context.truncated
  };
}