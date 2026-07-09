import { getSessionById } from "../catalog/query";
import { AgentProvider } from "../catalog/types";
import { ensureCatalogSchema } from "../catalog/db";
import { randomUUID } from "node:crypto";
import { getSessionGtdStatus, setSessionGtdStatusWithAudit } from "../gtd/store";
import { GtdApplyItem } from "../gtd/types";
import { getMemoryJobStatus, upsertMemoryJob } from "../memory/store";
import { writeSessionTodolistMd } from "../notes/todolist";
import { localDayRange } from "../memory/period";
import { runDailyDigest } from "../memory/daily";
import { catalogDbPath, resolvePanelHome } from "../panelHome";
import { catalogDbFromSettings, effectivePanelHome, loadSettings } from "../settings/store";
import { analyzeMemoryForGtd } from "./analyzeGtd";

export interface RunMemoryGtdSyncOptions {
  panelHome?: string;
  /** If true (default), generate today's daily digest when missing/not ok. */
  ensureDigests?: boolean;
}

export interface RunMemoryGtdSyncResult {
  applied: GtdApplyItem[];
  skipped: string[];
  warnings: string[];
  ensureDigest?: { ran: boolean; jobKey?: string };
  jobKey: string;
}

export async function runMemoryGtdSync(
  options: RunMemoryGtdSyncOptions = {}
): Promise<RunMemoryGtdSyncResult> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = options.panelHome
    ? resolvePanelHome(options.panelHome)
    : effectivePanelHome(settings, options.panelHome);
  const dbPath = options.panelHome
    ? catalogDbPath(panelHome)
    : catalogDbFromSettings(settings, options.panelHome);

  await ensureCatalogSchema(dbPath);

  const jobKey = `gtd_sync:${new Date().toISOString()}`;
  await upsertMemoryJob(dbPath, jobKey, "running");

  const skipped: string[] = [];
  const warnings: string[] = [];
  const applied: GtdApplyItem[] = [];
  let ensureDigest: RunMemoryGtdSyncResult["ensureDigest"] = { ran: false };

  try {
    if (options.ensureDigests !== false) {
      const day = localDayRange();
      const status = await getMemoryJobStatus(dbPath, day.jobKey);
      if (status?.status !== "ok") {
        await runDailyDigest({ panelHome, date: day.label });
        ensureDigest = { ran: true, jobKey: day.jobKey };
      }
    }

    const { proposals, warnings: analyzeWarnings } = await analyzeMemoryForGtd({
      dbPath,
      settings
    });
    warnings.push(...analyzeWarnings);

    if (!proposals.length) {
      await upsertMemoryJob(dbPath, jobKey, "ok");
      return { applied, skipped, warnings, ensureDigest, jobKey };
    }

    for (const p of proposals) {
      const session = await getSessionById(dbPath, p.provider as AgentProvider, p.sessionId);
      if (!session) {
        skipped.push(`missing session ${p.provider}/${p.sessionId}`);
        continue;
      }

      const previous = (await getSessionGtdStatus(dbPath, session.provider, session.id)) ?? null;

      // Direct write (AI-applied) + audit in one SQLite transaction
      await setSessionGtdStatusWithAudit(dbPath, {
        provider: session.provider,
        sessionId: session.id,
        status: p.gtd,
        previousStatus: previous,
        reason: `[AI] ${p.reason}`,
        sourceMemoryIds: p.sourceMemoryIds,
        auditId: randomUUID()
      });

      const todolistPath = await writeSessionTodolistMd({
        panelHome,
        dbPath,
        provider: session.provider,
        sessionId: session.id,
        title: session.title,
        projectPath: session.projectPath,
        gtd: p.gtd,
        reason: p.reason,
        tasks: p.tasks,
        sourceMemoryIds: p.sourceMemoryIds,
        previousStatus: previous
      });

      applied.push({
        provider: session.provider,
        sessionId: session.id,
        previousStatus: previous,
        newStatus: p.gtd,
        reason: p.reason,
        sourceMemoryIds: p.sourceMemoryIds,
        todolistPath,
        title: session.title,
        projectPath: session.projectPath
      });
    }

    await upsertMemoryJob(dbPath, jobKey, "ok");
    return { applied, skipped, warnings, ensureDigest, jobKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertMemoryJob(dbPath, jobKey, "error", message);
    throw error;
  }
}
