import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { AgentSession } from "../history";
import { t } from "../i18n";
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
    const openAnyway = t("dialog.buttonOpenAlma");
    const picked = await vscode.window.showWarningMessage(
      t("warning.almaNotRunningResume"),
      openAnyway
    );
    if (picked !== openAnyway) {
      return;
    }
    focusAlmaApp();
  }

  try {
    await navigateAlmaThreadInUi(session.title);
    vscode.window.showInformationMessage(t("notification.almaSwitchedThread", truncate(session.title, 48)));
  } catch (error) {
    vscode.window.showErrorMessage(t("error.failedOpenAlmaThread", formatError(error)));
  }
}

export async function openNewAlmaSession(projectPath: string, almaDataDir: string): Promise<void> {
  const projectName = basenameOrPath(projectPath);
  let apiReady = await isAlmaApiRunning();
  if (!apiReady) {
    const openAnyway = t("dialog.buttonOpenAlma");
    const picked = await vscode.window.showWarningMessage(
      t("warning.almaNotRunningNewSession"),
      openAnyway
    );
    if (picked !== openAnyway) {
      return;
    }
    focusAlmaApp();
    apiReady = await waitForAlmaApi();
    if (!apiReady) {
      vscode.window.showWarningMessage(t("warning.almaStillStarting", projectName));
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
    vscode.window.showInformationMessage(t("notification.almaOpenedNewChat", projectName));
  } catch (error) {
    vscode.window.showErrorMessage(t("error.failedOpenAlmaWorkspace", formatError(error)));
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