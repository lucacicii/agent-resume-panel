import { randomUUID } from "node:crypto";
import { getSessionById } from "../catalog/query";
import { AgentProvider } from "../catalog/types";
import { preparePanelDatabasesFromSettings } from "../dbPaths";
import { getSessionGtdStatus, setSessionGtdStatusWithAudit } from "../gtd/store";
import { GtdApplyItem, GtdProposal, GtdStatus, isGtdStatus } from "../gtd/types";
import { runDailyDigest } from "../report/daily";
import { localDayRange } from "../report/period";
import { getReportJobStatus, upsertReportJob } from "../report/store";
import { renderSessionTodolistMarkdown, writeSessionTodolistMd } from "../notes/todolist";
import { effectivePanelHome, loadSettings } from "../settings/store";
import { analyzeReportForGtd } from "./analyzeGtd";

export interface RunReportGtdSyncOptions {
  panelHome?: string;
  /** If true (default), generate today's daily digest when missing/not ok. */
  ensureDigests?: boolean;
  /** When set, only analyze these digests (e.g. current card). Skips ensureDigests if provided. */
  reportIds?: string[];
}

export interface GtdPreviewItem {
  provider: string;
  sessionId: string;
  title: string;
  projectPath: string;
  previousGtd: GtdStatus | null;
  proposedGtd: GtdStatus;
  reason: string;
  tasks: string[];
  sourceReportIds: string[];
  /** Markdown that would be written (not yet on disk). */
  todolistPreview: string;
}

export interface PreviewReportGtdSyncResult {
  previewId: string;
  proposals: GtdPreviewItem[];
  skipped: string[];
  warnings: string[];
  ensureDigest?: { ran: boolean; jobKey?: string };
}

export interface ApplyReportGtdSyncOptions {
  panelHome?: string;
  items: Array<{
    provider: string;
    sessionId: string;
    gtd: GtdStatus | string;
    reason: string;
    tasks: string[];
    sourceReportIds: string[];
    title?: string;
    projectPath?: string;
    previousGtd?: GtdStatus | null;
    /** User-edited markdown; written as-is (AI footer ensured). */
    todolistMarkdown?: string;
  }>;
}

export interface ApplyReportGtdSyncResult {
  applied: GtdApplyItem[];
  failed: Array<{ key: string; error: string }>;
  jobKey: string;
}

export interface RunReportGtdSyncResult {
  applied: GtdApplyItem[];
  skipped: string[];
  warnings: string[];
  ensureDigest?: { ran: boolean; jobKey?: string };
  jobKey: string;
}

/**
 * Analyze only — no GTD writes, no todolist.md on disk.
 */
export async function previewReportGtdSync(
  options: RunReportGtdSyncOptions = {}
): Promise<PreviewReportGtdSyncResult> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = effectivePanelHome(settings, options.panelHome);
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);

  const skipped: string[] = [];
  const warnings: string[] = [];
  let ensureDigest: PreviewReportGtdSyncResult["ensureDigest"] = { ran: false };

  const scoped = Boolean(options.reportIds?.length);
  if (!scoped && options.ensureDigests !== false) {
    const day = localDayRange();
    const status = await getReportJobStatus(paths.desktopDb, day.jobKey);
    if (status?.status !== "ok") {
      await runDailyDigest({ panelHome, date: day.label });
      ensureDigest = { ran: true, jobKey: day.jobKey };
    }
  }

  const { proposals, warnings: analyzeWarnings } = await analyzeReportForGtd({
    catalogDb: paths.catalogDb,
    desktopDb: paths.desktopDb,
    settings,
    reportIds: options.reportIds
  });
  warnings.push(...analyzeWarnings);

  const items: GtdPreviewItem[] = [];
  for (const p of proposals) {
    const session = await getSessionById(paths.catalogDb, p.provider as AgentProvider, p.sessionId);
    if (!session) {
      skipped.push(`missing session ${p.provider}/${p.sessionId}`);
      continue;
    }
    const previous = (await getSessionGtdStatus(paths.catalogDb, session.provider, session.id)) ?? null;
    const todolistPreview = renderSessionTodolistMarkdown({
      provider: session.provider,
      sessionId: session.id,
      title: session.title,
      projectPath: session.projectPath,
      gtd: p.gtd,
      reason: p.reason,
      tasks: p.tasks,
      sourceReportIds: p.sourceReportIds,
      previousStatus: previous,
      appliedAtIso: "(pending approval)"
    });

    items.push({
      provider: session.provider,
      sessionId: session.id,
      title: session.title,
      projectPath: session.projectPath,
      previousGtd: previous,
      proposedGtd: p.gtd,
      reason: p.reason,
      tasks: p.tasks,
      sourceReportIds: p.sourceReportIds,
      todolistPreview
    });
  }

  return {
    previewId: randomUUID(),
    proposals: items,
    skipped,
    warnings,
    ensureDigest
  };
}

/**
 * Apply user-approved items: write GTD + todolist.md.
 */
export async function applyReportGtdSync(
  options: ApplyReportGtdSyncOptions
): Promise<ApplyReportGtdSyncResult> {
  const settings = await loadSettings(options.panelHome);
  const panelHome = effectivePanelHome(settings, options.panelHome);
  const paths = await preparePanelDatabasesFromSettings(options.panelHome);

  const jobKey = `gtd_apply:${new Date().toISOString()}`;
  await upsertReportJob(paths.desktopDb, jobKey, "running");

  const applied: GtdApplyItem[] = [];
  const failed: Array<{ key: string; error: string }> = [];

  try {
    for (const raw of options.items || []) {
      const key = `${raw.provider}:${raw.sessionId}`;
      try {
        if (!isGtdStatus(String(raw.gtd))) {
          failed.push({ key, error: `invalid gtd: ${raw.gtd}` });
          continue;
        }
        const gtd = raw.gtd as GtdStatus;
        const session = await getSessionById(paths.catalogDb, raw.provider as AgentProvider, raw.sessionId);
        if (!session) {
          failed.push({ key, error: "session not found" });
          continue;
        }

        const previous =
          raw.previousGtd !== undefined
            ? raw.previousGtd
            : (await getSessionGtdStatus(paths.catalogDb, session.provider, session.id)) ?? null;

        await setSessionGtdStatusWithAudit(paths.catalogDb, paths.desktopDb, {
          provider: session.provider,
          sessionId: session.id,
          status: gtd,
          previousStatus: previous,
          reason: `[AI] ${raw.reason || "approved from preview"}`,
          sourceReportIds: raw.sourceReportIds || [],
          auditId: randomUUID()
        });

        const todolistPath = await writeSessionTodolistMd({
          panelHome,
          dbPath: paths.catalogDb,
          provider: session.provider,
          sessionId: session.id,
          title: raw.title || session.title,
          projectPath: raw.projectPath || session.projectPath,
          gtd,
          reason: raw.reason || "",
          tasks: raw.tasks || [],
          sourceReportIds: raw.sourceReportIds || [],
          previousStatus: previous,
          markdownBody: raw.todolistMarkdown
        });

        applied.push({
          provider: session.provider,
          sessionId: session.id,
          previousStatus: previous,
          newStatus: gtd,
          reason: raw.reason || "",
          sourceReportIds: raw.sourceReportIds || [],
          todolistPath,
          title: session.title,
          projectPath: session.projectPath
        });
      } catch (error) {
        failed.push({
          key,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    await upsertReportJob(paths.desktopDb, jobKey, failed.length && !applied.length ? "error" : "ok");
    return { applied, failed, jobKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertReportJob(paths.desktopDb, jobKey, "error", message);
    throw error;
  }
}

/**
 * @deprecated Prefer previewReportGtdSync + applyReportGtdSync.
 * Still: preview then apply all (no interactive gate).
 */
export async function runReportGtdSync(
  options: RunReportGtdSyncOptions = {}
): Promise<RunReportGtdSyncResult> {
  const preview = await previewReportGtdSync(options);
  if (!preview.proposals.length) {
    return {
      applied: [],
      skipped: preview.skipped,
      warnings: preview.warnings,
      ensureDigest: preview.ensureDigest,
      jobKey: `gtd_sync:${preview.previewId}`
    };
  }

  const apply = await applyReportGtdSync({
    panelHome: options.panelHome,
    items: preview.proposals.map((p) => ({
      provider: p.provider,
      sessionId: p.sessionId,
      gtd: p.proposedGtd,
      reason: p.reason,
      tasks: p.tasks,
      sourceReportIds: p.sourceReportIds,
      title: p.title,
      projectPath: p.projectPath,
      previousGtd: p.previousGtd
    }))
  });

  return {
    applied: apply.applied,
    skipped: preview.skipped,
    warnings: [
      ...preview.warnings,
      ...apply.failed.map((f) => `apply failed ${f.key}: ${f.error}`)
    ],
    ensureDigest: preview.ensureDigest,
    jobKey: apply.jobKey
  };
}

// re-export for typing convenience
export type { GtdProposal };