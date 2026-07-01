import * as vscode from "vscode";
import { AgentSession } from "../history";
import { PreviewMessage } from "../history/preview/types";
import { chatCompletion } from "./client";
import { buildChatCompletionsUrl, getLlmConfig, LlmConfigOverrides } from "./config";
import {
  buildRenameSystemPrompt,
  buildRenameUserPrompt,
  buildSummarizeSystemPrompt,
  buildSummarizeUserPrompt
} from "./prompts";
import { formatTranscript, truncateTranscript } from "./transcript";

async function requireLlmConfig(context: vscode.ExtensionContext) {
  const config = await getLlmConfig(context);
  if (!config) {
    throw new Error("LLM is not configured. Open Agent Resume Settings to set API base URL, model, and API key.");
  }
  return config;
}

function buildTranscript(messages: PreviewMessage[], maxContextChars: number): string {
  if (!messages.length) {
    throw new Error("Session has no messages to analyze.");
  }

  return truncateTranscript(formatTranscript(messages), maxContextChars);
}

export async function summarizeSession(
  context: vscode.ExtensionContext,
  messages: PreviewMessage[]
): Promise<string> {
  const config = await requireLlmConfig(context);
  const transcript = buildTranscript(messages, config.maxContextChars);

  return chatCompletion(
    config,
    [
      { role: "system", content: buildSummarizeSystemPrompt(config.outputLanguage) },
      { role: "user", content: buildSummarizeUserPrompt(transcript, config.outputLanguage) }
    ],
    1500
  );
}

export async function suggestSessionTitle(
  context: vscode.ExtensionContext,
  session: AgentSession,
  messages: PreviewMessage[]
): Promise<string> {
  const config = await requireLlmConfig(context);
  const transcript = buildTranscript(messages, config.maxContextChars);

  const raw = await chatCompletion(
    config,
    [
      { role: "system", content: buildRenameSystemPrompt(config.outputLanguage) },
      { role: "user", content: buildRenameUserPrompt(transcript, session.title, config.outputLanguage) }
    ],
    120
  );

  return raw.replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ").trim();
}

export async function testLlmConnection(
  context: vscode.ExtensionContext,
  overrides?: LlmConfigOverrides
): Promise<string> {
  const config = overrides ? await getLlmConfig(context, overrides) : await requireLlmConfig(context);
  if (!config) {
    throw new Error("LLM is not configured. Set API base URL, model, and API key.");
  }

  const endpoint = buildChatCompletionsUrl(config.baseUrl);
  const reply = await chatCompletion(
    config,
    [
      { role: "system", content: "Reply with exactly: OK" },
      { role: "user", content: "ping" }
    ],
    16
  );

  return `Connected to ${endpoint} (${config.model}): ${reply}`;
}