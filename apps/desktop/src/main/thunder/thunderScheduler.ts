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
  type ScheduleStatus
} from "@agent-resume/core";
import { loadPanelDbPaths } from "../panelDatabases";
import { getThunderClient, ThunderClient } from "./thunderClient";
import type { ThunderObservedEvent } from "./thunderProtocol";

let schedulerTimer: NodeJS.Timeout | null = null;
const runningTaskMap = new Map<string, { runId: string; taskId: string }>();

interface ScheduleRow {
  id: string;
  name: string;
  prompt: string;
  workspace_dir: string | null;
  model: string | null;
  trigger_type: string;
  trigger_value: string;
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
 * Calculate the next run timestamp based on trigger type and value.
 */
export function computeNextRun(
  triggerType: ThunderSchedule["triggerType"],
  triggerValue: string,
  fromTimeMs = Date.now()
): number | undefined {
  if (triggerType === "manual") return undefined;

  if (triggerType === "interval") {
    // Value can be minutes, e.g. "15", "30", "60", "120", or "1h", "24h"
    let minutes = 60;
    const val = triggerValue.trim().toLowerCase();
    if (val.endsWith("m")) minutes = parseInt(val, 10) || 60;
    else if (val.endsWith("h")) minutes = (parseInt(val, 10) || 1) * 60;
    else if (val.endsWith("d")) minutes = (parseInt(val, 10) || 1) * 1440;
    else minutes = parseInt(val, 10) || 60;

    if (minutes < 1) minutes = 1;
    return fromTimeMs + minutes * 60_000;
  }

  if (triggerType === "daily") {
    // Value is "HH:mm", e.g. "09:00"
    const parts = triggerValue.split(":");
    const hour = parseInt(parts[0] || "9", 10);
    const min = parseInt(parts[1] || "0", 10);

    const target = new Date(fromTimeMs);
    target.setHours(hour, min, 0, 0);

    if (target.getTime() <= fromTimeMs) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  if (triggerType === "cron") {
    // Fallback simple hourly increment if not standard parsed
    return fromTimeMs + 60 * 60_000;
  }

  return undefined;
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
  const nextRunAtMs = enabled ? computeNextRun(input.triggerType, input.triggerValue, now) : undefined;

  const sql = `
    INSERT INTO thunder_schedules (
      id, name, prompt, workspace_dir, model, trigger_type, trigger_value,
      enabled, last_run_at_ms, last_status, last_error, last_output,
      next_run_at_ms, created_at_ms, updated_at_ms
    ) VALUES (
      ${sqlStr(id)},
      ${sqlStr(input.name.trim())},
      ${sqlStr(input.prompt.trim())},
      ${sqlStrNullable(input.workspaceDir?.trim())},
      ${sqlStrNullable(input.model?.trim())},
      ${sqlStr(input.triggerType)},
      ${sqlStr(input.triggerValue.trim())},
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

  const nextRunAtMs = enabled ? computeNextRun(triggerType, triggerValue, now) : undefined;

  const sql = `
    UPDATE thunder_schedules SET
      name = ${sqlStr(name)},
      prompt = ${sqlStr(prompt)},
      workspace_dir = ${sqlStrNullable(workspaceDir)},
      model = ${sqlStrNullable(model)},
      trigger_type = ${sqlStr(triggerType)},
      trigger_value = ${sqlStr(triggerValue)},
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

  runningTaskMap.delete(runId);
  broadcastEvent("schedule:status-changed", { scheduleId: "", runId, status: "cancelled" });
  return cancelled;
}

async function startRun(schedule: ThunderSchedule, triggerSource: "schedule" | "manual"): Promise<{ runId: string }> {
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

  runningTaskMap.set(runId, { runId, taskId });

  broadcastEvent("schedule:status-changed", {
    scheduleId: schedule.id,
    runId,
    status: "running"
  });

  // Background execution without blocking caller
  void executeRun(schedule, runId, taskId);

  return { runId };
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

async function checkDueSchedules(): Promise<void> {
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
      // Don't spawn if already executing
      let alreadyRunning = false;
      for (const [_, val] of runningTaskMap) {
        // Check if this schedule is running
        if (row.last_status === "running") {
          alreadyRunning = true;
          break;
        }
      }
      if (!alreadyRunning) {
        void startRun(schedule, "schedule");
      }
    }
  } catch (err) {
    console.error("[thunderScheduler:checkDueSchedules]", err);
  }
}

export function startThunderScheduler(): void {
  stopThunderScheduler();
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
