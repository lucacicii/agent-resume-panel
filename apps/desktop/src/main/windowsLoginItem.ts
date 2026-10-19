/**
 * The agent-status daemon's Windows login item.
 *
 * launchd has no Windows equivalent, and the daemon needs one thing launchd
 * gives for free: an environment (`ELECTRON_RUN_AS_NODE=1`) that turns the app
 * executable into a Node process. A registry `Run` value cannot carry
 * environment variables, so the login item points at a tiny `.cmd` shim that
 * sets them and starts the daemon.
 *
 * The shim lives next to the daemon's other state under
 * `<panelHome>\.desktop\agent-status\`, and the `Run` value carries our marker
 * (the shim path) so uninstall only removes what this module wrote.
 *
 * Electron-free so the daemon test can exercise it.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { atomicWriteFile } from "@agent-resume/core";

const execFileAsync = promisify(execFile);

/** `Run` value name. Stable, so an upgrade replaces its own entry. */
export const WINDOWS_LOGIN_ITEM_NAME = "AgentResumeAgentStatus";
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

export type WindowsLoginItemInput = {
  panelHome: string;
  execPath: string;
  entryPath: string;
  appVersion: string;
  notify?: boolean;
};

export type WindowsLoginItemResult = {
  /** Absolute path of the shim the `Run` value starts. */
  shimPath: string;
  /** True when this call created or changed the shim or the registry value. */
  changed: boolean;
  /** True when the `Run` value now points at this shim. */
  registered: boolean;
};

export function windowsLoginShimPath(panelHome: string): string {
  return path.join(panelHome, ".desktop", "agent-status", "agent-status-login.cmd");
}

function quoteCmdArg(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Render the shim.
 *
 * `set "VAR=value"` is the only quoting form that keeps trailing spaces and
 * `&` inside the value, and `@echo off` keeps the login item from flashing a
 * console for every line.
 */
export function renderWindowsLoginShim(input: WindowsLoginItemInput): string {
  const args = [
    input.entryPath,
    "--panel-home",
    input.panelHome,
    "--app-version",
    input.appVersion
  ];
  if (input.notify) args.push("--notify");
  return [
    "@echo off",
    "setlocal",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `set "AGENT_RESUME_PANEL_HOME=${input.panelHome}"`,
    `set "AGENT_RESUME_APP_VERSION=${input.appVersion}"`,
    `start "" /b ${[input.execPath, ...args].map(quoteCmdArg).join(" ")}`,
    "endlocal",
    ""
  ].join("\r\n");
}

/**
 * The `Run` value's command line.
 *
 * `cmd.exe /d /s /c ""<shim>""` is the documented way to start a batch file
 * with a path that may contain spaces: `/s` strips the outer pair of quotes and
 * everything between them is the command, and `/d` skips AutoRun commands so a
 * user's `cmd` profile cannot change what login does.
 */
export function windowsLoginItemCommand(shimPath: string): string {
  return `cmd.exe /d /s /c ""${shimPath}""`;
}

async function readRunValue(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("reg.exe", ["query", RUN_KEY, "/v", WINDOWS_LOGIN_ITEM_NAME], {
      windowsHide: true
    });
    // `    AgentResumeAgentStatus    REG_SZ    <command line>`
    const match = /REG_SZ\s+(.+?)\s*$/m.exec(stdout);
    return match?.[1] ?? "";
  } catch {
    return null;
  }
}

export async function isWindowsLoginItemInstalled(panelHome: string): Promise<boolean> {
  const shimPath = windowsLoginShimPath(panelHome);
  if (!existsSync(shimPath)) return false;
  const value = await readRunValue();
  return Boolean(value && value.includes(shimPath));
}

export async function installWindowsLoginItem(
  input: WindowsLoginItemInput
): Promise<WindowsLoginItemResult> {
  const shimPath = windowsLoginShimPath(input.panelHome);
  mkdirSync(path.dirname(shimPath), { recursive: true });
  const shim = renderWindowsLoginShim(input);

  const previousShim = existsSync(shimPath) ? await readText(shimPath) : null;
  const shimChanged = previousShim !== shim;
  if (shimChanged) await atomicWriteFile(shimPath, shim);
  const command = windowsLoginItemCommand(shimPath);
  const previous = await readRunValue();
  const registered = previous === command;
  if (!registered) {
    await execFileAsync(
      "reg.exe",
      ["add", RUN_KEY, "/v", WINDOWS_LOGIN_ITEM_NAME, "/t", "REG_SZ", "/d", command, "/f"],
      { windowsHide: true }
    );
  }
  return { shimPath, changed: shimChanged || !registered, registered: true };
}

export async function uninstallWindowsLoginItem(panelHome: string): Promise<{
  removed: boolean;
  shimPath: string;
}> {
  const shimPath = windowsLoginShimPath(panelHome);
  const value = await readRunValue();
  let removed = false;
  if (value && value.includes(shimPath)) {
    await execFileAsync("reg.exe", ["delete", RUN_KEY, "/v", WINDOWS_LOGIN_ITEM_NAME, "/f"], {
      windowsHide: true
    }).catch(() => undefined);
    removed = true;
  }
  if (existsSync(shimPath)) {
    await rm(shimPath, { force: true });
    removed = true;
  }
  return { removed, shimPath };
}

async function readText(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}
