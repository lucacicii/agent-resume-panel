import { describe, expect, it } from "vitest";
import { normalizeLinkGraphSymbol } from "./linkGraphService";
import {
  mapCoreStepToDesktop,
  mapCoreTimeline,
  mapCoreTraceToAnalysis,
  stepsToHits
} from "./mapCoreTrace";
import type { LinkGraphStep, LinkGraphTraceResult } from "@agent-resume/core";

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
});

describe("mapCoreTrace", () => {
  const step: LinkGraphStep = {
    id: "s1",
    role: "call",
    title: "Call ajax_invoice.pageQuery",
    narrative: "ajax_invoice.pageQuery",
    file: "src/api/invoice.ts",
    path: "/ws/src/api/invoice.ts",
    line: 12,
    symbol: "pageQuery",
    preview: "pageQuery: () => $post(",
    confidence: "high",
    kind: "api_method"
  };

  it("maps step kinds to desktop node/edge", () => {
    const d = mapCoreStepToDesktop(step);
    expect(d.nodeKind).toBe("api_client");
    expect(d.edgeKind).toBe("refers");
    expect(d.role).toBe("call");
    expect(d.bridgeKind).toBe("api_client");
  });

  it("maps timeline phases through", () => {
    const items = mapCoreTimeline([
      {
        id: "locate",
        phase: "locate",
        status: "done",
        title: "定位",
        at: 1
      }
    ]);
    expect(items[0].phase).toBe("locate");
    expect(items[0].status).toBe("done");
  });

  it("builds analysis + hits from trace", () => {
    const trace: LinkGraphTraceResult = {
      ok: true,
      engine: "llm_agent",
      primaryChain: [step],
      timeline: [],
      summary: "ok",
      openEnds: [],
      bridgeStatus: "partial",
      facts: {
        hasFeApiClient: true,
        hasHttpPath: false,
        hasBackendHandler: false,
        hasVoField: false
      },
      workspaceRoot: "/ws",
      seed: { symbol: "pageQuery", filePath: "src/api/invoice.ts", line: 12 }
    };
    const analysis = mapCoreTraceToAnalysis(trace);
    expect(analysis.summary).toBe("ok");
    expect(analysis.hops).toHaveLength(1);
    expect(stepsToHits([mapCoreStepToDesktop(step)])).toHaveLength(1);
  });
});
