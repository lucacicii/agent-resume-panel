import { describe, expect, it } from "vitest";
import { discoverExternalAgents, externalPaneId } from "./discovery";
import { parseProcessTable, type ProcessEntry } from "./processTable";

/** Two agents on their own ttys, plus one inside a pane we already track. */
const TABLE = parseProcessTable(
  [
    "  100     1   100   100 ttys001  /bin/zsh",
    "  101   100   101   101 ttys001  claude",
    "  200     1   200   200 ttys002  /bin/zsh",
    "  201   200   201   201 ttys002  codex",
    "  202   201   201   201 ttys002  /bin/bash",
    "  300     1   300   300 ttys003  /bin/zsh",
    "  301   300   301   301 ttys003  pi",
    "  400     1   400     0 ??       node /opt/some-server.js",
    "  500     1   500   500 ttys005  /bin/zsh",
    "  501   500   501   501 ttys005  node /tmp/not-an-agent.js"
  ].join("\n")
);

function entry(overrides: Partial<ProcessEntry>): ProcessEntry {
  return {
    pid: 1,
    ppid: 1,
    pgid: 1,
    tpgid: 1,
    tty: "ttys001",
    command: "x",
    ...overrides
  };
}

describe("discoverExternalAgents", () => {
  it("finds agents on terminals we do not own", () => {
    const found = discoverExternalAgents(TABLE, new Set([300]));
    const byAgent = new Map(found.map((pane) => [pane.agent, pane]));
    expect([...byAgent.keys()].sort()).toEqual(["claude", "codex"]);
    expect(byAgent.get("claude")?.paneId).toBe(externalPaneId(101));
    expect(byAgent.get("claude")?.toolRunning).toBe(false);
  });

  it("reports a command running under an external agent", () => {
    const found = discoverExternalAgents(TABLE, new Set([300]));
    const codex = found.find((pane) => pane.agent === "codex");
    expect(codex?.toolRunning).toBe(true);
    expect(codex?.foregroundProcesses).toEqual(["/bin/bash"]);
  });

  it("ignores agents inside a tracked pane, including its descendants", () => {
    const found = discoverExternalAgents(TABLE, new Set([300]));
    expect(found.some((pane) => pane.agent === "pi")).toBe(false);
  });

  it("ignores processes without a controlling terminal", () => {
    const found = discoverExternalAgents(TABLE, new Set());
    expect(found.some((pane) => pane.paneId === externalPaneId(400))).toBe(false);
  });

  it("ignores a runtime that is not an agent", () => {
    const found = discoverExternalAgents(TABLE, new Set());
    expect(found.some((pane) => pane.paneId === externalPaneId(501))).toBe(false);
  });

  it("uses negative ids so they cannot collide with pty ids", () => {
    expect(externalPaneId(101)).toBeLessThan(0);
    expect(discoverExternalAgents(TABLE, new Set()).every((pane) => pane.paneId < 0)).toBe(true);
  });

  it("returns nothing for an empty table", () => {
    expect(discoverExternalAgents([], new Set())).toEqual([]);
  });

  it("stops walking parents on a cyclic table", () => {
    const cyclic = [entry({ pid: 10, ppid: 11, command: "claude" }), entry({ pid: 11, ppid: 10, command: "zsh" })];
    expect(() => discoverExternalAgents(cyclic, new Set([99]))).not.toThrow();
  });
});
