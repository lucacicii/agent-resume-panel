/**
 * A real launchd login item, as opposed to a plist we merely hope exists.
 *
 * `docs/design/agent-status.md` documented a `RunAtLoad` + `KeepAlive` agent at
 * `~/Library/LaunchAgents/dev.agentresume.agent-status.plist`, and the settings
 * pane reported whether it was installed. Nothing ever wrote it: the only code
 * in the repo was an `existsSync` + `launchctl print` check, so the pane showed
 * "not installed" forever and the daemon only ever ran while the app was open.
 * That is a real gap for work whose whole point is to run unattended.
 *
 * Rules this module follows, because it writes into the user's home:
 *
 * * **Idempotent.** Writing the same content twice is a no-op, so the app can
 *   call it on every launch without churning launchd.
 * * **Not ours to overwrite.** If a file already exists at the target path and
 *   does not carry our marker, install refuses rather than clobbering it.
 * * **Bootstrapped, not loaded.** `launchctl bootstrap`/`bootout` are the
 *   supported verbs; `load`/`unload` are deprecated and behave differently for
 *   an already-registered service.
 * * **Removable without residue.** Uninstall boots the service out and deletes
 *   only the file this module wrote.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * A comment line identifying the plist as ours.
 *
 * Ownership has to survive a reinstall by a newer build, so it is one short
 * token rather than a version — the version lives in `appVersion` below.
 */
export const LAUNCH_AGENT_MARKER = "dev.agentresume.managed";

export interface LaunchAgentSpec {
  /** launchd label, e.g. `dev.agentresume.agent-status`. */
  label: string;
  /** Executable launchd should run (here: the Electron binary in Node mode). */
  programArguments: string[];
  /** Extra environment for the service. */
  environment?: Record<string, string>;
  /** Working directory; defaults to the user's home. */
  workingDirectory?: string;
  /** Log file launchd appends stdout/stderr to. */
  logPath?: string;
  /** `RunAtLoad` — start as soon as the agent is bootstrapped (i.e. at login). */
  runAtLoad?: boolean;
  /** `KeepAlive` — restart on exit. */
  keepAlive?: boolean;
  /** Seconds launchd waits before respawning a fast-exiting service. */
  throttleIntervalSeconds?: number;
  /** Recorded in the plist for diagnostics; not interpreted by launchd. */
  appVersion?: string;
}

export interface LaunchAgentResult {
  /** Absolute path of the plist. */
  plistPath: string;
  /** True when this call created or changed the file. */
  changed: boolean;
  /** True when launchd now knows the service. */
  loaded: boolean;
}

export function launchAgentsDir(home: string = os.homedir()): string {
  return path.join(home, "Library", "LaunchAgents");
}

export function launchAgentPath(label: string, home: string = os.homedir()): string {
  return path.join(launchAgentsDir(home), `${label}.plist`);
}

function launchDomain(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return `gui/${uid}`;
}

function plistEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render the plist.
 *
 * Exported (and pure) so tests can assert the exact document without touching
 * launchd or the filesystem.
 */
export function renderLaunchAgentPlist(spec: LaunchAgentSpec): string {
  const runAtLoad = spec.runAtLoad !== false;
  const keepAlive = spec.keepAlive !== false;
  const stdoutPath = spec.logPath ?? "/dev/null";
  const stderrPath = spec.logPath ?? "/dev/null";

  const args = spec.programArguments
    .map((arg) => `    <string>${plistEscape(arg)}</string>`)
    .join("\n");

  const envEntries = Object.entries(spec.environment ?? {});
  const envBlock = envEntries.length
    ? `  <key>EnvironmentVariables</key>
  <dict>
${envEntries
  .map(([key, value]) => `    <key>${plistEscape(key)}</key>\n    <string>${plistEscape(value)}</string>`)
  .join("\n")}
  </dict>
`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${LAUNCH_AGENT_MARKER}${spec.appVersion ? ` appVersion=${plistEscape(spec.appVersion)}` : ""} -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistEscape(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
${envBlock}  <key>RunAtLoad</key>
  <${runAtLoad ? "true" : "false"}/>
  <key>KeepAlive</key>
  <${keepAlive ? "true" : "false"}/>
  <key>ThrottleInterval</key>
  <integer>${spec.throttleIntervalSeconds ?? 5}</integer>${
    spec.workingDirectory
      ? `\n  <key>WorkingDirectory</key>\n  <string>${plistEscape(spec.workingDirectory)}</string>`
      : ""
  }
  <key>StandardOutPath</key>
  <string>${plistEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${plistEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

/** True when the file exists and carries our marker (i.e. we may replace it). */
export function isManagedPlist(plistPath: string): boolean {
  try {
    const content = readFileSync(plistPath, "utf8");
    return content.includes(LAUNCH_AGENT_MARKER);
  } catch {
    return false;
  }
}

/** True when launchd currently knows the service. */
export async function isLaunchAgentLoaded(label: string): Promise<boolean> {
  try {
    await execFileAsync("launchctl", ["print", `${launchDomain()}/${label}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install (or refresh) the login item.
 *
 * Returns `changed: false` when the on-disk plist already matches, which is the
 * common case on every app launch after the first.
 */
export async function installLaunchAgent(
  spec: LaunchAgentSpec,
  home: string = os.homedir()
): Promise<LaunchAgentResult> {
  const plistPath = launchAgentPath(spec.label, home);

  if (existsSync(plistPath) && !isManagedPlist(plistPath)) {
    throw new Error(
      `${plistPath} already exists and was not created by this app; refusing to overwrite it.`
    );
  }

  const rendered = renderLaunchAgentPlist(spec);
  const previous = existsSync(plistPath) ? readFileSync(plistPath, "utf8") : null;
  const changed = previous !== rendered;

  if (changed) {
    mkdirSync(launchAgentsDir(home), { recursive: true });
    await fs.writeFile(plistPath, rendered, { mode: 0o644 });
  }

  // Boot out first: `bootstrap` fails on an already-registered label, and a
  // refresh must pick up the new document. Errors are ignored because "not
  // currently loaded" is the normal case.
  if (changed) {
    await execFileAsync("launchctl", ["bootout", `${launchDomain()}/${spec.label}`]).catch(
      () => undefined
    );
  }

  let loaded = await isLaunchAgentLoaded(spec.label);
  if (!loaded) {
    try {
      await execFileAsync("launchctl", ["bootstrap", launchDomain(), plistPath]);
      loaded = true;
    } catch (error) {
      // `bootstrap` also fails when the label is already loaded; re-check before
      // reporting failure so a benign race is not surfaced as an error.
      loaded = await isLaunchAgentLoaded(spec.label);
      if (!loaded) {
        throw new Error(
          `launchctl bootstrap failed for ${spec.label}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  return { plistPath, changed, loaded };
}

/**
 * Remove the login item.
 *
 * Only deletes a file this module wrote, so a hand-rolled plist at the same
 * path survives an uninstall.
 */
export async function uninstallLaunchAgent(
  label: string,
  home: string = os.homedir()
): Promise<{ removed: boolean; plistPath: string }> {
  const plistPath = launchAgentPath(label, home);

  await execFileAsync("launchctl", ["bootout", `${launchDomain()}/${label}`]).catch(
    () => undefined
  );

  if (!existsSync(plistPath)) return { removed: false, plistPath };
  if (!isManagedPlist(plistPath)) {
    throw new Error(
      `${plistPath} was not created by this app; leaving it alone.`
    );
  }

  await fs.rm(plistPath, { force: true });
  return { removed: true, plistPath };
}

/** Whether launchd knows the service *and* the plist is one of ours. */
export async function isLaunchAgentInstalled(
  label: string,
  home: string = os.homedir()
): Promise<boolean> {
  const plistPath = launchAgentPath(label, home);
  if (!existsSync(plistPath)) return false;
  if (!isManagedPlist(plistPath)) return false;
  return isLaunchAgentLoaded(label);
}
