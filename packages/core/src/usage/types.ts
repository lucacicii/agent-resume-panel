export type LlmUsageKind = "chat" | "embedding";

export type LlmUsageSource =
  | "schedule"
  | "daily"
  | "weekly"
  | "monthly"
  | "ask"
  | "gtd"
  | "backfill"
  | "summarize"
  | "rename"
  | "session_embed"
  | "session_transcript_embed"
  | "other";

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmUsageEvent {
  id: string;
  createdAtMs: number;
  kind: LlmUsageKind;
  source: LlmUsageSource | string;
  jobKey?: string | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  durationMs?: number | null;
  ok: boolean;
  error?: string | null;
}

export interface ScheduleRunLog {
  id: string;
  startedAtMs: number;
  finishedAtMs?: number | null;
  level: "daily" | "weekly" | "monthly" | string;
  periodKey: string;
  trigger: "schedule" | "manual" | string;
  status: "running" | "ok" | "error" | "skipped" | string;
  error?: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  metaJson?: string | null;
}

export interface UsageSummary {
  days: number;
  fromMs: number;
  toMs: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  chatTokens: number;
  embeddingTokens: number;
  eventCount: number;
  bySource: Array<{ source: string; totalTokens: number; events: number }>;
  byDay: Array<{ day: string; totalTokens: number; events: number; scheduleRuns: number }>;
}

export function parseOpenAiUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const u = raw as Record<string, unknown>;
  const prompt = num(u.prompt_tokens ?? u.promptTokens);
  const completion = num(u.completion_tokens ?? u.completionTokens);
  const total = num(u.total_tokens ?? u.totalTokens);
  if (prompt == null && completion == null && total == null) {
    return undefined;
  }
  return {
    promptTokens: prompt ?? undefined,
    completionTokens: completion ?? undefined,
    totalTokens: total ?? (prompt != null || completion != null ? (prompt || 0) + (completion || 0) : undefined)
  };
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(0, Math.floor(v));
  }
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Math.max(0, Math.floor(Number(v)));
  }
  return undefined;
}
