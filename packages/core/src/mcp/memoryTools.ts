import { z } from "zod";
import { localDayRange, localMonthRange, localWeekRange } from "../memory/period";
import { searchMemoryByEmbedding } from "../memory/search";
import type { MemoryLevel } from "../memory/schema";
import {
  getMemoryEntryById,
  listMemoryEntries,
  listMemoryEntriesInRange,
  listMemoryLinks
} from "../memory/store";

export interface MemoryToolContext {
  dbPath: string;
  panelHome: string;
}

export const MEMORY_SEARCH_DEFAULT_LIMIT = 8;
export const MEMORY_SEARCH_MAX_LIMIT = 20;
export const MEMORY_LIST_DEFAULT_LIMIT = 20;
export const MEMORY_LIST_MAX_LIMIT = 50;
export const MEMORY_READ_DEFAULT_MAX_LENGTH = 12_000;
export const MEMORY_READ_MAX_LENGTH = 20_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

function clampMemorySearchLimit(limit?: number): number {
  const raw = Number(limit);
  if (!Number.isFinite(raw) || raw < 1) {
    return MEMORY_SEARCH_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(raw), MEMORY_SEARCH_MAX_LIMIT);
}

function clampMemoryListLimit(limit?: number): number {
  const raw = Number(limit);
  if (!Number.isFinite(raw) || raw < 1) {
    return MEMORY_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(raw), MEMORY_LIST_MAX_LIMIT);
}

function clampMemoryReadMaxLength(maxLength?: number): number {
  const raw = Number(maxLength);
  if (!Number.isFinite(raw) || raw < 100) {
    return MEMORY_READ_DEFAULT_MAX_LENGTH;
  }
  return Math.min(Math.floor(raw), MEMORY_READ_MAX_LENGTH);
}

function resolvePeriodRange(level: MemoryLevel | string, label: string) {
  if (level === "daily") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) {
      throw new Error(`Invalid daily period label "${label}". Use YYYY-MM-DD.`);
    }
    return localDayRange(label);
  }
  if (level === "weekly") {
    if (!/^\d{4}-W\d{2}$/i.test(label)) {
      throw new Error(`Invalid weekly period label "${label}". Use YYYY-Www.`);
    }
    return localWeekRange(label);
  }
  if (level === "monthly") {
    if (!/^\d{4}-\d{2}$/.test(label)) {
      throw new Error(`Invalid monthly period label "${label}". Use YYYY-MM.`);
    }
    return localMonthRange(label);
  }
  throw new Error(`Unsupported memory level "${level}" for period range.`);
}

function summarizeMemoryListEntry(entry: {
  id: string;
  level: string;
  title: string | null;
  periodStartMs: number;
  content: string;
}) {
  return {
    memoryId: entry.id,
    level: entry.level,
    title: entry.title || entry.id,
    periodStartMs: entry.periodStartMs,
    contentPreview: truncate(entry.content, 200)
  };
}

export const memorySearchSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Semantic search query for memory digests (daily/weekly/monthly reports). Prefer memory_read when Memory Sources already cite a memoryId."
    ),
  level: z
    .enum(["daily", "weekly", "monthly"])
    .optional()
    .describe("Optional filter by digest level."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      `Maximum results to return. Defaults to ${MEMORY_SEARCH_DEFAULT_LIMIT}, capped at ${MEMORY_SEARCH_MAX_LIMIT}.`
    )
};

export const memoryReadSchema = {
  memoryId: z
    .string()
    .min(1)
    .describe("Memory entry id, e.g. daily:2026-07-15, weekly:2026-W28, monthly:2026-07."),
  maxLength: z
    .number()
    .int()
    .min(100)
    .max(MEMORY_READ_MAX_LENGTH)
    .optional()
    .describe(
      `Maximum characters of digest content to return. Defaults to ${MEMORY_READ_DEFAULT_MAX_LENGTH}.`
    )
};

export const memoryListSchema = {
  level: z.enum(["daily", "weekly", "monthly"]).describe("Digest level to list."),
  from: z
    .string()
    .optional()
    .describe("Start period label (daily: YYYY-MM-DD, weekly: YYYY-Www, monthly: YYYY-MM)."),
  to: z.string().optional().describe("End period label (inclusive), same format as from."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      `Maximum entries when from/to are omitted, or cap for range queries. Defaults to ${MEMORY_LIST_DEFAULT_LIMIT}, capped at ${MEMORY_LIST_MAX_LIMIT}.`
    )
};

export async function handleMemorySearch(
  args: { query: string; level?: MemoryLevel; limit?: number },
  ctx: MemoryToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const query = args.query?.trim();
  if (!query) {
    throw new Error("query is required.");
  }
  const limit = clampMemorySearchLimit(args.limit);
  const hits = await searchMemoryByEmbedding({
    panelHome: ctx.panelHome,
    query,
    level: args.level,
    limit
  });
  if (!hits.length) {
    return {
      content: [{ type: "text", text: `No memory digests found matching "${query}".` }]
    };
  }
  const summary = hits.map((hit) => ({
    memoryId: hit.entry.id,
    level: hit.entry.level,
    title: hit.entry.title || hit.entry.id,
    score: hit.score,
    contentPreview: truncate(hit.entry.content, 600)
  }));
  return {
    content: [
      {
        type: "text",
        text: `Found ${summary.length} memory digest(s) matching "${query}":\n${JSON.stringify(summary, null, 2)}`
      }
    ]
  };
}

export async function handleMemoryRead(
  args: { memoryId: string; maxLength?: number },
  ctx: MemoryToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const memoryId = args.memoryId?.trim();
  if (!memoryId) {
    throw new Error("memoryId is required.");
  }
  const maxLength = clampMemoryReadMaxLength(args.maxLength);
  const entry = await getMemoryEntryById(ctx.dbPath, memoryId);
  if (!entry) {
    return {
      content: [{ type: "text", text: `No memory entry found for memoryId "${memoryId}".` }]
    };
  }
  const links = await listMemoryLinks(ctx.dbPath, memoryId);
  const payload = {
    memoryId: entry.id,
    level: entry.level,
    title: entry.title || entry.id,
    periodStartMs: entry.periodStartMs,
    periodEndMs: entry.periodEndMs,
    content: truncate(entry.content, maxLength),
    linkedSessions: links.map((link) => ({
      provider: link.provider,
      sessionId: link.agentSessionId,
      projectPath: link.projectPath
    }))
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
  };
}

export async function handleMemoryList(
  args: { level: MemoryLevel; from?: string; to?: string; limit?: number },
  ctx: MemoryToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const level = args.level;
  if (!level) {
    throw new Error("level is required.");
  }
  const limit = clampMemoryListLimit(args.limit);
  const from = args.from?.trim();
  const to = args.to?.trim();

  let entries;
  if (from || to) {
    const startMs = from ? resolvePeriodRange(level, from).startMs : 0;
    const endMs = to ? resolvePeriodRange(level, to).endMs : Number.MAX_SAFE_INTEGER;
    if (startMs >= endMs) {
      throw new Error("Invalid range: from must be before to.");
    }
    entries = await listMemoryEntriesInRange(ctx.dbPath, {
      level,
      startMs,
      endMs,
      limit
    });
  } else {
    entries = await listMemoryEntries(ctx.dbPath, { level, limit });
  }

  if (!entries.length) {
    const rangeHint = from || to ? ` in range ${from || "…"} – ${to || "…"}` : "";
    return {
      content: [{ type: "text", text: `No ${level} memory digests found${rangeHint}.` }]
    };
  }

  const summary = entries.map(summarizeMemoryListEntry);
  return {
    content: [
      {
        type: "text",
        text: `Listed ${summary.length} ${level} memory digest(s):\n${JSON.stringify(summary, null, 2)}`
      }
    ]
  };
}