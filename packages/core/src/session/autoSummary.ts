import { getSessionById } from "../catalog/query";
import { CatalogSessionRow, toAgentSession, type AgentSession } from "../catalog/types";
import { llmConfigFromSettings } from "../llm/fromSettings";
import type { PanelSettings, SessionSummaryAutoSettings } from "../settings/types";
import { DEFAULT_SETTINGS } from "../settings/types";
import { runSqliteJson } from "../sqlite";
import { ensureSummariesForSessions, type EnsureSummariesResult } from "./ensureSummaries";

export const DEFAULT_STALE_DELAY_MINUTES = 30;
export const DEFAULT_MISSING_DELAY_MINUTES = 0;
export const DEFAULT_AUTO_SUMMARY_CONCURRENCY = 1;
export const DEFAULT_AUTO_SUMMARY_MAX_PER_TICK = 5;

export type AutoSummaryReason = "missing" | "stale";

export interface AutoSummaryCandidate {
  session: AgentSession;
  reason: AutoSummaryReason;
  /** Earliest ms when this candidate becomes eligible. */
  eligibleAtMs: number;
}

export interface ResolvedSessionSummaryAutoSettings {
  enabled: boolean;
  staleDelayMinutes: number;
  missingDelayMinutes: number;
  concurrency: number;
  maxPerTick: number;
  staleDelayMs: number;
  missingDelayMs: number;
}

export function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function resolveSessionSummaryAutoSettings(
  settings?: PanelSettings | null
): ResolvedSessionSummaryAutoSettings {
  const defaults = DEFAULT_SETTINGS.sessionSummaryAuto || {};
  const raw: SessionSummaryAutoSettings = {
    ...defaults,
    ...(settings?.sessionSummaryAuto || {})
  };
  const staleDelayMinutes = clampInt(
    raw.staleDelayMinutes,
    DEFAULT_STALE_DELAY_MINUTES,
    0,
    1440
  );
  const missingDelayMinutes = clampInt(
    raw.missingDelayMinutes,
    DEFAULT_MISSING_DELAY_MINUTES,
    0,
    1440
  );
  const concurrency = clampInt(raw.concurrency, DEFAULT_AUTO_SUMMARY_CONCURRENCY, 1, 3);
  const maxPerTick = clampInt(raw.maxPerTick, DEFAULT_AUTO_SUMMARY_MAX_PER_TICK, 1, 50);
  return {
    enabled: raw.enabled !== false,
    staleDelayMinutes,
    missingDelayMinutes,
    concurrency,
    maxPerTick,
    staleDelayMs: staleDelayMinutes * 60_000,
    missingDelayMs: missingDelayMinutes * 60_000
  };
}

export function isMissingSummary(session: AgentSession): boolean {
  return !session.sessionSummary?.trim();
}

export function isStaleSummary(session: AgentSession): boolean {
  if (isMissingSummary(session)) {
    return false;
  }
  const summaryAt = session.sessionSummaryAtMs;
  if (summaryAt == null || !Number.isFinite(summaryAt)) {
    return true;
  }
  return session.updatedAt > summaryAt;
}

/**
 * Whether a needing-summary session is past its quiet-period delay.
 */
export function isEligibleForAutoSummary(
  session: AgentSession,
  nowMs: number,
  auto: Pick<ResolvedSessionSummaryAutoSettings, "missingDelayMs" | "staleDelayMs">
): { eligible: boolean; reason?: AutoSummaryReason; eligibleAtMs: number } {
  const updatedAt = Number(session.updatedAt) || 0;
  if (isMissingSummary(session)) {
    const eligibleAtMs = updatedAt + auto.missingDelayMs;
    return {
      eligible: nowMs >= eligibleAtMs,
      reason: "missing",
      eligibleAtMs
    };
  }
  if (isStaleSummary(session)) {
    const eligibleAtMs = updatedAt + auto.staleDelayMs;
    return {
      eligible: nowMs >= eligibleAtMs,
      reason: "stale",
      eligibleAtMs
    };
  }
  return { eligible: false, eligibleAtMs: Number.POSITIVE_INFINITY };
}

/**
 * Catalog rows that lack a summary or have updated_at newer than summary_at.
 */
export async function listSessionsNeedingSummary(
  catalogDb: string,
  limit = 200
): Promise<AgentSession[]> {
  const safeLimit = Math.max(1, Math.min(limit, 2000));
  const rows = await runSqliteJson<CatalogSessionRow>(
    catalogDb,
    `SELECT provider, agent_session_id, title, project_path, updated_at_ms, archived,
      message_count, model, branch, source, acp_provider, user_title, hidden, last_synced_at_ms,
      session_summary, session_summary_language, session_summary_at_ms, project_id
     FROM sessions
     WHERE hidden = 0
       AND (
         session_summary IS NULL
         OR TRIM(session_summary) = ''
         OR session_summary_at_ms IS NULL
         OR updated_at_ms > session_summary_at_ms
       )
     ORDER BY updated_at_ms DESC
     LIMIT ${safeLimit};`
  );
  return rows.map((row) => toAgentSession(row));
}

export function selectAutoSummaryCandidates(
  sessions: AgentSession[],
  nowMs: number,
  auto: ResolvedSessionSummaryAutoSettings
): AutoSummaryCandidate[] {
  const missing: AutoSummaryCandidate[] = [];
  const stale: AutoSummaryCandidate[] = [];

  for (const session of sessions) {
    const check = isEligibleForAutoSummary(session, nowMs, auto);
    if (!check.eligible || !check.reason) {
      continue;
    }
    const item = { session, reason: check.reason, eligibleAtMs: check.eligibleAtMs };
    if (check.reason === "missing") {
      missing.push(item);
    } else {
      stale.push(item);
    }
  }

  // Prefer first-time summaries, then stale; already ordered by updated_at desc from query.
  return [...missing, ...stale].slice(0, auto.maxPerTick);
}

export interface RunAutoSessionSummariesOptions {
  catalogDb: string;
  settings: PanelSettings;
  panelHome?: string;
  nowMs?: number;
  systemLocale?: string;
  /** Skip keys (e.g. recent failures) for this run. */
  skipKeys?: Set<string>;
}

export interface RunAutoSessionSummariesResult {
  skippedReason?: "disabled" | "no_llm" | "none_eligible";
  candidates: AutoSummaryCandidate[];
  ensure?: EnsureSummariesResult;
}

/**
 * Load candidates and run ensureSummaries with refreshIfStale for auto pipeline.
 */
export async function runAutoSessionSummaries(
  options: RunAutoSessionSummariesOptions
): Promise<RunAutoSessionSummariesResult> {
  const auto = resolveSessionSummaryAutoSettings(options.settings);
  if (!auto.enabled) {
    return { skippedReason: "disabled", candidates: [] };
  }
  if (!llmConfigFromSettings(options.settings, options.systemLocale)) {
    return { skippedReason: "no_llm", candidates: [] };
  }

  const nowMs = options.nowMs ?? Date.now();
  const pool = await listSessionsNeedingSummary(options.catalogDb, Math.max(auto.maxPerTick * 10, 50));
  let candidates = selectAutoSummaryCandidates(pool, nowMs, auto);
  if (options.skipKeys?.size) {
    candidates = candidates.filter(
      (c) => !options.skipKeys!.has(`${c.session.provider}:${c.session.id}`)
    );
  }
  if (!candidates.length) {
    return { skippedReason: "none_eligible", candidates: [] };
  }

  // Re-fetch full rows so ensure has latest titles/summaries.
  const sessions: AgentSession[] = [];
  for (const c of candidates) {
    const fresh = await getSessionById(options.catalogDb, c.session.provider, c.session.id);
    sessions.push(fresh || c.session);
  }

  const ensure = await ensureSummariesForSessions({
    dbPath: options.catalogDb,
    sessions,
    settings: options.settings,
    panelHome: options.panelHome,
    refreshIfStale: true,
    concurrency: auto.concurrency,
    jobKeyPrefix: "summarize:auto",
    systemLocale: options.systemLocale
  });

  return { candidates, ensure };
}
