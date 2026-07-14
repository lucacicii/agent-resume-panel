import { chatCompletionStream } from "../llm/chat";
import { ChatMessage } from "../llm/types";
import { chatLlmConfigFromSettings } from "../llm/fromSettings";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { recordLlmUsage } from "../usage/store";
import {
  buildMetaAgentSystemPrompt,
  buildMetaAgentUserPrompt,
  formatNoteSourceBlock,
  formatSourceBlock
} from "./prompts";
import { appendAskTurn, listAskMessagesForHistory } from "./askStore";
import { retrieveAgentContext } from "./retrieve";
import type { AskMetaAgentOptions, AskMetaAgentResult } from "./types";

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

  const history =
    options.history && options.history.length > 0
      ? options.history.slice(-6)
      : await listAskMessagesForHistory(dbPath, 6, options.threadId);

  options.onStream?.({ phase: "retrieving" });

  const retrieved = await retrieveAgentContext({
    query,
    panelHome: options.panelHome || panelHome,
    limit: options.limit,
    onNoteIndexProgress: (progress) =>
      options.onStream?.({
        phase: "indexing_notes",
        message: progress.message,
        current: progress.current,
        total: progress.total,
        noteTitle: progress.noteTitle,
        chunkCurrent: progress.chunkCurrent,
        chunkTotal: progress.chunkTotal
      })
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

  const notesBlock = retrieved.notes
    .map((note, i) =>
      formatNoteSourceBlock({
        index: i + 1,
        title: note.title || note.relMdPath,
        relMdPath: note.relMdPath,
        scope: note.scope,
        heading: note.heading,
        content: note.content,
        score: note.score,
        matchType: note.matchType
      })
    )
    .join("\n\n");
  const notesSummary = retrieved.noteMatchTotal != null
    ? `Exact note search matched ${retrieved.noteMatchTotal} notes; ${retrieved.notes.length} note sources are included in this prompt. Do not claim the included list is complete when these numbers differ.`
    : undefined;

  const historyBlock = history.length
    ? history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")
    : undefined;

  const language = llm.outputLanguage || "zh-CN";
  const messages: ChatMessage[] = [
    { role: "system", content: buildMetaAgentSystemPrompt(language) },
    {
      role: "user",
      content: buildMetaAgentUserPrompt({
        query,
        sourcesBlock,
        notesBlock,
        notesSummary,
        historyBlock
      })
    }
  ];

  options.onStream?.({ phase: "generating" });

  const result = await chatCompletionStream(llm, messages, 2000, {
    onChunk: async (delta) => {
      options.onStream?.({ phase: "chunk", delta });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  });
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

  const answer: AskMetaAgentResult = {
    answer: result.content,
    citations: retrieved.citations,
    fallback: retrieved.fallback,
    digests: retrieved.digests.map((d) => d.entry)
  };

  try {
    await appendAskTurn(dbPath, {
      userContent: query,
      assistantContent: result.content,
      citations: retrieved.citations,
      fallback: retrieved.fallback,
      threadId: options.threadId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    answer.persistWarning = `对话保存失败：${message}`;
  }

  options.onStream?.({ phase: "done" });
  return answer;
}
