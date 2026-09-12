/**
 * Detection manifests: the rule data every agent's screen is judged against.
 *
 * A manifest is JSON, not code, so rules can be reviewed as data, replaced by a
 * local override, and (later) refreshed without shipping a build. The schema is
 * deliberately small: a rule declares *where* to look (region), *how strong* it
 * is (priority), *what it claims* (state), and *which evidence* must hold.
 *
 * Two schema ideas do most of the false-positive work:
 *   - `atLeast`: "at least N lines look like options" is what separates a real
 *     menu from prose that happens to contain an arrow; and
 *   - `not`: every strong rule documents the neighbouring dialog it must not
 *     swallow.
 *
 * Pure: parses, validates, and compiles. Never touches the filesystem.
 */

import { REGIONS, isRegionName } from "./region";
import type { AgentState } from "../types";

/** Bumped when the schema gains a field older builds cannot honour. */
export const MANIFEST_ENGINE_VERSION = 2;

const AGENT_STATES: readonly AgentState[] = ["idle", "working", "blocked", "unknown"];

/** Raw schema, as authored in JSON. */
export type ManifestGate = {
  all?: ManifestGate[];
  any?: ManifestGate[];
  not?: ManifestGate[];
  contains?: string[];
  regex?: string[];
  lineRegex?: string[];
};

export type ManifestRule = ManifestGate & {
  id: string;
  state: AgentState;
  priority?: number;
  region: string;
  /** Rows of context the region needs, for `bottom_non_empty_lines(n)`. */
  visibleIdle?: boolean;
  visibleBlocker?: boolean;
  visibleWorking?: boolean;
  /** The pane is showing a viewer: keep the previous state instead of judging. */
  skipStateUpdate?: boolean;
  /** Require this many lines to match `lineRegex` (default: at least one). */
  atLeast?: number;
  /** Require a hidden cursor (DEC private mode 25). */
  cursorHidden?: boolean;
};

export type AgentManifestFile = {
  id: string;
  version: string;
  engine: number;
  /** Free-form note about what this manifest covers; JSON has no comments. */
  description?: string;
  aliases?: string[];
  rules: ManifestRule[];
};

/** Compiled predicates. Regexes are built once, at load time. */
export type CompiledGate = {
  contains: string[];
  regex: RegExp[];
  lineRegex: RegExp[];
  all: CompiledGate[];
  any: CompiledGate[];
  not: CompiledGate[];
};

export type CompiledRule = {
  id: string;
  state: AgentState;
  priority: number;
  region: string;
  visibleIdle: boolean;
  visibleBlocker: boolean;
  visibleWorking: boolean;
  skipStateUpdate: boolean;
  atLeast: number | null;
  cursorHidden: boolean;
  contains: string[];
  regex: RegExp[];
  lineRegex: RegExp[];
  all: CompiledGate[];
  any: CompiledGate[];
  not: CompiledGate[];
};

export type CompiledManifest = {
  id: string;
  version: string;
  engine: number;
  rules: CompiledRule[];
};

export type ManifestCompileResult =
  | { ok: true; manifest: CompiledManifest; warnings: string[] }
  | { ok: false; error: string };

export function compileManifest(raw: unknown): ManifestCompileResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "manifest is not an object" };
  const file = raw as Partial<AgentManifestFile>;
  const id = typeof file.id === "string" ? file.id.trim() : "";
  const version = typeof file.version === "string" ? file.version.trim() : "";
  const engine = typeof file.engine === "number" ? file.engine : MANIFEST_ENGINE_VERSION;
  if (!id) return { ok: false, error: "manifest has no id" };
  if (!version) return { ok: false, error: `manifest ${id} has no version` };
  if (engine > MANIFEST_ENGINE_VERSION) {
    return { ok: false, error: `manifest ${id} needs engine ${engine}; this build speaks ${MANIFEST_ENGINE_VERSION}` };
  }
  if (!Array.isArray(file.rules)) return { ok: false, error: `manifest ${id} has no rules array` };

  const warnings: string[] = [];
  const rules: CompiledRule[] = [];
  const seen = new Set<string>();
  for (const [index, rawRule] of file.rules.entries()) {
    const result = compileRule(rawRule, `${id}[${index}]`, warnings);
    if (!result) continue;
    if (seen.has(result.id)) {
      warnings.push(`manifest ${id}: duplicate rule id "${result.id}" ignored`);
      continue;
    }
    seen.add(result.id);
    rules.push(result);
  }
  if (!rules.length) return { ok: false, error: `manifest ${id} has no usable rules` };

  return { ok: true, manifest: { id, version, engine, rules }, warnings };
}

function compileRule(raw: unknown, label: string, warnings: string[]): CompiledRule | null {
  if (!raw || typeof raw !== "object") {
    warnings.push(`${label}: not an object`);
    return null;
  }
  const rule = raw as Partial<ManifestRule>;
  const id = typeof rule.id === "string" ? rule.id.trim() : "";
  if (!id) {
    warnings.push(`${label}: missing rule id`);
    return null;
  }
  const state = rule.state;
  if (!state || !AGENT_STATES.includes(state)) {
    warnings.push(`${label}: invalid state`);
    return null;
  }
  const region = typeof rule.region === "string" ? rule.region : "whole_recent";
  if (!isRegionName(region)) {
    warnings.push(`${label} (${id}): unknown region "${region}"`);
    return null;
  }
  const gate = compileGate(rule, label, warnings);
  if (!gate) return null;
  return {
    id,
    state,
    priority: typeof rule.priority === "number" && Number.isFinite(rule.priority) ? rule.priority : 0,
    region,
    visibleIdle: rule.visibleIdle === true,
    visibleBlocker: rule.visibleBlocker === true,
    visibleWorking: rule.visibleWorking === true,
    skipStateUpdate: rule.skipStateUpdate === true,
    atLeast: typeof rule.atLeast === "number" && rule.atLeast > 0 ? Math.floor(rule.atLeast) : null,
    cursorHidden: rule.cursorHidden === true,
    ...gate
  };
}

function compileGate(raw: ManifestGate, label: string, warnings: string[]): CompiledGate | null {
  return {
    contains: stringList(raw.contains),
    regex: compileRegexes(raw.regex, label, warnings),
    lineRegex: compileRegexes(raw.lineRegex, label, warnings),
    all: compileGates(raw.all, label, warnings),
    any: compileGates(raw.any, label, warnings),
    not: compileGates(raw.not, label, warnings)
  };
}

function compileGates(
  raw: ManifestGate[] | undefined,
  label: string,
  warnings: string[]
): CompiledGate[] {
  if (!Array.isArray(raw)) return [];
  const gates: CompiledGate[] = [];
  for (const gate of raw) {
    if (!gate || typeof gate !== "object") {
      warnings.push(`${label}: ignoring a non-object gate`);
      continue;
    }
    const compiled = compileGate(gate, label, warnings);
    if (compiled) gates.push(compiled);
  }
  return gates;
}

/**
 * A broken pattern must never take the engine down: an unusable regex is
 * reported and dropped, so the manifest keeps working with one rule less.
 *
 * Patterns are compiled case-insensitive and unicode-aware: agent TUIs render
 * the same copy in mixed case across versions, and matching is about shapes, not
 * spelling. `contains` follows the same rule (see `evaluate.ts`).
 */
function compileRegexes(values: string[] | undefined, label: string, warnings: string[]): RegExp[] {
  if (!Array.isArray(values)) return [];
  const compiled: RegExp[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    try {
      compiled.push(new RegExp(value, "iu"));
    } catch {
      try {
        compiled.push(new RegExp(value, "i"));
      } catch {
        warnings.push(`${label}: ignoring invalid regex ${JSON.stringify(value)}`);
      }
    }
  }
  return compiled;
}

function stringList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export const MANIFEST_REGIONS = REGIONS;
