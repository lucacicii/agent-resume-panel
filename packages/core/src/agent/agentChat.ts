import { chatCompletionStream } from "../llm/chat";
import { ChatMessage } from "../llm/types";
import { DEFAULT_CATALOG_OUTPUT_LANGUAGE } from "../i18n/outputLanguage";
import { createUiText } from "../i18n/uiText";
import { chatLlmConfigFromSettings } from "../llm/fromSettings";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { effectivePanelHome, loadSettings } from "../settings/store";
import { recordLlmUsage } from "../usage/store";
import {
  buildMetaAgentSystemPrompt,
  buildMetaAgentSystemPromptWithTools,
  buildMetaAgentUserPrompt,
  formatNoteSourceBlock,
  formatSessionSourceBlock,
  formatSourceBlock
} from "./prompts";
import { appendAgentTurn, listAgentMessagesForHistory } from "./agentStore";
import { retrieveAgentContext } from "./retrieve";
import { runToolLoop } from "./toolLoop";
import type { TouchedNote, TouchedSession } from "./toolLoop";
import { NoteMcpClient } from "../mcp/client";
import { createNoteMcpServer } from "../mcp/server";
import { NotesStore } from "../notes/store";
import type { AgentProvider } from "../catalog/types";
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
  const llm = chatLlmConfigFromSettings(settings, options.systemLocale);
  if (!llm) {
    throw new Error(
      "Conversation LLM is not configured. Set llm (or chatLlm) baseUrl, model, and apiKey in settings.json."
    );
  }

  const panelHome = effectivePanelHome(settings, options.panelHome);
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);
  const desktopDb = paths.desktopDb;

  const history =
    options.history && options.history.length > 0
      ? options.history.slice(-6)
      : await listAgentMessagesForHistory(desktopDb, 6, options.threadId);

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

  const sessionsBlock = retrieved.sessions
    .map((session, i) =>
      formatSessionSourceBlock({
        index: i + 1,
        title: session.title || session.sessionId,
        provider: session.provider,
        sessionId: session.sessionId,
        projectPath: session.projectPath,
        content: session.summaryPreview || session.title || session.sessionId,
        score: session.score,
        match: session.match
      })
    )
    .join("\n\n");

  const historyBlock = history.length
    ? history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")
    : undefined;

  const language = llm.outputLanguage || DEFAULT_CATALOG_OUTPUT_LANGUAGE;

  if (options.enableTools ?? true) {
    return runAskWithTools(options, llm, language, desktopDb, panelHome, {
      query,
      sourcesBlock,
      notesBlock,
      notesSummary,
      sessionsBlock,
      historyBlock,
      desktopDb,
      retrieved
    });
  }

  return runAskWithoutTools(options, llm, language, {
    query,
    sourcesBlock,
    notesBlock,
    notesSummary,
    sessionsBlock,
    historyBlock,
    desktopDb,
    retrieved
  });
}

interface AskContext {
  query: string;
  sourcesBlock: string;
  notesBlock: string;
  notesSummary?: string;
  sessionsBlock?: string;
  historyBlock?: string;
  desktopDb: string;
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
        sessionsBlock: ctx.sessionsBlock,
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
    await recordLlmUsage(ctx.desktopDb, {
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

  return buildAskResult(options, ctx.desktopDb, ctx.retrieved, result.content, ctx.retrieved.citations);
}

async function runAskWithTools(
  options: AgentChatOptions,
  llm: NonNullable<ReturnType<typeof chatLlmConfigFromSettings>>,
  language: string,
  desktopDb: string,
  panelHome: string,
  ctx: AskContext
): Promise<AgentChatResult> {
  const settings = await loadSettings(options.panelHome);
  const pt = createUiText(settings, options.systemLocale);
  const messages: ChatMessage[] = [
    { role: "system", content: buildMetaAgentSystemPromptWithTools(language) },
    {
      role: "user",
      content: buildMetaAgentUserPrompt({
        query: ctx.query,
        sourcesBlock: ctx.sourcesBlock,
        notesBlock: ctx.notesBlock,
        notesSummary: ctx.notesSummary,
        sessionsBlock: ctx.sessionsBlock,
        historyBlock: ctx.historyBlock
      })
    }
  ];

  const mcpClient = new NoteMcpClient();
  let answer: string;
  let toolCallsExecuted = 0;
  let touchedNotes: TouchedNote[] = [];
  let touchedSessions: TouchedSession[] = [];

  try {
    const notesStore = new NotesStore(ctx.retrieved.catalogDb, panelHome);
    const server = createNoteMcpServer({
      notesStore,
      dbPath: ctx.retrieved.desktopDb,
      panelHome,
      catalogDb: ctx.retrieved.catalogDb,
      resumeSession: options.onResumeSession
        ? async (args) => options.onResumeSession!(args)
        : undefined
    });
    await mcpClient.connectInMemory(server);

    options.onStream?.({ phase: "generating" });

    const toolResult = await runToolLoop({
      llm,
      messages,
      mcpClient,
      maxTokens: 2000,
      signal: options.signal,
      uiText: pt,
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
    touchedSessions = toolResult.touchedSessions;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ask:tools] tool loop failed:", msg);
    throw error;
  } finally {
    await mcpClient.stop().catch(() => {});
  }

  const baseCitations = ctx.retrieved.citations;
  const noteStartIndex = baseCitations.filter(
    (c) => c.source === "note" || c.level === "note"
  ).length;
  const noteCitations = touchedNotesToCitations(touchedNotes, noteStartIndex);
  const withNotes = [...baseCitations, ...noteCitations];
  const allCitations = mergeTouchedSessionCitations(withNotes, touchedSessions);

  return buildAskResult(options, ctx.desktopDb, ctx.retrieved, answer, allCitations, toolCallsExecuted);
}

function isSessionCitation(citation: AgentCitation): boolean {
  return citation.source === "session" || citation.level === "session";
}

function sessionCitationKey(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`;
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
    level: "note",
    contentPreview: note.contentPreview,
    operation: note.operation
  }));
}

/**
 * Merge tool-touched sessions into citations: upgrade existing retrieved sessions,
 * append new ones with S* indices continuing after retrieved session count.
 */
function mergeTouchedSessionCitations(
  baseCitations: AgentCitation[],
  touched: TouchedSession[]
): AgentCitation[] {
  if (!touched.length) {
    return baseCitations;
  }

  const result = baseCitations.map((c) => ({ ...c }));
  const indexByKey = new Map<string, number>();
  let maxSessionIndex = 0;

  for (let i = 0; i < result.length; i++) {
    const citation = result[i];
    if (!isSessionCitation(citation) || !citation.session) {
      continue;
    }
    indexByKey.set(
      sessionCitationKey(citation.session.provider, citation.session.id),
      i
    );
    maxSessionIndex = Math.max(maxSessionIndex, citation.index);
  }

  for (const session of touched) {
    const key = sessionCitationKey(session.provider, session.sessionId);
    const operation =
      session.operation === "list" ? ("search" as const) : session.operation;
    const existingIdx = indexByKey.get(key);

    if (existingIdx != null) {
      const existing = result[existingIdx];
      result[existingIdx] = {
        ...existing,
        title: session.title || existing.title,
        contentPreview: session.contentPreview || existing.contentPreview,
        score: session.score ?? existing.score,
        operation: operation || existing.operation,
        session: {
          provider: session.provider as AgentProvider,
          id: session.sessionId,
          projectPath: session.projectPath || existing.session?.projectPath || ""
        }
      };
      continue;
    }

    maxSessionIndex += 1;
    indexByKey.set(key, result.length);
    result.push({
      source: "session",
      index: maxSessionIndex,
      title: session.title || session.sessionId,
      level: "session",
      contentPreview: session.contentPreview,
      score: session.score,
      operation,
      session: {
        provider: session.provider as AgentProvider,
        id: session.sessionId,
        projectPath: session.projectPath || ""
      }
    });
  }

  return result;
}

async function buildAskResult(
  options: AgentChatOptions,
  desktopDb: string,
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
    await appendAgentTurn(desktopDb, {
      userContent: options.query,
      assistantContent: answerContent,
      citations,
      fallback: retrieved.fallback,
      threadId: options.threadId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const settings = await loadSettings(options.panelHome);
    const pt = createUiText(settings, options.systemLocale);
    answer.persistWarning = pt("desktop.agent.persistFailed", message);
  }

  options.onStream?.({ phase: "done" });
  return answer;
}
