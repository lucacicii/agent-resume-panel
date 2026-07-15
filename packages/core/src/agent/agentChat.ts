import { chatCompletionStream } from "../llm/chat";
import { ChatMessage } from "../llm/types";
import { chatLlmConfigFromSettings } from "../llm/fromSettings";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { recordLlmUsage } from "../usage/store";
import {
  buildMetaAgentSystemPrompt,
  buildMetaAgentSystemPromptWithTools,
  buildMetaAgentUserPrompt,
  formatNoteSourceBlock,
  formatSourceBlock
} from "./prompts";
import { appendAgentTurn, listAgentMessagesForHistory } from "./agentStore";
import { retrieveAgentContext } from "./retrieve";
import { runToolLoop } from "./toolLoop";
import type { TouchedNote } from "./toolLoop";
import { NoteMcpClient } from "../mcp/client";
import { createNoteMcpServer } from "../mcp/server";
import { NotesStore } from "../notes/store";
import type { AgentCitation, AgentChatOptions, AgentChatResult } from "./types";

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export async function runAgentChat(options: AgentChatOptions): Promise<AgentChatResult> {
  throwIfAborted(options.signal);
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
      : await listAgentMessagesForHistory(dbPath, 6, options.threadId);

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
  throwIfAborted(options.signal);

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
        matchType: note.matchType,
        projectPath: note.projectPath
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

  if (options.enableTools ?? true) {
    return runAskWithTools(options, llm, language, dbPath, panelHome, {
      query,
      sourcesBlock,
      notesBlock,
      notesSummary,
      historyBlock,
      dbPath,
      retrieved
    });
  }

  return runAskWithoutTools(options, llm, language, {
    query,
    sourcesBlock,
    notesBlock,
    notesSummary,
    historyBlock,
    dbPath,
    retrieved
  });
}

interface AskContext {
  query: string;
  sourcesBlock: string;
  notesBlock: string;
  notesSummary?: string;
  historyBlock?: string;
  dbPath: string;
  retrieved: Awaited<ReturnType<typeof retrieveAgentContext>>;
}

async function runAskWithoutTools(
  options: AgentChatOptions,
  llm: NonNullable<ReturnType<typeof chatLlmConfigFromSettings>>,
  language: string,
  ctx: AskContext
): Promise<AgentChatResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildMetaAgentSystemPrompt(language) },
    {
      role: "user",
      content: buildMetaAgentUserPrompt({
        query: ctx.query,
        sourcesBlock: ctx.sourcesBlock,
        notesBlock: ctx.notesBlock,
        notesSummary: ctx.notesSummary,
        historyBlock: ctx.historyBlock
      })
    }
  ];

  options.onStream?.({ phase: "generating" });

  const result = await chatCompletionStream(
    llm,
    messages,
    2000,
    {
      onChunk: async (delta) => {
        options.onStream?.({ phase: "chunk", delta });
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    },
    options.signal
  );
  try {
    await recordLlmUsage(ctx.dbPath, {
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

  return buildAskResult(options, ctx.dbPath, ctx.retrieved, result.content, ctx.retrieved.citations);
}

async function runAskWithTools(
  options: AgentChatOptions,
  llm: NonNullable<ReturnType<typeof chatLlmConfigFromSettings>>,
  language: string,
  dbPath: string,
  panelHome: string,
  ctx: AskContext
): Promise<AgentChatResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildMetaAgentSystemPromptWithTools(language) },
    {
      role: "user",
      content: buildMetaAgentUserPrompt({
        query: ctx.query,
        sourcesBlock: ctx.sourcesBlock,
        notesBlock: ctx.notesBlock,
        notesSummary: ctx.notesSummary,
        historyBlock: ctx.historyBlock
      })
    }
  ];

  const mcpClient = new NoteMcpClient();
  let answer: string;
  let toolCallsExecuted = 0;
  let touchedNotes: TouchedNote[] = [];

  try {
    const notesStore = new NotesStore(dbPath, panelHome);
    const server = createNoteMcpServer({ notesStore, dbPath, panelHome });
    await mcpClient.connectInMemory(server);

    options.onStream?.({ phase: "generating" });

    const toolResult = await runToolLoop({
      llm,
      messages,
      mcpClient,
      maxTokens: 2000,
      signal: options.signal,
      onProgress: (message) => {
        options.onStream?.({ phase: "generating", message });
      },
      onToolCall: (toolName) => {
        options.onStream?.({ phase: "tool_calling", toolName });
      },
      onToolResult: (toolName) => {
        options.onStream?.({ phase: "tool_executing", toolName });
      }
    });

    answer = toolResult.content;
    toolCallsExecuted = toolResult.toolCallsExecuted;
    touchedNotes = toolResult.touchedNotes;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ask:tools] tool loop failed:", msg);
    throw error;
 } finally {
   await mcpClient.stop().catch(() => {});
 }

  const baseCitations = ctx.retrieved.citations;
  const toolCitations = touchedNotesToCitations(touchedNotes, baseCitations.length);
  const allCitations = [...baseCitations, ...toolCitations];

  return buildAskResult(options, ctx.dbPath, ctx.retrieved, answer, allCitations, toolCallsExecuted);
}

function touchedNotesToCitations(
  touched: TouchedNote[],
  startIndex: number
): AgentCitation[] {
  return touched.map((note, i) => ({
    source: "note" as const,
    index: startIndex + i + 1,
    noteId: note.noteId,
    title: note.title || note.noteId,
    scope: note.scope,
    relMdPath: note.relMdPath,
    projectPath: note.projectPath,
    level: "note",
    contentPreview: note.contentPreview,
    operation: note.operation
  }));
}

async function buildAskResult(
  options: AgentChatOptions,
  dbPath: string,
  retrieved: Awaited<ReturnType<typeof retrieveAgentContext>>,
  answerContent: string,
  citations: AgentCitation[],
  toolCallsExecuted?: number
): Promise<AgentChatResult> {
  const answer: AgentChatResult = {
    answer: answerContent,
    citations,
    fallback: retrieved.fallback,
    digests: retrieved.digests.map((d) => d.entry),
    toolCallsExecuted
  };

  try {
    await appendAgentTurn(dbPath, {
      userContent: options.query,
      assistantContent: answerContent,
      citations,
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
