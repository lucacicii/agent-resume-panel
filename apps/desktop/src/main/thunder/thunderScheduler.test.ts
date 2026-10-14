/**
 * The four defects that made "计划" unreliable, each pinned by a test.
 *
 * These run against a real `desktop.db` under a temp panel home, because the
 * bugs were all in the interaction between the in-memory run map and the stored
 * rows — a mocked database would have hidden every one of them.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const panelHome = fs.mkdtempSync(path.join(os.tmpdir(), "sched-defects-"));

// The scheduler resolves its database through `@agent-resume/core`'s panel
// paths, which read `AGENT_RESUME_PANEL_HOME`. Set it before the module graph
// loads so every test in this file shares one throwaway home.
process.env.AGENT_RESUME_PANEL_HOME = panelHome;
process.env.AGENT_RESUME_AGENT_STATUS_DAEMON = "0";

// `thunderScheduler` imports `electron` only for `BrowserWindow` broadcasting.
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] }
}));

// Point every database resolution at the throwaway panel home. The scheduler
// calls `loadPanelDbPaths()` with no hint, so overriding the module is what keeps
// the real `~/.agent-resume-panel/desktop.db` out of these tests.
vi.mock("../panelDatabases", async () => {
  const core = await import("@agent-resume/core");
  return {
    loadPanelDbPaths: async () =>
      core.preparePanelDatabasesFromSettings(panelHome)
  };
});

// The daemon is never spawned in these tests; the client is only referenced.
vi.mock("./thunderClient", () => ({
  getThunderClient: () => ({
    runTask: vi.fn(async () => ({ finalContent: "ok", finishReason: "Stop" })),
    cancelTask: vi.fn(async () => true),
    cleanup: vi.fn()
  }),
  ThunderClient: class {}
}));

// The module under test is loaded in `beforeAll` rather than via a top-level
// await: this project compiles the main process as CommonJS, where TLA is not
// available, and `tsc` checks this file. `vi.mock` calls above are hoisted, so
// the mocks are in place before the import runs.
type Scheduler = typeof import("./thunderScheduler");
type Core = typeof import("@agent-resume/core");

let createSchedule: Scheduler["createSchedule"];
let getSchedule: Scheduler["getSchedule"];
let updateSchedule: Scheduler["updateSchedule"];
let listSchedules: Scheduler["listSchedules"];
let reconcileInterruptedRuns: Scheduler["reconcileInterruptedRuns"];
let checkDueSchedules: Scheduler["checkDueSchedules"];
let computeNextRun: Scheduler["computeNextRun"];

let core: Core;

beforeAll(async () => {
  const mod = await import("./thunderScheduler");
  createSchedule = mod.createSchedule;
  getSchedule = mod.getSchedule;
  updateSchedule = mod.updateSchedule;
  listSchedules = mod.listSchedules;
  reconcileInterruptedRuns = mod.reconcileInterruptedRuns;
  checkDueSchedules = mod.checkDueSchedules;
  computeNextRun = mod.computeNextRun;
  core = await import("@agent-resume/core");
});

async function db(): Promise<string> {
  const { desktopDb } = await core.preparePanelDatabasesFromSettings(panelHome);
  return desktopDb;
}

async function runSqlite(dbPath: string, sql: string): Promise<void> {
  await core.runSqlite(dbPath, sql);
}

async function runSqliteJson<T>(dbPath: string, sql: string): Promise<T[] | null> {
  return core.runSqliteJson<T>(dbPath, sql);
}

async function rawSchedules(): Promise<
  Array<{ id: string; last_status: string | null; next_run_at_ms: number | null; catch_up: string | null }>
> {
  const d = await db();
  return (await runSqliteJson(d, "SELECT * FROM thunder_schedules")) || [];
}

beforeEach(async () => {
  const d = await db();
  await runSqlite(d, "DELETE FROM thunder_schedule_runs;");
  await runSqlite(d, "DELETE FROM thunder_schedules;");
});

describe("D1 · cron is really parsed", () => {
  it("stores a next run that matches the expression, not an hour later", async () => {
    const created = await createSchedule({
      name: "weekday sweep",
      prompt: "check",
      triggerType: "cron",
      triggerValue: "0 9 * * 1-5",
      enabled: true
    });

    expect(created.nextRunAtMs).toBeDefined();
    const next = new Date(created.nextRunAtMs!);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect([1, 2, 3, 4, 5]).toContain(next.getDay());
  });

  it("refuses to store an unparseable cron expression", async () => {
    await expect(
      createSchedule({
        name: "broken",
        prompt: "check",
        triggerType: "cron",
        triggerValue: "not a cron at all",
        enabled: true
      })
    ).rejects.toThrow(/Invalid cron/i);
  });

  it("refuses an expression that can never fire", async () => {
    await expect(
      createSchedule({
        name: "never",
        prompt: "check",
        triggerType: "cron",
        triggerValue: "0 0 30 2 *",
        enabled: true
      })
    ).rejects.toThrow(/Invalid cron/i);
  });
});

describe("D3 · an interrupted run is reconciled on startup", () => {
  it("clears a stuck 'running' status and re-arms the schedule", async () => {
    const created = await createSchedule({
      name: "stuck",
      prompt: "check",
      triggerType: "interval",
      triggerValue: "1h",
      enabled: true
    });

    const d = await db();
    // Simulate a panel killed mid-run: the row says running, nothing is in flight.
    await runSqlite(d, "UPDATE thunder_schedules SET last_status = 'running' WHERE id = '" + created.id + "';");

    let rows = await rawSchedules();
    expect(rows[0].last_status).toBe("running");

    await reconcileInterruptedRuns();

    rows = await rawSchedules();
    expect(rows[0].last_status).toBe("failed");
    expect(rows[0].next_run_at_ms).not.toBeNull();

    const refreshed = await getSchedule(created.id);
    expect(refreshed?.lastError).toMatch(/Interrupted/i);
  });

  it("closes the orphaned run row so history cannot show an endless run", async () => {
    const created = await createSchedule({
      name: "stuck2",
      prompt: "check",
      triggerType: "interval",
      triggerValue: "1h",
      enabled: true
    });
    const d = await db();
    await runSqlite(
      d,
      `INSERT INTO thunder_schedule_runs (id, schedule_id, status, trigger_source, prompt, started_at_ms, logs_json)
       VALUES ('run_orphan', '${created.id}', 'running', 'schedule', 'check', 1, '[]');`
    );

    await reconcileInterruptedRuns();

    const runs =
      (await runSqliteJson<{ status: string; error: string | null }>(
        d,
        "SELECT status, error FROM thunder_schedule_runs WHERE id = 'run_orphan';"
      )) || [];
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toMatch(/Interrupted/i);
  });

  it("is a no-op when nothing is stale", async () => {
    const created = await createSchedule({
      name: "healthy",
      prompt: "check",
      triggerType: "interval",
      triggerValue: "1h",
      enabled: true
    });
    await reconcileInterruptedRuns();
    const refreshed = await getSchedule(created.id);
    expect(refreshed?.lastStatus).toBe("idle");
  });
});

describe("D2 · one running schedule does not starve the others", () => {
  it("fires every due schedule, not just the first", async () => {
    const now = Date.now();

    // Three schedules, all overdue, none of them currently running.
    const a = await createSchedule({
      name: "a",
      prompt: "check a",
      triggerType: "interval",
      triggerValue: "1h",
      enabled: true
    });
    const b = await createSchedule({
      name: "b",
      prompt: "check b",
      triggerType: "interval",
      triggerValue: "1h",
      enabled: true
    });
    const c = await createSchedule({
      name: "c",
      prompt: "check c",
      triggerType: "interval",
      triggerValue: "1h",
      enabled: true
    });

    const d = await db();
    await runSqlite(
      d,
      `UPDATE thunder_schedules SET last_run_at_ms = ${now - 7200_000}, next_run_at_ms = ${now - 3600_000};`
    );

    await checkDueSchedules();
    // `startRun` is fire-and-forget; give the microtask queue a turn.
    await new Promise((r) => setTimeout(r, 50));

    const runs =
      (await runSqliteJson<{ schedule_id: string }>(
        d,
        "SELECT schedule_id FROM thunder_schedule_runs;"
      )) || [];
    const started = new Set(runs.map((r) => r.schedule_id));

    // Before the fix, a single `last_status = 'running'` row short-circuited the
    // loop and only one schedule ever started.
    expect(started.has(a.id)).toBe(true);
    expect(started.has(b.id)).toBe(true);
    expect(started.has(c.id)).toBe(true);
  });

  it("does not double-fire a schedule that is already running", async () => {
    const created = await createSchedule({
      name: "once",
      prompt: "check",
      triggerType: "interval",
      triggerValue: "1h",
      enabled: true
    });
    const d = await db();
    const now = Date.now();
    await runSqlite(
      d,
      `UPDATE thunder_schedules SET last_run_at_ms = ${now - 7200_000}, next_run_at_ms = ${now - 3600_000};`
    );

    await checkDueSchedules();
    await new Promise((r) => setTimeout(r, 50));
    // Second tick while the first run is still in flight.
    await checkDueSchedules();
    await new Promise((r) => setTimeout(r, 50));

    const runs =
      (await runSqliteJson<{ id: string }>(
        d,
        `SELECT id FROM thunder_schedule_runs WHERE schedule_id = '${created.id}';`
      )) || [];
    expect(runs.length).toBe(1);
  });
});

describe("D4 · missed trigger points are counted, not silently forgiven", () => {
  it("defaults to skipping and does not replay a backlog", async () => {
    const now = Date.now();
    const created = await createSchedule({
      name: "no-catchup",
      prompt: "check",
      triggerType: "interval",
      triggerValue: "1h",
      enabled: true
    });

    const d = await db();
    // Six hours overdue = six missed hourly points.
    await runSqlite(
      d,
      `UPDATE thunder_schedules SET last_run_at_ms = ${now - 6 * 3600_000}, next_run_at_ms = ${now - 3600_000};`
    );

    await checkDueSchedules();
    await new Promise((r) => setTimeout(r, 80));

    const runs =
      (await runSqliteJson<{ trigger_source: string }>(
        d,
        `SELECT trigger_source FROM thunder_schedule_runs WHERE schedule_id = '${created.id}';`
      )) || [];
    // `skip` fires exactly once (the ordinary overdue path), not six times.
    expect(runs.length).toBe(1);
    expect(runs[0].trigger_source).toBe("schedule");
  });

  it("replays every missed point when catchUp is 'all'", async () => {
    const now = Date.now();
    const created = await createSchedule({
      name: "catchup-all",
      prompt: "check",
      triggerType: "interval",
      triggerValue: "1h",
      catchUp: "all",
      enabled: true
    });

    const d = await db();
    // Three whole intervals missed.
    await runSqlite(
      d,
      `UPDATE thunder_schedules SET last_run_at_ms = ${now - 3 * 3600_000}, next_run_at_ms = ${now - 3600_000};`
    );

    await checkDueSchedules();
    await new Promise((r) => setTimeout(r, 120));

    const runs =
      (await runSqliteJson<{ trigger_source: string }>(
        d,
        `SELECT trigger_source FROM thunder_schedule_runs WHERE schedule_id = '${created.id}';`
      )) || [];
    expect(runs.length).toBe(3);
    expect(runs.every((r) => r.trigger_source === "catch_up")).toBe(true);
  });

  it("persists and round-trips the catchUp and sessionMode choices", async () => {
    const created = await createSchedule({
      name: "roundtrip",
      prompt: "check",
      triggerType: "interval",
      triggerValue: "1h",
      catchUp: "once",
      sessionMode: "fresh",
      enabled: true
    });
    expect(created.catchUp).toBe("once");
    expect(created.sessionMode).toBe("fresh");

    const updated = await updateSchedule(created.id, { catchUp: "all" });
    expect(updated.catchUp).toBe("all");
    // An unrelated update must not silently reset the other field.
    expect(updated.sessionMode).toBe("fresh");

    const listed = await listSchedules();
    expect(listed[0].catchUp).toBe("all");
    expect(listed[0].sessionMode).toBe("fresh");
  });

  it("leaves a schedule with no lastRunAtMs alone on the first tick", async () => {
    const created = await createSchedule({
      name: "brand-new",
      prompt: "check",
      triggerType: "interval",
      triggerValue: "1h",
      catchUp: "all",
      enabled: true
    });
    // A schedule that has never run has nothing to catch up on; it should take
    // the ordinary path, not replay a phantom backlog.
    const d = await db();
    await runSqlite(d, `UPDATE thunder_schedules SET next_run_at_ms = ${Date.now() - 1000};`);

    await checkDueSchedules();
    await new Promise((r) => setTimeout(r, 60));

    const runs =
      (await runSqliteJson<{ trigger_source: string }>(
        d,
        `SELECT trigger_source FROM thunder_schedule_runs WHERE schedule_id = '${created.id}';`
      )) || [];
    expect(runs.length).toBe(1);
    expect(runs[0].trigger_source).toBe("schedule");
  });
});

describe("registry hygiene", () => {
  it("keeps computeNextRun re-exported for callers that still import it here", () => {
    expect(computeNextRun("manual", "")).toBeUndefined();
  });
});
