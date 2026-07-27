import { z } from "zod";
import {
  clampSessionListLimit,
  clampSessionSearchLimit,
  mergeSessionSearchHits,
  searchCatalogSessions,
  type SessionSearchFilters,
  type SessionSearchHit
} from "../catalog/search";
import { getSessionById } from "../catalog/query";
import type { AgentProvider } from "../catalog/types";
import { GTD_ACTIVE_STATUSES, GTD_STATUSES } from "../gtd/types";
import { embeddingConfigFromSettings } from "../llm/fromSettings";
import { loadSettings } from "../settings/store";
import { resolvePreviewHomes } from "../transcript/homes";
import { loadSessionSnippet } from "../transcript/load";
import { searchSessionsByEmbedding } from "../session/searchByEmbedding";
import { searchSessionsByTranscriptEmbedding } from "../session/transcriptIndex";
import {
  getSessionGtdStatus as getGtd,
  setSessionGtdStatus,
  setSessionGtdStatusWithAudit
} from "../gtd/store";
import { isActiveGtdStatus, type GtdStatus } from "../gtd/types";
import { buildResumeCommand } from "../terminal/commands";
import { randomUUID } from "node:crypto";

export interface SessionToolContext {
  catalogDb: string;
  desktopDb: string;
  panelHome: string;
  /**
   * Desktop injects this so session_resume opens the real Workbench/Sessions resume path.
   * When omitted, the tool still returns the resume command for the model to surface.
   */
  resumeSession?: (args: {
    provider: AgentProvider;
    sessionId: string;
  }) => Promise<{
    ok: boolean;
    command?: string;
    cwd?: string;
    mode?: string;
    external?: boolean;
    error?: string;
  }>;
}

export const SESSION_SEARCH_DEFAULT_LIMIT = 20;
export const SESSION_READ_DEFAULT_MAX_SUMMARY = 8000;
export const SESSION_READ_MAX_SUMMARY = 16_000;
export const SESSION_TRANSCRIPT_DEFAULT_MAX = 2500;
export const SESSION_TRANSCRIPT_MAX = 8000;

const providerEnum = z.enum(["codex", "claude", "agy", "grok", "opencode", "pi", "chat"]);

const filterFields = {
  provider: providerEnum.optional().describe("Filter by agent provider."),
  projectPath: z
    .string()
    .optional()
    .describe("Substring match on project working directory path."),
  gtdStatus: z
    .enum(GTD_STATUSES as unknown as [string, ...string[]])
    .optional()
    .describe("Filter by GTD status (inbox, next, waiting, someday, reference, done)."),
  fromMs: z
    .number()
    .optional()
    .describe("Include sessions with updatedAtMs >= this epoch millisecond."),
  toMs: z
    .number()
    .optional()
    .describe("Include sessions with updatedAtMs < this epoch millisecond."),
  limit: z.number().int().min(1).optional()
};

export const sessionSearchSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Search query. Matches titles, project paths, and session summaries (keyword). When embeddings are configured, also runs semantic search over session summaries and transcript chunks."
    ),
  ...filterFields,
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`Maximum results. Defaults to ${SESSION_SEARCH_DEFAULT_LIMIT}, capped at 50.`)
};

export const sessionSetGtdSchema = {
  provider: providerEnum.describe("Agent provider of the session."),
  sessionId: z.string().min(1).describe("Native agent session id."),
  status: z
    .enum(GTD_ACTIVE_STATUSES as unknown as [string, ...string[]])
    .describe("GTD status: inbox, next, waiting, someday, or reference. Done is set manually from a session menu."),
  reason: z
    .string()
    .optional()
    .describe("Short reason for the status change (stored in AI audit).")
};

export const sessionResumeSchema = {
  provider: providerEnum.describe("Agent provider of the session."),
  sessionId: z.string().min(1).describe("Native agent session id to resume.")
};

export const sessionListSchema = {
  ...filterFields,
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Maximum sessions to list. Defaults to 30, capped at 100.")
};

export const sessionReadSchema = {
  provider: providerEnum.describe("Agent provider of the session."),
  sessionId: z.string().min(1).describe("Native agent session id (catalog agent_session_id)."),
  maxSummaryLength: z
    .number()
    .int()
    .min(100)
    .max(SESSION_READ_MAX_SUMMARY)
    .optional()
    .describe(`Max characters of session_summary. Defaults to ${SESSION_READ_DEFAULT_MAX_SUMMARY}.`)
};

export const sessionReadTranscriptSchema = {
  provider: providerEnum.describe("Agent provider of the session."),
  sessionId: z.string().min(1).describe("Native agent session id."),
  maxChars: z
    .number()
    .int()
    .min(200)
    .max(SESSION_TRANSCRIPT_MAX)
    .optional()
    .describe(
      `Max characters of recent transcript to return (sent to the chat model). Defaults to ${SESSION_TRANSCRIPT_DEFAULT_MAX}, capped at ${SESSION_TRANSCRIPT_MAX}. Prefer session_read first.`
    )
};

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

function clampSummaryLength(max?: number): number {
  const raw = Number(max);
  if (!Number.isFinite(raw) || raw < 100) {
    return SESSION_READ_DEFAULT_MAX_SUMMARY;
  }
  return Math.min(Math.floor(raw), SESSION_READ_MAX_SUMMARY);
}

function clampTranscriptChars(max?: number): number {
  const raw = Number(max);
  if (!Number.isFinite(raw) || raw < 200) {
    return SESSION_TRANSCRIPT_DEFAULT_MAX;
  }
  return Math.min(Math.floor(raw), SESSION_TRANSCRIPT_MAX);
}

function filtersFromArgs(args: {
  provider?: string;
  projectPath?: string;
  gtdStatus?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  query?: string;
}): SessionSearchFilters {
  return {
    query: args.query,
    provider: args.provider,
    projectPath: args.projectPath,
    gtdStatus: args.gtdStatus,
    fromMs: args.fromMs,
    toMs: args.toMs,
    limit: args.limit
  };
}

function hitToJson(hit: SessionSearchHit): Record<string, unknown> {
  const out: Record<string, unknown> = {
    provider: hit.provider,
    sessionId: hit.sessionId,
    title: hit.title,
    projectPath: hit.projectPath,
    updatedAtMs: hit.updatedAtMs
  };
  if (hit.messageCount != null) {
    out.messageCount = hit.messageCount;
  }
  if (hit.model) {
    out.model = hit.model;
  }
  if (hit.branch) {
    out.branch = hit.branch;
  }
  if (hit.gtdStatus) {
    out.gtdStatus = hit.gtdStatus;
  }
  if (hit.summaryPreview) {
    out.summaryPreview = hit.summaryPreview;
  }
  if (hit.score != null) {
    out.score = hit.score;
  }
  if (hit.match) {
    out.match = hit.match;
  }
  return out;
}

export async function handleSessionSearch(
  args: {
    query: string;
    provider?: string;
    projectPath?: string;
    gtdStatus?: string;
    fromMs?: number;
    toMs?: number;
    limit?: number;
  },
  ctx: SessionToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const query = args.query?.trim();
  if (!query) {
    throw new Error("query is required.");
  }

  const limit = clampSessionSearchLimit(args.limit);
  const filters = filtersFromArgs({ ...args, query, limit: limit * 2 });

  const keywordHits = await searchCatalogSessions(ctx.catalogDb, filters);

  let summaryHits: SessionSearchHit[] = [];
  let transcriptHits: SessionSearchHit[] = [];
  try {
    const settings = await loadSettings(ctx.panelHome);
    if (embeddingConfigFromSettings(settings)) {
      try {
        summaryHits = await searchSessionsByEmbedding({
          catalogDb: ctx.catalogDb,
          desktopDb: ctx.desktopDb,
          settings,
          query,
          filters: { ...filters, limit: limit * 2 },
          limit: limit * 2
        });
      } catch {
        summaryHits = [];
      }
      try {
        transcriptHits = await searchSessionsByTranscriptEmbedding({
          catalogDb: ctx.catalogDb,
          desktopDb: ctx.desktopDb,
          settings,
          query,
          filters: { ...filters, limit: limit * 2 },
          limit: limit * 2
        });
      } catch {
        transcriptHits = [];
      }
    }
  } catch {
    summaryHits = [];
    transcriptHits = [];
  }

  const semanticHits = mergeSessionSearchHits(summaryHits, transcriptHits, limit * 2);
  const merged = mergeSessionSearchHits(keywordHits, semanticHits, limit);
  if (!merged.length) {
    return {
      content: [{ type: "text", text: `No sessions found matching "${query}".` }]
    };
  }

  const payload = merged.map(hitToJson);
  return {
    content: [
      {
        type: "text",
        text: `Found ${payload.length} session(s) matching "${query}":\n${JSON.stringify(payload, null, 2)}`
      }
    ]
  };
}

export async function handleSessionList(
  args: {
    provider?: string;
    projectPath?: string;
    gtdStatus?: string;
    fromMs?: number;
    toMs?: number;
    limit?: number;
  },
  ctx: SessionToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const limit = clampSessionListLimit(args.limit);
  const filters = filtersFromArgs({ ...args, limit });
  delete (filters as { query?: string }).query;

  const hits = await searchCatalogSessions(ctx.catalogDb, { ...filters, limit });
  if (!hits.length) {
    return {
      content: [{ type: "text", text: "No sessions found for the given filters." }]
    };
  }
  const payload = hits.map(hitToJson);
  return {
    content: [
      {
        type: "text",
        text: `Listed ${payload.length} session(s):\n${JSON.stringify(payload, null, 2)}`
      }
    ]
  };
}

export async function handleSessionRead(
  args: { provider: string; sessionId: string; maxSummaryLength?: number },
  ctx: SessionToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const provider = args.provider?.trim() as AgentProvider;
  const sessionId = args.sessionId?.trim();
  if (!provider || !sessionId) {
    throw new Error("provider and sessionId are required.");
  }

  const session = await getSessionById(ctx.catalogDb, provider, sessionId);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `No visible session found for ${provider}:${sessionId}.`
        }
      ]
    };
  }

  const gtdStatus = await getGtd(ctx.catalogDb, provider, sessionId);
  const maxSummary = clampSummaryLength(args.maxSummaryLength);
  const payload: Record<string, unknown> = {
    provider: session.provider,
    sessionId: session.id,
    title: session.title,
    projectPath: session.projectPath,
    updatedAtMs: session.updatedAt
  };
  if (session.messageCount != null) {
    payload.messageCount = session.messageCount;
  }
  if (session.model) {
    payload.model = session.model;
  }
  if (session.branch) {
    payload.branch = session.branch;
  }
  if (session.projectId) {
    payload.projectId = session.projectId;
  }
  if (gtdStatus) {
    payload.gtdStatus = gtdStatus;
  }
  if (session.sessionSummary?.trim()) {
    payload.sessionSummary = truncate(session.sessionSummary.trim(), maxSummary);
  } else {
    payload.sessionSummary = null;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
  };
}

export async function handleSessionReadTranscript(
  args: { provider: string; sessionId: string; maxChars?: number },
  ctx: SessionToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const provider = args.provider?.trim() as AgentProvider;
  const sessionId = args.sessionId?.trim();
  if (!provider || !sessionId) {
    throw new Error("provider and sessionId are required.");
  }

  const session = await getSessionById(ctx.catalogDb, provider, sessionId);
  if (!session) {
    return {
      content: [
        {
          type: "text",
          text: `No visible session found for ${provider}:${sessionId}.`
        }
      ]
    };
  }

  const maxChars = clampTranscriptChars(args.maxChars);
  try {
    const settings = await loadSettings(ctx.panelHome);
    const homes = resolvePreviewHomes(settings, ctx.panelHome);
    const snippet = await loadSessionSnippet(session, homes, maxChars);
    if (!snippet?.trim()) {
      return {
        content: [
          {
            type: "text",
            text: `Transcript unavailable or empty for ${provider}:${sessionId}.`
          }
        ]
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Transcript excerpt for ${provider}:${sessionId} (max ${maxChars} chars):\n\n${snippet}`
        }
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Failed to load transcript for ${provider}:${sessionId}: ${message}`
        }
      ]
    };
  }
}

export async function handleSessionSetGtd(
  args: { provider: string; sessionId: string; status: string; reason?: string },
  ctx: SessionToolContext
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const provider = args.provider?.trim() as AgentProvider;
  const sessionId = args.sessionId?.trim();
  const statusRaw = args.status?.trim();
  if (!provider || !sessionId || !statusRaw) {
    throw new Error("provider, sessionId, and status are required.");
  }
  if (!isActiveGtdStatus(statusRaw)) {
    throw new Error(
      `Invalid automated GTD status "${statusRaw}". Use one of: ${GTD_ACTIVE_STATUSES.join(", ")}.`
    );
  }
  const status = statusRaw as GtdStatus;

  const session = await getSessionById(ctx.catalogDb, provider, sessionId);
  if (!session) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `No visible session found for ${provider}:${sessionId}. GTD was not changed.`
        }
      ]
    };
  }

  const previousStatus = (await getGtd(ctx.catalogDb, provider, sessionId)) ?? null;
  const reason = args.reason?.trim() || "Set via Agent session_set_gtd tool";
  const auditId = randomUUID();

  try {
    await setSessionGtdStatusWithAudit(ctx.catalogDb, ctx.desktopDb, {
      provider,
      sessionId,
      status,
      previousStatus,
      reason,
      sourceReportIds: [],
      auditId
    });
  } catch {
    // Audit table may be missing in some contexts; still persist GTD.
    await setSessionGtdStatus(ctx.catalogDb, provider, sessionId, status);
  }

  const payload = {
    ok: true,
    provider,
    sessionId,
    title: session.title,
    previousStatus,
    status,
    reason,
    auditId
  };
  return {
    content: [
      {
        type: "text",
        text: `GTD updated for ${provider}:${sessionId}:\n${JSON.stringify(payload, null, 2)}`
      }
    ]
  };
}

export async function handleSessionResume(
  args: { provider: string; sessionId: string },
  ctx: SessionToolContext
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const provider = args.provider?.trim() as AgentProvider;
  const sessionId = args.sessionId?.trim();
  if (!provider || !sessionId) {
    throw new Error("provider and sessionId are required.");
  }

  const session = await getSessionById(ctx.catalogDb, provider, sessionId);
  if (!session) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `No visible session found for ${provider}:${sessionId}. Resume was not started.`
        }
      ]
    };
  }

  const command = buildResumeCommand(session);

  if (ctx.resumeSession) {
    try {
      const result = await ctx.resumeSession({ provider, sessionId });
      if (!result.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Resume failed for ${provider}:${sessionId}: ${result.error || "unknown error"}\nCommand: ${command}`
            }
          ]
        };
      }
      const payload = {
        ok: true,
        provider,
        sessionId,
        title: session.title,
        command: result.command || command,
        cwd: result.cwd || session.projectPath,
        mode: result.mode,
        external: result.external === true
      };
      return {
        content: [
          {
            type: "text",
            text: `Resume launched for ${provider}:${sessionId}:\n${JSON.stringify(payload, null, 2)}`
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Resume failed for ${provider}:${sessionId}: ${message}\nCommand: ${command}`
          }
        ]
      };
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `Resume command for ${provider}:${sessionId} (launcher not injected; run in terminal):\n${JSON.stringify(
          {
            ok: true,
            provider,
            sessionId,
            title: session.title,
            command,
            projectPath: session.projectPath,
            launched: false
          },
          null,
          2
        )}`
      }
    ]
  };
}
