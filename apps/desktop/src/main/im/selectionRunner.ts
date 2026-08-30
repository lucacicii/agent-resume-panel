import {
  chatCompletionDetailed,
  chatLlmConfigFromSettings,
  desktopDbPath,
  effectivePanelHome,
  loadSettings,
  recordLlmUsage
} from "@agent-resume/core";
import type { ImStore } from "./store";
import { fillSelectionPrompt } from "./store";

/**
 * Runs an independent selection action (Translate / Explain / custom) against
 * the user's chat LLM and records usage. Kept in its own module so the IPC
 * handler stays thin and the LLM path is unit-testable with mocked core.
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
  const llm = chatLlmConfigFromSettings(settings);
  if (!llm) {
    throw new Error("Conversation LLM is not configured. Set chat model in Settings → Models.");
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