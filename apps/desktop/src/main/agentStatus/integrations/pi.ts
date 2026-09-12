/**
 * Pi's status channel: a companion extension the app writes into `~/.pi/agent`.
 *
 * Pi has no hook catalogue to install into, but it does have an extension API —
 * so the extension subscribes to the UI prompt and turn lifecycle and writes the
 * same status escape sequence the sensor already parses from the terminal
 * stream. Nothing here talks to the daemon: the pane's bytes are the transport,
 * which is why this works even while the extension is the only thing loaded.
 *
 * The file is managed: reinstalling overwrites it, and it is written on startup.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const PI_EXTENSION_FILE = "agent-resume-bridge.ts";

export const PI_EXTENSION_CONTENT = `// Agent Resume companion bridge — reports agent status on the terminal stream.
// Managed file: reinstalling overwrites it. Add your own extensions beside it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function agentResumeBridge(pi: ExtensionAPI): void {
  const report = (state: "awaiting" | "running" | "idle", detail?: string): void => {
    try {
      process.stdout.write(\`\\x1b]633;AR;\${state}\${detail ? \`;\${detail}\` : ""}\\x07\`);
    } catch {
      // Reporting must never break the agent.
    }
  };

  pi.on("ui_prompt_start", async (event) => report("awaiting", event?.kind || "prompt"));
  pi.on("ui_prompt_end", async () => report("running"));
  pi.on("turn_start", async () => report("running"));
  pi.on("turn_end", async () => report("idle"));
}
`;

export function piExtensionPath(home: string = os.homedir()): string {
  return path.join(home, ".pi", "agent", "extensions", PI_EXTENSION_FILE);
}

export function piExtensionInstalled(home: string = os.homedir()): boolean {
  return existsSync(piExtensionPath(home));
}

/** Write the companion extension. Idempotent; returns its path. */
export function installPiExtension(home: string = os.homedir()): string {
  const target = piExtensionPath(home);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, PI_EXTENSION_CONTENT, { mode: 0o600 });
  return target;
}
