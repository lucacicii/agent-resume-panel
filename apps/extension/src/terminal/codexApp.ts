import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { t } from "../i18n";
import { basenameOrPath } from "../history/pathUtils";
import { AgentSession } from "../history";

function buildChatGptThreadUrl(sessionId: string): string {
  const threadId = sessionId.trim();
  if (!threadId) {
    throw new Error("Session id is missing.");
  }
  return `codex://threads/${encodeURIComponent(threadId)}`;
}

function buildChatGptNewTaskUrl(projectPath: string): string {
  const params = new URLSearchParams();
  params.set("path", projectPath);
  return `codex://threads/new?${params.toString()}`;
}

async function openChatGptDeepLink(url: string): Promise<void> {
  const uri = vscode.Uri.parse(url);
  const opened = await vscode.env.openExternal(uri);
  if (opened) {
    return;
  }

  if (process.platform === "darwin") {
    await runOpen(url);
    return;
  }

  throw new Error("Could not open ChatGPT desktop app.");
}

export async function openCodexAppSession(session: AgentSession): Promise<void> {
  if (session.provider !== "codex") {
    return;
  }

  try {
    await openChatGptDeepLink(buildChatGptThreadUrl(session.id));
    vscode.window.showInformationMessage(
      t("notification.openingCodexApp", truncate(session.title, 48))
    );
  } catch (error) {
    vscode.window.showErrorMessage(t("error.failedOpenCodexApp", formatError(error)));
  }
}

export function openCodexAppProject(projectPath: string): void {
  const url = buildChatGptNewTaskUrl(projectPath);
  void openChatGptDeepLink(url)
    .then(() => {
      vscode.window.showInformationMessage(
        t("notification.openingCodexApp", basenameOrPath(projectPath))
      );
    })
    .catch((error) => {
      vscode.window.showErrorMessage(t("error.failedOpenCodexApp", formatError(error)));
    });
}

function runOpen(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("open", [target], { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`open exited with code ${code}`));
      }
    });
  });
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