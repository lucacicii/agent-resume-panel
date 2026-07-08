import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { t } from "../i18n";
import { basenameOrPath } from "../history/pathUtils";

export function openCodexAppProject(projectPath: string): void {
  const child = spawn("codex", ["app", projectPath], {
    cwd: projectPath || undefined,
    detached: true,
    stdio: "ignore"
  });

  child.once("error", (error) => {
    vscode.window.showErrorMessage(t("error.failedOpenCodexApp", formatError(error)));
  });
  child.once("spawn", () => {
    child.unref();
    vscode.window.showInformationMessage(t("notification.openingCodexApp", basenameOrPath(projectPath)));
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
