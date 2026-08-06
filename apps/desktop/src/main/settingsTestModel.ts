import {
  chatLlmConfigFromSettings,
  embeddingConfigFromSettings,
  llmConfigFromSettings,
  loadSettings,
  testChatLlmConnection,
  testEmbeddingConnection,
  type PanelSettings
} from "@agent-resume/core";

export type ModelTestKind = "tool" | "chat" | "embedding";

/** Draft fields from Settings → Models (current form values; not necessarily saved). */
export interface ModelsTestDraft {
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiKey?: string;
  llmLang?: string;
  llmDisableThinking?: boolean;
  chatBaseUrl?: string;
  chatModel?: string;
  chatApiKey?: string;
  embBaseUrl?: string;
  embModel?: string;
  embApiKey?: string;
}

export interface TestModelConnectionResult {
  ok: boolean;
  message: string;
}

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Apply Models form draft onto saved settings without writing disk (mirrors renderer modelsPatch). */
export function applyModelsDraft(settings: PanelSettings, draft: ModelsTestDraft | undefined | null): PanelSettings {
  if (!draft || typeof draft !== "object") {
    return settings;
  }
  const llmApiKey = typeof draft.llmApiKey === "string" ? draft.llmApiKey : settings.llm?.apiKey || "";
  const chatApiKey = typeof draft.chatApiKey === "string" ? draft.chatApiKey : "";
  const embApiKey = typeof draft.embApiKey === "string" ? draft.embApiKey : "";
  return {
    ...settings,
    llm: {
      ...settings.llm,
      baseUrl: trim(draft.llmBaseUrl),
      model: trim(draft.llmModel),
      apiKey: llmApiKey,
      disableThinking: typeof draft.llmDisableThinking === "boolean" ? draft.llmDisableThinking : settings.llm?.disableThinking,
      outputLanguage:
        typeof draft.llmLang === "string" && draft.llmLang.trim()
          ? (draft.llmLang.trim() as PanelSettings["llm"]["outputLanguage"])
          : settings.llm?.outputLanguage
    },
    chatLlm: {
      ...settings.chatLlm,
      baseUrl: trim(draft.chatBaseUrl) || undefined,
      model: trim(draft.chatModel) || undefined,
      apiKey: chatApiKey || undefined
    },
    embedding: {
      ...settings.embedding,
      baseUrl: trim(draft.embBaseUrl) || undefined,
      model: trim(draft.embModel) || "text-embedding-3-small",
      apiKey: embApiKey || undefined
    }
  };
}

export function parseModelTestKind(value: unknown): ModelTestKind {
  if (value === "tool" || value === "chat" || value === "embedding") {
    return value;
  }
  throw new Error(`Unsupported model test kind: ${String(value)}`);
}

export async function testModelConnectionFromDraft(args: {
  kind?: unknown;
  draft?: ModelsTestDraft | null;
}): Promise<TestModelConnectionResult> {
  const kind = parseModelTestKind(args.kind);
  const settings = applyModelsDraft(await loadSettings(), args.draft);

  try {
    if (kind === "embedding") {
      const message = await testEmbeddingConnection(embeddingConfigFromSettings(settings));
      return { ok: true, message };
    }
    const config =
      kind === "chat" ? chatLlmConfigFromSettings(settings) : llmConfigFromSettings(settings);
    const message = await testChatLlmConnection(config);
    return { ok: true, message };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
