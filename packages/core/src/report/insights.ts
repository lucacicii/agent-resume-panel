import { escapeSqlLiteral, runSqliteJson } from "../sqlite";

export interface PeriodSessionStats {
  total: number;
  completed: number;
  active: number;
  blocked: number;
  other: number;
  byProvider: Record<string, number>;
  byProject: Array<{ projectPath: string; projectName: string; count: number }>;
  deepTurnCount: number;
  quickTurnCount: number;
}

export interface PeriodBlockedSession {
  provider: string;
  id: string;
  title: string;
  projectPath: string;
  updatedAt: number;
  blockerReason?: string;
  nextAction?: string;
}

export interface PeriodActiveSession {
  provider: string;
  id: string;
  title: string;
  projectPath: string;
  updatedAt: number;
  nextAction?: string;
}

export interface PeriodTagItem {
  tag: string;
  normalizedTag: string;
  displayName: string;
  category: string;
  sessionCount: number;
  weight: number;
  sessionIds: string[];
}

export interface PeriodTagStats {
  totalTags: number;
  totalHits: number;
  byCategory: Record<string, PeriodTagItem[]>;
  topTags: PeriodTagItem[];
}

export interface PeriodLlmUsageTrendPoint {
  label: string;
  calls: number;
  tokens: number;
}

export interface PeriodLlmUsage {
  totalCalls: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  topModels: Array<{ model: string; count: number }>;
  trend: PeriodLlmUsageTrendPoint[];
}

export interface PeriodDailyTrendItem {
  dayKey: string;
  label: string;
  dayOfMonth: number;
  dayOfWeek: number;
  sessionCount: number;
  completedCount: number;
  activeCount: number;
  blockedCount: number;
}

export interface PeriodInsights {
  fromMs: number;
  toMs: number;
  sessionStats: PeriodSessionStats;
  blockedSessions: PeriodBlockedSession[];
  activeSessions: PeriodActiveSession[];
  tagStats: PeriodTagStats;
  llmUsage: PeriodLlmUsage;
  dailyTrend: PeriodDailyTrendItem[];
}

export interface GetPeriodInsightsOptions {
  catalogDb: string;
  desktopDb: string;
  fromMs: number;
  toMs: number;
}

function extractSummaryField(text: string, field: string): string | undefined {
  const match = text.match(
    new RegExp(
      `(?:^|\\n)${field}:\\s*([^\\n]+(?:\\n(?!State:|Outcome:|Open work:|Next action:|Evidence:)[^\\n]+)*)`,
      "i"
    )
  );
  return match ? match[1].trim() : undefined;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function dayKeyFromDate(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function dayKeyFromMs(value: number): string {
  return dayKeyFromDate(new Date(value));
}

function generateDaysInRange(fromMs: number, toMs: number): string[] {
  const days: string[] = [];
  const cur = new Date(fromMs);
  cur.setHours(0, 0, 0, 0);
  while (cur.getTime() < toMs || days.length === 0) {
    days.push(dayKeyFromDate(cur));
    cur.setDate(cur.getDate() + 1);
    cur.setHours(0, 0, 0, 0);
    if (cur.getTime() >= toMs && days.length > 0) break;
  }
  return days;
}

interface RawSessionRow {
  provider: string;
  id: string;
  title: string;
  user_title: string | null;
  project_path: string;
  updated_at_ms: number;
  message_count: number | null;
  session_summary: string | null;
}

export async function getPeriodInsights(
  options: GetPeriodInsightsOptions
): Promise<PeriodInsights> {
  const { catalogDb, desktopDb, fromMs, toMs } = options;

  const emptyInsights: PeriodInsights = {
    fromMs,
    toMs,
    sessionStats: {
      total: 0,
      completed: 0,
      active: 0,
      blocked: 0,
      other: 0,
      byProvider: {},
      byProject: [],
      deepTurnCount: 0,
      quickTurnCount: 0
    },
    blockedSessions: [],
    activeSessions: [],
    tagStats: {
      totalTags: 0,
      totalHits: 0,
      byCategory: {},
      topTags: []
    },
    llmUsage: {
      totalCalls: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      topModels: [],
      trend: []
    },
    dailyTrend: []
  };

  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
    return emptyInsights;
  }

  // 1. Fetch sessions from catalogDb
  let sessions: RawSessionRow[] = [];
  try {
    sessions = await runSqliteJson<RawSessionRow>(
      catalogDb,
      `SELECT 
         provider,
         agent_session_id as id,
         title,
         user_title,
         project_path,
         updated_at_ms,
         message_count,
         session_summary
       FROM sessions
       WHERE updated_at_ms >= ${Number(fromMs)}
         AND updated_at_ms < ${Number(toMs)}
         AND hidden = 0
       ORDER BY updated_at_ms DESC;`
    );
  } catch {
    sessions = [];
  }

  const byProvider: Record<string, number> = {};
  const byProjectMap = new Map<string, number>();
  let completed = 0;
  let active = 0;
  let blocked = 0;
  let other = 0;
  let deepTurnCount = 0;
  let quickTurnCount = 0;

  const blockedSessions: PeriodBlockedSession[] = [];
  const activeSessions: PeriodActiveSession[] = [];

  for (const row of sessions) {
    const provider = row.provider || "unknown";
    byProvider[provider] = (byProvider[provider] || 0) + 1;

    const projectPath = row.project_path || "";
    if (projectPath) {
      byProjectMap.set(projectPath, (byProjectMap.get(projectPath) || 0) + 1);
    }

    const messageCount = Number(row.message_count) || 0;
    if (messageCount >= 16) {
      deepTurnCount += 1;
    } else if (messageCount > 0 && messageCount <= 2) {
      quickTurnCount += 1;
    }

    const summary = row.session_summary?.trim() || "";
    const effectiveTitle = row.user_title?.trim() || row.title?.trim() || row.id;

    if (summary.includes("State: blocked")) {
      blocked += 1;
      blockedSessions.push({
        provider: row.provider,
        id: row.id,
        title: effectiveTitle,
        projectPath,
        updatedAt: row.updated_at_ms,
        blockerReason:
          extractSummaryField(summary, "Evidence") ||
          extractSummaryField(summary, "Open work") ||
          extractSummaryField(summary, "Outcome"),
        nextAction: extractSummaryField(summary, "Next action")
      });
    } else if (summary.includes("State: completed")) {
      completed += 1;
    } else if (summary.includes("State: active")) {
      active += 1;
      activeSessions.push({
        provider: row.provider,
        id: row.id,
        title: effectiveTitle,
        projectPath,
        updatedAt: row.updated_at_ms,
        nextAction:
          extractSummaryField(summary, "Next action") ||
          extractSummaryField(summary, "Open work")
      });
    } else {
      other += 1;
    }
  }

  const byProject = Array.from(byProjectMap.entries())
    .map(([projectPath, count]) => {
      const parts = projectPath.split(/[\\/]/).filter(Boolean);
      const projectName = parts.at(-1) || projectPath;
      return { projectPath, projectName, count };
    })
    .sort((a, b) => b.count - a.count);

  const sessionStats: PeriodSessionStats = {
    total: sessions.length,
    completed,
    active,
    blocked,
    other,
    byProvider,
    byProject,
    deepTurnCount,
    quickTurnCount
  };

  // 2. Fetch tags from desktopDb for active period sessions
  const entityIds = sessions.map((s) => `${s.provider}:${s.id}`);
  const byNormTag = new Map<
    string,
    {
      tag: string;
      normalizedTag: string;
      displayName: string;
      category: string;
      weight: number;
      sessionIds: Set<string>;
    }
  >();

  if (entityIds.length > 0) {
    const CHUNK_SIZE = 300;
    for (let i = 0; i < entityIds.length; i += CHUNK_SIZE) {
      const chunk = entityIds.slice(i, i + CHUNK_SIZE);
      const inList = chunk.map((id) => `'${escapeSqlLiteral(id)}'`).join(", ");
      try {
        const tagRows = await runSqliteJson<{
          entity_id: string;
          tag: string;
          normalized_tag: string;
          category: string;
          weight: number;
          display_name: string | null;
        }>(
          desktopDb,
          `SELECT 
             e.entity_id,
             e.tag,
             e.normalized_tag,
             e.category,
             e.weight,
             t.display_name
           FROM entity_tags e
           LEFT JOIN tag_definitions t ON e.normalized_tag = t.normalized_tag
           WHERE e.entity_type = 'session'
             AND e.status = 'active'
             AND e.entity_id IN (${inList});`
        );

        for (const row of tagRows) {
          const norm = row.normalized_tag;
          if (!byNormTag.has(norm)) {
            byNormTag.set(norm, {
              tag: row.tag,
              normalizedTag: norm,
              displayName: row.display_name || row.tag,
              category: row.category || "tech_stack",
              weight: 0,
              sessionIds: new Set()
            });
          }
          const item = byNormTag.get(norm)!;
          item.sessionIds.add(row.entity_id);
          item.weight += Number(row.weight) || 0;
        }
      } catch {
        // Tag table might be empty or missing in test environments
      }
    }
  }

  const allTagItems: PeriodTagItem[] = Array.from(byNormTag.values())
    .map((item) => ({
      tag: item.tag,
      normalizedTag: item.normalizedTag,
      displayName: item.displayName,
      category: item.category,
      sessionCount: item.sessionIds.size,
      weight: Number(item.weight.toFixed(1)),
      sessionIds: Array.from(item.sessionIds)
    }))
    .sort((a, b) => b.sessionCount - a.sessionCount || b.weight - a.weight);

  const byCategory: Record<string, PeriodTagItem[]> = {};
  let totalHits = 0;
  for (const item of allTagItems) {
    totalHits += item.sessionCount;
    if (!byCategory[item.category]) {
      byCategory[item.category] = [];
    }
    byCategory[item.category].push(item);
  }

  const tagStats: PeriodTagStats = {
    totalTags: allTagItems.length,
    totalHits,
    byCategory,
    topTags: allTagItems.slice(0, 15)
  };

  // 3. Fetch LLM usage from desktopDb
  let llmUsage: PeriodLlmUsage = {
    totalCalls: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    topModels: [],
    trend: []
  };

  try {
    const usageRows = await runSqliteJson<{
      total_calls: number;
      total_tokens: number;
      prompt_tokens: number;
      completion_tokens: number;
    }>(
      desktopDb,
      `SELECT 
         count(*) as total_calls,
         coalesce(sum(total_tokens), 0) as total_tokens,
         coalesce(sum(prompt_tokens), 0) as prompt_tokens,
         coalesce(sum(completion_tokens), 0) as completion_tokens
       FROM llm_usage_events
       WHERE created_at_ms >= ${Number(fromMs)}
         AND created_at_ms < ${Number(toMs)};`
    );

    const modelRows = await runSqliteJson<{
      model: string;
      count: number;
    }>(
      desktopDb,
      `SELECT 
         model,
         count(*) as count
       FROM llm_usage_events
       WHERE created_at_ms >= ${Number(fromMs)}
         AND created_at_ms < ${Number(toMs)}
         AND model IS NOT NULL
         AND model != ''
       GROUP BY model
       ORDER BY count DESC
       LIMIT 5;`
    );

    // Compute trend points for LLM usage
    const isSingleDay = toMs - fromMs <= 86400000 * 1.5;
    let trendPoints: PeriodLlmUsageTrendPoint[] = [];

    if (isSingleDay) {
      const hrMap = new Map<string, { calls: number; tokens: number }>();
      for (let h = 0; h < 24; h++) {
        const hrStr = String(h).padStart(2, "0");
        hrMap.set(hrStr, { calls: 0, tokens: 0 });
      }

      const hourlyRows = await runSqliteJson<{
        hr: string;
        calls: number;
        tokens: number;
      }>(
        desktopDb,
        `SELECT 
           strftime('%H', created_at_ms / 1000, 'unixepoch', 'localtime') as hr,
           count(*) as calls,
           coalesce(sum(total_tokens), 0) as tokens
         FROM llm_usage_events
         WHERE created_at_ms >= ${Number(fromMs)}
           AND created_at_ms < ${Number(toMs)}
         GROUP BY hr
         ORDER BY hr ASC;`
      );

      for (const r of hourlyRows) {
        if (hrMap.has(r.hr)) {
          hrMap.set(r.hr, {
            calls: Number(r.calls) || 0,
            tokens: Number(r.tokens) || 0
          });
        }
      }

      trendPoints = Array.from(hrMap.entries()).map(([hr, val]) => ({
        label: `${hr}:00`,
        calls: val.calls,
        tokens: val.tokens
      }));
    } else {
      const dayKeys = generateDaysInRange(fromMs, toMs);
      const isWeekSpan = dayKeys.length === 7;
      const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayMap = new Map<string, { calls: number; tokens: number }>();
      for (const dk of dayKeys) {
        dayMap.set(dk, { calls: 0, tokens: 0 });
      }

      const dailyRows = await runSqliteJson<{
        day_key: string;
        calls: number;
        tokens: number;
      }>(
        desktopDb,
        `SELECT 
           date(created_at_ms / 1000, 'unixepoch', 'localtime') as day_key,
           count(*) as calls,
           coalesce(sum(total_tokens), 0) as tokens
         FROM llm_usage_events
         WHERE created_at_ms >= ${Number(fromMs)}
           AND created_at_ms < ${Number(toMs)}
         GROUP BY day_key
         ORDER BY day_key ASC;`
      );

      for (const r of dailyRows) {
        if (dayMap.has(r.day_key)) {
          dayMap.set(r.day_key, {
            calls: Number(r.calls) || 0,
            tokens: Number(r.tokens) || 0
          });
        }
      }

      trendPoints = dayKeys.map((dk) => {
        const parts = dk.split("-").map(Number);
        const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
        const dayOfWeek = d.getDay();
        const dayOfMonth = d.getDate();
        const val = dayMap.get(dk) || { calls: 0, tokens: 0 };
        return {
          label: isWeekSpan ? weekdayLabels[dayOfWeek] : String(dayOfMonth),
          calls: val.calls,
          tokens: val.tokens
        };
      });
    }

    if (usageRows.length > 0) {
      const u = usageRows[0];
      llmUsage = {
        totalCalls: Number(u.total_calls) || 0,
        totalTokens: Number(u.total_tokens) || 0,
        promptTokens: Number(u.prompt_tokens) || 0,
        completionTokens: Number(u.completion_tokens) || 0,
        topModels: modelRows.map((m) => ({
          model: m.model,
          count: Number(m.count) || 0
        })),
        trend: trendPoints
      };
    }
  } catch {
    // llm_usage_events might be empty or missing in test environments
  }

  // 4. Compute daily trend across range
  const dayKeys = generateDaysInRange(fromMs, toMs);
  const trendMap = new Map<string, PeriodDailyTrendItem>();
  const isWeekSpan = dayKeys.length === 7;
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  for (const dk of dayKeys) {
    const parts = dk.split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
    const dayOfWeek = d.getDay();
    const dayOfMonth = d.getDate();
    trendMap.set(dk, {
      dayKey: dk,
      label: isWeekSpan ? weekdayLabels[dayOfWeek] : String(dayOfMonth),
      dayOfMonth,
      dayOfWeek,
      sessionCount: 0,
      completedCount: 0,
      activeCount: 0,
      blockedCount: 0
    });
  }

  for (const row of sessions) {
    const dk = dayKeyFromMs(row.updated_at_ms);
    const item = trendMap.get(dk);
    if (item) {
      item.sessionCount += 1;
      const summary = row.session_summary?.trim() || "";
      if (summary.includes("State: blocked")) item.blockedCount += 1;
      else if (summary.includes("State: completed")) item.completedCount += 1;
      else if (summary.includes("State: active")) item.activeCount += 1;
    }
  }

  const dailyTrend = Array.from(trendMap.values());

  return {
    fromMs,
    toMs,
    sessionStats,
    blockedSessions,
    activeSessions,
    tagStats,
    llmUsage,
    dailyTrend
  };
}
