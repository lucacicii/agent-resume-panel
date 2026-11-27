import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { createRunningSessionLookup, readRunningTtyRecord } from "../../out/herdr/runningSession.js";

function withAgentHome(files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "arp-tty-"));
  fs.mkdirSync(path.join(home, "terminal-sessions"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(home, "terminal-sessions", name), body);
  }
  return home;
}

test("readRunningTtyRecord splits cwd, session file, and cwdstat lines", () => {
  const sessionFile = "/Users/x/.omp/agent/sessions/-wz-GitHub/2026-11-26T11-23-15-869Z_01a21798-701d.jsonl";
  const home = withAgentHome({
    ttys002: ["/Users/x/wz/GitHub", sessionFile, "cwdstat 16777233 12345"].join("\n")
  });

  const record = readRunningTtyRecord(home, "ttys002");
  assert.equal(record.cwd, "/Users/x/wz/GitHub");
  assert.equal(record.sessionId, "01a21798-701d");
  assert.equal(record.sessionFile, sessionFile);
});

test("readRunningTtyRecord returns undefined for unknown tty or missing session line", () => {
  const home = withAgentHome({ ttys003: "/Users/x/wz/GitHub\n" });
  assert.equal(readRunningTtyRecord(home, "ttys999"), undefined);
  assert.equal(readRunningTtyRecord(home, "ttys003"), undefined);
  assert.equal(readRunningTtyRecord(home, ""), undefined);
});

test("createRunningSessionLookup is unknown for providers without a home", () => {
  const sessionFile = "/Users/x/.omp/agent/sessions/-wz-GitHub/2026-11-26T11-23-15-869Z_sess-a.jsonl";
  const home = withAgentHome({ ttys004: ["/Users/x/wz/GitHub", sessionFile].join("\n") });
  assert.equal(readRunningTtyRecord(home, "ttys004").sessionId, "sess-a");

  const lookup = createRunningSessionLookup({});
  assert.equal(lookup.resolve({ address: "t1", state: "live", pid: 1 }, "omp"), undefined);
});

test("a second /new in the same PTY is seen without a pid change", () => {
  const fileA = "/Users/x/.omp/agent/sessions/-wz-GitHub/2026-11-26T11-23-15-869Z_sess-a.jsonl";
  const fileB = "/Users/x/.omp/agent/sessions/-wz-GitHub/2026-11-27T00-10-00-000Z_sess-b.jsonl";
  const home = withAgentHome({ ttys005: ["/Users/x/wz/GitHub", fileA].join("\n") });
  const term = { address: "t10p", state: "live", pid: 43384, foreground: { pid: 43384 } };

  let psCalls = 0;
  const lookup = createRunningSessionLookup({ omp: home }, () => {
    psCalls++;
    return "ttys005";
  });

  assert.equal(lookup.resolve(term, "omp"), "sess-a");
  fs.writeFileSync(path.join(home, "terminal-sessions", "ttys005"), ["/Users/x/wz/GitHub", fileB].join("\n"));
  assert.equal(lookup.resolve(term, "omp"), "sess-b");
  assert.equal(psCalls, 1, "the pid -> tty hop stays cached, the record does not");
});
