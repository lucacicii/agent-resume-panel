import { spawn } from "node:child_process";
import { AgentSession } from "../catalog/types";
import { buildResumeCommand } from "./commands";

export type GhosttyLaunchMode = "pasteCommand" | "copyCommand" | "executeCommand";

export interface GhosttySettings {
  ghosttyExecutable?: string;
  ghosttyLaunchMode?: GhosttyLaunchMode;
  ghosttyAutoPasteDelayMs?: number;
}

export async function openProjectInGhostty(
  projectPath: string,
  settings: GhosttySettings = {}
): Promise<void> {
  const ghosttyExecutable = settings.ghosttyExecutable?.trim() || "Ghostty";
  await launchGhosttyShell(ghosttyExecutable, projectPath);
}

export async function openSessionInGhostty(
  session: AgentSession,
  settings: GhosttySettings = {},
  clipboard?: { writeText: (text: string) => Promise<void> }
): Promise<{ copied?: boolean; message?: string }> {
  const ghosttyExecutable = settings.ghosttyExecutable?.trim() || "Ghostty";
  const launchMode = settings.ghosttyLaunchMode || "pasteCommand";
  const autoPasteDelayMs = settings.ghosttyAutoPasteDelayMs ?? 900;
  const shell = process.env.SHELL || "/bin/zsh";
  const resumeCommand = buildResumeCommand(session);

  if (launchMode === "executeCommand") {
    if (process.platform === "darwin") {
      await launchMacGhosttyApp(ghosttyExecutable, session.projectPath, shell, resumeCommand);
      return {};
    }
    await launchGhosttyCli(ghosttyExecutable, session.projectPath, shell, resumeCommand);
    return {};
  }

  if (launchMode === "copyCommand" || process.platform !== "darwin") {
    if (clipboard) {
      await clipboard.writeText(resumeCommand);
    }
    await launchGhosttyShell(ghosttyExecutable, session.projectPath);
    return { copied: true, message: "Resume command copied; paste into Ghostty and press Enter." };
  }

  if (clipboard) {
    await clipboard.writeText(resumeCommand);
  }
  await launchGhosttyShell(ghosttyExecutable, session.projectPath);
  await pasteClipboardAndSubmit(ghosttyExecutable, autoPasteDelayMs);
  return {};
}

async function launchGhosttyShell(appOrExecutable: string, cwd: string): Promise<void> {
  if (process.platform === "darwin") {
    await runDetached("open", ["-na", appOrExecutable, "--args", `--working-directory=${cwd}`]);
    return;
  }

  await runDetached(appOrExecutable, [`--working-directory=${cwd}`]);
}

async function launchMacGhosttyApp(
  appName: string,
  cwd: string,
  shell: string,
  command: string
): Promise<void> {
  try {
    await runDetached("open", [
      "-na",
      appName,
      "--args",
      `--working-directory=${cwd}`,
      "-e",
      shell,
      "-lc",
      command
    ]);
  } catch (openError) {
    const cliCandidate = appName === "Ghostty" ? "ghostty" : appName;
    try {
      await launchGhosttyCli(cliCandidate, cwd, shell, command);
    } catch {
      throw openError;
    }
  }
}

async function launchGhosttyCli(
  executable: string,
  cwd: string,
  shell: string,
  command: string
): Promise<void> {
  await runDetached(executable, [`--working-directory=${cwd}`, "-e", shell, "-lc", command]);
}

async function pasteClipboardAndSubmit(appName: string, delayMs: number): Promise<void> {
  const normalizedAppName = appName.endsWith(".app") ? appName.slice(0, -4) : appName;
  const delaySeconds = Math.max(0, delayMs) / 1000;

  await runCommand("osascript", [
    "-e",
    `tell application ${appleScriptString(normalizedAppName)} to activate`,
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

function appleScriptString(value: string): string {
  return JSON.stringify(value);
}