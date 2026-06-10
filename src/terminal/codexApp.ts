import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { basenameOrPath } from "../history/pathUtils";

export function openCodexAppProject(projectPath: string): void {
  const child = spawn("codex", ["app", projectPath], {
    cwd: projectPath || undefined,
    detached: true,
    stdio: "ignore"
  });

  child.once("error", (error) => {
    vscode.window.showErrorMessage(`Failed to open Codex App: ${formatError(error)}`);
  });
  child.once("spawn", () => {
    child.unref();
    vscode.window.showInformationMessage(`Opening ${basenameOrPath(projectPath)} in Codex App.`);
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
