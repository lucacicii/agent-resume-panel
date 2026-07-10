import { chatCompletionDetailed } from "../llm/chat";
import { ChatMessage } from "../llm/types";
import { chatLlmConfigFromSettings } from "../llm/fromSettings";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { recordLlmUsage } from "../usage/store";
import { buildMetaAgentSystemPrompt, buildMetaAgentUserPrompt, formatSourceBlock } from "./prompts";
import { retrieveAgentContext } from "./retrieve";
import { AskMetaAgentOptions, AskMetaAgentResult } from "./types";

export async function askMetaAgent(options: AskMetaAgentOptions): Promise<AskMetaAgentResult> {
  const query = options.query?.trim();
  if (!query) {
    throw new Error("Question is empty.");
  }

  const settings = await loadSettings(options.panelHome);
  const llm = chatLlmConfigFromSettings(settings);
  if (!llm) {
    throw new Error(
      "Conversation LLM is not configured. Set llm (or chatLlm) baseUrl, model, and apiKey in settings.json."
    );
  }

  const dbPath = catalogDbFromSettings(settings, options.panelHome);
  const panelHome = effectivePanelHome(settings, options.panelHome);

  const retrieved = await retrieveAgentContext({
    query,
    panelHome: options.panelHome || panelHome,
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

  const result = await chatCompletionDetailed(llm, messages, 2000);
  try {
    await recordLlmUsage(dbPath, {
      kind: "chat",
      source: "ask",
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      ok: true
    });
  } catch {
    // non-fatal
  }

  return {
    answer: result.content,
    citations: retrieved.citations,
    fallback: retrieved.fallback,
    digests: retrieved.digests.map((d) => d.entry)
  };
}
