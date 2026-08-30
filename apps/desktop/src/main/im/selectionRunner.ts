import {
  chatCompletionDetailed,
  chatLlmConfigFromSettings,
  desktopDbPath,
  effectivePanelHome,
  loadSettings,
  normalizeBaseUrl,
  recordLlmUsage,
  type LlmRuntimeConfig,
  type PanelSettings
} from "@agent-resume/core";
import type { ImStore } from "./store";
import { fillSelectionPrompt } from "./store";

function resolveActionLlm(
  settings: PanelSettings,
  providerId: string,
  modelId: string
): LlmRuntimeConfig | undefined {
  const provider = (settings.providers ?? []).find((entry) => entry.id === providerId);
  if (!provider) return undefined;
  const model = (provider.models ?? []).find((entry) => entry.id === modelId);
  if (!model) return undefined;
  const apiKey = provider.apiKey?.trim();
  const baseUrl = normalizeBaseUrl(provider.baseUrl || "");
  if (!apiKey || !baseUrl || !model.id.trim()) return undefined;
  const toolOptions = settings.llmOptions?.tool;
  return {
    baseUrl,
    model: model.id.trim(),
    apiKey,
    maxContextChars: toolOptions?.maxContextChars,
    requestTimeoutMs: toolOptions?.requestTimeoutMs,
    disableThinking: settings.llmOptions?.chat?.disableThinking
  };
}

/**
 * Runs an independent selection action (Translate / Explain / custom) against
 * the user's chat LLM (or action-specific model) and records usage.
 */
export async function runIndependentSelectionAction(
  store: ImStore,
  actionId: string,
  rawText: string
): Promise<{ text: string }> {
  const action = await store.getSelectionAction(actionId);
  if (!action) throw new Error("Selection action not found.");
  if (action.kind !== "independent") {
    throw new Error("Only independent actions can run against the chat model.");
  }
  const selection = store.clipSelectionText(rawText);
  if (!selection.trim()) throw new Error("Select some text first.");
  const settings = await loadSettings();
  const llm = (action.providerId && action.modelId ? resolveActionLlm(settings, action.providerId, action.modelId) : undefined)
    ?? chatLlmConfigFromSettings(settings);
  if (!llm) {
    throw new Error("Conversation LLM is not configured. Select an Ask/Chat model in Settings → Providers.");
  }
  const prompt = fillSelectionPrompt(action.prompt, selection);
  const usageDb = desktopDbPath(effectivePanelHome(settings));
  try {
    const result = await chatCompletionDetailed(llm, [{ role: "user", content: prompt }], 1024);
    await recordLlmUsage(usageDb, {
      kind: "chat",
      source: "im_selection",
      jobKey: action.actionId,
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      ok: true
    });
    return { text: result.content };
  } catch (error) {
    await recordLlmUsage(usageDb, {
      kind: "chat",
      source: "im_selection",
      jobKey: action.actionId,
      model: llm.model,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => undefined);
    throw error;
  }
}