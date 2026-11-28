import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { AgentSession } from "../history";
import { basenameOrPath } from "../history/pathUtils";
import { t } from "../i18n";
import {
  createAlmaThread,
  ensureAlmaWorkspaceId,
  isAlmaApiRunning,
  openAlmaThreadRef,
  sendAlmaThreadMessage,
  waitForAlmaApi
} from "./almaApi";

async function ensureAlmaRunningForUserAction(promptMessage: string): Promise<boolean> {
  if (await isAlmaApiRunning()) {
    return true;
  }

  if (process.platform === "darwin") {
    const openAction = t("alma.openAppAction");
    const picked = await vscode.window.showWarningMessage(promptMessage, openAction);
    if (picked !== openAction) {
      return false;
    }
    focusAlmaApp();
    const ready = await waitForAlmaApi();
    if (!ready) {
      vscode.window.showWarningMessage(t("alma.stillStarting"));
    }
    return ready;
  }

  vscode.window.showWarningMessage(t("alma.notRunning"));
  return false;
}

export async function openAlmaThread(session: AgentSession): Promise<void> {
  if (session.provider !== "alma") {
    return;
  }

  if (!(await ensureAlmaRunningForUserAction(t("alma.startBeforeResume")))) {
    return;
  }

  try {
    await openAlmaThreadRef(session.id);
    focusAlmaApp();
  } catch (error) {
    vscode.window.showErrorMessage(t("alma.failedOpenThread", formatError(error)));
  }
}

export async function openNewAlmaSession(projectPath: string): Promise<void> {
  const projectName = basenameOrPath(projectPath);
  if (!(await ensureAlmaRunningForUserAction(t("alma.startBeforeNewSession")))) {
    return;
  }

  try {
    const workspaceId = await ensureAlmaWorkspaceId(projectPath, projectName);
    const thread = await createAlmaThread("New Thread", workspaceId);
    await openAlmaThreadRef(thread.id);
    focusAlmaApp();
    vscode.window.showInformationMessage(t("alma.openedNewChat", projectName));
  } catch (error) {
    vscode.window.showErrorMessage(t("alma.failedOpenNewChat", formatError(error)));
  }
}

export async function deliverHandoffToAlma(input: {
  title: string;
  projectPath: string;
  message: string;
}): Promise<string> {
  if (!(await isAlmaApiRunning())) {
    throw new Error(t("alma.notRunning"));
  }

  const projectName = basenameOrPath(input.projectPath);
  const workspaceId = await ensureAlmaWorkspaceId(input.projectPath, projectName);
  const thread = await createAlmaThread(input.title, workspaceId);
  await sendAlmaThreadMessage(thread.id, input.message);
  await openAlmaThreadRef(thread.id);
  focusAlmaApp();
  return thread.id;
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
