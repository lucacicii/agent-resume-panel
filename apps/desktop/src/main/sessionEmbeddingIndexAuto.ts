import {
  effectivePanelHome,
  loadSettings,
  resolveSessionEmbeddingIndexSettings,
  runAutoSessionEmbeddings
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";
import { recordAppError } from "./appErrorLog";

const TICK_INTERVAL_MS = 5 * 60_000;
const FAILURE_COOLDOWN_MS = 15 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let startGeneration = 0;
/** provider:id → do-not-retry-until ms */
const failureCooldown = new Map<string, number>();

export function stopSessionEmbeddingIndexAuto(): void {
  startGeneration += 1;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
}

export function startSessionEmbeddingIndexAuto(): void {
  stopSessionEmbeddingIndexAuto();
  const generation = ++startGeneration;
  void loadSettings().then((settings) => {
    if (generation !== startGeneration || !resolveSessionEmbeddingIndexSettings(settings).enabled) return;
    timer = setInterval(() => scheduleSessionEmbeddingIndexAuto(0), TICK_INTERVAL_MS);
    scheduleSessionEmbeddingIndexAuto(20_000);
  }).catch((error) => void recordAppError({ source: "session-embedding-index-auto", error }));
}

/** Debounced schedule after session sync or settings change. */
export function scheduleSessionEmbeddingIndexAuto(delayMs = 4_000): void {
  if (pending) {
    clearTimeout(pending);
  }
  pending = setTimeout(() => {
    pending = null;
    void runEmbeddingIndexSafe();
  }, Math.max(0, delayMs));
}

async function runEmbeddingIndexSafe(): Promise<void> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = runEmbeddingIndex()
    .catch((error) => {
      void recordAppError({ source: "session-embedding-index-auto", error });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function runEmbeddingIndex(): Promise<void> {
  const settings = await loadSettings();
  const paths = await loadPanelDbPaths(settings);
  void effectivePanelHome(settings);
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

  const result = await runAutoSessionEmbeddings({
    catalogDb: paths.catalogDb,
    desktopDb: paths.desktopDb,
    settings,
    nowMs: now,
    skipKeys
  });

  if (result.skippedReason) {
    if (result.skippedReason !== "none_eligible") {
      console.log(`[session-embedding-index-auto] skip: ${result.skippedReason}`);
    }
    return;
  }

  for (const row of result.results) {
    if (row.result.skipped === "embed_failed") {
      failureCooldown.set(row.key, Date.now() + FAILURE_COOLDOWN_MS);
    }
  }

  console.log(
    `[session-embedding-index-auto] candidates=${result.candidates.length} embedded=${result.embedded} skipped=${result.skipped} failed=${result.failed}`
  );
}
