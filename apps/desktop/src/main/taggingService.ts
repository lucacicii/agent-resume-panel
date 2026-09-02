import { app } from "electron";
import {
  effectivePanelHome,
  loadSettings,
  resolveAutoTaggingSettings,
  runAutoTagging
} from "@agent-resume/core";
import { enqueueDesktopBackgroundWork, shouldRunDesktopBackgroundWork } from "./backgroundWork";
import { loadPanelDbPaths } from "./panelDatabases";
import { recordAppError } from "./appErrorLog";

/** Background cadence: tagging is intentionally not a foreground poll. */
const TICK_INTERVAL_MS = 5 * 60_000;
const FAILURE_COOLDOWN_MS = 20 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let startGeneration = 0;
/** entityType:entityId → do-not-retry-until ms */
const failureCooldown = new Map<string, number>();

export function stopAutoTaggingService(): void {
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

export function startAutoTaggingService(): void {
  stopAutoTaggingService();
  const generation = ++startGeneration;
  void loadSettings().then((settings) => {
    if (generation !== startGeneration || !resolveAutoTaggingSettings(settings).enabled) return;
    timer = setInterval(() => scheduleAutoTagging(0), TICK_INTERVAL_MS);
    scheduleAutoTagging(15_000);
  }).catch((error) => void recordAppError({ source: "auto-tagging", error }));
}

/**
 * Debounced schedule after session sync, note write, or settings change.
 */
export function scheduleAutoTagging(delayMs = 3_000): void {
  if (pending) {
    clearTimeout(pending);
  }
  pending = setTimeout(() => {
    pending = null;
    void runAutoTaggingSafe();
  }, Math.max(0, delayMs));
}

async function runAutoTaggingSafe(): Promise<void> {
  if (!shouldRunDesktopBackgroundWork()) return;
  if (inFlight) {
    return inFlight;
  }
  inFlight = enqueueDesktopBackgroundWork(runAutoTaggingTick)
    .catch((error) => {
      void recordAppError({ source: "auto-tagging", error });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

async function runAutoTaggingTick(): Promise<void> {
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

  const result = await runAutoTagging({
    catalogDb: paths.catalogDb,
    desktopDb: paths.desktopDb,
    settings,
    panelHome: effectivePanelHome(settings),
    systemLocale: app.getLocale(),
    nowMs: now,
    skipKeys
  });

  if (result.skippedReason) {
    if (result.skippedReason !== "none_eligible") {
      console.log(`[auto-tagging] skip: ${result.skippedReason}`);
    } else if (result.decay && result.decay.markedObsolete > 0) {
      console.log(
        `[auto-tagging] decay scanned=${result.decay.scanned} obsolete=${result.decay.markedObsolete}`
      );
    }
    return;
  }

  for (const fail of result.failed) {
    failureCooldown.set(fail.key, Date.now() + FAILURE_COOLDOWN_MS);
  }

  console.log(
    `[auto-tagging] candidates=${result.candidates.length} tagged=${result.tagged} failed=${result.failed.length}` +
      (result.decay ? ` decayObsolete=${result.decay.markedObsolete}` : "")
  );
}
