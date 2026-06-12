import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { AgentSession } from "../history";
import { buildResumeCommand } from "./commandBuilder";

export async function openProjectInGhostty(projectPath: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const ghosttyExecutable = config.get<string>("ghosttyExecutable", "Ghostty");

  try {
    await launchGhosttyShell(ghosttyExecutable, projectPath);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open Ghostty: ${formatError(error)}`);
  }
}

export async function openInGhostty(session: AgentSession): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const ghosttyExecutable = config.get<string>("ghosttyExecutable", "Ghostty");
  const launchMode = config.get<string>("ghosttyLaunchMode", "pasteCommand");
  const autoPasteDelayMs = config.get<number>("ghosttyAutoPasteDelayMs", 900);
  const shell = process.env.SHELL || "/bin/zsh";
  const resumeCommand = buildResumeCommand(session);

  try {
    if (launchMode === "executeCommand") {
      if (process.platform === "darwin") {
        await launchMacGhosttyApp(ghosttyExecutable, session.projectPath, shell, resumeCommand);
        return;
      }

      await launchGhosttyCli(ghosttyExecutable, session.projectPath, shell, resumeCommand);
      return;
    }

    if (launchMode === "copyCommand" || process.platform !== "darwin") {
      await vscode.env.clipboard.writeText(resumeCommand);
      await launchGhosttyShell(ghosttyExecutable, session.projectPath);
      vscode.window.showInformationMessage("Ghostty opened. Resume command copied; paste it into Ghostty and press Enter.");
      return;
    }

    await vscode.env.clipboard.writeText(resumeCommand);
    await launchGhosttyShell(ghosttyExecutable, session.projectPath);
    await pasteClipboardAndSubmit(ghosttyExecutable, autoPasteDelayMs);
  } catch (error) {
    if (launchMode === "pasteCommand") {
      vscode.window.showErrorMessage(
        `Ghostty opened and the resume command was copied, but auto paste failed: ${formatError(error)}`
      );
      return;
    }

    vscode.window.showErrorMessage(`Failed to open Ghostty: ${formatError(error)}`);
  }
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
