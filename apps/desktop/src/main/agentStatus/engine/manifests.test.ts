/**
 * Golden test for the bundled rules: every fixture under `fixtures/<agent>/` is
 * judged by that agent's manifest and must land on the state in `expected.json`.
 *
 * This is the regression net for screen detection. When a rule is added or
 * loosened, a fixture must say what it is expected to do — "it looked fine when
 * I tried it" does not survive the next agent release.
 *
 * The test reads the manifests from `src/`; the daemon reads the copy the
 * desktop build places next to the compiled engine.
 */

import { readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "./evaluate";
import { createManifestRegistry } from "./registry";
import type { AgentKind } from "../types";

type Expectation = {
  /** Expected settled agent state, or null when no rule should match. */
  state: "blocked" | "working" | "idle" | "unknown" | null;
  cursorHidden?: boolean;
  oscTitle?: string;
  oscProgress?: string;
  /** Optional: the rule that must win, so a fixture pins the reason too. */
  rule?: string;
  /** Optional: the manifest layer that rule was authored in. */
  manifest?: string;
  /** Optional: assert the rule's display flags. */
  skip?: boolean;
  visibleIdle?: boolean;
  visibleWorking?: boolean;
  visibleBlocker?: boolean;
};

const engineDir = path.join(process.cwd(), "src", "main", "agentStatus", "engine");
const manifestsDir = path.join(engineDir, "manifests");
const fixturesDir = path.join(engineDir, "fixtures");
const expected = JSON.parse(readFileSync(path.join(fixturesDir, "expected.json"), "utf8")) as Record<
  string,
  Expectation
>;

function fixtureCases(): { agent: string; caseName: string; key: string }[] {
  const cases: { agent: string; caseName: string; key: string }[] = [];
  for (const agent of readdirSync(fixturesDir, { withFileTypes: true })) {
    if (!agent.isDirectory()) continue;
    for (const file of readdirSync(path.join(fixturesDir, agent.name))) {
      if (!file.endsWith(".txt")) continue;
      const caseName = file.replace(/\.txt$/, "");
      cases.push({ agent: agent.name, caseName, key: `${agent.name}/${caseName}` });
    }
  }
  return cases;
}

function registry() {
  return createManifestRegistry({ dir: manifestsDir });
}

const cases = fixtureCases();

describe("bundled manifests", () => {
  it("ships a usable manifest for the generic fallback", () => {
    expect(registry().forAgent("unknown")).not.toBeNull();
    expect(registry().warnings()).toEqual([]);
  });

  it("loads every bundled manifest without warnings", () => {
    const summaries = registry().summaries();
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) {
      expect(summary.rules).toBeGreaterThan(0);
      expect(summary.version).toMatch(/\d/);
    }
  });

  it("has a fixture for every manifest", () => {
    const covered = new Set(cases.map((entry) => entry.agent));
    for (const summary of registry().summaries()) {
      expect(covered.has(summary.id), `no fixtures for manifest ${summary.id}`).toBe(true);
    }
  });

  it("expects every fixture in expected.json", () => {
    for (const entry of cases) {
      expect(expected[entry.key], `missing expectation for ${entry.key}`).toBeDefined();
    }
  });

  it("layers an agent's own rules over the base rules", () => {
    const claude = registry().forAgent("claude");
    expect(claude?.id).toBe("claude");
    const ids = claude!.rules.map((rule) => rule.id);
    // Own rules first (higher precedence on a tie), then the base layer.
    expect(ids.indexOf("live_prompt_box")).toBeLessThan(ids.indexOf("option_list"));
    expect(ids).toContain("permission_dialog_allow");
    const layers = registry().layersFor("claude").map((layer) => layer.id);
    expect(layers).toEqual(["claude", "generic"]);
  });

  it("falls back to the base rules alone for an agent without a manifest", () => {
    const fallback = registry().forAgent("gemini" as never);
    expect(fallback?.id).toBe("generic");
    expect(registry().layersFor("gemini" as never).map((layer) => layer.id)).toEqual(["generic"]);
  });

  for (const entry of cases) {
    it(`${entry.key} → ${expected[entry.key]?.state ?? "no match"}`, () => {
      const expectation = expected[entry.key]!;
      const manifest = registry().forAgent(entry.agent as AgentKind);
      expect(manifest, `no manifest for ${entry.agent}`).not.toBeNull();
      const screenText = readFileSync(path.join(fixturesDir, entry.agent, `${entry.caseName}.txt`), "utf8");
      const result = evaluateRules(manifest!, {
        paneId: 1,
        at: 0,
        screenText,
        cursorHidden: expectation.cursorHidden === true,
        oscTitle: expectation.oscTitle ?? "",
        oscProgress: expectation.oscProgress ?? ""
      });
      expect(result.verdict?.state ?? null).toBe(expectation.state);
      if (expectation.rule) expect(result.verdict?.matchedRule.id).toBe(expectation.rule);
      if (expectation.manifest) expect(result.verdict?.matchedRule.manifest).toBe(expectation.manifest);
      if (expectation.skip !== undefined) expect(result.verdict?.skipStateUpdate).toBe(expectation.skip);
      if (expectation.visibleIdle !== undefined) {
        expect(result.verdict?.visible.idle).toBe(expectation.visibleIdle);
      }
      if (expectation.visibleWorking !== undefined) {
        expect(result.verdict?.visible.working).toBe(expectation.visibleWorking);
      }
      if (expectation.visibleBlocker !== undefined) {
        expect(result.verdict?.visible.blocker).toBe(expectation.visibleBlocker);
      }
    });
  }
});
