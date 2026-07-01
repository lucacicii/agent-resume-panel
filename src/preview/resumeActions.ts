import * as vscode from "vscode";
import { AgentSession } from "../history";
import { openClaudeCodePanelResumeFlow } from "../terminal/claudeCodePanel";
import { isCodexIdePanelResumeAvailable, openCodexIdePanelResumeFlow } from "../terminal/codexIdePanel";
import { openInGhostty } from "../terminal/ghosttyTerminal";
import { openCodexAppResumeTerminal, openResumeTerminal } from "../terminal/resumeTerminal";

export type ResumeTarget = "vscode" | "ghostty" | "codexApp" | "codexIdePanel" | "claudePanel";

interface ResumeTargetOption extends vscode.QuickPickItem {
  target: ResumeTarget;
}

export async function resumeSession(
  session: AgentSession,
  target: ResumeTarget,
  context?: vscode.ExtensionContext
): Promise<void> {
  if (target === "vscode") {
    openResumeTerminal(session, context);
    return;
  }

  if (target === "ghostty") {
    if (session.provider === "alma") {
      vscode.window.showWarningMessage("Ghostty resume is not available for Alma sessions.");
      return;
    }

    await openInGhostty(session);
    return;
  }

  if (target === "claudePanel") {
    if (session.provider !== "claude") {
      vscode.window.showWarningMessage("Claude Code panel resume is only available for Claude sessions.");
      return;
    }

    await openClaudeCodePanelResumeFlow(session, context);
    return;
  }

  if (target === "codexIdePanel") {
    if (session.provider !== "codex") {
      vscode.window.showWarningMessage("Codex IDE panel resume is only available for Codex sessions.");
      return;
    }

    await openCodexIdePanelResumeFlow(session, context);
    return;
  }

  if (target === "codexApp") {
    if (session.provider !== "codex") {
      vscode.window.showWarningMessage("Codex App resume is only available for Codex sessions.");
      return;
    }

    openCodexAppResumeTerminal(session, context);
    return;
  }

  vscode.window.showWarningMessage("Unsupported resume target.");
}

export async function pickResumeTarget(session: AgentSession): Promise<ResumeTarget | undefined> {
  if (session.provider === "alma") {
    return undefined;
  }

  const options: ResumeTargetOption[] = [
    {
      label: "VS Code Integrated Terminal",
      description: "Resume in a VS Code integrated terminal",
      target: "vscode"
    },
    {
      label: "Ghostty",
      description: "Open the session in Ghostty",
      target: "ghostty"
    }
  ];

  if (session.provider === "claude") {
    options.push({
      label: "Claude Code Panel",
      description: "Resume in the Claude Code VS Code extension panel",
      target: "claudePanel"
    });
  }

  if (session.provider === "codex") {
    if (isCodexIdePanelResumeAvailable()) {
      options.push({
        label: "Codex IDE Panel (Experimental)",
        description: "Resume in the Codex VS Code extension panel",
        target: "codexIdePanel"
      });
    }

    options.push({
      label: "Codex App",
      description: "Resume in Codex App via integrated terminal",
      target: "codexApp"
    });
  }

  const picked = await vscode.window.showQuickPick(options, {
    title: "Resume With",
    placeHolder: "Choose where to resume this session"
  });

  return picked?.target;
}