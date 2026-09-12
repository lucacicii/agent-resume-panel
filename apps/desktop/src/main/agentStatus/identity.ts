/**
 * Naming a pane's agent.
 *
 * Two independent sources, because neither is complete on its own:
 *   - the process tree (authoritative whenever the agent runs as itself), and
 *   - the session the pane was opened for (`cli:<provider>`, a declared hint).
 *
 * npm-installed CLIs are the reason the process tree needs unwrapping: `pi` is a
 * `#!/usr/bin/env node` script, so `ps comm` reports `node` and only the argv
 * carries the name (`node /…/bin/pi`).
 *
 * Pure string and tree analysis — no I/O, no Electron.
 */

import type { ProcessEntry } from "./processTable";
import type { AgentKind } from "./types";

/** Executable basenames that name an agent, taken from the resume commands. */
const EXECUTABLE_KINDS: Record<string, AgentKind> = {
  claude: "claude",
  "claude-code": "claude",
  codex: "codex",
  pi: "pi",
  opencode: "opencode",
  opencode2: "opencode",
  "open-code": "opencode",
  grok: "grok",
  "grok-build": "grok",
  "cursor-agent": "cursor",
  agy: "agy",
  antigravity: "agy",
  "antigravity-cli": "agy",
  "prime-agent": "prime"
};

/** Interpreters that hide the agent behind a script argument. */
const JS_RUNTIMES = new Set(["node", "bun", "deno"]);

/** `AgentProvider` ids mapped onto an agent kind. */
const PROVIDER_KINDS: Record<string, AgentKind> = {
  claude: "claude",
  codex: "codex",
  pi: "pi",
  opencode: "opencode",
  grok: "grok",
  cursor: "cursor",
  agy: "agy",
  prime: "prime"
};

/**
 * Basename of an executable path, lowercased, with a JS extension removed so
 * `pi.js` (an npm bin shim target) still reads as `pi`.
 */
export function executableBaseName(value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return "";
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
  return base.replace(/\.(?:c|m)?js$/i, "").toLowerCase();
}

/** Kind named by an executable path (`…/.local/bin/claude` → claude). */
export function kindForExecutable(value: string): AgentKind | null {
  return EXECUTABLE_KINDS[executableBaseName(value)] ?? null;
}

/** Kind named by a provider id (`claude`, `cursor-ide`, …). */
export function kindForProvider(provider: string): AgentKind | null {
  return PROVIDER_KINDS[provider.trim().toLowerCase()] ?? null;
}

/** Kind declared by a session key: `cli:<provider>:<id>`. */
export function kindForSessionKey(sessionKey: string | undefined): AgentKind | null {
  if (!sessionKey) return null;
  const [channel, provider] = sessionKey.split(":");
  if (channel !== "cli") return null;
  return kindForProvider(provider ?? "");
}

/**
 * Agent hidden behind `<runtime> <script>`: the runtime is the process but the
 * script argument carries the identity.
 */
export function kindFromRuntimeArgv(argv: readonly string[]): AgentKind | null {
  if (argv.length < 2) return null;
  if (!JS_RUNTIMES.has(executableBaseName(argv[0] ?? ""))) return null;
  return kindForExecutable(argv[1] ?? "");
}

/** Kind for one process table row, whichever way its name is expressed. */
export function kindForProcess(entry: ProcessEntry): AgentKind | null {
  const direct = kindForExecutable(entry.command);
  if (direct) return direct;
  return entry.argv ? kindFromRuntimeArgv(entry.argv) : null;
}

/**
 * The agent running in a pane, if any.
 *
 * Breadth-first over the pty's descendants so the shallowest match wins: an
 * agent that spawns a tool in the foreground keeps owning the pane, and a
 * nested agent (a tool that itself launches one) does not steal it.
 */
export function findAgentProcess(
  entries: readonly ProcessEntry[],
  rootPid: number
): { entry: ProcessEntry; kind: AgentKind } | null {
  const byParent = new Map<number, ProcessEntry[]>();
  for (const entry of entries) {
    const bucket = byParent.get(entry.ppid);
    if (bucket) bucket.push(entry);
    else byParent.set(entry.ppid, [entry]);
  }

  const queue = [...(byParent.get(rootPid) ?? [])];
  const seen = new Set<number>();
  while (queue.length) {
    const entry = queue.shift()!;
    if (seen.has(entry.pid)) continue;
    seen.add(entry.pid);
    const kind = kindForProcess(entry);
    if (kind) return { entry, kind };
    queue.push(...(byParent.get(entry.pid) ?? []));
  }
  return null;
}
