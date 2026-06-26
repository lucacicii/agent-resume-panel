import * as path from "node:path";
import * as vscode from "vscode";
import { AgentSession } from "../history";
import { openSessionResume } from "./resumeTerminal";

const pendingResumeKey = "agentResume.pendingResume";
const pendingTtlMs = 5 * 60 * 1000;

export interface PendingResumeOptions {
  claudePanel?: boolean;
  codexPanel?: boolean;
}

interface PendingResume {
  session: AgentSession;
  createdAt: number;
  claudePanel?: boolean;
  codexPanel?: boolean;
}

export async function storePendingResume(
  context: vscode.ExtensionContext,
  session: AgentSession,
  options?: PendingResumeOptions
): Promise<void> {
  await context.globalState.update(pendingResumeKey, {
    session,
    createdAt: Date.now(),
    claudePanel: options?.claudePanel,
    codexPanel: options?.codexPanel
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
    void resumePendingSession(pending, context);
  }, 750);
}

async function resumePendingSession(pending: PendingResume, context: vscode.ExtensionContext): Promise<void> {
  if (pending.claudePanel && pending.session.provider === "claude") {
    const { openClaudeCodePanelResumeFlow } = await import("./claudeCodePanel.js");
    await openClaudeCodePanelResumeFlow(pending.session, context);
    return;
  }

  if (pending.codexPanel && pending.session.provider === "codex") {
    const { openCodexIdePanelResumeFlow } = await import("./codexIdePanel.js");
    await openCodexIdePanelResumeFlow(pending.session, context);
    return;
  }

  openSessionResume(pending.session, context);
}

function isCurrentWorkspace(projectPath: string): boolean {
  const target = normalize(projectPath);
  return vscode.workspace.workspaceFolders?.some((folder) => normalize(folder.uri.fsPath) === target) ?? false;
}

function normalize(input: string): string {
  return path.resolve(input);
}
