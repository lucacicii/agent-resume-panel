import { app } from "electron";
import {
  createUiText,
  effectivePanelHome,
  embeddingConfigFromSettings,
  ensureNotesVectorIndex,
  loadSettings,
  type NoteIndexProgressEvent
} from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";

const NOTES_INDEX_INTERVAL_MS = 5 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
let notifyProgress: ((event: NoteIndexProgressEvent) => void) | null = null;

export function stopNotesIndexer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
}

export function startNotesIndexer(
  notify: (event: NoteIndexProgressEvent) => void
): void {
  stopNotesIndexer();
  notifyProgress = notify;
  timer = setInterval(() => scheduleNotesIndex(0), NOTES_INDEX_INTERVAL_MS);
  scheduleNotesIndex(1_000);
}

export function scheduleNotesIndex(delayMs = 1_000): void {
  if (pending) {
    clearTimeout(pending);
  }
  pending = setTimeout(() => {
    pending = null;
    void runNotesIndex().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[notes-indexer]", error);
      const settings = await loadSettings();
      const pt = createUiText(settings, app.getLocale());
      notifyProgress?.({ phase: "error", message: pt("desktop.notes.indexFailed", message) });
    });
  }, Math.max(0, delayMs));
}

async function runNotesIndex(): Promise<void> {
  const settings = await loadSettings();
  const embedding = embeddingConfigFromSettings(settings);
  if (!embedding) {
    return;
  }
  const paths = await loadPanelDbPaths(settings);
  await ensureNotesVectorIndex({
    catalogDb: paths.catalogDb,
    desktopDb: paths.desktopDb,
    panelHome: effectivePanelHome(settings),
    embedding,
    systemLocale: app.getLocale(),
    onProgress: (event) => notifyProgress?.(event)
  });
}