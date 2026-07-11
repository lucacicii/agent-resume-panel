import { spawn } from "node:child_process";
import { AgentSession } from "../catalog/types";
import { expandHome } from "../pathUtils";
import { buildResumeCommand } from "./commands";

export type SystemTerminalLaunchMode = "pasteCommand" | "copyCommand" | "executeCommand";

export interface SystemTerminalSettings {
  externalLaunchMode?: SystemTerminalLaunchMode;
  externalAutoPasteDelayMs?: number;
}

export async function openProjectInSystemTerminal(projectPath: string): Promise<void> {
  const cwd = expandHome(projectPath);
  const shell = process.env.SHELL || "/bin/zsh";
  await launchSystemTerminal(cwd, shell, `cd ${shellQuote(cwd)} && exec ${shell} -l`);
}

export async function openSessionInSystemTerminal(
  session: AgentSession,
  settings: SystemTerminalSettings = {},
  clipboard?: { writeText: (text: string) => Promise<void> }
): Promise<{ copied?: boolean; message?: string }> {
  const launchMode = settings.externalLaunchMode || "executeCommand";
  const autoPasteDelayMs = settings.externalAutoPasteDelayMs ?? 900;
  const shell = process.env.SHELL || "/bin/zsh";
  const cwd = expandHome(session.projectPath);
  const resumeCommand = buildResumeCommand(session);
  const command = `cd ${shellQuote(cwd)} && ${resumeCommand}`;

  if (launchMode === "executeCommand") {
    await launchSystemTerminal(cwd, shell, command);
    return {};
  }

  if (clipboard) {
    await clipboard.writeText(resumeCommand);
  }
  await launchSystemTerminal(cwd, shell, `cd ${shellQuote(cwd)} && exec ${shell} -l`);

  if (launchMode === "copyCommand") {
    return { copied: true, message: "Resume command copied; paste into the terminal and press Enter." };
  }

  if (process.platform === "darwin") {
    await pasteIntoMacTerminal("Terminal", autoPasteDelayMs);
  }
  return {};
}

async function launchSystemTerminal(cwd: string, shell: string, command: string): Promise<void> {
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
    const inner = command.replace(/^cd\s+'[^']*'\s*&&\s*/, "");
    const winCmd = `cd /d ${quoteWindows(cwd)} && ${inner}`;
    await runDetached("cmd.exe", ["/c", "start", "cmd.exe", "/k", winCmd]);
    return;
  }

  const [terminal, ...terminalArgs] = resolveLinuxTerminalInvocation(cwd, shell, command);
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteWindows(value: string): string {
  if (!/\s/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
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