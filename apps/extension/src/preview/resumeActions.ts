import * as vscode from "vscode";
import { AgentSession } from "../history";
import { t } from "../i18n";
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
    await openInGhostty(session);
    return;
  }

  if (target === "claudePanel") {
    if (session.provider !== "claude") {
      vscode.window.showWarningMessage(t("warning.claudePanelResumeOnlyForClaude"));
      return;
    }

    await openClaudeCodePanelResumeFlow(session, context);
    return;
  }

  if (target === "codexIdePanel") {
    if (session.provider !== "codex") {
      vscode.window.showWarningMessage(t("warning.codexIdePanelResumeOnlyForCodex"));
      return;
    }

    await openCodexIdePanelResumeFlow(session, context);
    return;
  }

  if (target === "codexApp") {
    if (session.provider !== "codex") {
      vscode.window.showWarningMessage(t("warning.codexAppResumeOnlyForCodex"));
      return;
    }

    openCodexAppResumeTerminal(session, context);
    return;
  }

  vscode.window.showWarningMessage(t("warning.unsupportedResumeTarget"));
}

export async function pickResumeTarget(session: AgentSession): Promise<ResumeTarget | undefined> {
  const options: ResumeTargetOption[] = [
    {
      label: t("quickpick.resumeWithVscodeLabel"),
      description: t("quickpick.resumeWithVscodeDescription"),
      target: "vscode"
    },
    {
      label: t("quickpick.resumeWithGhosttyLabel"),
      description: t("quickpick.resumeWithGhosttyDescription"),
      target: "ghostty"
    }
  ];

  if (session.provider === "claude") {
    options.push({
      label: t("quickpick.resumeWithClaudePanelLabel"),
      description: t("quickpick.resumeWithClaudePanelDescription"),
      target: "claudePanel"
    });
  }

  if (session.provider === "codex") {
    if (isCodexIdePanelResumeAvailable()) {
      options.push({
        label: t("quickpick.resumeWithCodexIdePanelLabel"),
        description: t("quickpick.resumeWithCodexIdePanelDescription"),
        target: "codexIdePanel"
      });
    }

    options.push({
      label: t("quickpick.resumeWithCodexAppLabel"),
      description: t("quickpick.resumeWithCodexAppDescription"),
      target: "codexApp"
    });
  }

  const picked = await vscode.window.showQuickPick(options, {
    title: t("quickpick.resumeWithTitle"),
    placeHolder: t("quickpick.resumeWithPlaceHolder")
  });

  return picked?.target;
}