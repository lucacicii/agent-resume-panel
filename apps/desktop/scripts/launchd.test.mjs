/**
 * launchd login-item rendering and safety.
 *
 * Runs against the compiled module, so `pnpm run build:desktop` must have run
 * first — same convention as the other script-level desktop tests. It never
 * touches the real `~/Library/LaunchAgents`: every filesystem call is pointed at
 * a temp home, and launchd itself is not invoked by the pure rendering tests.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const launchd = await import(path.join(here, "..", "dist", "main", "launchd.js"));

const {
  LAUNCH_AGENT_MARKER,
  renderLaunchAgentPlist,
  launchAgentPath,
  isManagedPlist
} = launchd;

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log("launchd plist rendering");

check("emits a valid plist skeleton", () => {
  const xml = renderLaunchAgentPlist({
    label: "dev.agentresume.test",
    programArguments: ["/usr/bin/node", "/tmp/entry.js", "--flag"]
  });
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<key>Label<\/key>\s*<string>dev\.agentresume\.test<\/string>/);
  assert.match(xml, /<\/plist>\s*$/);
  // Balanced dict/array tags: plutil is the real arbiter but this catches gross slips.
  const openDict = (xml.match(/<dict>/g) || []).length;
  const closeDict = (xml.match(/<\/dict>/g) || []).length;
  assert.equal(openDict, closeDict, "unbalanced <dict> tags");
});

check("passes every program argument through in order", () => {
  const xml = renderLaunchAgentPlist({
    label: "dev.agentresume.test",
    programArguments: ["/bin/a", "--panel-home", "/Users/x/.agent-resume-panel"]
  });
  const args = [...xml.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
  assert.deepEqual(args.slice(1, 4), ["/bin/a", "--panel-home", "/Users/x/.agent-resume-panel"]);
});

check("sets RunAtLoad and KeepAlive by default", () => {
  const xml = renderLaunchAgentPlist({ label: "l", programArguments: ["/bin/a"] });
  const runAtLoad = xml.slice(xml.indexOf("<key>RunAtLoad</key>"));
  assert.match(runAtLoad.slice(0, 40), /<true\/>/);
  const keepAlive = xml.slice(xml.indexOf("<key>KeepAlive</key>"));
  assert.match(keepAlive.slice(0, 40), /<true\/>/);
});

check("honours explicit RunAtLoad/KeepAlive false", () => {
  const xml = renderLaunchAgentPlist({
    label: "l",
    programArguments: ["/bin/a"],
    runAtLoad: false,
    keepAlive: false
  });
  assert.match(xml.slice(xml.indexOf("<key>RunAtLoad</key>")), /<false\/>/);
  assert.match(xml.slice(xml.indexOf("<key>KeepAlive</key>")), /<false\/>/);
});

check("emits EnvironmentVariables only when supplied", () => {
  const without = renderLaunchAgentPlist({ label: "l", programArguments: ["/bin/a"] });
  assert.ok(!without.includes("EnvironmentVariables"));

  const withEnv = renderLaunchAgentPlist({
    label: "l",
    programArguments: ["/bin/a"],
    environment: { ELECTRON_RUN_AS_NODE: "1", AGENT_RESUME_PANEL_HOME: "/tmp/home" }
  });
  assert.ok(withEnv.includes("EnvironmentVariables"));
  assert.ok(withEnv.includes("<key>ELECTRON_RUN_AS_NODE</key>"));
  assert.ok(withEnv.includes("<string>1</string>"));
});

check("escapes XML metacharacters in values", () => {
  const xml = renderLaunchAgentPlist({
    label: "l",
    programArguments: ["/bin/a", "--q", 'a&b<c>d"e'],
    environment: { HOME: "/x&y" }
  });
  assert.ok(!/<string>a&b/.test(xml), "raw & must not survive");
  assert.ok(xml.includes("&amp;"), "& should be escaped");
  assert.ok(xml.includes("&lt;"), "< should be escaped");
  assert.ok(xml.includes("&quot;"), '" should be escaped');
});

check("carries the ownership marker and app version", () => {
  const xml = renderLaunchAgentPlist({
    label: "l",
    programArguments: ["/bin/a"],
    appVersion: "0.2.35"
  });
  assert.ok(xml.includes(LAUNCH_AGENT_MARKER));
  assert.ok(xml.includes("appVersion=0.2.35"));
});

check("includes WorkingDirectory only when given", () => {
  const without = renderLaunchAgentPlist({ label: "l", programArguments: ["/bin/a"] });
  assert.ok(!without.includes("WorkingDirectory"));
  const withDir = renderLaunchAgentPlist({
    label: "l",
    programArguments: ["/bin/a"],
    workingDirectory: "/Users/x"
  });
  assert.ok(withDir.includes("WorkingDirectory"));
});

check("points log paths at the log file, or /dev/null", () => {
  const withLog = renderLaunchAgentPlist({
    label: "l",
    programArguments: ["/bin/a"],
    logPath: "/tmp/daemon.log"
  });
  assert.equal((withLog.match(/\/tmp\/daemon\.log/g) || []).length, 2);

  const without = renderLaunchAgentPlist({ label: "l", programArguments: ["/bin/a"] });
  assert.equal((without.match(/\/dev\/null/g) || []).length, 2);
});

console.log("launchd path + ownership");

check("resolves the plist under Library/LaunchAgents of the given home", () => {
  const p = launchAgentPath("dev.agentresume.test", "/tmp/fakehome");
  assert.equal(p, "/tmp/fakehome/Library/LaunchAgents/dev.agentresume.test.plist");
});

check("treats only our own plist as managed", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "launchd-test-"));
  try {
    const ours = path.join(home, "ours.plist");
    fs.writeFileSync(ours, renderLaunchAgentPlist({ label: "l", programArguments: ["/bin/a"] }));
    assert.equal(isManagedPlist(ours), true);

    const foreign = path.join(home, "foreign.plist");
    fs.writeFileSync(foreign, '<?xml version="1.0"?><plist version="1.0"><dict/></plist>');
    assert.equal(isManagedPlist(foreign), false);

    assert.equal(isManagedPlist(path.join(home, "missing.plist")), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

check("rendering is deterministic so reinstalls are no-ops", () => {
  const spec = {
    label: "dev.agentresume.test",
    programArguments: ["/bin/a", "--x"],
    environment: { A: "1" },
    appVersion: "1.0.0"
  };
  assert.equal(renderLaunchAgentPlist(spec), renderLaunchAgentPlist(spec));
});

if (failures > 0) {
  console.error(`\n${failures} launchd check(s) failed`);
  process.exit(1);
}
console.log("\nlaunchd checks passed");
