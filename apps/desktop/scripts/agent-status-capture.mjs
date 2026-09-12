/**
 * Capture a pane's screen into the rule fixtures.
 *
 * Screen rules are only as good as the screens they were written against, so the
 * workflow when a pane is misjudged is: capture it, add an expectation, fix the
 * rule. This script does the capture half — it asks the running daemon for the
 * exact bytes the engine judged, writes them as a fixture, and prints the
 * `expected.json` entry to fill in.
 *
 * Usage (Desktop must be running, with the pane visible):
 *   node apps/desktop/scripts/agent-status-capture.mjs --list
 *   node apps/desktop/scripts/agent-status-capture.mjs --pane 3 --name blocked-form-claude
 *
 * Reads the panel home from AGENT_RESUME_PANEL_HOME (default: ~/.agent-resume-panel).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist", "main", "agentStatus");
const fixturesDir = path.join(here, "..", "src", "main", "agentStatus", "engine", "fixtures");

const { agentStatusPaths } = await import(path.join(dist, "paths.js"));
const { readLiveEndpoint } = await import(path.join(dist, "endpoint.js"));
const { connectAgentStatusClient } = await import(path.join(dist, "client.js"));

const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const panelHome = process.env.AGENT_RESUME_PANEL_HOME?.trim()
  || path.join(process.env.HOME ?? "", ".agent-resume-panel");
const paths = agentStatusPaths(panelHome);
const endpoint = await readLiveEndpoint(paths);
if (!endpoint) {
  console.error(`No agent-status daemon is listening under ${panelHome}.`);
  console.error("Start Agent Resume Desktop, or set AGENT_RESUME_PANEL_HOME.");
  process.exit(1);
}

const client = await connectAgentStatusClient({ socketPath: paths.socket, role: "cli", appVersion: "capture" });
const snapshot = await client.request("status.snapshot");
const panes = Object.values(snapshot.byPaneId ?? {});

if (args.includes("--list") || panes.length === 0) {
  console.log(`panes known to the daemon (${panes.length}):`);
  for (const pane of panes) {
    console.log(
      `  pane ${pane.paneId}  agent=${pane.agent}  state=${pane.state}  source=${pane.source}` +
        `${pane.matchedRule ? `  rule=${pane.matchedRule.id}` : ""}`
    );
  }
  client.close();
  process.exit(0);
}

const paneId = Number(argValue("--pane") ?? panes[0].paneId);
const dump = await client.request("pane.screen", { paneId });
client.close();
if (!dump) {
  console.error(`The daemon does not know pane ${paneId}.`);
  process.exit(1);
}

const name = (argValue("--name") ?? `${dump.agent}-${new Date().toISOString().slice(0, 10)}`).replace(/[^a-z0-9-_]/gi, "-");
const agentDir = path.join(fixturesDir, dump.agent);
if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });
const target = path.join(agentDir, `${name}.txt`);
writeFileSync(target, dump.screenText.endsWith("\n") ? dump.screenText : `${dump.screenText}\n`, "utf8");

const expectedPath = path.join(fixturesDir, "expected.json");
const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
const current = expected[`${dump.agent}/${name}`];

console.log(`captured pane ${paneId} → ${path.relative(process.cwd(), target)}`);
console.log(`verdict now: ${dump.state} (${dump.source})${dump.reason ? ` — ${dump.reason}` : ""}`);
if (dump.matchedRule) console.log(`matched rule: ${dump.matchedRule.id} [${dump.matchedRule.manifest}]`);
if (dump.oscTitle || dump.oscProgress || dump.cursorHidden) {
  console.log(
    `capture side channels: oscTitle=${JSON.stringify(dump.oscTitle)} oscProgress=${JSON.stringify(dump.oscProgress)} cursorHidden=${dump.cursorHidden}`
  );
}
console.log("");
console.log(`add to ${path.relative(process.cwd(), expectedPath)}:`);
console.log(
  `  "${dump.agent}/${name}": ${JSON.stringify({
    state: dump.state,
    rule: dump.matchedRule?.id,
    manifest: dump.matchedRule?.manifest,
    ...(dump.oscTitle ? { oscTitle: dump.oscTitle } : {}),
    ...(dump.cursorHidden ? { cursorHidden: true } : {})
  })}`
);
if (current) {
  console.log("");
  console.log(`note: an expectation already exists for this fixture: ${JSON.stringify(current)}`);
}
