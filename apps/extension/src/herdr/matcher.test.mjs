import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanTerminalTitle,
  detectTerminalProvider,
  extractSessionIdFromTerminal,
  matchSessionToHerdr
} from "../../out/herdr/matcher.js";

function makeTerminal(overrides = {}) {
  return {
    address: "t1",
    name: null,
    title: "",
    argv: ["/bin/zsh"],
    cwd: "/tmp/proj",
    state: "live",
    created_ms: 1000,
    cols: 120,
    rows: 36,
    keep: true,
    labels: {},
    status: null,
    foreground: null,
    turn: 0,
    screen: "",
    ...overrides
  };
}

test("extractSessionIdFromTerminal parses alma.session label", () => {
  const term = makeTerminal({
    labels: { "alma.session": "omp:id:01a1ed97-5d3d-72b4-99be-c1727ad3075a" }
  });
  assert.deepEqual(extractSessionIdFromTerminal(term), {
    provider: "omp",
    id: "01a1ed97-5d3d-72b4-99be-c1727ad3075a"
  });
});

test("extractSessionIdFromTerminal parses resume flags in argv", () => {
  const claudeTerm = makeTerminal({
    foreground: { pid: 10, name: "claude", argv: ["claude", "--resume", "abc-123"], cwd: "/tmp/proj" }
  });
  assert.deepEqual(extractSessionIdFromTerminal(claudeTerm), {
    provider: "claude",
    id: "abc-123"
  });

  const codexTerm = makeTerminal({
    foreground: {
      pid: 11,
      name: "codex",
      argv: ["codex", "resume", "--cd", "/tmp/proj", "thread-99"],
      cwd: "/tmp/proj"
    }
  });
  assert.deepEqual(extractSessionIdFromTerminal(codexTerm), {
    provider: "codex",
    id: "thread-99"
  });
});

test("matchSessionToHerdr prioritizes live exact ID over finished and recorded", () => {
  const spaceNames = new Map([["sp1", "anfeng"]]);
  const recorded = new Map([
    ["omp:sess-1", { provider: "omp", id: "sess-1", lastAddress: "t0", spaceId: "sp1", updatedAt: 500 }]
  ]);
  const terminals = [
    makeTerminal({
      address: "t0",
      state: "finished",
      labels: { "alma.session": "omp:id:sess-1", "herdr.space": "sp1" }
    }),
    makeTerminal({
      address: "t8h",
      state: "live",
      labels: { "alma.session": "omp:id:sess-1", "herdr.space": "sp1" },
      status: { state: "working", app: "omp", msg: "Running tests" }
    })
  ];

  const match = matchSessionToHerdr(
    { provider: "omp", id: "sess-1", title: "Fix auth", projectPath: "/tmp/proj" },
    terminals,
    spaceNames,
    recorded
  );

  assert.equal(match?.kind, "live");
  assert.equal(match?.address, "t8h");
  assert.equal(match?.spaceName, "anfeng");
  assert.equal(match?.agentState, "working");
  assert.equal(match?.statusMsg, "Running tests");
});

test("matchSessionToHerdr falls back to cwd + provider + title and then recorded", () => {
  const spaceNames = new Map([["sp2", "web-consignor"]]);
  const recorded = new Map([
    ["pi:sess-old", { provider: "pi", id: "sess-old", lastAddress: "t2", spaceId: "sp2", updatedAt: 999 }]
  ]);

  const titleMatchTerm = makeTerminal({
    address: "t91",
    cwd: "/tmp/my-app",
    title: "π - Refactor login flow",
    status: { state: "done", app: "pi" },
    labels: { "herdr.space": "sp2" }
  });

  assert.equal(detectTerminalProvider(titleMatchTerm), "pi");
  assert.equal(cleanTerminalTitle(titleMatchTerm.title), "Refactor login flow");

  const titleMatch = matchSessionToHerdr(
    { provider: "pi", id: "sess-2", title: "Refactor login flow", projectPath: "/tmp/my-app" },
    [titleMatchTerm],
    spaceNames,
    recorded
  );
  assert.equal(titleMatch?.kind, "live");
  assert.equal(titleMatch?.address, "t91");
  assert.equal(titleMatch?.spaceName, "web-consignor");

  const recMatch = matchSessionToHerdr(
    { provider: "pi", id: "sess-old", title: "Old task", projectPath: "/tmp/other" },
    [],
    spaceNames,
    recorded
  );
  assert.equal(recMatch?.kind, "recorded");
  assert.equal(recMatch?.spaceName, "web-consignor");
});

test("a stale label loses to the session the terminal actually runs", () => {
  const spaceNames = new Map([["sp3", "GitHub"]]);
  const recorded = new Map();
  // `/new` inside the same PTY: label still names the session that just ended.
  const term = makeTerminal({
    address: "t10p",
    cwd: "/tmp/proj",
    name: "omp-new",
    labels: { "alma.session": "omp:id:sess-old", "herdr.space": "sp3" },
    status: { state: "working", app: "omp" }
  });
  const running = (_term, provider) => (provider === "omp" ? "sess-new" : undefined);

  const stale = matchSessionToHerdr(
    { provider: "omp", id: "sess-old", title: "Old task", projectPath: "/tmp/proj" },
    [term],
    spaceNames,
    recorded,
    running
  );
  assert.equal(stale, undefined);

  const adopted = matchSessionToHerdr(
    { provider: "omp", id: "sess-new", title: "New task", projectPath: "/tmp/proj" },
    [term],
    spaceNames,
    recorded,
    running
  );
  assert.equal(adopted?.kind, "live");
  assert.equal(adopted?.address, "t10p");
});

test("title fallback never claims a terminal another session is running", () => {
  const spaceNames = new Map();
  const term = makeTerminal({
    address: "t11",
    cwd: "/tmp/my-app",
    title: "π - Refactor login flow",
    status: { state: "working", app: "pi" }
  });
  const running = (_term, provider) => (provider === "pi" ? "other-session" : undefined);

  const match = matchSessionToHerdr(
    { provider: "pi", id: "sess-2", title: "Refactor login flow", projectPath: "/tmp/my-app" },
    [term],
    spaceNames,
    new Map(),
    running
  );
  assert.equal(match, undefined);
});
