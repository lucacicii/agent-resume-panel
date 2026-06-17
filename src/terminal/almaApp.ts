import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { AgentSession } from "../history";
import { basenameOrPath } from "../history/pathUtils";
import {
  ensureAlmaWorkspaceId,
  isAlmaApiRunning,
  navigateAlmaThreadInUi,
  openAlmaNewChatInUi,
  setAlmaDefaultWorkspace,
  waitForAlmaApi
} from "./almaApi";

export async function openAlmaThread(session: AgentSession): Promise<void> {
  if (session.provider !== "alma") {
    return;
  }

  const running = await isAlmaApiRunning();
  if (!running) {
    const openAnyway = "Open Alma";
    const picked = await vscode.window.showWarningMessage(
      "Alma does not appear to be running. Start Alma first, then resume the thread.",
      openAnyway
    );
    if (picked !== openAnyway) {
      return;
    }
    focusAlmaApp();
  }

  try {
    await navigateAlmaThreadInUi(session.title);
    vscode.window.showInformationMessage(`Switched Alma to "${truncate(session.title, 48)}".`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open Alma thread: ${formatError(error)}`);
  }
}

export async function openNewAlmaSession(projectPath: string, almaDataDir: string): Promise<void> {
  const projectName = basenameOrPath(projectPath);
  let apiReady = await isAlmaApiRunning();
  if (!apiReady) {
    const openAnyway = "Open Alma";
    const picked = await vscode.window.showWarningMessage(
      "Alma does not appear to be running. Open Alma and set the project workspace?",
      openAnyway
    );
    if (picked !== openAnyway) {
      return;
    }
    focusAlmaApp();
    apiReady = await waitForAlmaApi();
    if (!apiReady) {
      vscode.window.showWarningMessage(
        `Alma is still starting. Open a new chat in Alma and select workspace "${projectName}".`
      );
      return;
    }
  }

  try {
    const workspaceId = await ensureAlmaWorkspaceId(almaDataDir, projectPath, projectName);
    await setAlmaDefaultWorkspace(workspaceId);
    if (process.platform === "darwin") {
      await openAlmaNewChatInUi();
    } else {
      focusAlmaApp();
    }
    vscode.window.showInformationMessage(`Opened a new Alma chat in "${projectName}".`);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to open Alma workspace: ${formatError(error)}`);
  }
}

function focusAlmaApp(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const child = spawn("open", ["-a", "Alma"], {
    detached: true,
    stdio: "ignore"
  });
  child.once("spawn", () => child.unref());
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}