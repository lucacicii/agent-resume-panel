/**
 * Tier 1.5 — LLM status adjudication.
 *
 * Answers the one question heuristics cannot: is this agent blocked on the
 * user? Only reached for screens the cheaper tiers could not settle, so its
 * cost stays proportional to genuine ambiguity rather than to output volume.
 *
 * Everything here is defensive: a timeout, a bad key, a malformed reply or an
 * exhausted quota must degrade to "not waiting" — never surface into the
 * status pipeline, and never invent an alert.
 */

import {
  chatCompletionDetailed,
  recordLlmUsage,
  sessionStatusLlmConfigFromSettings,
  type PanelSettings
} from "@agent-resume/core";import {
  buildJudgePrompt,
  parseJudgeVerdicts,
  type JudgeRequest,
  type JudgeVerdict
} from "./prompt";

export const JUDGE_TIMEOUT_MS = 20_000;

/** Hard ceiling on screens per call; extra requests are answered as not-waiting. */
export const MAX_REQUESTS_PER_CALL = 8;

/**
 * Per-pane hourly call budget.
 *
 * A pane normally needs a handful per turn; this only exists so a pathological
 * loop (or a stuck agent) cannot spend the user's quota unattended.
 */
export const HOURLY_CALL_LIMIT_PER_PANE = 200;
const HOUR_MS = 60 * 60 * 1000;

/** Max output tokens — the reply is a tiny JSON document. */
const MAX_TOKENS = 512;

export type JudgeDeps = {
  loadSettings: () => PanelSettings;
  /** Absolute path of the desktop catalog DB used for LLM usage accounting. */
  desktopDb?: string;
};

/** Shape written to the usage table; kept local so tests can spy on it. */
export type JudgeUsageEntry = {
  model: string;
  ok: boolean;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  durationMs?: number;
  error?: string;
};

/** Sliding-window call counter, keyed by pane. */
class CallBudget {
  private readonly timestamps = new Map<string, number[]>();

  allow(paneKey: string, now: number): boolean {
    const recent = (this.timestamps.get(paneKey) ?? []).filter((at) => now - at < HOUR_MS);
    if (recent.length >= HOURLY_CALL_LIMIT_PER_PANE) {
      this.timestamps.set(paneKey, recent);
      return false;
    }
    recent.push(now);
    this.timestamps.set(paneKey, recent);
    return true;
  }

  reset(): void {
    this.timestamps.clear();
  }
}

export class StatusJudge {
  private readonly budget = new CallBudget();
  private inFlight = false;

  constructor(private readonly deps: JudgeDeps) {}

  /** Reset hourly budgets — used when settings change or on explicit retry. */
  resetBudget(): void {
    this.budget.reset();
  }

  /**
   * Adjudicate one batch of screens.
   *
   * Returns a verdict for every request: skipped, unconfigured or failed
   * entries all come back as `awaiting: false`, so the caller can apply the
   * result without a second guard.
   */
  async judge(requests: readonly JudgeRequest[]): Promise<JudgeVerdict[]> {
    const notWaiting = (request: JudgeRequest): JudgeVerdict => ({ paneKey: request.paneKey, awaiting: false });

    if (!requests.length) return [];
    // Single-flight: a second batch waits for the next tick rather than
    // doubling concurrent spend.
    if (this.inFlight) return requests.map(notWaiting);

    const now = Date.now();
    const admitted: JudgeRequest[] = [];
    for (const request of requests.slice(0, MAX_REQUESTS_PER_CALL)) {
      if (this.budget.allow(request.paneKey, now)) admitted.push(request);
    }
    if (!admitted.length) return requests.map(notWaiting);

    const llm = sessionStatusLlmConfigFromSettings(this.deps.loadSettings());
    // Unconfigured (no tool model either) → the layer simply does not run.
    if (!llm) return requests.map(notWaiting);

    this.inFlight = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
    try {
      const started = Date.now();
      const result = await chatCompletionDetailed(
        llm,
        [{ role: "user", content: buildJudgePrompt(admitted) }],
        MAX_TOKENS,
        controller.signal
      );

      const verdicts = parseJudgeVerdicts(result.content, admitted);
      await this.record({
        model: result.model || llm.model,
        ok: true,
        usage: result.usage,
        durationMs: result.durationMs ?? Date.now() - started
      });

      // Anything the model was not asked about stays not-waiting.
      const byPane = new Map(verdicts.map((verdict) => [verdict.paneKey, verdict]));
      return requests.map((request) => byPane.get(request.paneKey) ?? notWaiting(request));
    } catch (error) {
      const aborted = controller.signal.aborted
        || (error as { name?: string })?.name === "AbortError"
        || /abort|timed?\s*out/i.test(String((error as Error)?.message ?? ""));
      await this.record({
        model: llm.model,
        ok: false,
        error: aborted ? "timeout" : (error instanceof Error ? error.message : String(error))
      });
      return requests.map(notWaiting);
    } finally {
      clearTimeout(timer);
      this.inFlight = false;
    }
  }

  private async record(entry: JudgeUsageEntry): Promise<void> {
    const db = this.deps.desktopDb;
    if (!db) return;
    await recordLlmUsage(db, {
      kind: "chat",
      source: "session_status_judge",
      jobKey: "session_status",
      model: entry.model,
      usage: entry.usage,
      durationMs: entry.durationMs,
      ok: entry.ok,
      error: entry.error
    }).catch(() => undefined);
  }
}
