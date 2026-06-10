import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession } from "../history";
import { openResumeTerminal } from "./resumeTerminal";

const pendingResumeKey = "agentResume.pendingResume";
const pendingTtlMs = 5 * 60 * 1000;

interface PendingResume {
  session: AgentSession;
  createdAt: number;
}

export async function storePendingResume(context: vscode.ExtensionContext, session: AgentSession): Promise<void> {
  await context.globalState.update(pendingResumeKey, {
    session,
    createdAt: Date.now()
  } satisfies PendingResume);
}

export async function consumePendingResumeForWorkspace(context: vscode.ExtensionContext): Promise<void> {
  const pending = context.globalState.get<PendingResume>(pendingResumeKey);
  if (!pending) {
    return;
  }

  if (Date.now() - pending.createdAt > pendingTtlMs) {
    await context.globalState.update(pendingResumeKey, undefined);
    return;
  }

  if (!isCurrentWorkspace(pending.session.projectPath)) {
    return;
  }

  await context.globalState.update(pendingResumeKey, undefined);

  setTimeout(() => {
    openResumeTerminal(pending.session, context);
  }, 750);
}

function isCurrentWorkspace(projectPath: string): boolean {
  const target = normalize(projectPath);
  return vscode.workspace.workspaceFolders?.some((folder) => normalize(folder.uri.fsPath) === target) ?? false;
}

function normalize(input: string): string {
  return path.resolve(input);
}
