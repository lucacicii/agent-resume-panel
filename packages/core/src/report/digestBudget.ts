import { listAllSessionsInRange } from "../catalog/query";
import type { AgentSession } from "../catalog/types";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { loadSettings } from "../settings/store";
import type { PanelSettings } from "../settings/types";
import { dayKeyFromMs, digestIndex } from "./calendar";
import { listDayLabelsInRange, localDayRange, localMonthRange, localWeekRange } from "./period";
import { listReportEntriesInRange } from "./store";

export type DigestRunLevel = "daily" | "weekly" | "monthly";
export type DigestRunTrigger = "manual" | "schedule" | "backfill" | "workflow";

export interface DigestGenerationEstimate {
  level: DigestRunLevel;
  periodKey: string;
  sessionCount: number;
  summaryCallCount: number;
  digestCallCount: number;
  estimatedLlmCalls: number;
  callBudget: number;
  overBudget: boolean;
}

export class DigestBudgetExceededError extends Error {
  readonly estimate: DigestGenerationEstimate;
  constructor(estimate: DigestGenerationEstimate) {
    super(`Digest generation requires about ${estimate.estimatedLlmCalls} LLM calls, exceeding the configured budget of ${estimate.callBudget}.`);
    this.name = "DigestBudgetExceededError";
    this.estimate = estimate;
  }
}

export function digestCallBudget(settings: PanelSettings): number {
  const value = Number(settings.report?.maxDigestLlmCalls ?? 100);
  return Math.max(10, Math.min(Number.isFinite(value) ? Math.floor(value) : 100, 1_000));
}

function sourceBudget(maxContextChars?: number): number {
  const limit = Number.isFinite(Number(maxContextChars)) && Number(maxContextChars) > 0
    ? Math.max(4_000, Math.floor(Number(maxContextChars)))
    : 120_000;
  return Math.max(2_000, Math.floor(limit * 0.55));
}

/** Conservative map/reduce/final call estimate matching hierarchical digest packing. */
export function estimateHierarchicalCallCount(
  itemLengths: number[],
  maxContextChars?: number
): number {
  const budget = sourceBudget(maxContextChars);
  const total = itemLengths.reduce((sum, length) => sum + Math.max(1, length) + 2, 0);
  if (total <= Math.floor((maxContextChars || 120_000) * 0.7)) return 1;
  let groups = Math.max(1, Math.ceil(total / budget));
  let calls = groups;
  // Intermediate summaries are bounded by the 1800-token response ceiling; use 4 chars/token.
  while (groups * 7_200 > budget) {
    groups = Math.max(1, Math.ceil((groups * 7_200) / budget));
    calls += groups;
  }
  return calls + 1;
}

function summaryNeedsRefresh(session: AgentSession): boolean {
  if (!session.sessionSummary?.trim()) return true;
  const summaryAt = session.sessionSummaryAtMs;
  return summaryAt == null || !Number.isFinite(summaryAt) || session.updatedAt > summaryAt;
}

function estimatedSessionSourceLength(session: AgentSession): number {
  const summaryLength = session.sessionSummary?.trim().length || 800;
  return 180 + Math.max(800, summaryLength);
}

export function estimateDailyForSessions(
  settings: PanelSettings,
  periodKey: string,
  sessions: AgentSession[]
): DigestGenerationEstimate {
  const summaryCallCount = sessions.filter(summaryNeedsRefresh).length;
  const digestCallCount = estimateHierarchicalCallCount(
    sessions.map(estimatedSessionSourceLength),
    settings.llmOptions?.tool?.maxContextChars
  );
  const estimatedLlmCalls = summaryCallCount + digestCallCount;
  const callBudget = digestCallBudget(settings);
  return {
    level: "daily",
    periodKey,
    sessionCount: sessions.length,
    summaryCallCount,
    digestCallCount,
    estimatedLlmCalls,
    callBudget,
    overBudget: estimatedLlmCalls > callBudget
  };
}

export function assertDigestCallBudget(
  estimate: DigestGenerationEstimate,
  allowOverBudget?: boolean
): void {
  if (estimate.overBudget && allowOverBudget !== true) {
    throw new DigestBudgetExceededError(estimate);
  }
}

export async function estimateDigestRun(options: {
  panelHome?: string;
  level: DigestRunLevel;
  periodKey?: string;
}): Promise<DigestGenerationEstimate> {
  const settings = await loadSettings(options.panelHome);
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);
  if (options.level === "daily") {
    const period = localDayRange(options.periodKey);
    const sessions = await listAllSessionsInRange(paths.catalogDb, period.startMs, period.endMs);
    return estimateDailyForSessions(settings, period.label, sessions);
  }

  const period = options.level === "weekly"
    ? localWeekRange(options.periodKey)
    : localMonthRange(options.periodKey);
  const allSessions = await listAllSessionsInRange(paths.catalogDb, period.startMs, period.endMs);
  const sessionsByDay = new Map<string, AgentSession[]>();
  for (const day of listDayLabelsInRange(period.startMs, period.endMs)) sessionsByDay.set(day, []);
  for (const session of allSessions) {
    const date = new Date(session.updatedAt);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    sessionsByDay.get(day)?.push(session);
  }

  const { evaluateDailyDigestRefresh } = await import("./daily.js");
  let summaryCallCount = 0;
  let digestCallCount = 0;
  const dailySourceLengths: number[] = [];
  const existingDailies = await listReportEntriesInRange(paths.desktopDb, {
    level: "daily",
    startMs: period.startMs,
    endMs: period.endMs,
    limit: 500
  });
  const dailyLength = new Map([...digestIndex(existingDailies).values()].map((entry) => [
    dayKeyFromMs(entry.periodStartMs),
    entry.content.length
  ]));

  for (const [day, sessions] of sessionsByDay) {
    if (!sessions.length) continue;
    const refresh = await evaluateDailyDigestRefresh({
      settings,
      catalogDb: paths.catalogDb,
      desktopDb: paths.desktopDb,
      date: day
    });
    if (refresh.needed) {
      const daily = estimateDailyForSessions(settings, day, sessions);
      summaryCallCount += daily.summaryCallCount;
      digestCallCount += daily.digestCallCount;
      dailySourceLengths.push(4_000);
    } else {
      dailySourceLengths.push(Math.max(500, dailyLength.get(day) || 4_000));
    }
  }
  digestCallCount += estimateHierarchicalCallCount(dailySourceLengths, settings.llmOptions?.tool?.maxContextChars);
  const estimatedLlmCalls = summaryCallCount + digestCallCount;
  const callBudget = digestCallBudget(settings);
  return {
    level: options.level,
    periodKey: period.label,
    sessionCount: allSessions.length,
    summaryCallCount,
    digestCallCount,
    estimatedLlmCalls,
    callBudget,
    overBudget: estimatedLlmCalls > callBudget
  };
}
