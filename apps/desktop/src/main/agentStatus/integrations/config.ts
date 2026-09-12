/**
 * Editing the hook configuration of agents we do not own.
 *
 * The rules here matter more than the code: a user's `~/.claude/settings.json`
 * may contain hooks from other tools, comments are impossible in JSON but TOML
 * has them, and an installer that reformats or drops unrelated keys is a bug
 * report waiting to happen. So:
 *
 *   - unknown keys are preserved exactly (values are edited in place);
 *   - we only ever add or remove entries whose command points at our wrapper;
 *   - a file we cannot parse is left alone and reported, never rewritten.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";

export type HookCommandEntry = {
  type: "command";
  command: string;
  timeout: number;
};

export type HookGroup = {
  matcher?: string;
  hooks: HookCommandEntry[];
};

export type JsonObject = Record<string, unknown>;

export type JsonReadResult =
  | { ok: true; value: JsonObject; existed: boolean }
  | { ok: false; error: string };

export function readJsonObject(file: string): JsonReadResult {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { ok: true, value: {}, existed: false };
  }
  if (!raw.trim()) return { ok: true, value: {}, existed: true };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "top level is not an object" };
    }
    return { ok: true, value: parsed as JsonObject, existed: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Canonical serialization, used for "did anything change" comparisons. */
export function canonicalJson(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Write the file, unless the canonical form is byte-identical to `previous`.
 *
 * `previous` must be taken *before* mutating the object (see `canonicalJson`):
 * comparing a mutated object against itself silently skips the write, which
 * made uninstall a no-op.
 *
 * @returns true when the file was written.
 */
export function writeJsonObjectIfChanged(
  file: string,
  next: JsonObject,
  previous: string
): boolean {
  const serialized = canonicalJson(next);
  if (previous === serialized) return false;
  const temporary = `${file}.agent-resume.tmp`;
  writeFileSync(temporary, serialized, { mode: 0o600 });
  renameSync(temporary, file);
  return true;
}

export function ensureHooksObject(container: JsonObject): JsonObject {
  const existing = container.hooks;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as JsonObject;
  }
  const hooks: JsonObject = {};
  container.hooks = hooks;
  return hooks;
}

/**
 * Add one command hook for an event, in the nested shape both Claude and Codex
 * use: `{ "<Event>": [ { matcher, hooks: [ { type, command, timeout } ] } ] }`.
 *
 * @returns true when the file changed.
 */
export function ensureCommandHook(
  hooks: JsonObject,
  event: string,
  command: string,
  timeoutSeconds: number,
  matcher?: string
): boolean {
  const existing = hooks[event];
  // Someone else's shape for this event: leave it alone rather than replace it.
  if (existing !== undefined && !Array.isArray(existing)) return false;
  const list = Array.isArray(existing) ? (existing as unknown[]) : [];
  if (list.some((entry) => groupHasCommand(entry, command))) return false;
  const group: HookGroup = {
    ...(matcher ? { matcher } : {}),
    hooks: [{ type: "command", command, timeout: timeoutSeconds }]
  };
  list.push(group);
  hooks[event] = list;
  return true;
}

/**
 * Remove every entry whose command is ours.
 *
 * Groups left without hooks are dropped; a group with other tools' hooks is kept.
 *
 * @returns true when the file changed.
 */
export function removeOurHooks(hooks: JsonObject, isOurs: (command: string) => boolean): boolean {
  let changed = false;
  for (const event of Object.keys(hooks)) {
    const entries = hooks[event];
    if (!Array.isArray(entries)) continue;
    const kept: unknown[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        kept.push(entry);
        continue;
      }
      const group = entry as { hooks?: unknown };
      if (!Array.isArray(group.hooks)) {
        kept.push(entry);
        continue;
      }
      const remaining = group.hooks.filter((hook) => {
        const command = (hook as { command?: unknown })?.command;
        return !(typeof command === "string" && isOurs(command));
      });
      if (remaining.length === group.hooks.length) {
        kept.push(entry);
        continue;
      }
      changed = true;
      if (remaining.length) kept.push({ ...(entry as object), hooks: remaining });
    }
    if (kept.length) {
      hooks[event] = kept;
    } else if (entries.length) {
      delete hooks[event];
      changed = true;
    }
  }
  return changed;
}

/** How many hook entries point at our wrapper. */
export function countOurHooks(hooks: JsonObject, isOurs: (command: string) => boolean): number {
  let count = 0;
  for (const entries of Object.values(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const group = entry as { hooks?: unknown };
      if (!Array.isArray(group?.hooks)) continue;
      for (const hook of group.hooks) {
        const command = (hook as { command?: unknown })?.command;
        if (typeof command === "string" && isOurs(command)) count += 1;
      }
    }
  }
  return count;
}

function groupHasCommand(entry: unknown, command: string): boolean {
  const group = entry as { hooks?: unknown };
  if (!Array.isArray(group?.hooks)) return false;
  return group.hooks.some((hook) => (hook as { command?: unknown })?.command === command);
}
