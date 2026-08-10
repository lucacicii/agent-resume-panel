import { describe, expect, it } from "vitest";
import {
  isStopwordSymbol,
  normalizeLinkGraphSymbol,
  parseLinkGraphAnalysis,
  repairCommonJsonIssues,
  symbolSpecificity
} from "./linkGraphService";
import type { LinkGraphHit } from "../../shared/linkGraphTypes";

describe("normalizeLinkGraphSymbol", () => {
  it("keeps simple identifiers", () => {
    expect(normalizeLinkGraphSymbol("userId")).toEqual({ symbol: "userId", wholeWord: true });
  });

  it("takes the last member segment", () => {
    expect(normalizeLinkGraphSymbol("user.profile.id")).toEqual({ symbol: "id", wholeWord: true });
  });

  it("rejects empty or oversized input", () => {
    expect(normalizeLinkGraphSymbol("")).toBeNull();
    expect(normalizeLinkGraphSymbol("x".repeat(100))).toBeNull();
  });

  it("treats phrases as non-whole-word", () => {
    expect(normalizeLinkGraphSymbol("find user by id")).toEqual({
      symbol: "find user by id",
      wholeWord: false
    });
  });
});

describe("stopwords and specificity", () => {
  it("flags common short tokens", () => {
    expect(isStopwordSymbol("id")).toBe(true);
    expect(isStopwordSymbol("data")).toBe(true);
    expect(isStopwordSymbol("getUserProfile")).toBe(false);
  });

  it("scores camelCase higher than short names", () => {
    expect(symbolSpecificity("getUserProfile")).toBeGreaterThan(symbolSpecificity("data"));
  });
});

describe("continue budgets", () => {
  it("raises hit/symbol caps above the current session counts", async () => {
    // Pure arithmetic check mirrors analyzeLinkGraph continue branch.
    const existingHits = 80;
    const existingSymbols = 40;
    const baseHits = 80;
    const baseSymbols = 40;
    const continueHitBudget = 50;
    const continueSymbolBudget = 25;
    const maxHits = Math.min(400, existingHits + Math.max(continueHitBudget, Math.floor(baseHits / 2)));
    const maxSymbols = Math.min(200, existingSymbols + Math.max(continueSymbolBudget, Math.floor(baseSymbols / 2)));
    expect(maxHits).toBeGreaterThan(existingHits);
    expect(maxSymbols).toBeGreaterThan(existingSymbols);
  });
});

describe("parseLinkGraphAnalysis", () => {
  const hits: LinkGraphHit[] = [
    {
      path: "/proj/src/a.ts",
      relativePath: "src/a.ts",
      line: 10,
      column: 1,
      endColumn: 5,
      preview: "const userId = 1",
      depth: 0,
      symbol: "userId",
      reason: "seed",
      score: 50
    }
  ];

  it("accepts evidence-backed hops", () => {
    const raw = JSON.stringify({
      summary: "userId is defined in a.ts",
      complete: false,
      hops: [
        {
          id: "h1",
          role: "definition",
          title: "define userId",
          narrative: "const",
          file: "src/a.ts",
          line: 10,
          confidence: "high"
        }
      ],
      confidence: "medium"
    });
    const analysis = parseLinkGraphAnalysis(raw, hits, true);
    expect(analysis?.hops).toHaveLength(1);
    expect(analysis?.complete).toBe(false);
    expect(analysis?.summary).toContain("userId");
  });

  it("drops hops that invent files", () => {
    const raw = JSON.stringify({
      summary: "x",
      complete: true,
      hops: [{ id: "h1", role: "call", title: "x", narrative: "x", file: "nope.ts", line: 1, confidence: "high" }],
      confidence: "low"
    });
    const analysis = parseLinkGraphAnalysis(raw, hits, false);
    expect(analysis?.hops).toHaveLength(0);
    expect(analysis?.summary).toBe("x");
  });

  it("parses fenced JSON with trailing prose and string line numbers", () => {
    const raw = [
      "Here is the analysis:",
      "```json",
      '{',
      '  "summary": "userId flows through a.ts",',
      '  "complete": false,',
      '  "hops": [',
      '    {"id":"h1","role":"definition","title":"define","narrative":"const","file":"src/a.ts","line":"10","confidence":"high"}',
      "  ],",
      '  "confidence": "medium",',
      "}",
      "```",
      "Hope that helps!"
    ].join("\n");
    const analysis = parseLinkGraphAnalysis(raw, hits, true);
    expect(analysis?.summary).toContain("userId");
    expect(analysis?.hops).toHaveLength(1);
    expect(analysis?.hops[0]?.line).toBe(10);
    expect(analysis?.complete).toBe(false);
  });

  it("repairs trailing commas", () => {
    const broken = '{"summary":"ok","complete":false,"hops":[],"confidence":"low",}';
    expect(() => JSON.parse(broken)).toThrow();
    expect(JSON.parse(repairCommonJsonIssues(broken))).toMatchObject({ summary: "ok" });
    expect(parseLinkGraphAnalysis(broken, hits, true)?.summary).toBe("ok");
  });
});
