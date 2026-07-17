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
    throw new Error("Session has no messages to hand off.");
  }

  const transcript = truncateTranscript(formatTranscript(context.messages), config.maxContextChars);
  const body = await chatCompletion(
    config,
    [
      { role: "system", content: buildHandoffSystemPrompt(config.outputLanguage) },
      { role: "user", content: buildHandoffUserPrompt(transcript, config.outputLanguage) }
    ],
    maxBriefTokens
  );

  return {
    body,
    truncated: context.truncated
  };
}