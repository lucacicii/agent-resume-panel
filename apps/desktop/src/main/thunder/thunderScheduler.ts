import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import {
  ensureDesktopDbSchema,
  escapeSqlLiteral,
  runSqlite,
  runSqliteJson,
  type ThunderSchedule,
  type ThunderScheduleInput,
  type ThunderScheduleRun,
  type ThunderScheduleRunLogEntry,
  type ScheduleRunTriggerSource,
  type ScheduleSessionMode,
  type ScheduleStatus
} from "@agent-resume/core";
import { loadPanelDbPaths } from "../panelDatabases";
import { getThunderClient, ThunderClient } from "./thunderClient";
import type { ThunderObservedEvent } from "./thunderProtocol";
import {
  computeNextRun,
  enumerateMissedRuns,
  selectCatchUpRuns,
  validateCron,
  type CatchUpPolicy
} from "../../shared/scheduleTriggers";

export { computeNextRun } from "../../shared/scheduleTriggers";

let schedulerTimer: NodeJS.Timeout | null = null;
/**
 * In-flight runs, keyed by `runId`.
 *
 * The schedule is carried alongside the task id because cancelling needs it:
 * the schedule row has to be released from `running` and given a fresh
 * `next_run_at_ms`, and neither is derivable from a run id.
 */
const runningTaskMap = new Map<
  string,
  { runId: string; taskId: string; schedule: ThunderSchedule }
>();

interface ScheduleRow {
  id: string;
  name: string;
  prompt: string;
  workspace_dir: string | null;
  model: string | null;
  trigger_type: string;
  trigger_value: string;
  catch_up: string | null;
  session_mode: string | null;
  enabled: number;
  last_run_at_ms: number | null;
  last_status: string | null;
  last_error: string | null;
  last_output: string | null;
  next_run_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
}

interface RunRow {
  id: string;
  schedule_id: string;
  status: string;
  trigger_source: string;
  prompt: string;
  workspace_dir: string | null;
  model: string | null;
  output: string | null;
  error: string | null;
  started_at_ms: number;
  finished_at_ms: number | null;
  logs_json: string | null;
}

function rowToSchedule(row: ScheduleRow): ThunderSchedule {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    workspaceDir: row.workspace_dir || undefined,
    model: row.model || undefined,
    triggerType: row.trigger_type as any,
    triggerValue: row.trigger_value,
    catchUp: (row.catch_up as CatchUpPolicy) || undefined,
    sessionMode: (row.session_mode as ScheduleSessionMode) || undefined,
    enabled: Boolean(row.enabled),
    lastRunAtMs: row.last_run_at_ms || undefined,
    lastStatus: (row.last_status as ScheduleStatus) || undefined,
    lastError: row.last_error || undefined,
    lastOutput: row.last_output || undefined,
    nextRunAtMs: row.next_run_at_ms || undefined,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function rowToRun(row: RunRow): ThunderScheduleRun {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    status: row.status as any,
    triggerSource: row.trigger_source as any,
    prompt: row.prompt,
    workspaceDir: row.workspace_dir || undefined,
    model: row.model || undefined,
    output: row.output || undefined,
    error: row.error || undefined,
    startedAtMs: row.started_at_ms,
    finishedAtMs: row.finished_at_ms || undefined,
    logsJson: row.logs_json || undefined
  };
}

/**
 * Reject a trigger the scheduler cannot honour.
 *
 * The editor can (and does) validate live, but the IPC surface is reachable
 * without it, and a schedule stored with an unparseable cron expression would
 * simply never fire — the failure mode this whole module exists to remove.
 */
function assertUsableTrigger(triggerType: ThunderSchedule["triggerType"], triggerValue: string): void {
  if (triggerType !== "cron") return;
  const result = validateCron(triggerValue);
  if (!result.ok) {
    throw new Error(`Invalid cron expression: ${result.error}`);
  }
}

/**
 * The Thunder session a schedule's runs belong to.
 *
 * `pinned` reuses one session per schedule; `fresh` isolates each run. The
 * default is pinned, which keeps the prompt prefix cache-warm and makes a
 * schedule's history readable as a single conversation.
 */
function scheduleSessionId(schedule: ThunderSchedule, runId: string): string {
  // Thunder session ids are opaque; the prefix keeps them recognisable in
  // `~/.thunder/conversations/` next to human chat sessions.
  const base = `sched_${schedule.id.replace(/^sched_/, "")}`;
  return schedule.sessionMode === "fresh" ? `${base}_${runId}` : base;
}

function sqlStr(val: string): string {
  return `'${escapeSqlLiteral(val)}'`;
}

function sqlStrNullable(val: string | undefined | null): string {
  return val ? `'${escapeSqlLiteral(val)}'` : "NULL";
}

async function getDb(): Promise<string> {
  const { desktopDb } = await loadPanelDbPaths();
  await ensureDesktopDbSchema(desktopDb);
  return desktopDb;
}

function broadcastEvent(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

export async function listSchedules(): Promise<ThunderSchedule[]> {
  const db = await getDb();
  const rows = (await runSqliteJson<ScheduleRow>(
    db,
    "SELECT * FROM thunder_schedules ORDER BY created_at_ms DESC"
  )) || [];
  return rows.map(rowToSchedule);
}

export async function getSchedule(id: string): Promise<ThunderSchedule | null> {
  const db = await getDb();
  const rows = (await runSqliteJson<ScheduleRow>(
    db,
    `SELECT * FROM thunder_schedules WHERE id = ${sqlStr(id)} LIMIT 1`
  )) || [];
  return rows[0] ? rowToSchedule(rows[0]) : null;
}

export async function createSchedule(input: ThunderScheduleInput): Promise<ThunderSchedule> {
  const db = await getDb();
  const now = Date.now();
  const id = `sched_${randomUUID()}`;
  const enabled = input.enabled !== false;
  assertUsableTrigger(input.triggerType, input.triggerValue);
  const nextRunAtMs = enabled ? computeNextRun(input.triggerType, input.triggerValue, now) : undefined;

  const sql = `
    INSERT INTO thunder_schedules (
      id, name, prompt, workspace_dir, model, trigger_type, trigger_value,
      catch_up, session_mode, enabled, last_run_at_ms, last_status, last_error, last_output,
      next_run_at_ms, created_at_ms, updated_at_ms
    ) VALUES (
      ${sqlStr(id)},
      ${sqlStr(input.name.trim())},
      ${sqlStr(input.prompt.trim())},
      ${sqlStrNullable(input.workspaceDir?.trim())},
      ${sqlStrNullable(input.model?.trim())},
      ${sqlStr(input.triggerType)},
      ${sqlStr(input.triggerValue.trim())},
      ${sqlStrNullable(input.catchUp)},
      ${sqlStrNullable(input.sessionMode)},
      ${enabled ? 1 : 0},
      NULL,
      'idle',
      NULL,
      NULL,
      ${nextRunAtMs ?? "NULL"},
      ${now},
      ${now}
    );
  `;
  await runSqlite(db, sql);
  const created = await getSchedule(id);
  if (!created) throw new Error("Failed to create schedule");
  return created;
}

export async function updateSchedule(
  id: string,
  input: Partial<ThunderScheduleInput>
): Promise<ThunderSchedule> {
  const existing = await getSchedule(id);
  if (!existing) throw new Error(`Schedule ${id} not found`);

  const db = await getDb();
  const now = Date.now();
  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const prompt = input.prompt !== undefined ? input.prompt.trim() : existing.prompt;
  const workspaceDir = input.workspaceDir !== undefined ? input.workspaceDir.trim() : existing.workspaceDir;
  const model = input.model !== undefined ? input.model.trim() : existing.model;
  const triggerType = input.triggerType || existing.triggerType;
  const triggerValue = input.triggerValue !== undefined ? input.triggerValue.trim() : existing.triggerValue;
  const enabled = input.enabled !== undefined ? input.enabled : existing.enabled;
  const catchUp = input.catchUp !== undefined ? input.catchUp : existing.catchUp;
  const sessionMode =
    input.sessionMode !== undefined ? input.sessionMode : existing.sessionMode;

  // Only validate when the trigger actually changed: an existing row with a
  // legacy/hand-written cron string must stay editable in its other fields
  // rather than becoming unsaveable.
  if (input.triggerType !== undefined || input.triggerValue !== undefined) {
    assertUsableTrigger(triggerType, triggerValue);
  }

  const nextRunAtMs = enabled ? computeNextRun(triggerType, triggerValue, now) : undefined;

  const sql = `
    UPDATE thunder_schedules SET
      name = ${sqlStr(name)},
      prompt = ${sqlStr(prompt)},
      workspace_dir = ${sqlStrNullable(workspaceDir)},
      model = ${sqlStrNullable(model)},
      trigger_type = ${sqlStr(triggerType)},
      trigger_value = ${sqlStr(triggerValue)},
      catch_up = ${sqlStrNullable(catchUp)},
      session_mode = ${sqlStrNullable(sessionMode)},
      enabled = ${enabled ? 1 : 0},
      next_run_at_ms = ${nextRunAtMs ?? "NULL"},
      updated_at_ms = ${now}
    WHERE id = ${sqlStr(id)};
  `;
  await runSqlite(db, sql);
  const updated = await getSchedule(id);
  if (!updated) throw new Error("Failed to update schedule");
  return updated;
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const db = await getDb();
  await runSqlite(db, `DELETE FROM thunder_schedules WHERE id = ${sqlStr(id)}`);
  return true;
}

export async function toggleSchedule(id: string, enabled: boolean): Promise<ThunderSchedule> {
  return updateSchedule(id, { enabled });
}

export async function listScheduleRuns(scheduleId: string, limit = 50): Promise<ThunderScheduleRun[]> {
  const db = await getDb();
  const rows = (await runSqliteJson<RunRow>(
    db,
    `SELECT * FROM thunder_schedule_runs
     WHERE schedule_id = ${sqlStr(scheduleId)}
     ORDER BY started_at_ms DESC
     LIMIT ${Math.max(1, limit)}`
  )) || [];
  return rows.map(rowToRun);
}

export async function getScheduleRun(runId: string): Promise<ThunderScheduleRun | null> {
  const db = await getDb();
  const rows = (await runSqliteJson<RunRow>(
    db,
    `SELECT * FROM thunder_schedule_runs WHERE id = ${sqlStr(runId)} LIMIT 1`
  )) || [];
  return rows[0] ? rowToRun(rows[0]) : null;
}

export async function runScheduleNow(scheduleId: string): Promise<{ runId: string }> {
  const schedule = await getSchedule(scheduleId);
  if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);

  return startRun(schedule, "manual");
}

export async function cancelScheduleRun(runId: string): Promise<boolean> {
  const active = runningTaskMap.get(runId);
  if (!active) return false;

  const client = getThunderClient();
  const cancelled = await client.cancelTask(active.taskId);

  const db = await getDb();
  const now = Date.now();
  await runSqlite(
    db,
    `UPDATE thunder_schedule_runs SET
       status = 'cancelled',
       finished_at_ms = ${now}
     WHERE id = ${sqlStr(runId)};`
  );

  // The schedule row was left at 'running' by `startRun`; clearing it here is
  // what stops a cancelled run from pinning the schedule — and, before the
  // guard fix below, from blocking every other schedule too.
  await runSqlite(
    db,
    `UPDATE thunder_schedules SET
       last_run_at_ms = ${now},
       last_status = 'idle',
       last_error = NULL,
       next_run_at_ms = ${
         active.schedule.enabled
           ? computeNextRun(active.schedule.triggerType, active.schedule.triggerValue, now) ?? "NULL"
           : "NULL"
       },
       updated_at_ms = ${now}
     WHERE id = ${sqlStr(active.schedule.id)};`
  );

  runningTaskMap.delete(runId);
  // `scheduleId` used to be the empty string, so the renderer's
  // `payload.scheduleId === schedule.id` guard never matched and the UI stayed
  // stuck in its running state after a cancel.
  broadcastEvent("schedule:status-changed", {
    scheduleId: active.schedule.id,
    runId,
    status: "cancelled"
  });
  return cancelled;
}

async function startRun(
  schedule: ThunderSchedule,
  triggerSource: ScheduleRunTriggerSource
): Promise<{ runId: string; completion: Promise<void> }> {
  const db = await getDb();
  const now = Date.now();
  const runId = `run_${randomUUID()}`;
  const taskId = `task_${randomUUID()}`;

  console.log(`[thunder-scheduler] Starting run: scheduleId=${schedule.id}, name="${schedule.name}", runId=${runId}, taskId=${taskId}`);

  // Insert run record
  const sql = `
    INSERT INTO thunder_schedule_runs (
      id, schedule_id, status, trigger_source, prompt, workspace_dir,
      model, output, error, started_at_ms, finished_at_ms, logs_json
    ) VALUES (
      ${sqlStr(runId)},
      ${sqlStr(schedule.id)},
      'running',
      ${sqlStr(triggerSource)},
      ${sqlStr(schedule.prompt)},
      ${sqlStrNullable(schedule.workspaceDir)},
      ${sqlStrNullable(schedule.model)},
      NULL,
      NULL,
      ${now},
      NULL,
      '[]'
    );
  `;
  await runSqlite(db, sql);

  // Update schedule status
  await runSqlite(
    db,
    `UPDATE thunder_schedules SET
       last_status = 'running',
       updated_at_ms = ${now}
     WHERE id = ${sqlStr(schedule.id)};`
  );

  runningTaskMap.set(runId, { runId, taskId, schedule });

  broadcastEvent("schedule:status-changed", {
    scheduleId: schedule.id,
    runId,
    status: "running"
  });

  // Background execution without blocking the caller. Handing the promise back
  // lets catch-up sequence its replay; every other caller keeps fire-and-forget
  // semantics by ignoring it.
  const completion = executeRun(schedule, runId, taskId);

  return { runId, completion };
}

async function executeRun(
  schedule: ThunderSchedule,
  runId: string,
  taskId: string
): Promise<void> {
  const client = getThunderClient();
  const logs: ThunderScheduleRunLogEntry[] = [];
  let accumulatedOutput = "";

  const onObserved = (observed: ThunderObservedEvent) => {
    const ev = observed.event;
    const now = Date.now();

    if (ev.type === "token_delta") {
      accumulatedOutput += (ev as any).delta || "";
      logs.push({
        timestamp: now,
        type: "token",
        turn: (ev as any).turn,
        content: (ev as any).delta
      });
    } else if (ev.type === "reasoning_delta") {
      logs.push({
        timestamp: now,
        type: "reasoning",
        turn: (ev as any).turn,
        content: (ev as any).delta
      });
    } else if (ev.type === "tool_exec_start") {
      logs.push({
        timestamp: now,
        type: "tool_start",
        turn: (ev as any).turn,
        toolName: (ev as any).name,
        toolArgs: (ev as any).arguments
      });
    } else if (ev.type === "tool_exec_result") {
      logs.push({
        timestamp: now,
        type: "tool_result",
        turn: (ev as any).turn,
        toolName: (ev as any).name,
        toolResult: (ev as any).result
      });
    } else if (ev.type === "turn_start") {
      logs.push({
        timestamp: now,
        type: "turn",
        turn: (ev as any).turn
      });
    } else if (ev.type === "error") {
      console.error(`[thunder-scheduler:task-error] ${schedule.name}:`, (ev as any).message);
      logs.push({
        timestamp: now,
        type: "error",
        turn: (ev as any).turn,
        content: (ev as any).message
      });
    }

    broadcastEvent("schedule:run-event", {
      scheduleId: schedule.id,
      runId,
      event: ev,
      accumulatedOutput
    });
  };

  try {
    const result = await client.runTask({
      taskId,
      prompt: schedule.prompt,
      workspaceDir: schedule.workspaceDir,
      model: schedule.model,
      // A dedicated session per schedule, so three things hold at once: it never
      // collides with a chat session (the daemon refuses a second task on a
      // session that is busy), the fixed prompt prefix stays cache-warm across
      // repeated runs, and the run's traces land somewhere predictable.
      sessionId: scheduleSessionId(schedule, runId),
      // Unattended: no `ask_user_question`, and an explicit mode so the global
      // `agent.defaultMode` cannot change how schedules behave.
      headless: true,
      mode: "yolo",
      onEvent: onObserved
    });

    const finishedAt = Date.now();
    const finalOutput = result.finalContent || accumulatedOutput;

    if (result.finishReason === "Error" || (!finalOutput && logs.some((l) => l.type === "error"))) {
      const firstErr = logs.find((l) => l.type === "error")?.content || "Thunder task execution failed (FinishReason::Error)";
      throw new Error(firstErr);
    }

    const outputText = finalOutput || "Task completed successfully.";
    const db = await getDb();

    console.log(`[thunder-scheduler] Task completed successfully: scheduleId=${schedule.id}, duration=${finishedAt - schedule.createdAtMs}ms`);

    // Update run
    const updateRunSql = `
      UPDATE thunder_schedule_runs SET
        status = 'completed',
        output = ${sqlStr(outputText)},
        finished_at_ms = ${finishedAt},
        logs_json = ${sqlStr(JSON.stringify(logs.slice(-300)))}
      WHERE id = ${sqlStr(runId)};
    `;
    await runSqlite(db, updateRunSql);

    // Compute next run if enabled
    const nextRun = schedule.enabled
      ? computeNextRun(schedule.triggerType, schedule.triggerValue, finishedAt)
      : undefined;

    const updateSchedSql = `
      UPDATE thunder_schedules SET
        last_run_at_ms = ${finishedAt},
        last_status = 'success',
        last_output = ${sqlStr(outputText.slice(0, 1000))},
        last_error = NULL,
        next_run_at_ms = ${nextRun ?? "NULL"},
        updated_at_ms = ${finishedAt}
      WHERE id = ${sqlStr(schedule.id)};
    `;
    await runSqlite(db, updateSchedSql);

    broadcastEvent("schedule:status-changed", {
      scheduleId: schedule.id,
      runId,
      status: "completed",
      output: outputText
    });
  } catch (err: any) {
    const finishedAt = Date.now();
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[thunder-scheduler] Task failed: scheduleId=${schedule.id}, error=${errorMsg}`);
    const db = await getDb();

    logs.push({
      timestamp: finishedAt,
      type: "error",
      content: errorMsg
    });

    const updateRunSql = `
      UPDATE thunder_schedule_runs SET
        status = 'failed',
        error = ${sqlStr(errorMsg)},
        finished_at_ms = ${finishedAt},
        logs_json = ${sqlStr(JSON.stringify(logs.slice(-300)))}
      WHERE id = ${sqlStr(runId)};
    `;
    await runSqlite(db, updateRunSql);

    const nextRun = schedule.enabled
      ? computeNextRun(schedule.triggerType, schedule.triggerValue, finishedAt)
      : undefined;

    const updateSchedSql = `
      UPDATE thunder_schedules SET
        last_run_at_ms = ${finishedAt},
        last_status = 'failed',
        last_error = ${sqlStr(errorMsg)},
        next_run_at_ms = ${nextRun ?? "NULL"},
        updated_at_ms = ${finishedAt}
      WHERE id = ${sqlStr(schedule.id)};
    `;
    await runSqlite(db, updateSchedSql);

    broadcastEvent("schedule:status-changed", {
      scheduleId: schedule.id,
      runId,
      status: "failed",
      error: errorMsg
    });
  } finally {
    runningTaskMap.delete(runId);
  }
}

/** True when this schedule already has a run in flight. */
function isScheduleRunning(scheduleId: string): boolean {
  for (const entry of runningTaskMap.values()) {
    if (entry.schedule.id === scheduleId) return true;
  }
  return false;
}

/**
 * Release schedules whose `last_status` says `running` but which have no run.
 *
 * A panel killed mid-run (crash, force-quit, power loss) leaves `running` in the
 * row with nothing to ever clear it. That used to be permanent: the row was
 * never retried, and the old guard treated any `running` row as "the scheduler
 * is busy" for *every* schedule. On startup the truth is knowable — nothing is
 * in flight yet — so anything still marked `running` is an interrupted run.
 */
const INTERRUPTED_MESSAGE = "Interrupted: the scheduler stopped before this run finished.";

export async function reconcileInterruptedRuns(): Promise<void> {
  const db = await getDb();
  const now = Date.now();

  // Drive the pass from the RUN rows. Anything still `running` after a restart
  // is by definition not in flight — this process has started nothing yet — and
  // that is true whether or not the parent schedule row was also left running.
  // Keying off the schedule row instead would miss an orphan (a schedule deleted
  // mid-run, say) and leave it claiming to run forever.
  const staleRuns = (await runSqliteJson<{ schedule_id: string }>(
    db,
    `SELECT schedule_id FROM thunder_schedule_runs WHERE status = 'running'`
  )) || [];

  if (staleRuns.length > 0) {
    const scheduleIds = [...new Set(staleRuns.map((row) => row.schedule_id))];
    console.warn(
      `[thunder-scheduler] Marking ${staleRuns.length} interrupted run(s) across ${scheduleIds.length} schedule(s)`
    );

    for (const scheduleId of scheduleIds) {
      await runSqlite(
        db,
        `UPDATE thunder_schedule_runs SET
           status = 'failed',
           error = ${sqlStr(INTERRUPTED_MESSAGE)},
           finished_at_ms = ${now}
         WHERE schedule_id = ${sqlStr(scheduleId)}
           AND status = 'running';`
      );

      // Re-arm the schedule. A row that is gone (deleted mid-run) simply does
      // not match, which is correct: there is no schedule left to re-arm.
      const rows =
        (await runSqliteJson<ScheduleRow>(
          db,
          `SELECT * FROM thunder_schedules WHERE id = ${sqlStr(scheduleId)} LIMIT 1`
        )) || [];
      const schedule = rows[0] ? rowToSchedule(rows[0]) : null;
      if (!schedule) continue;

      await runSqlite(
        db,
        `UPDATE thunder_schedules SET
           last_status = 'failed',
           last_error = ${sqlStr(INTERRUPTED_MESSAGE)},
           next_run_at_ms = ${
             schedule.enabled
               ? computeNextRun(schedule.triggerType, schedule.triggerValue, now) ?? "NULL"
               : "NULL"
           },
           updated_at_ms = ${now}
         WHERE id = ${sqlStr(schedule.id)};`
      );
    }
  }

  // A schedule marked running with no run row behind it is the same lie, reached
  // from the other side: clear it too, so the guard cannot be pinned by a row
  // that will never finish.
  await runSqlite(
    db,
    `UPDATE thunder_schedules SET
       last_status = 'failed',
       last_error = ${sqlStr(INTERRUPTED_MESSAGE)},
       next_run_at_ms = CASE
         WHEN enabled = 1 AND trigger_type != 'manual' THEN ${now}
         ELSE NULL
       END,
       updated_at_ms = ${now}
     WHERE last_status = 'running'
       AND id NOT IN (SELECT schedule_id FROM thunder_schedule_runs WHERE status = 'running');`
  );
}

const CATCH_UP_LIMIT = 100;

/**
 * Fire the trigger points that came due while the scheduler was not running.
 *
 * Without this a schedule is simply overdue on restart and fires once
 * immediately, which conflates "the daily report is late" with "here are the six
 * daily reports you missed". The policy is per-schedule and defaults to `skip`.
 */
async function runCatchUp(schedule: ThunderSchedule, now: number): Promise<boolean> {
  if (schedule.triggerType === "manual") return false;
  if (!schedule.lastRunAtMs) return false;

  const policy: CatchUpPolicy = schedule.catchUp ?? "skip";
  const missed = enumerateMissedRuns(
    schedule.triggerType,
    schedule.triggerValue,
    schedule.lastRunAtMs,
    now,
    CATCH_UP_LIMIT
  );
  const selected = selectCatchUpRuns(missed, policy);
  if (selected.length === 0) return false;

  console.log(
    `[thunder-scheduler] Catch-up for "${schedule.name}": ${selected.length} of ${missed.length} missed run(s), policy=${policy}`
  );

  // Sequentially, and awaited. These runs share one schedule (and, when pinned,
  // one Thunder session), so overlapping them would put two writers on the same
  // conversation — which the daemon refuses outright. Waiting also keeps the
  // replay in trigger order, which is what "in order" has to mean for work like
  // a nightly sync.
  for (let index = 0; index < selected.length; index += 1) {
    // Re-assert the gate each round: `startRun` claims the schedule, and a tick
    // that arrives mid-replay must not slip a second run in.
    if (index > 0 && isScheduleRunning(schedule.id)) break;

    const { completion } = await startRun(schedule, "catch_up");
    await completion;
  }
  return true;
}

export async function checkDueSchedules(): Promise<void> {
  try {
    const db = await getDb();
    const now = Date.now();
    const dueRows = (await runSqliteJson<ScheduleRow>(
      db,
      `SELECT * FROM thunder_schedules
       WHERE enabled = 1
         AND next_run_at_ms IS NOT NULL
         AND next_run_at_ms <= ${now}`
    )) || [];

    for (const row of dueRows) {
      const schedule = rowToSchedule(row);

      // Per-schedule, not per-scheduler. The previous version asked whether *any*
      // row had `last_status = 'running'`, so a single long-running schedule
      // silently starved every other one.
      if (isScheduleRunning(schedule.id)) continue;

      // A schedule that was overdue when the panel started may owe several runs.
      // Claim those first; if the policy declines them, fall through to the
      // ordinary single fire.
      if (await runCatchUp(schedule, now)) continue;

      void startRun(schedule, "schedule");
    }
  } catch (err) {
    console.error("[thunderScheduler:checkDueSchedules]", err);
  }
}

export function startThunderScheduler(): void {
  stopThunderScheduler();

  // Reconcile first: a `running` row left by a previous process is a lie until
  // proven otherwise, and the catch-up walk reads `last_run_at_ms` from these
  // rows. Then tick immediately rather than waiting a full interval, so a
  // schedule that came due while the panel was closed does not sit idle for
  // another 30 seconds.
  void (async () => {
    try {
      await reconcileInterruptedRuns();
    } catch (err) {
      console.error("[thunderScheduler:reconcileInterruptedRuns]", err);
    }
    await checkDueSchedules();
  })();

  // Check due schedules every 30 seconds
  schedulerTimer = setInterval(() => {
    void checkDueSchedules();
  }, 30_000);
}

export function stopThunderScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  const client = getThunderClient();
  client.cleanup();
}
