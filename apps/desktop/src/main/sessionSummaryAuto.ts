import { app } from "electron";
import {
  effectivePanelHome,
  loadSettings,
  runAutoSessionSummaries
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";

const TICK_INTERVAL_MS = 5 * 60_000;
const FAILURE_COOLDOWN_MS = 15 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
/** provider:id → do-not-retry-until ms */
const failureCooldown = new Map<string, number>();

export function stopSessionSummaryAuto(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
}

export function startSessionSummaryAuto(): void {
  stopSessionSummaryAuto();
  timer = setInterval(() => scheduleSessionSummaryAuto(0), TICK_INTERVAL_MS);
  scheduleSessionSummaryAuto(5_000);
}

/**
 * Debounced schedule after session sync or settings change.
 */
export function scheduleSessionSummaryAuto(delayMs = 2_000): void {
  if (pending) {
    clearTimeout(pending);
  }
  pending = setTimeout(() => {
    pending = null;
    void runSessionSummaryAutoSafe();
  }, Math.max(0, delayMs));
}

async function runSessionSummaryAutoSafe(): Promise<void> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = runSessionSummaryAuto()
    .catch((error) => {
      console.error("[session-summary-auto]", error);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function runSessionSummaryAuto(): Promise<void> {
  const settings = await loadSettings();
  const paths = await loadPanelDbPaths(settings);
  const now = Date.now();

  // Drop expired failure cooldowns.
  for (const [key, until] of failureCooldown) {
    if (until <= now) {
      failureCooldown.delete(key);
    }
  }

  const skipKeys = new Set(
    Array.from(failureCooldown.entries())
      .filter(([, until]) => until > now)
      .map(([key]) => key)
  );

  const result = await runAutoSessionSummaries({
    catalogDb: paths.catalogDb,
    settings,
    panelHome: effectivePanelHome(settings),
    systemLocale: app.getLocale(),
    nowMs: now,
    skipKeys
  });

  if (result.skippedReason) {
    if (result.skippedReason !== "none_eligible") {
      console.log(`[session-summary-auto] skip: ${result.skippedReason}`);
    }
    return;
  }

  const ensure = result.ensure;
  if (!ensure) {
    return;
  }

  for (const fail of ensure.failed) {
    failureCooldown.set(fail.key, Date.now() + FAILURE_COOLDOWN_MS);
  }

  console.log(
    `[session-summary-auto] candidates=${result.candidates.length} summarized=${ensure.summarized} skipped=${ensure.skipped} failed=${ensure.failed.length}`
  );
}
