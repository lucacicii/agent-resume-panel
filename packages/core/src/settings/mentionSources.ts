/**
 * The pure part of workspace mentions: the id shape, the pack cap, and the
 * per-kind `@` switches.
 *
 * Split out of `mentions.ts` so the renderer can import these *values* from the
 * browser-safe entry — `mentions.ts` also normalizes paths and therefore pulls
 * in `node:path`. Nothing here may import a `node:*` module.
 */
import {
  DEFAULT_WORKBENCH_MENTION_SOURCES,
  type WorkbenchMentionSources
} from "./types";

export { DEFAULT_WORKBENCH_MENTION_SOURCES };
export type { WorkbenchMentionSources };

/** A mention id: letters, digits, `_`, `-`. The `@` is not stored. */
export const COMPOSER_MENTION_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const COMPOSER_MENTIONS_MAX = 50;

export function isMentionRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A per-kind `@` menu switch. Every kind defaults to on except catalog projects,
 * which are collected from session history rather than chosen — so they only
 * appear when the user asks for them.
 */
export function normalizeWorkbenchMentionSources(
  value: WorkbenchMentionSources | unknown
): WorkbenchMentionSources {
  const record = isMentionRecord(value) ? value : {};
  const on = (key: keyof WorkbenchMentionSources): boolean =>
    typeof record[key] === "boolean"
      ? (record[key] as boolean)
      : DEFAULT_WORKBENCH_MENTION_SOURCES[key];
  return {
    workspaces: on("workspaces"),
    tasks: on("tasks"),
    notes: on("notes"),
    sessions: on("sessions"),
    projects: on("projects")
  };
}
