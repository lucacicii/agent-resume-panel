import { z } from "zod";
import { localDayRange, localMonthRange, localWeekRange } from "../report/period";
import { searchReportsByEmbedding } from "../report/search";
import type { ReportLevel } from "../report/schema";
import {
  getReportEntryById,
  listReportEntries,
  listReportEntriesInRange,
  listReportLinks
} from "../report/store";

export interface ReportToolContext {
  dbPath: string;
  panelHome: string;
}

export const REPORT_SEARCH_DEFAULT_LIMIT = 8;
export const REPORT_SEARCH_MAX_LIMIT = 20;
export const REPORT_LIST_DEFAULT_LIMIT = 20;
export const REPORT_LIST_MAX_LIMIT = 50;
export const REPORT_READ_DEFAULT_MAX_LENGTH = 12_000;
export const REPORT_READ_MAX_LENGTH = 20_000;

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n[...truncated...]`;
}

function clampReportSearchLimit(limit?: number): number {
  const raw = Number(limit);
  if (!Number.isFinite(raw) || raw < 1) {
    return REPORT_SEARCH_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(raw), REPORT_SEARCH_MAX_LIMIT);
}

function clampReportListLimit(limit?: number): number {
  const raw = Number(limit);
  if (!Number.isFinite(raw) || raw < 1) {
    return REPORT_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(raw), REPORT_LIST_MAX_LIMIT);
}

function clampReportReadMaxLength(maxLength?: number): number {
  const raw = Number(maxLength);
  if (!Number.isFinite(raw) || raw < 100) {
    return REPORT_READ_DEFAULT_MAX_LENGTH;
  }
  return Math.min(Math.floor(raw), REPORT_READ_MAX_LENGTH);
}

function resolvePeriodRange(level: ReportLevel | string, label: string) {
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

function summarizeReportListEntry(entry: {
  id: string;
  level: string;
  title: string | null;
  periodStartMs: number;
  content: string;
}) {
  return {
    reportId: entry.id,
    level: entry.level,
    title: entry.title || entry.id,
    periodStartMs: entry.periodStartMs,
    contentPreview: truncate(entry.content, 200)
  };
}

export const reportSearchSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Semantic search query for memory digests (daily/weekly/monthly reports). Prefer report_read when Report Sources already cite a reportId."
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
      `Maximum results to return. Defaults to ${REPORT_SEARCH_DEFAULT_LIMIT}, capped at ${REPORT_SEARCH_MAX_LIMIT}.`
    )
};

export const reportReadSchema = {
  reportId: z
    .string()
    .min(1)
    .describe("Memory entry id, e.g. daily:2026-07-15, weekly:2026-W28, monthly:2026-07."),
  maxLength: z
    .number()
    .int()
    .min(100)
    .max(REPORT_READ_MAX_LENGTH)
    .optional()
    .describe(
      `Maximum characters of digest content to return. Defaults to ${REPORT_READ_DEFAULT_MAX_LENGTH}.`
    )
};

export const reportListSchema = {
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
      `Maximum entries when from/to are omitted, or cap for range queries. Defaults to ${REPORT_LIST_DEFAULT_LIMIT}, capped at ${REPORT_LIST_MAX_LIMIT}.`
    )
};

export async function handleReportSearch(
  args: { query: string; level?: ReportLevel; limit?: number },
  ctx: ReportToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const query = args.query?.trim();
  if (!query) {
    throw new Error("query is required.");
  }
  const limit = clampReportSearchLimit(args.limit);
  const hits = await searchReportsByEmbedding({
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
    reportId: hit.entry.id,
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

export async function handleReportRead(
  args: { reportId: string; maxLength?: number },
  ctx: ReportToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const reportId = args.reportId?.trim();
  if (!reportId) {
    throw new Error("reportId is required.");
  }
  const maxLength = clampReportReadMaxLength(args.maxLength);
  const entry = await getReportEntryById(ctx.dbPath, reportId);
  if (!entry) {
    return {
      content: [{ type: "text", text: `No memory entry found for reportId "${reportId}".` }]
    };
  }
  const links = await listReportLinks(ctx.dbPath, reportId);
  const payload = {
    reportId: entry.id,
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

export async function handleReportList(
  args: { level: ReportLevel; from?: string; to?: string; limit?: number },
  ctx: ReportToolContext
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const level = args.level;
  if (!level) {
    throw new Error("level is required.");
  }
  const limit = clampReportListLimit(args.limit);
  const from = args.from?.trim();
  const to = args.to?.trim();

  let entries;
  if (from || to) {
    const startMs = from ? resolvePeriodRange(level, from).startMs : 0;
    const endMs = to ? resolvePeriodRange(level, to).endMs : Number.MAX_SAFE_INTEGER;
    if (startMs >= endMs) {
      throw new Error("Invalid range: from must be before to.");
    }
    entries = await listReportEntriesInRange(ctx.dbPath, {
      level,
      startMs,
      endMs,
      limit
    });
  } else {
    entries = await listReportEntries(ctx.dbPath, { level, limit });
  }

  if (!entries.length) {
    const rangeHint = from || to ? ` in range ${from || "…"} – ${to || "…"}` : "";
    return {
      content: [{ type: "text", text: `No ${level} memory digests found${rangeHint}.` }]
    };
  }

  const summary = entries.map(summarizeReportListEntry);
  return {
    content: [
      {
        type: "text",
        text: `Listed ${summary.length} ${level} memory digest(s):\n${JSON.stringify(summary, null, 2)}`
      }
    ]
  };
}