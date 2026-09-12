/**
 * Offline rule mining and triage.
 *
 * The online LLM adjudicator was deleted on purpose: paying per tick to guess
 * what a screen means is worse than writing the rule once. This script is where
 * the model still helps — offline, reviewing evidence a human collected.
 *
 * Modes:
 *   node apps/desktop/scripts/agent-status-mine.mjs
 *     Triage the fixtures: verdicts, stale expectations, and fixtures no rule
 *     matches (each one is either a missing rule or an acceptable `null`).
 *
 *   node apps/desktop/scripts/agent-status-mine.mjs --screens <dir> [--agent claude]
 *     Triage captured real screens (see agent-status-capture.mjs) the same way.
 *
 *   node apps/desktop/scripts/agent-status-mine.mjs --propose <agent>/<case>
 *     Ask the configured tool model for one candidate rule that explains a
 *     fixture, printed as JSON to review and paste into the manifest. Requires a
 *     configured provider in the panel-home settings.
 *
 * Run `pnpm --filter @agent-resume/desktop run build` first: the engine is loaded
 * from dist so the script judges screens exactly like the daemon does.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const engineDist = path.join(here, "..", "dist", "main", "agentStatus", "engine");
const fixturesDir = path.join(here, "..", "src", "main", "agentStatus", "engine", "fixtures");
const manifestsDir = path.join(here, "..", "src", "main", "agentStatus", "engine", "manifests");

const { createManifestRegistry } = await import(path.join(engineDist, "registry.js"));
const { evaluateRules } = await import(path.join(engineDist, "evaluate.js"));

const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const registry = createManifestRegistry({ dir: manifestsDir });
for (const warning of registry.warnings()) console.warn(`warning: ${warning}`);

const expectedPath = path.join(fixturesDir, "expected.json");
const expected = JSON.parse(readFileSync(expectedPath, "utf8"));

function judge(agent, screenText, side = {}) {
  const manifest = registry.forAgent(agent);
  if (!manifest) return null;
  return evaluateRules(manifest, {
    paneId: 0,
    at: 0,
    screenText,
    cursorHidden: side.cursorHidden === true,
    oscTitle: side.oscTitle ?? "",
    oscProgress: side.oscProgress ?? ""
  });
}

function triage(label, agent, screenText, side) {
  const result = judge(agent, screenText, side);
  const verdict = result?.verdict ?? null;
  const rule = verdict ? `${verdict.matchedRule.id} [${verdict.matchedRule.manifest}]` : "—";
  console.log(
    `${label.padEnd(38)} ${String(verdict?.state ?? "no match").padEnd(9)} ${String(verdict?.source ?? "").padEnd(7)} ${rule}`
  );
  return verdict;
}

// --------------------------------------------------------------- fixture triage

if (!args.includes("--screens") && !args.includes("--propose")) {
  let gaps = 0;
  let stale = 0;
  for (const agent of readdirSync(fixturesDir, { withFileTypes: true })) {
    if (!agent.isDirectory()) continue;
    for (const file of readdirSync(path.join(fixturesDir, agent.name)).sort()) {
      if (!file.endsWith(".txt")) continue;
      const key = `${agent.name}/${file.replace(/\.txt$/, "")}`;
      const expectation = expected[key];
      const screenText = readFileSync(path.join(fixturesDir, agent.name, file), "utf8");
      const verdict = triage(key, agent.name, screenText, {
        cursorHidden: expectation?.cursorHidden,
        oscTitle: expectation?.oscTitle,
        oscProgress: expectation?.oscProgress
      });

      if (!expectation) {
        console.log(`  ↳ no expectation yet; add one to expected.json`);
        gaps += 1;
        continue;
      }
      const state = verdict?.state ?? null;
      if (state !== expectation.state) {
        console.log(`  ↳ expectation says ${expectation.state ?? "no match"}; the engine disagrees`);
        stale += 1;
      } else if (expectation.rule && verdict?.matchedRule.id !== expectation.rule) {
        console.log(`  ↳ expectation pins ${expectation.rule}; ${verdict?.matchedRule.id} won instead`);
        stale += 1;
      } else if (state === null) {
        gaps += 1;
      }
    }
  }
  console.log("");
  console.log(`${Object.keys(expected).length} expectations, ${gaps} without a rule, ${stale} stale`);
  process.exit(stale > 0 ? 1 : 0);
}

// --------------------------------------------------------------- screen triage

const screensDir = argValue("--screens");
if (screensDir) {
  if (!existsSync(screensDir)) {
    console.error(`No such directory: ${screensDir}`);
    process.exit(1);
  }
  const agents = (argValue("--agent") ?? "unknown").split(",");
  for (const file of readdirSync(screensDir).sort()) {
    if (!file.endsWith(".txt")) continue;
    for (const agent of agents) {
      triage(`${path.basename(file)} (${agent})`, agent.trim(), readFileSync(path.join(screensDir, file), "utf8"), {});
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------- rule proposal

const proposal = argValue("--propose");
if (proposal) {
  const [agent, caseName] = proposal.split("/");
  const fixture = path.join(fixturesDir, agent ?? "", `${caseName ?? ""}.txt`);
  if (!existsSync(fixture)) {
    console.error(`No such fixture: ${fixture}`);
    process.exit(1);
  }
  const screenText = readFileSync(fixture, "utf8");
  const manifestPath = path.join(manifestsDir, `${agent}.json`);
  const currentManifest = existsSync(manifestPath) ? readFileSync(manifestPath, "utf8") : "(none)";
  const result = judge(agent, screenText, { cursorHidden: expected[proposal]?.cursorHidden });
  console.log(`current verdict for ${proposal}: ${result?.verdict?.state ?? "no match"}`);
  for (const row of result?.evaluated ?? []) {
    console.log(`  ${row.matched ? "MATCH" : "     "} ${row.id} [${row.manifest}] — ${row.reason}`);
  }

  const { loadSettings, llmConfigForUse, chatCompletionDetailed } = require("@agent-resume/core");
  const panelHome = process.env.AGENT_RESUME_PANEL_HOME?.trim()
    || path.join(process.env.HOME ?? "", ".agent-resume-panel");
  const settings = await loadSettings(panelHome);
  const config = llmConfigForUse(settings, "tool");
  if (!config) {
    console.error("");
    console.error("No tool model is configured in this panel home, so no proposal can be made.");
    console.error("Configure a provider in Desktop settings, or write the rule by hand.");
    process.exit(1);
  }

  const schema = readFileSync(path.join(here, "..", "src", "main", "agentStatus", "engine", "manifests", "generic.json"), "utf8");
  const prompt = [
    "You write screen-detection rules for a coding-agent status panel.",
    "Decide the pane state by the same discipline the existing rules use: several independent signals,",
    "never one loose keyword; prefer `atLeast` option-line counting over prose matching; add `not` gates",
    "for the neighbouring states a rule must not swallow.",
    "",
    "Return ONLY compact JSON for one rule with this shape:",
    '{ "id": "snake_case", "state": "blocked|working|idle|unknown", "priority": 0-1000,',
    '  "region": "whole_recent|bottom_non_empty_lines(n)|top_non_empty_lines(n)|after_last_horizontal_rule|osc_title|osc_progress",',
    '  "visibleBlocker": true, "contains": [], "regex": [], "lineRegex": [], "any": [], "not": [] }',
    "",
    "Example manifest for reference:",
    schema,
    "",
    `Existing rules for ${agent}:`,
    currentManifest,
    "",
    "The screen to explain (between the fences):",
    "```",
    screenText,
    "```"
  ].join("\n");

  const reply = await chatCompletionDetailed(config, [
    { role: "system", content: "You output a single JSON rule and nothing else." },
    { role: "user", content: prompt }
  ], 800);
  console.log("");
  console.log("candidate rule (review before pasting):");
  console.log(reply.text?.trim() || "(empty reply)");
  process.exit(0);
}
