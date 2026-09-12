/**
 * Rule evaluation.
 *
 * Every rule is evaluated every tick — not just until one matches — because
 * `status.explain` has to answer "why *not* this rule" as well as "why this
 * one". The cost is a handful of regexes over a few kilobytes.
 *
 * The verdict is the highest-priority match. A rule may also declare
 * `skipStateUpdate`, which is a statement about the *screen* ("this is a viewer,
 * not the live prompt") rather than about the pane.
 */

import { resolveRegion } from "./region";
import type { AgentState, DetectionSource, EvaluatedRule, PaneTelemetry } from "../types";
import type { CompiledGate, CompiledManifest, CompiledRule } from "./manifest";

export type ScreenVerdict = {
  state: AgentState;
  /** OSC-derived rules are reported as `osc`, everything else as `screen`. */
  source: DetectionSource;
  matchedRule: { id: string; priority: number; region: string; manifest: string };
  visible: { idle: boolean; blocker: boolean; working: boolean };
  skipStateUpdate: boolean;
  reason: string;
};

export type RulesEvaluation = {
  verdict: ScreenVerdict | null;
  evaluated: EvaluatedRule[];
};

type RuleContext = {
  regionText: string;
  /** Lowercased once per rule, because text matching is case-insensitive. */
  regionTextLower: string;
  lines: string[];
  cursorHidden: boolean;
};

export function evaluateRules(
  manifest: CompiledManifest,
  telemetry: PaneTelemetry | undefined
): RulesEvaluation {
  const evaluated: EvaluatedRule[] = [];
  let best: { rule: CompiledRule; reason: string } | null = null;

  for (const rule of manifest.rules) {
    const region = resolveRegion(telemetry, rule.region);
    if (!region) {
      evaluated.push(evaluateRow(rule, false, `unknown region ${rule.region}`, 0));
      continue;
    }
    const context: RuleContext = {
      regionText: region.text,
      regionTextLower: region.text.toLowerCase(),
      lines: region.text.split("\n"),
      cursorHidden: telemetry?.cursorHidden === true
    };
    const outcome = matchRule(rule, context);
    evaluated.push(evaluateRow(rule, outcome.matched, outcome.reason, region.text.length));
    if (!outcome.matched) continue;
    if (!best || rule.priority > best.rule.priority) {
      best = { rule, reason: outcome.reason };
    }
  }

  if (!best) return { verdict: null, evaluated };

  const source: DetectionSource = best.rule.region.startsWith("osc_") ? "osc" : "screen";
  return {
    verdict: {
      state: best.rule.state,
      source,
      matchedRule: {
        id: best.rule.id,
        priority: best.rule.priority,
        region: best.rule.region,
        manifest: best.rule.manifest
      },
      visible: {
        idle: best.rule.visibleIdle,
        blocker: best.rule.visibleBlocker,
        working: best.rule.visibleWorking
      },
      skipStateUpdate: best.rule.skipStateUpdate,
      reason: `rule ${best.rule.id} matched: ${best.reason}`
    },
    evaluated
  };
}

function evaluateRow(
  rule: CompiledRule,
  matched: boolean,
  reason: string,
  regionBytes: number
): EvaluatedRule {
  return {
    id: rule.id,
    manifest: rule.manifest,
    priority: rule.priority,
    region: rule.region,
    state: rule.state,
    matched,
    reason,
    evidence: {
      contains: rule.contains,
      regex: rule.regex.map((pattern) => pattern.source),
      lineRegex: rule.lineRegex.map((pattern) => pattern.source),
      regionBytes
    }
  };
}

/**
 * All conditions of a rule must hold; the first failure explains itself.
 *
 * Text is matched twice: once against the region as read, and — when that fails
 * and the region has more than one line — once against a view with line breaks
 * collapsed. The mirror already undoes soft wraps, so what is left here is a
 * literal the application itself broke across lines; either way, a literal the
 * user can read should match. Per-line patterns keep using the real lines, so
 * `atLeast` still counts visible rows.
 */
export function matchRule(rule: CompiledRule, context: RuleContext): { matched: boolean; reason: string } {
  const direct = matchRuleOnce(rule, context);
  if (direct.matched) return direct;
  const joined = joinedContext(context);
  if (!joined) return direct;
  const tolerant = matchRuleOnce(rule, joined);
  if (!tolerant.matched) return direct;
  return { matched: true, reason: `${tolerant.reason} (matched across a line wrap)` };
}

function matchRuleOnce(rule: CompiledRule, context: RuleContext): { matched: boolean; reason: string } {
  const missingContains = missingText(rule.contains, context);
  if (missingContains) return { matched: false, reason: `missing text ${JSON.stringify(missingContains)}` };

  const missingRegex = rule.regex.find((pattern) => !pattern.test(context.regionText));
  if (missingRegex) return { matched: false, reason: `regex ${missingRegex.source} did not match` };

  if (rule.lineRegex.length) {
    const hits = countMatchingLines(context.lines, rule.lineRegex);
    if (rule.atLeast != null) {
      if (hits < rule.atLeast) {
        return { matched: false, reason: `${hits} line(s) matched, ${rule.atLeast} required` };
      }
    } else if (hits === 0) {
      return { matched: false, reason: "no line matched" };
    }
  }

  if (rule.cursorHidden && !context.cursorHidden) {
    return { matched: false, reason: "cursor is visible" };
  }

  for (const gate of rule.all) {
    const outcome = matchGate(gate, context);
    if (!outcome.matched) return { matched: false, reason: `all gate failed: ${outcome.reason}` };
  }
  // Vetoes are checked before the `any` alternatives: a matching alternative
  // must never short-circuit a rule that an exclusion already disqualified.
  for (const gate of rule.not) {
    const outcome = matchGate(gate, context);
    if (outcome.matched) return { matched: false, reason: `excluded by not gate: ${outcome.reason}` };
  }
  if (rule.any.length) {
    const hit = rule.any.map((gate) => matchGate(gate, context)).find((outcome) => outcome.matched);
    if (!hit) return { matched: false, reason: "no any gate matched" };
    return { matched: true, reason: hit.reason };
  }
  return { matched: true, reason: describeGate(rule) };
}

export function matchGate(gate: CompiledGate, context: RuleContext): { matched: boolean; reason: string } {
  const missingContains = missingText(gate.contains, context);
  if (missingContains) return { matched: false, reason: `missing text ${JSON.stringify(missingContains)}` };

  const missingRegex = gate.regex.find((pattern) => !pattern.test(context.regionText));
  if (missingRegex) return { matched: false, reason: `regex ${missingRegex.source} did not match` };

  if (gate.lineRegex.length && countMatchingLines(context.lines, gate.lineRegex) === 0) {
    return { matched: false, reason: "no line matched" };
  }

  for (const nested of gate.all) {
    const outcome = matchGate(nested, context);
    if (!outcome.matched) return { matched: false, reason: `all gate failed: ${outcome.reason}` };
  }
  for (const nested of gate.not) {
    const outcome = matchGate(nested, context);
    if (outcome.matched) return { matched: false, reason: `excluded by not gate: ${outcome.reason}` };
  }
  if (gate.any.length) {
    const hit = gate.any.map((nested) => matchGate(nested, context)).find((outcome) => outcome.matched);
    if (!hit) return { matched: false, reason: "no any gate matched" };
    return { matched: true, reason: hit.reason };
  }
  return { matched: true, reason: describeGate(gate) };
}

/**
 * The same region with line breaks collapsed into single spaces, or null when
 * the region has nothing to collapse.
 */
function joinedContext(context: RuleContext): RuleContext | null {
  if (context.lines.length < 2) return null;
  const joined = context.lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
  if (!joined || joined === context.regionText) return null;
  return { ...context, regionText: joined, regionTextLower: joined.toLowerCase() };
}

/** First needle the region does not contain, or undefined when all are present. */
function missingText(needles: readonly string[], context: RuleContext): string | undefined {
  return needles.find((needle) => !context.regionTextLower.includes(needle.toLowerCase()));
}

/** How many lines match at least one pattern. */
function countMatchingLines(lines: readonly string[], patterns: readonly RegExp[]): number {
  let hits = 0;
  for (const line of lines) {
    if (patterns.some((pattern) => pattern.test(line))) hits += 1;
  }
  return hits;
}

/** What a matching gate actually looked at, so `explain` reads like a sentence. */
function describeGate(gate: {
  contains: string[];
  regex: RegExp[];
  lineRegex: RegExp[];
  all: unknown[];
  any: unknown[];
  cursorHidden?: boolean;
  atLeast?: number | null;
}): string {
  const parts: string[] = [];
  if (gate.contains.length) parts.push(`text ${gate.contains.map((value) => JSON.stringify(value)).join(" + ")}`);
  if (gate.regex.length) parts.push(`${gate.regex.length} regex(es)`);
  if (gate.lineRegex.length) {
    parts.push(gate.atLeast != null ? `>=${gate.atLeast} matching line(s)` : "a matching line");
  }
  if (gate.all.length) parts.push(`${gate.all.length} all gate(s)`);
  if (gate.any.length) parts.push(`${gate.any.length} any alternative(s)`);
  if (gate.cursorHidden) parts.push("a hidden cursor");
  return parts.length ? parts.join(", ") : "no conditions";
}
