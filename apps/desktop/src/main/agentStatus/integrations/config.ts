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

/** Write only when something changed, so re-installing does not touch mtimes. */
export function writeJsonObjectIfChanged(
  file: string,
  next: JsonObject,
  previousRaw: JsonObject | null
): boolean {
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  if (previousRaw && `${JSON.stringify(previousRaw, null, 2)}\n` === serialized) return false;
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

const TOML_FEATURES_HEADER = "[features]";

/**
 * Turn a feature flag on inside `[features]`, creating the table when needed.
 *
 * Line-based on purpose: rewriting TOML through a parser would reformat a user's
 * file (and drop their comments).
 */
export function ensureTomlFeature(content: string, key: string): string {
  const lines = content.split("\n");
  const trailingNewline = content.endsWith("\n");
  let sectionStart = -1;
  let sectionEnd = lines.length;
  let keyIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) {
      if (sectionStart >= 0) {
        sectionEnd = index;
        break;
      }
      if (`[${header[1]?.trim()}]` === TOML_FEATURES_HEADER) sectionStart = index;
      continue;
    }
    if (sectionStart >= 0 && new RegExp(`^\\s*${key}\\s*=`).test(line)) keyIndex = index;
  }

  if (keyIndex >= 0) {
    if (new RegExp(`^\\s*${key}\\s*=\\s*true\\s*$`).test(lines[keyIndex] ?? "")) return content;
    lines[keyIndex] = `${key} = true`;
    return joinLines(lines, trailingNewline);
  }

  if (sectionStart >= 0) {
    lines.splice(sectionStart + 1, 0, `${key} = true`);
    return joinLines(lines, trailingNewline);
  }

  const trimmed = lines.join("\n").trimEnd();
  const suffix = `${TOML_FEATURES_HEADER}\n${key} = true`;
  return trimmed ? `${trimmed}\n\n${suffix}\n` : `${suffix}\n`;
}

/** Turn a feature flag off, removing the line (and a table left empty). */
export function removeTomlFeature(content: string, key: string): string {
  const lines = content.split("\n");
  const trailingNewline = content.endsWith("\n");
  const out: string[] = [];
  let inFeatures = false;
  let featureHeaderIndex = -1;
  let removed = false;

  for (const line of lines) {
    const header = line.trim().match(/^\[([^\]]+)\]$/);
    if (header) {
      inFeatures = `[${header[1]?.trim()}]` === TOML_FEATURES_HEADER;
      if (inFeatures) featureHeaderIndex = out.length;
    }
    if (inFeatures && new RegExp(`^\\s*${key}\\s*=`).test(line)) {
      removed = true;
      continue;
    }
    out.push(line);
  }
  if (!removed) return content;

  // Drop a now-empty [features] table so the file does not accumulate husks.
  if (featureHeaderIndex >= 0) {
    const body = out.slice(featureHeaderIndex + 1);
    const nextHeader = body.findIndex((candidate) => /^\s*\[[^\]]+\]\s*$/.test(candidate));
    const section = nextHeader >= 0 ? body.slice(0, nextHeader) : body;
    if (!section.some((line) => line.trim())) {
      out.splice(featureHeaderIndex, 1 + section.length);
    }
  }
  return joinLines(out, trailingNewline).replace(/\n{3,}/g, "\n\n");
}

function joinLines(lines: string[], trailingNewline: boolean): string {
  const joined = lines.join("\n");
  return trailingNewline ? joined : joined.replace(/\n$/, "");
}
