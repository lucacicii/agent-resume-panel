import { describe, expect, it } from "vitest";
import {
  buildChildIndex,
  collectDescendants,
  detectToolActivity,
  foregroundProcesses,
  parseArgvTable,
  parseProcessTable
} from "./processTable";

/**
 * Real `ps -Ao pid=,ppid=,pgid=,tpgid=,tty=,comm=` shapes captured on macOS.
 *
 * `tpgid` is the terminal's foreground process group: while the agent is idle it
 * equals the shell's group, and while a tool runs it is the group the kernel
 * switched the terminal to.
 */
const PS_SAMPLE = [
  "17058     1 17058     0 ??       /Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
  "25276 17058 25276 25292 ttys004  /bin/zsh",
  "25292 25276 25292 25292 ttys004  pi",
  "25349 25292 25292 25292 ttys004  /Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
  "25350 25292 25292 25292 ttys004  /Applications/Agent Resume.app/Contents/MacOS/Agent Resume",
  "69310 25292 25292 25292 ttys004  /bin/bash",
  "69311 69310 25292 25292 ttys004  sleep"
].join("\n");

/** The same pane while the agent sits idle at its prompt. */
const PS_IDLE = PS_SAMPLE.split("\n")
  .filter((line) => !line.includes("69310") && !line.includes("69311"))
  .join("\n");

const OWN_APP = "/Applications/Agent Resume.app/Contents/MacOS/Agent Resume";

describe("parseProcessTable", () => {
  it("parses executable paths containing spaces", () => {
    const entries = parseProcessTable(PS_SAMPLE);
    expect(entries).toHaveLength(7);
    expect(entries[0]).toMatchObject({ pid: 17058, ppid: 1, command: OWN_APP, tpgid: 0, tty: "??" });
    expect(entries[2]).toMatchObject({ pid: 25292, ppid: 25276, pgid: 25292, tpgid: 25292, tty: "ttys004", command: "pi" });
  });

  it("skips malformed and blank lines", () => {
    const entries = parseProcessTable("\n  \nnot-a-row\n12 34 \n56 78 56 78 ttys001 ok");
    expect(entries).toEqual([
      { pid: 56, ppid: 78, pgid: 56, tpgid: 78, tty: "ttys001", command: "ok" }
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(parseProcessTable("")).toEqual([]);
  });
});

describe("parseArgvTable", () => {
  it("maps pids to argv tokens", () => {
    const table = parseArgvTable("  25292 node /Users/someone/.fnm/bin/pi --session abc\n\n1 /sbin/launchd");
    expect(table.get(25292)).toEqual(["node", "/Users/someone/.fnm/bin/pi", "--session", "abc"]);
    expect(table.get(1)).toEqual(["/sbin/launchd"]);
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

describe("foregroundProcesses", () => {
  it("returns the group the terminal has in the foreground", () => {
    const { pgid, processes } = foregroundProcesses(parseProcessTable(PS_SAMPLE), 25276);
    expect(pgid).toBe(25292);
    expect(processes.map((entry) => entry.pid).sort((a, b) => a - b)).toEqual([
      25292, 25349, 25350, 69310, 69311
    ]);
  });

  it("has no foreground group when the pty pid is unknown or has no tty", () => {
    const entries = parseProcessTable(PS_SAMPLE);
    expect(foregroundProcesses(entries, 999999)).toEqual({ pgid: 0, processes: [] });
    expect(foregroundProcesses(entries, 17058)).toEqual({ pgid: 0, processes: [] });
  });
});

describe("detectToolActivity", () => {
  const ignore = new Set([OWN_APP]);

  it("reports idle when only the agent and our MCP bridge are present", () => {
    const entries = parseProcessTable(PS_IDLE);
    expect(detectToolActivity({ entries, ptyPid: 25276, ignoreExecutables: ignore, agentPid: 25292 }))
      .toEqual({ active: false, processes: [] });
  });

  it("reports busy when a tool shell runs in the foreground", () => {
    const result = detectToolActivity({
      entries: parseProcessTable(PS_SAMPLE),
      ptyPid: 25276,
      ignoreExecutables: ignore,
      agentPid: 25292
    });
    expect(result.active).toBe(true);
    expect(result.processes).toEqual(["/bin/bash", "sleep"]);
  });

  it("counts the agent itself as neither tool nor infrastructure", () => {
    const entries = parseProcessTable("10 1 10 11 ttys002 /bin/zsh\n11 10 11 11 ttys002 pi\n");
    expect(detectToolActivity({ entries, ptyPid: 10, ignoreExecutables: ignore, agentPid: 11 }))
      .toEqual({ active: false, processes: [] });
  });

  it("ignores foreground children we injected ourselves", () => {
    const entries = parseProcessTable([
      "10 1 10 11 ttys002 /bin/zsh",
      "11 10 11 11 ttys002 claude",
      "12 11 11 11 ttys002 /Applications/Agent Resume.app/Contents/MacOS/Agent Resume"
    ].join("\n"));
    expect(detectToolActivity({ entries, ptyPid: 10, ignoreExecutables: ignore, agentPid: 11 }))
      .toEqual({ active: false, processes: [] });
  });

  it("degrades to idle when the PTY pid is unknown", () => {
    expect(detectToolActivity({
      entries: parseProcessTable(PS_SAMPLE),
      ptyPid: 999999,
      ignoreExecutables: ignore,
      agentPid: 25292
    })).toEqual({ active: false, processes: [] });
  });

  it("treats a nested tool chain in the foreground as busy", () => {
    const entries = parseProcessTable([
      "10 1 10 11 ttys003 /bin/zsh",
      "11 10 11 11 ttys003 pi",
      "12 11 11 11 ttys003 /bin/bash",
      "13 12 11 11 ttys003 npm",
      "14 13 11 11 ttys003 node"
    ].join("\n"));
    const result = detectToolActivity({ entries, ptyPid: 10, ignoreExecutables: ignore, agentPid: 11 });
    expect(result.active).toBe(true);
    expect(result.processes).toEqual(["/bin/bash", "npm", "node"]);
  });

  it("does not mistake a child that owns its own group for foreground work", () => {
    // With job control the kernel moves the terminal's foreground group to the
    // job it started, so a backgrounded child (its own group) is never counted.
    // Without job control a child shares the shell's group and does count — a
    // false "working", which is the safe direction for this tier.
    const entries = parseProcessTable([
      "10 1 10 11 ttys003 /bin/zsh",
      "11 10 11 11 ttys003 claude",
      "20 11 20 11 ttys003 node /opt/mcp-server.js"
    ].join("\n"));
    expect(detectToolActivity({ entries, ptyPid: 10, ignoreExecutables: ignore, agentPid: 11 }))
      .toEqual({ active: false, processes: [] });
  });
});
