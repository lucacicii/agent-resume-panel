import { app } from "electron";
import {
  effectivePanelHome,
  loadSettings,
  runAutoTranscriptIndex
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";

const TICK_INTERVAL_MS = 5 * 60_000;
const FAILURE_COOLDOWN_MS = 15 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
/** provider:id → do-not-retry-until ms */
const failureCooldown = new Map<string, number>();

export function stopSessionTranscriptIndexAuto(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
}

export function startSessionTranscriptIndexAuto(): void {
  stopSessionTranscriptIndexAuto();
  timer = setInterval(() => scheduleSessionTranscriptIndexAuto(0), TICK_INTERVAL_MS);
  scheduleSessionTranscriptIndexAuto(15_000);
}

/**
 * Debounced schedule after session sync or settings change.
 */
export function scheduleSessionTranscriptIndexAuto(delayMs = 2_000): void {
  if (pending) {
    clearTimeout(pending);
  }
  pending = setTimeout(() => {
    pending = null;
    void runTranscriptIndexSafe();
  }, Math.max(0, delayMs));
}

async function runTranscriptIndexSafe(): Promise<void> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = runTranscriptIndex()
    .catch((error) => {
      console.error("[session-transcript-index-auto]", error);
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function runTranscriptIndex(): Promise<void> {
  const settings = await loadSettings();
  const paths = await loadPanelDbPaths(settings);
  const now = Date.now();

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

  const result = await runAutoTranscriptIndex({
    catalogDb: paths.catalogDb,
    desktopDb: paths.desktopDb,
    settings,
    panelHome: effectivePanelHome(settings),
    nowMs: now,
    skipKeys
  });

  if (result.skippedReason) {
    if (result.skippedReason !== "none_eligible") {
      console.log(`[session-transcript-index-auto] skip: ${result.skippedReason}`);
    }
    return;
  }

  for (const row of result.results) {
    if (row.result.skipped === "embed_failed" || row.result.skipped === "empty_transcript") {
      // empty transcript: short cooldown so we don't thrash missing histories
      const cool =
        row.result.skipped === "empty_transcript" ? FAILURE_COOLDOWN_MS * 4 : FAILURE_COOLDOWN_MS;
      failureCooldown.set(row.key, Date.now() + cool);
    }
  }

  console.log(
    `[session-transcript-index-auto] candidates=${result.candidates.length} indexed=${result.indexed} skipped=${result.skipped} failed=${result.failed}`
  );
}
