/**
 * End-to-end proof of the status pipeline, printed step by step.
 *
 * It walks one pane's worth of bytes through the real modules — the same ones
 * the app runs — and then does a socket round trip against a real daemon:
 *
 *   PTY bytes → scan.ts (side channels) → mirror.ts (screen text) → engine
 *   (rules) → daemon (verdict) → snapshot / explain
 *
 * Everything is asserted, so it doubles as a check that the layers still agree:
 * it fails loudly if a rule stops matching, if a wrap is not undone, or if the
 * emoji width table drifts from the renderer's.
 *
 * Run it (needs a prior build):
 *   pnpm --filter @agent-resume/desktop run build
 *   node apps/desktop/scripts/agent-status-pipeline-demo.mjs
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(here, "..");
const dist = path.join(desktopRoot, "dist", "main", "agentStatus");
const manifestsDir = path.join(desktopRoot, "src", "main", "agentStatus", "engine", "manifests");
const require = createRequire(path.join(desktopRoot, "package.json"));

const { createScanState, drainReports, scanChunk } = await import(path.join(dist, "scan.js"));
const { PaneMirror, MIRROR_UNICODE_VERSION } = await import(path.join(dist, "mirror.js"));
const { createManifestRegistry } = await import(path.join(dist, "engine", "registry.js"));
const { evaluateRules } = await import(path.join(dist, "engine", "evaluate.js"));
const { agentStatusPaths } = await import(path.join(dist, "paths.js"));
const { readLiveEndpoint } = await import(path.join(dist, "endpoint.js"));
const { connectAgentStatusClient } = await import(path.join(dist, "client.js"));

const failures = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return ok ? "ok" : "MISMATCH";
}

// ① What an agent actually writes to the terminal.
const bytes = [
  "\x1b[?1049h",                                          // alternate screen (full-screen TUI)
  "\x1b]0;\u2802 claude\x07",                             // OSC 0: title (spinner glyph)
  "\x1b[2J\x1b[H",                                        // clear + home
  "\x1b[38;5;245m  \u23fa Ran the build\x1b[0m\r\n",
  "\r\n",
  `\x1b[90m${"\u2500".repeat(40)}\x1b[0m\r\n`,            // a plain separator line
  " Do you want to apply this change?\r\n",
  "\x1b[7m \u276f 1. Yes \x1b[0m\r\n",
  "   2. No\r\n",
  "\r\n",
  " enter to select \u00b7 tab/arrow keys to navigate \u00b7 esc to cancel\r\n",
  "\x1b[?25l",                                            // DEC 25: hide cursor
  "\x1b]633;AR;awaiting;dialog\x07",                      // our own status sequence (pi-style channel)
  "\x1b]9;4;3;60\x07"                                     // OSC 9;4: progress
].join("");
console.log("① PTY bytes:", bytes.length, "characters (escape sequences included)");

// ② scan.ts: side channels out, status sequence stripped from the forwarded stream.
const scan = createScanState();
const forwarded = scanChunk(scan, bytes);
const reports = drainReports(scan);
console.log(
  `② scan.ts: title=${JSON.stringify(scan.oscTitle)} progress=${JSON.stringify(scan.oscProgress)}` +
    ` cursorHidden=${scan.cursorHidden} reports=${JSON.stringify(reports)}` +
    ` forwardedHasSequence=${forwarded.includes("633;AR")}`
);
check("scan stripped the status sequence", forwarded.includes("633;AR"), false);
check("scan read the report", reports.map((report) => report.state), ["blocked"]);

// ③ mirror.ts: bytes → screen text (soft wraps undone), at 60 columns.
const mirror = new PaneMirror({ cols: 60, rows: 12 });
mirror.write(forwarded);
await mirror.flush();
const screenText = mirror.snapshotText();
console.log("③ screen text the rules read:");
console.log(screenText.split("\n").map((line) => `   | ${line}`).join("\n"));
check("a wrapped literal is readable again", screenText.includes("esc to cancel"), true);

// The width table must match the renderer, or lines break in different places.
const probe = new PaneMirror({ cols: 10, rows: 3 });
probe.write("\u{1F44D}".repeat(11) + "\r\n");
await probe.flush();
const inspect = probe;
const term = inspect.term ?? inspect["term"];
const cellWidth = term?.buffer?.active?.getLine(0)?.getCell(0)?.getWidth?.();
console.log(`③b width table: unicode ${term?.unicode?.activeVersion} (renderer uses ${MIRROR_UNICODE_VERSION}), 👍 width = ${cellWidth}`);
check("emoji width matches the renderer", term?.unicode?.activeVersion, MIRROR_UNICODE_VERSION);
check("emoji are two cells wide", cellWidth, 2);
probe.dispose();

// ④ engine: rules over that text, with per-rule reasons.
const registry = createManifestRegistry({ dir: manifestsDir });
const manifest = registry.forAgent("claude");
const layers = registry.layersFor("claude").map((layer) => `${layer.id}@${layer.version}(${layer.rules})`);
const evaluation = evaluateRules(manifest, {
  paneId: 1,
  at: 0,
  screenText,
  cursorHidden: scan.cursorHidden,
  oscTitle: scan.oscTitle,
  oscProgress: scan.oscProgress
});
console.log(`④ rule layers: ${layers.join(" → ")}`);
console.log(
  `   matched: ${evaluation.verdict?.matchedRule.id} [${evaluation.verdict?.matchedRule.manifest}]` +
    ` → ${evaluation.verdict?.state} (source ${evaluation.verdict?.source}, visibleBlocker ${evaluation.verdict?.visible.blocker})`
);
console.log(`   reason: ${evaluation.verdict?.reason}`);
console.log("   rules that did not match (each with its reason):");
for (const row of evaluation.evaluated.filter((entry) => !entry.matched)) {
  console.log(`     · ${row.id.padEnd(34)} ${row.reason}`);
}
check("the dialog wins over stale title chrome", evaluation.verdict?.state, "blocked");
check("the dialog rule is Claude's own", evaluation.verdict?.matchedRule.manifest, "claude");

// ⑤⑥ A real daemon: telemetry in, snapshot/explain out.
const panelHome = mkdtempSync(path.join(os.tmpdir(), "agent-status-demo-"));
const daemon = spawn(
  process.execPath,
  [path.join(dist, "daemon.js"), "--panel-home", panelHome, "--app-version", "demo", "--no-discovery"],
  { env: { ...process.env, AGENT_RESUME_PANEL_HOME: panelHome }, stdio: ["ignore", "ignore", "inherit"] }
);
const paths = agentStatusPaths(panelHome);
for (let attempt = 0; attempt < 50; attempt += 1) {
  if (await readLiveEndpoint(paths)) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const client = await connectAgentStatusClient({ socketPath: paths.socket, role: "test" });
const telemetry = {
  paneId: 1,
  agent: "claude",
  ptyPid: 1234,
  sessionKey: "cli:claude:abc",
  oscTitle: scan.oscTitle,
  oscProgress: scan.oscProgress,
  cursorHidden: scan.cursorHidden,
  toolRunning: false,
  screenText,
  lastOutputAt: Date.now() - 3_000,
  at: Date.now()
};
console.log(`⑤ telemetry frame: ${JSON.stringify({ ...telemetry, screenText: `${screenText.length} chars` })}`);
await client.request("telemetry.publish", telemetry);

const snapshot = await client.request("status.snapshot");
const explain = await client.request("status.explain", { paneId: 1 });
console.log(`⑥ snapshot: ${JSON.stringify(snapshot.byPaneId["1"])}`);
console.log(`   explain: layers=${explain.manifests.map((layer) => layer.id).join("+")} evaluated=${explain.evaluated.length}`);
check("the daemon settles on blocked", snapshot.byPaneId["1"].state, "blocked");
check("authority is the screen (no hook reported)", snapshot.byPaneId["1"].authority, "screen");

// A hook report flips the authority, and the screen stops being consulted.
await client.request("pane.report_state", {
  paneId: 1,
  source: "agent-resume:claude",
  agent: "claude",
  state: "working",
  seq: Date.now() * 1000
});
const nativeSnapshot = await client.request("status.snapshot");
const nativeExplain = await client.request("status.explain", { paneId: 1 });
console.log(
  `⑦ after a hook report: ${JSON.stringify(nativeSnapshot.byPaneId["1"])}` +
    ` (evaluated=${nativeExplain.evaluated.length}, layers=${nativeExplain.manifests.length})`
);
check("native wins over the screen", nativeSnapshot.byPaneId["1"].state, "working");
check("native panes skip the rules", nativeExplain.evaluated.length, 0);

client.close();
daemon.kill("SIGTERM");
await new Promise((resolve) => setTimeout(resolve, 300));
rmSync(panelHome, { recursive: true, force: true });
mirror.dispose();

if (failures.length) {
  console.error("\nFAILED:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\nAll pipeline checks passed: bytes → side channels → screen text → rules → daemon → snapshot.");
process.exit(0);
