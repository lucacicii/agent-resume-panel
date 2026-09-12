import { describe, expect, it } from "vitest";
import { evaluateRules, matchGate, matchRule } from "./evaluate";
import { MANIFEST_ENGINE_VERSION, compileManifest, type AgentManifestFile, type CompiledRule } from "./manifest";
import type { PaneTelemetry } from "../types";

function compile(rules: AgentManifestFile["rules"]) {
  const result = compileManifest({ id: "test", version: "1", engine: MANIFEST_ENGINE_VERSION, rules });
  if (!result.ok) throw new Error(result.error);
  return result.manifest;
}

function telemetry(overrides: Partial<PaneTelemetry> = {}): PaneTelemetry {
  return { paneId: 1, at: 0, screenText: "", ...overrides };
}

const MENU = "Do you want to proceed?\n❯ 1. Yes\n  2. No\n\nuse arrow keys to select";

describe("evaluateRules", () => {
  it("returns no verdict when nothing matches", () => {
    const manifest = compile([{ id: "only", state: "blocked", region: "whole_recent", contains: ["nope"] }]);
    const result = evaluateRules(manifest, telemetry({ screenText: MENU }));
    expect(result.verdict).toBeNull();
    expect(result.evaluated).toHaveLength(1);
    expect(result.evaluated[0]?.matched).toBe(false);
    expect(result.evaluated[0]?.reason).toMatch(/missing text/);
  });

  it("reports the highest-priority match and still evaluates the others", () => {
    const manifest = compile([
      { id: "weak", state: "idle", priority: 10, region: "whole_recent", contains: ["proceed"] },
      { id: "strong", state: "blocked", priority: 900, region: "whole_recent", contains: ["proceed"] },
      { id: "silent", state: "blocked", priority: 500, region: "whole_recent", contains: ["absent"] }
    ]);
    const result = evaluateRules(manifest, telemetry({ screenText: MENU }));
    expect(result.verdict?.matchedRule.id).toBe("strong");
    expect(result.verdict?.state).toBe("blocked");
    expect(result.verdict?.source).toBe("screen");
    expect(result.evaluated.map((row) => row.matched)).toEqual([true, true, false]);
  });

  it("propagates the rule's display flags and skip behaviour", () => {
    const manifest = compile([
      {
        id: "viewer",
        state: "unknown",
        priority: 1_000,
        region: "bottom_non_empty_lines(3)",
        skipStateUpdate: true,
        contains: ["showing detailed transcript"]
      }
    ]);
    const result = evaluateRules(manifest, telemetry({ screenText: "showing detailed transcript" }));
    expect(result.verdict?.skipStateUpdate).toBe(true);
    expect(result.verdict?.visible).toEqual({ idle: false, blocker: false, working: false });
  });

  it("labels OSC-derived rules with the osc source", () => {
    const manifest = compile([
      { id: "busy", state: "working", region: "osc_title", regex: ["⠋"] }
    ]);
    const result = evaluateRules(manifest, telemetry({ oscTitle: "⠋ claude" }));
    expect(result.verdict?.source).toBe("osc");
    expect(result.verdict?.matchedRule.region).toBe("osc_title");
  });

  it("records evidence for every rule it considered", () => {
    const manifest = compile([
      {
        id: "menu",
        state: "blocked",
        region: "whole_recent",
        contains: ["proceed"],
        lineRegex: ["^❯ \\d"],
        atLeast: 1
      }
    ]);
    const result = evaluateRules(manifest, telemetry({ screenText: MENU }));
    expect(result.evaluated[0]?.evidence.regionBytes).toBe(MENU.length);
    expect(result.evaluated[0]?.evidence.contains).toEqual(["proceed"]);
    expect(result.evaluated[0]?.evidence.lineRegex).toEqual(["^❯ \\d"]);
  });

  it("skips a rule whose region cannot be resolved", () => {
    const manifest = compile([{ id: "broken", state: "blocked", region: "whole_recent", contains: ["x"] }]);
    const rule = { ...manifest.rules[0]!, region: "bottom_non_empty_lines" } as CompiledRule;
    const result = evaluateRules({ ...manifest, rules: [rule] }, telemetry({ screenText: "x" }));
    expect(result.verdict).toBeNull();
    expect(result.evaluated[0]?.reason).toMatch(/unknown region/);
  });
});

describe("matchRule", () => {
  const context = {
    regionText: MENU,
    regionTextLower: MENU.toLowerCase(),
    lines: MENU.split("\n"),
    cursorHidden: false
  };

  it("requires at least N matching lines when atLeast is set", () => {
    const [one] = compile([
      { id: "one", state: "blocked", region: "whole_recent", lineRegex: ["^\\s*\\d\\. "], atLeast: 2 }
    ]).rules;
    const [two] = compile([
      { id: "two", state: "blocked", region: "whole_recent", lineRegex: ["^\\s*[❯ ]\\s*\\d\\. "], atLeast: 2 }
    ]).rules;
    expect(matchRule(one!, context).matched).toBe(false);
    expect(matchRule(two!, context).matched).toBe(true);
  });

  it("matches text case-insensitively", () => {
    const [rule] = compile([
      { id: "any-case", state: "blocked", region: "whole_recent", contains: ["DO YOU WANT TO PROCEED?"] }
    ]).rules;
    expect(matchRule(rule!, context).matched).toBe(true);
  });

  it("matches a literal split across two logical lines", () => {
    // The mirror undoes soft wraps, so what is left is a literal the app itself
    // broke across lines: the tolerant view joins those with a space.
    const manifest = compile([
      { id: "dialog", state: "blocked", region: "whole_recent", contains: ["esc to cancel"] }
    ]);
    const result = evaluateRules(
      manifest,
      telemetry({ screenText: "press enter to select · esc to\ncancel\n" })
    );
    expect(result.verdict?.state).toBe("blocked");
    expect(result.verdict?.reason).toMatch(/across a line wrap/);
  });

  it("keeps per-line counting on real lines, not on the joined view", () => {
    const manifest = compile([
      {
        id: "two-options",
        state: "blocked",
        region: "whole_recent",
        lineRegex: ["^\\s*(?:❯ )?\\d+\\. "],
        atLeast: 2
      }
    ]);
    const stacked = evaluateRules(manifest, telemetry({ screenText: "❯ 1. Yes\n  2. No" }));
    const sameLine = evaluateRules(manifest, telemetry({ screenText: "❯ 1. Yes ❯ 2. No" }));
    expect(stacked.verdict?.state).toBe("blocked");
    expect(sameLine.verdict ?? null).toBeNull();
  });

  it("does not join lines for a rule that already matched", () => {
    const manifest = compile([
      { id: "dialog", state: "blocked", region: "whole_recent", contains: ["esc to cancel"] }
    ]);
    const result = evaluateRules(manifest, telemetry({ screenText: "esc to cancel\nmore" }));
    expect(result.verdict?.reason).not.toMatch(/across a line wrap/);
  });

  it("honours cursorHidden", () => {
    const [rule] = compile([
      { id: "hidden", state: "blocked", region: "whole_recent", cursorHidden: true, contains: ["proceed"] }
    ]).rules;
    expect(matchRule(rule!, context).matched).toBe(false);
    expect(matchRule(rule!, { ...context, cursorHidden: true }).matched).toBe(true);
  });

  it("lets a not gate veto an otherwise matching rule", () => {
    const [rule] = compile([
      {
        id: "vetoed",
        state: "blocked",
        region: "whole_recent",
        contains: ["proceed"],
        not: [{ regex: ["arrow keys"] }]
      }
    ]).rules;
    const outcome = matchRule(rule!, context);
    expect(outcome.matched).toBe(false);
    expect(outcome.reason).toMatch(/excluded by not gate/);
  });

  it("explains which all gate failed", () => {
    const [rule] = compile([
      {
        id: "gated",
        state: "blocked",
        region: "whole_recent",
        all: [{ contains: ["proceed"] }, { contains: ["missing"] }]
      }
    ]).rules;
    expect(matchRule(rule!, context).reason).toMatch(/all gate failed/);
  });
});

describe("matchGate", () => {
  const context = {
    regionText: "one two",
    regionTextLower: "one two",
    lines: ["one two"],
    cursorHidden: false
  };

  /** Gates are compiled data; build them through the compiler like the engine does. */
  function gate(gate: Record<string, unknown>) {
    const [rule] = compile([
      { id: "g", state: "blocked", region: "whole_recent", ...gate } as never
    ]).rules;
    return rule!;
  }

  it("composes nested any/all/not gates", () => {
    const passing = gate({
      all: [{ contains: ["one"] }],
      any: [{ contains: ["two"] }, { contains: ["three"] }],
      not: [{ contains: ["four"] }]
    });
    expect(matchRule(passing, context).matched).toBe(true);

    const vetoed = gate({
      all: [{ contains: ["one"] }],
      any: [{ contains: ["two"] }],
      not: [{ contains: ["two"] }]
    });
    expect(matchRule(vetoed, context).matched).toBe(false);

    const noAlternative = gate({
      all: [{ contains: ["one"] }],
      any: [{ contains: ["three"] }]
    });
    expect(matchRule(noAlternative, context).matched).toBe(false);
  });

  it("matches a nested gate directly", () => {
    const rule = gate({ any: [{ contains: ["two"] }] });
    expect(matchGate(rule.any[0]!, context).matched).toBe(true);
  });
});
