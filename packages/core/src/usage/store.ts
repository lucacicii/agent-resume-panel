import { randomUUID } from "node:crypto";
import { escapeSqlLiteral, runSqlite, runSqliteJson } from "../sqlite";
import {
  LlmUsageEvent,
  LlmUsageKind,
  LlmUsageSource,
  ScheduleRunLog,
  TokenUsage,
  UsageSummary
} from "./types";

export async function recordLlmUsage(
  dbPath: string,
  input: {
    kind: LlmUsageKind;
    source: LlmUsageSource | string;
    jobKey?: string;
    model?: string;
    usage?: TokenUsage;
    durationMs?: number;
    ok?: boolean;
    error?: string;
  }
): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  const ok = input.ok === false ? 0 : 1;
  await runSqlite(
    dbPath,
    `INSERT INTO llm_usage_events (
       id, created_at_ms, kind, source, job_key, model,
       prompt_tokens, completion_tokens, total_tokens, duration_ms, ok, error
     ) VALUES (
       '${escapeSqlLiteral(id)}',
       ${now},
       '${escapeSqlLiteral(input.kind)}',
       '${escapeSqlLiteral(input.source)}',
       ${input.jobKey ? `'${escapeSqlLiteral(input.jobKey)}'` : "NULL"},
       ${input.model ? `'${escapeSqlLiteral(input.model)}'` : "NULL"},
       ${input.usage?.promptTokens ?? "NULL"},
       ${input.usage?.completionTokens ?? "NULL"},
       ${input.usage?.totalTokens ?? "NULL"},
       ${input.durationMs ?? "NULL"},
       ${ok},
       ${input.error ? `'${escapeSqlLiteral(input.error)}'` : "NULL"}
     );`
  );
  return id;
}

interface UsageRow {
  id: string;
  created_at_ms: number;
  kind: string;
  source: string;
  job_key: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number | null;
  ok: number;
  error: string | null;
}

function mapUsage(row: UsageRow): LlmUsageEvent {
  return {
    id: row.id,
    createdAtMs: row.created_at_ms,
    kind: row.kind as LlmUsageKind,
    source: row.source,
    jobKey: row.job_key,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    durationMs: row.duration_ms,
    ok: row.ok === 1,
    error: row.error
  };
}

export async function listLlmUsageEvents(
  dbPath: string,
  options?: { fromMs?: number; toMs?: number; source?: string; limit?: number }
): Promise<LlmUsageEvent[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
  const clauses: string[] = [];
  if (options?.fromMs != null) {
    clauses.push(`created_at_ms >= ${Math.floor(options.fromMs)}`);
  }
  if (options?.toMs != null) {
    clauses.push(`created_at_ms < ${Math.floor(options.toMs)}`);
  }
  if (options?.source) {
    clauses.push(`source = '${escapeSqlLiteral(options.source)}'`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await runSqliteJson<UsageRow>(
    dbPath,
    `SELECT * FROM llm_usage_events ${where} ORDER BY created_at_ms DESC LIMIT ${limit};`
  );
  return rows.map(mapUsage);
}

export async function startScheduleRun(
  dbPath: string,
  input: {
    level: string;
    periodKey: string;
    trigger?: string;
  }
): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  await runSqlite(
    dbPath,
    `INSERT INTO schedule_run_logs (
       id, started_at_ms, finished_at_ms, level, period_key, trigger, status,
       error, prompt_tokens, completion_tokens, total_tokens, meta_json
     ) VALUES (
       '${escapeSqlLiteral(id)}',
       ${now},
       NULL,
       '${escapeSqlLiteral(input.level)}',
       '${escapeSqlLiteral(input.periodKey)}',
       '${escapeSqlLiteral(input.trigger || "schedule")}',
       'running',
       NULL, 0, 0, 0, NULL
     );`
  );
  return id;
}

export async function finishScheduleRun(
  dbPath: string,
  id: string,
  input: {
    status: string;
    error?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    meta?: Record<string, unknown>;
  }
): Promise<void> {
  const now = Date.now();
  const meta = input.meta ? `'${escapeSqlLiteral(JSON.stringify(input.meta))}'` : "NULL";
  await runSqlite(
    dbPath,
    `UPDATE schedule_run_logs SET
       finished_at_ms = ${now},
       status = '${escapeSqlLiteral(input.status)}',
       error = ${input.error ? `'${escapeSqlLiteral(input.error)}'` : "NULL"},
       prompt_tokens = ${input.promptTokens ?? 0},
       completion_tokens = ${input.completionTokens ?? 0},
       total_tokens = ${input.totalTokens ?? 0},
       meta_json = ${meta}
     WHERE id = '${escapeSqlLiteral(id)}';`
  );
}

interface ScheduleRow {
  id: string;
  started_at_ms: number;
  finished_at_ms: number | null;
  level: string;
  period_key: string;
  trigger: string;
  status: string;
  error: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  meta_json: string | null;
}

function mapSchedule(row: ScheduleRow): ScheduleRunLog {
  return {
    id: row.id,
    startedAtMs: row.started_at_ms,
    finishedAtMs: row.finished_at_ms,
    level: row.level,
    periodKey: row.period_key,
    trigger: row.trigger,
    status: row.status,
    error: row.error,
    promptTokens: row.prompt_tokens || 0,
    completionTokens: row.completion_tokens || 0,
    totalTokens: row.total_tokens || 0,
    metaJson: row.meta_json
  };
}

export async function listScheduleRuns(
  dbPath: string,
  options?: { fromMs?: number; level?: string; limit?: number }
): Promise<ScheduleRunLog[]> {
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 500));
  const clauses: string[] = [];
  if (options?.fromMs != null) {
    clauses.push(`started_at_ms >= ${Math.floor(options.fromMs)}`);
  }
  if (options?.level) {
    clauses.push(`level = '${escapeSqlLiteral(options.level)}'`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await runSqliteJson<ScheduleRow>(
    dbPath,
    `SELECT * FROM schedule_run_logs ${where} ORDER BY started_at_ms DESC LIMIT ${limit};`
  );
  return rows.map(mapSchedule);
}

export async function getUsageSummary(dbPath: string, days = 30): Promise<UsageSummary> {
  const safeDays = Math.max(1, Math.min(days, 365));
  const toMs = Date.now();
  const fromMs = toMs - safeDays * 24 * 60 * 60 * 1000;

  const events = await listLlmUsageEvents(dbPath, { fromMs, toMs, limit: 500 });
  const runs = await listScheduleRuns(dbPath, { fromMs, limit: 500 });

  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let chatTokens = 0;
  let embeddingTokens = 0;
  const bySourceMap = new Map<string, { totalTokens: number; events: number }>();
  const byDayMap = new Map<string, { totalTokens: number; events: number; scheduleRuns: number }>();

  for (const e of events) {
    const t = e.totalTokens || 0;
    const p = e.promptTokens || 0;
    const c = e.completionTokens || 0;
    totalTokens += t;
    promptTokens += p;
    completionTokens += c;
    if (e.kind === "chat") {
      chatTokens += t;
    } else {
      embeddingTokens += t;
    }
    const src = e.source || "other";
    const s = bySourceMap.get(src) || { totalTokens: 0, events: 0 };
    s.totalTokens += t;
    s.events += 1;
    bySourceMap.set(src, s);

    const day = new Date(e.createdAtMs).toISOString().slice(0, 10);
    const d = byDayMap.get(day) || { totalTokens: 0, events: 0, scheduleRuns: 0 };
    d.totalTokens += t;
    d.events += 1;
    byDayMap.set(day, d);
  }

  for (const r of runs) {
    const day = new Date(r.startedAtMs).toISOString().slice(0, 10);
    const d = byDayMap.get(day) || { totalTokens: 0, events: 0, scheduleRuns: 0 };
    d.scheduleRuns += 1;
    // if run has tokens but events missing, still count on day
    if (r.totalTokens && !d.totalTokens) {
      d.totalTokens += r.totalTokens;
    }
    byDayMap.set(day, d);
  }

  return {
    days: safeDays,
    fromMs,
    toMs,
    totalTokens,
    promptTokens,
    completionTokens,
    chatTokens,
    embeddingTokens,
    eventCount: events.length,
    bySource: [...bySourceMap.entries()]
      .map(([source, v]) => ({ source, ...v }))
      .sort((a, b) => b.totalTokens - a.totalTokens),
    byDay: [...byDayMap.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => b.day.localeCompare(a.day))
  };
}
