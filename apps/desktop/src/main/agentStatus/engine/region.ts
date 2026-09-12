/**
 * Regions: which slice of a pane's visible state a rule reads.
 *
 * Agent TUIs are mostly chat, and chat contains the very words an approval
 * dialog uses ("Allow", "yes", "continue"). Reading the right slice — the bottom
 * of the screen, or what sits under the last horizontal rule — is what keeps a
 * rule from matching a sentence someone typed yesterday.
 *
 * Pure string slicing; no terminal, no state.
 */

import type { PaneTelemetry } from "../types";

/** Every region a manifest may name, with its parameter form. */
export const REGIONS = [
  "whole_recent",
  "bottom_non_empty_lines",
  "top_non_empty_lines",
  "after_last_horizontal_rule",
  "osc_title",
  "osc_progress"
] as const;

export type RegionName = (typeof REGIONS)[number];

const REGION_NAMES = new Set<string>(REGIONS);

/** `bottom_non_empty_lines(12)` is valid; `bottom_non_empty_lines` is not. */
export function isRegionName(value: string): boolean {
  const base = value.includes("(") ? value.slice(0, value.indexOf("(")) : value;
  if (!REGION_NAMES.has(base.trim())) return false;
  return base === "bottom_non_empty_lines" || base === "top_non_empty_lines"
    ? /\([1-9]\d*\)$/.test(value.trim())
    : true;
}

export type RegionResolution = {
  name: string;
  text: string;
};

/** Lines that are nothing but rule characters: a TUI dialog separator. */
const HORIZONTAL_RULE = /^\s*[─━═—_=-]{3,}\s*$/;

export function resolveRegion(
  telemetry: Pick<PaneTelemetry, "screenText" | "oscTitle" | "oscProgress"> | undefined,
  region: string
): RegionResolution | null {
  const text = telemetry?.screenText ?? "";
  const trimmed = region.trim();

  if (trimmed === "osc_title") return { name: trimmed, text: telemetry?.oscTitle ?? "" };
  if (trimmed === "osc_progress") return { name: trimmed, text: telemetry?.oscProgress ?? "" };
  if (trimmed === "whole_recent") return { name: trimmed, text };

  if (trimmed.startsWith("bottom_non_empty_lines(")) {
    const count = parseCount(trimmed);
    return count == null ? null : { name: trimmed, text: lastNonEmptyLines(text, count) };
  }
  if (trimmed.startsWith("top_non_empty_lines(")) {
    const count = parseCount(trimmed);
    return count == null ? null : { name: trimmed, text: firstNonEmptyLines(text, count) };
  }
  if (trimmed === "after_last_horizontal_rule") {
    return { name: trimmed, text: afterLastHorizontalRule(text) };
  }
  return null;
}

function parseCount(region: string): number | null {
  const match = region.match(/\(([1-9]\d*)\)$/);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

function nonEmptyLines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim().length > 0);
}

function lastNonEmptyLines(text: string, count: number): string {
  return nonEmptyLines(text).slice(-count).join("\n");
}

function firstNonEmptyLines(text: string, count: number): string {
  return nonEmptyLines(text).slice(0, count).join("\n");
}

function afterLastHorizontalRule(text: string): string {
  const lines = text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (HORIZONTAL_RULE.test(lines[index] ?? "")) return lines.slice(index + 1).join("\n");
  }
  // No rule on screen means no dialog region; an empty region cannot match.
  return "";
}
