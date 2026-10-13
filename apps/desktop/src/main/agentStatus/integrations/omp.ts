/**
 * OMP's status channel: a companion extension the app writes into `~/.omp/agent/extensions`.
 *
 * OMP runs on the `@oh-my-pi/pi-coding-agent` extension runtime and emits
 * `agent_start`, `agent_end`, `tool_approval_requested` / `tool_approval_resolved`,
 * and `tool_execution_start` / `tool_execution_end` (for interactive `ask`).
 * Writing the `633;AR;<state>` escape sequence directly onto stdout lets the
 * pane sensor track exact state without a separate socket round-trip.
 *
 * Nested subagents or bash children spawned by OMP inherit `OMPCODE=1`; the
 * extension ignores those so subagent turns never clobber the root pane state.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const OMP_EXTENSION_FILE = "agent-resume-bridge.ts";

const OMP_EXTENSION_CONTENT = `// Agent Resume companion bridge for OMP — reports agent status on the terminal stream.
// Managed file: reinstalling overwrites it. Add your own extensions beside it.
// @ts-nocheck

const nestedOmpSession = process.env.OMPCODE === "1";

export default function agentResumeOmpBridge(pi) {
  if (nestedOmpSession || !pi || typeof pi.on !== "function") {
    return;
  }

  const report = (state, detail) => {
    try {
      const clean = detail ? String(detail).replace(/[\\x00-\\x1f\\x7f;]/g, " ").trim().slice(0, 80) : "";
      process.stdout.write(\`\\x1b]633;AR;\${state}\${clean ? \`;\${clean}\` : ""}\\x07\`);
    } catch {
      // Reporting must never break the agent.
    }
  };

  pi.on("ui_prompt_start", async (event) => report("awaiting", event?.kind || "prompt"));
  pi.on("ui_prompt_end", async () => report("running"));
  pi.on("tool_approval_requested", async (event) => {
    report("awaiting", event?.reason || (event?.toolName ? \`\${event.toolName} approval\` : "approval"));
  });
  pi.on("tool_approval_resolved", async () => report("running"));
  pi.on("tool_execution_start", async (event) => {
    if (event?.toolName === "ask") {
      report("awaiting", "question");
    }
  });
  pi.on("tool_execution_end", async (event) => {
    if (event?.toolName === "ask") {
      report("running");
    }
  });
  pi.on("turn_start", async () => report("running"));
  pi.on("agent_start", async () => report("running"));
  pi.on("agent_end", async (event) => {
    if (event?.willContinue === true) return;
    report("idle");
  });
}
`;

export function ompExtensionPath(home: string = os.homedir()): string {
  const base = home.trim() || os.homedir();
  return path.join(base, ".omp", "agent", "extensions", OMP_EXTENSION_FILE);
}

export function ompExtensionInstalled(home: string = os.homedir()): boolean {
  const target = ompExtensionPath(home);
  return existsSync(target);
}

/** Write the companion extension. Idempotent; returns its path. */
export function installOmpExtension(home: string = os.homedir()): string {
  const target = ompExtensionPath(home);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, OMP_EXTENSION_CONTENT, { mode: 0o600 });
  return target;
}
