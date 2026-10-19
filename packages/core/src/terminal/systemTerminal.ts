import { spawn } from "node:child_process";
import { AgentSession } from "../catalog/types";
import { expandHome } from "../pathUtils";
import { defaultShellKind, quoteCmd, quotePowerShell, quotePosix, type ShellKind } from "../platform";
import { buildResumeArgv, joinForShell } from "./commands";

export type SystemTerminalLaunchMode = "pasteCommand" | "copyCommand" | "executeCommand";

export interface SystemTerminalSettings {
  externalLaunchMode?: SystemTerminalLaunchMode;
  externalAutoPasteDelayMs?: number;
}

export async function openProjectInSystemTerminal(projectPath: string): Promise<void> {
  const cwd = expandHome(projectPath);
  await launchSystemTerminal(cwd, buildInteractiveCommand(cwd));
}

export async function openCommandInSystemTerminal(
  projectPath: string,
  commandText: string,
  settings: SystemTerminalSettings = {},
  clipboard?: { writeText: (text: string) => Promise<void> }
): Promise<{ copied?: boolean; message?: string }> {
  const command = commandText.trim();
  if (!command) throw new Error("Command is required.");

  const launchMode = settings.externalLaunchMode || "executeCommand";
  const autoPasteDelayMs = settings.externalAutoPasteDelayMs ?? 900;
  const cwd = expandHome(projectPath);

  if (launchMode === "executeCommand") {
    await launchSystemTerminal(cwd, changeDirectoryCommand(cwd, defaultShellKind()) + " && " + command);
    return {};
  }

  if (clipboard) {
    await clipboard.writeText(command);
  }
  await launchSystemTerminal(cwd, buildInteractiveCommand(cwd));

  if (launchMode === "copyCommand") {
    return { copied: true, message: "Command copied; paste into the terminal and press Enter." };
  }

  if (process.platform === "darwin") {
    await pasteIntoMacTerminal("Terminal", autoPasteDelayMs);
  }
  return {};
}

export async function openSessionInSystemTerminal(
  session: AgentSession,
  settings: SystemTerminalSettings = {},
  clipboard?: { writeText: (text: string) => Promise<void> },
  contextFile?: string
): Promise<{ copied?: boolean; message?: string }> {
  const cwd = expandHome(session.projectPath);
  const resumeCommand = joinForShell(buildResumeArgv(session, contextFile), defaultShellKind());
  const result = await openCommandInSystemTerminal(
    cwd,
    resumeCommand,
    settings,
    clipboard
  );
  return result.copied
    ? { ...result, message: "Resume command copied; paste into the terminal and press Enter." }
    : result;
}

/** `cd <dir>` for the shell that will run it. */
export function changeDirectoryCommand(cwd: string, shell: ShellKind): string {
  if (shell === "cmd") return `cd /d ${quoteCmd(cwd)}`;
  if (shell === "powershell") return `Set-Location -LiteralPath ${quotePowerShell(cwd)}`;
  return `cd ${quotePosix(cwd)}`;
}

function buildInteractiveCommand(cwd: string): string {
  const shell = defaultShellKind();
  if (process.platform === "win32") {
    // A fresh PowerShell/cmd window already starts in `cwd` because it is
    // spawned with that working directory; nothing to run.
    return "";
  }
  return `${changeDirectoryCommand(cwd, shell)} && exec ${process.env.SHELL || "/bin/zsh"} -l`;
}

async function launchSystemTerminal(cwd: string, command: string): Promise<void> {
  if (process.platform === "darwin") {
    await runCommand("osascript", [
      "-e",
      'tell application "Terminal" to activate',
      "-e",
      `tell application "Terminal" to do script ${JSON.stringify(command)}`
    ]);
    return;
  }

  if (process.platform === "win32") {
    // `start` is a cmd builtin. An empty title argument is required so a quoted
    // command is not mistaken for the window title.
    const winCmd = command ? `cd /d ${quoteCmd(cwd)} && ${command}` : "";
    await runDetached("cmd.exe", ["/d", "/s", "/c", "start", "", "cmd.exe", "/k", winCmd]);
    return;
  }

  const [terminal, ...terminalArgs] = resolveLinuxTerminalInvocation(cwd, process.env.SHELL || "/bin/zsh", command);
  await runDetached(terminal, terminalArgs);
}

function resolveLinuxTerminalInvocation(
  cwd: string,
  shell: string,
  command: string
): [string, ...string[]] {
  const term = (process.env.TERMINAL || process.env.XTERMINAL || "x-terminal-emulator").trim();
  const base = term.split(/\s+/)[0] || "x-terminal-emulator";

  if (base.includes("gnome-terminal") || term.startsWith("gnome-terminal")) {
    return [base, "--working-directory", cwd, "--", shell, "-lc", command];
  }
  if (base.includes("konsole")) {
    return [base, "--workdir", cwd, "-e", shell, "-lc", command];
  }
  if (base.includes("xfce4-terminal")) {
    return [base, "--working-directory", cwd, "-e", `${shell} -lc ${command}`];
  }

  return [base, "-e", `${shell} -lc ${command}`];
}

async function pasteIntoMacTerminal(appName: string, delayMs: number): Promise<void> {
  const delaySeconds = Math.max(0, delayMs) / 1000;
  await runCommand("osascript", [
    "-e",
    `tell application ${JSON.stringify(appName)} to activate`,
    "-e",
    `delay ${delaySeconds}`,
    "-e",
    "tell application \"System Events\"",
    "-e",
    "keystroke \"v\" using command down",
    "-e",
    "key code 36",
    "-e",
    "end tell"
  ]);
}

function runDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore"
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}
