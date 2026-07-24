import {
  effectivePanelHome,
  NotesStore,
  recordTrackedExecutionActivity,
  recordTrackedExecutionIdle,
  startDesktopExecutionTracking,
  type AgentSession
} from "@agent-resume/core";
import { loadSettings } from "@agent-resume/core";
import { loadPanelDbPaths } from "./panelDatabases";

let store: NotesStore | null = null;
let storeKey = "";

async function context() {
  const settings = await loadSettings();
  const paths = await loadPanelDbPaths(settings);
  const panelHome = effectivePanelHome(settings);
  const key = `${paths.catalogDb}::${panelHome}`;
  if (!store || storeKey !== key) {
    store = new NotesStore(paths.catalogDb, panelHome);
    await store.initialize();
    storeKey = key;
  }
  return { settings, notesStore: store, catalogDb: paths.catalogDb, desktopDb: paths.desktopDb };
}

function enabled(settings: Awaited<ReturnType<typeof loadSettings>>): boolean {
  return settings.desktop?.autoSessionExecutionNotes === true;
}

export async function trackOpenedSessionExecution(session: AgentSession): Promise<void> {
  const ctx = await context();
  if (!enabled(ctx.settings)) return;
  await startDesktopExecutionTracking(ctx, session);
}

export async function trackSyncedSessionExecutions(sessions: AgentSession[]): Promise<void> {
  const ctx = await context();
  if (!enabled(ctx.settings)) return;
  for (const session of sessions) {
    await recordTrackedExecutionActivity(ctx, session);
  }
  await recordTrackedExecutionIdle(ctx);
}

export function invalidateSessionExecutionNotesStore(): void {
  store = null;
  storeKey = "";
}
