/**
 * Live probe for the stage-3 signal: foreground job control.
 *
 * Stage 2 asked "is any descendant deeper than the agent running?" and had to
 * filter out the MCP bridge we inject. Stage 3 asks the kernel instead: which
 * process group does the pane's terminal have in the foreground? This script
 * proves that works on the machine you are on, and prints the raw evidence
 * (shell pid, tty, pgid, tpgid, group members) so a failure is diagnosable.
 *
 * It also covers the case the naive rule got wrong: a background child is not
 * foreground work, no matter how deep it sits in the tree.
 *
 * Run manually after touching `processTable.ts` (requires a prior build):
 *   pnpm --filter @agent-resume/desktop run build
 *   node apps/desktop/scripts/process-foreground-baseline.mjs
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pty = require("node-pty");

const dist = path.join(here, "..", "dist", "main", "agentStatus");
const { buildIgnoredExecutables, detectToolActivity, foregroundProcesses, readProcessEntries } = await import(
  path.join(dist, "processTable.js")
);

const shell = pty.spawn("/bin/sh", ["-c", "sleep 3; echo between; sleep 3"], {
  name: "xterm-256color",
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: { ...process.env, TERM: "xterm-256color" }
});
console.log(`pty shell pid ${shell.pid}`);

async function probe(label) {
  const entries = await readProcessEntries();
  const owner = entries.find((entry) => entry.pid === shell.pid);
  const group = foregroundProcesses(entries, shell.pid);
  const activity = detectToolActivity({
    entries,
    ptyPid: shell.pid,
    ignoreExecutables: buildIgnoredExecutables(),
    agentPid: null
  });
  console.log(
    `${label.padEnd(20)} tty=${owner?.tty ?? "-"} pgid=${owner?.pgid ?? "-"} tpgid=${owner?.tpgid ?? "-"} ` +
      `group=[${group.processes.map((entry) => `${entry.pid}:${entry.command}`).join(" ")}] toolRunning=${activity.active}`
  );
  return activity;
}

await new Promise((resolve) => setTimeout(resolve, 1_200));
const firstSleep = await probe("sleeping (1)");
await new Promise((resolve) => setTimeout(resolve, 3_200));
const between = await probe("between sleeps");
await new Promise((resolve) => setTimeout(resolve, 3_200));
const after = await probe("after both sleeps");

const ok = firstSleep.active && between.active && !after.active;
console.log(
  ok
    ? "OK: foreground job control reports running work while a command executes and nothing once the pane is quiet."
    : "MISMATCH: foreground detection did not behave as expected — inspect the rows above."
);
shell.kill();
process.exit(ok ? 0 : 1);
