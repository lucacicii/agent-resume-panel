import { describe, expect, it } from "vitest";
import {
  buildChildIndex,
  collectDescendants,
  detectToolActivity,
  parseProcessTable
} from "./processProbe";

/** Real `ps -Ao pid=,ppid=,comm=` shapes captured on macOS. */
const PS_SAMPLE = [
  "17058     1 /Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
  "25276 17058 /bin/zsh",
  "25292 25276 pi",
  "25349 25292 /Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
  "25350 25292 /Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
  "69310 25292 /bin/bash",
  "69311 69310 sleep"
].join("\n");

const OWN_APP = "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume";

describe("parseProcessTable", () => {
  it("parses executable paths containing spaces", () => {
    const entries = parseProcessTable(PS_SAMPLE);
    expect(entries).toHaveLength(7);
    expect(entries[0]).toEqual({ pid: 17058, ppid: 1, command: OWN_APP });
    expect(entries[2]).toEqual({ pid: 25292, ppid: 25276, command: "pi" });
  });

  it("skips malformed and blank lines", () => {
    const entries = parseProcessTable("\n  \nnot-a-row\n12 34 \n56 78 ok");
    expect(entries).toEqual([{ pid: 56, ppid: 78, command: "ok" }]);
  });

  it("returns nothing for empty input", () => {
    expect(parseProcessTable("")).toEqual([]);
  });
});

describe("collectDescendants", () => {
  it("walks the whole subtree depth-first, excluding the root", () => {
    const index = buildChildIndex(parseProcessTable(PS_SAMPLE));
    expect(collectDescendants(index, 25276).sort((a, b) => a - b)).toEqual([
      25292, 25349, 25350, 69310, 69311
    ]);
  });

  it("returns nothing for a leaf process", () => {
    const index = buildChildIndex(parseProcessTable(PS_SAMPLE));
    expect(collectDescendants(index, 69311)).toEqual([]);
  });
});

describe("detectToolActivity", () => {
  const ignore = new Set([OWN_APP]);

  it("reports idle when only the agent and our MCP bridge are present", () => {
    const entries = parseProcessTable(PS_SAMPLE);
    const idle = entries.filter((entry) => entry.pid !== 69310 && entry.pid !== 69311);
    expect(detectToolActivity(idle, 25276, ignore)).toEqual({ active: false, processes: [] });
  });

  it("reports busy when a tool shell runs beneath the agent", () => {
    const result = detectToolActivity(parseProcessTable(PS_SAMPLE), 25276, ignore);
    expect(result.active).toBe(true);
    expect(result.processes).toContain("/bin/bash");
    expect(result.processes).toContain("sleep");
  });

  it("counts the agent itself as neither tool nor infrastructure", () => {
    // `pi` is the direct child of the PTY shell, so it must never trigger busy.
    const entries = parseProcessTable("10 1 /bin/zsh\n11 10 pi\n");
    expect(detectToolActivity(entries, 10, ignore)).toEqual({ active: false, processes: [] });
  });

  it("reports idle for a clean codex-like tree with no resident bridge", () => {
    const entries = parseProcessTable("10 1 /bin/zsh\n11 10 codex\n");
    expect(detectToolActivity(entries, 10, ignore)).toEqual({ active: false, processes: [] });
  });

  it("degrades to idle when the PTY pid is unknown", () => {
    expect(detectToolActivity(parseProcessTable(PS_SAMPLE), 999999, ignore))
      .toEqual({ active: false, processes: [] });
  });

  it("treats a nested tool chain as busy", () => {
    const entries = parseProcessTable("10 1 zsh\n11 10 pi\n12 11 /bin/bash\n13 12 npm\n14 13 node\n");
    const result = detectToolActivity(entries, 10, ignore);
    expect(result.active).toBe(true);
    expect(result.processes).toEqual(["/bin/bash", "npm", "node"]);
  });

  it("survives a cyclic table without hanging", () => {
    const entries = parseProcessTable("10 1 zsh\n11 10 pi\n12 11 tool\n11 12 looped\n");
    expect(() => detectToolActivity(entries, 10, ignore)).not.toThrow();
  });
});
