import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ActiveSessionDot } from "../activeSessionDots";
import { WORKBENCH_SESSION_DOT_STATUSES } from "../../../../shared/workbenchSelection";
import { SESSION_DOT_STATUSES, type SessionDotStatus } from "./types";
import { LIVE_RANK, needsYou, rank, rollupDot } from "./taskRollup";

function dot(
  sessionKey: string,
  status: SessionDotStatus,
  extra: Partial<ActiveSessionDot> = {}
): ActiveSessionDot {
  return {
    paneKey: extra.paneKey ?? `pane:${sessionKey}`,
    projectPath: extra.projectPath ?? "/p",
    title: extra.title ?? sessionKey,
    sessionKey,
    status
  };
}

function byKey(...dots: ActiveSessionDot[]): ReadonlyMap<string, ActiveSessionDot> {
  return new Map(dots.map((entry) => [entry.sessionKey, entry]));
}

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function filesDefining(pattern: RegExp): string[] {
  return listSourceFiles(SRC_ROOT)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC_ROOT, file).replaceAll("\\", "/"))
    .sort();
}

describe("taskRollup", () => {
  it("picks the highest LIVE_RANK among a task's sessions", () => {
    const dots = byKey(
      dot("s-open", "open"),
      dot("s-running", "running"),
      dot("s-error", "error"),
      dot("s-awaiting", "awaiting_user")
    );
    expect(rollupDot({ work: { sessions: ["s-open", "s-running", "s-error"] } }, dots)?.sessionKey).toBe("s-error");
    expect(rollupDot({ work: { sessions: ["s-running", "s-awaiting"] } }, dots)?.status).toBe("awaiting_user");
    expect(rollupDot({ work: { sessions: ["missing", "s-open"] } }, dots)?.status).toBe("open");
    expect(rollupDot({ work: { sessions: ["missing"] } }, dots)).toBeUndefined();
    expect(rollupDot({ work: {} }, dots)).toBeUndefined();
  });

  it("orders LIVE_RANK across all five SessionDotStatus values", () => {
    expect(LIVE_RANK.awaiting_user).toBeGreaterThan(LIVE_RANK.error);
    expect(LIVE_RANK.error).toBeGreaterThan(LIVE_RANK.connecting);
    expect(LIVE_RANK.connecting).toBeGreaterThan(LIVE_RANK.running);
    expect(LIVE_RANK.running).toBeGreaterThan(LIVE_RANK.open);
    expect(new Set(Object.keys(LIVE_RANK))).toEqual(new Set(SESSION_DOT_STATUSES));
    const ordered = (Object.entries(LIVE_RANK) as Array<[SessionDotStatus, number]>)
      .sort((a, b) => b[1] - a[1])
      .map(([status]) => status);
    expect(ordered).toEqual(["awaiting_user", "error", "connecting", "running", "open"]);
  });

  it("sorts as live rank desc, then updatedAtMs desc", () => {
    const dots = byKey(
      dot("s-awaiting", "awaiting_user"),
      dot("s-running", "running"),
      dot("s-open", "open")
    );
    const items = [
      { id: "open-new", updatedAtMs: 100, work: { sessions: ["s-open"] } },
      { id: "awaiting-old", updatedAtMs: 50, work: { sessions: ["s-awaiting"] } },
      { id: "running", updatedAtMs: 90, work: { sessions: ["s-running"] } },
      { id: "open-old", updatedAtMs: 80, work: { sessions: ["s-open"] } },
      { id: "awaiting-new", updatedAtMs: 70, work: { sessions: ["s-awaiting"] } },
      { id: "idle", updatedAtMs: 200, work: { sessions: ["missing"] } }
    ];
    const sorted = [...items].sort((a, b) => rank(b, dots) - rank(a, dots)).map((item) => item.id);
    expect(sorted).toEqual(["awaiting-new", "awaiting-old", "running", "idle", "open-new", "open-old"]);
  });

  it("treats awaiting_user as the needs_you criterion", () => {
    expect(needsYou(dot("s1", "awaiting_user"))).toBe(true);
    expect(needsYou(dot("s2", "error"))).toBe(false);
    expect(needsYou(dot("s3", "connecting"))).toBe(false);
    expect(needsYou(dot("s4", "running"))).toBe(false);
    expect(needsYou(dot("s5", "open"))).toBe(false);
    expect(needsYou(undefined)).toBe(false);
  });

  it("defines rollupDot, LIVE_RANK, and rank in exactly one source file each", () => {
    expect(filesDefining(/\bexport const LIVE_RANK\b/)).toEqual([
      "renderer-react/features/workbench/sessionStatus/taskRollup.ts"
    ]);
    expect(filesDefining(/\bexport function rollupDot\b/)).toEqual([
      "renderer-react/features/workbench/sessionStatus/taskRollup.ts"
    ]);
    expect(filesDefining(/\bexport function rank\b/)).toEqual([
      "renderer-react/features/workbench/sessionStatus/taskRollup.ts"
    ]);
  });

  it("declares the session dot vocabulary only in the shared module", () => {
    expect(filesDefining(/\bexport const WORKBENCH_SESSION_DOT_STATUSES\b/)).toEqual([
      "shared/workbenchSelection.ts"
    ]);
    // Same object, not a copy: a renderer-only status is impossible, and adding
    // one to the shared list breaks every Record<SessionDotStatus, …> map on
    // both sides of the process boundary at compile time.
    expect(SESSION_DOT_STATUSES).toBe(WORKBENCH_SESSION_DOT_STATUSES);
  });
});
