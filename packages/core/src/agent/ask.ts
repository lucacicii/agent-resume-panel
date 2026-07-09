import { chatCompletion } from "../llm/chat";
import { ChatMessage } from "../llm/types";
import { llmConfigFromSettings } from "../llm/fromSettings";
import { loadSettings } from "../settings/store";
import { buildMetaAgentSystemPrompt, buildMetaAgentUserPrompt, formatSourceBlock } from "./prompts";
import { retrieveAgentContext } from "./retrieve";
import { AskMetaAgentOptions, AskMetaAgentResult } from "./types";

export async function askMetaAgent(options: AskMetaAgentOptions): Promise<AskMetaAgentResult> {
  const query = options.query?.trim();
  if (!query) {
    throw new Error("Question is empty.");
  }

  const settings = await loadSettings(options.panelHome);
  const llm = llmConfigFromSettings(settings);
  if (!llm) {
    throw new Error(
      "LLM is not configured. Set llm.baseUrl, llm.model, and llm.apiKey in settings.json."
    );
  }

  const retrieved = await retrieveAgentContext({
    query,
    panelHome: options.panelHome,
    limit: options.limit
  });

  const sourcesBlock = retrieved.digests
    .map((d, i) =>
      formatSourceBlock(
        i + 1,
        d.entry.level,
        d.entry.title || d.entry.id,
        d.entry.content,
        d.score
      )
    )
    .join("\n\n");

  const history = (options.history || []).slice(-6);
  const historyBlock = history.length
    ? history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")
    : undefined;

  const language = llm.outputLanguage || "zh-CN";
  const messages: ChatMessage[] = [
    { role: "system", content: buildMetaAgentSystemPrompt(language) },
    {
      role: "user",
      content: buildMetaAgentUserPrompt({ query, sourcesBlock, historyBlock })
    }
  ];

  const answer = await chatCompletion(llm, messages, 2000);

  return {
    answer,
    citations: retrieved.citations,
    fallback: retrieved.fallback,
    digests: retrieved.digests.map((d) => d.entry)
  };
}
