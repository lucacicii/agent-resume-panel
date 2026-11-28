import * as vscode from "vscode";
import { AgentSession } from "../history";
import { t } from "../i18n";
import { openClaudeCodePanelResumeFlow } from "../terminal/claudeCodePanel";
import { isCodexIdePanelResumeAvailable, openCodexIdePanelResumeFlow } from "../terminal/codexIdePanel";
import { openInGhostty } from "../terminal/ghosttyTerminal";
import { getHerdrSessionTracker, openHerdrResume } from "../terminal/herdrTerminal";
import { openAlmaThread } from "../terminal/almaApp";
import { openCodexAppResumeTerminal, openResumeTerminal } from "../terminal/resumeTerminal";

type ResumeTarget = "vscode" | "ghostty" | "herdr" | "codexApp" | "codexIdePanel" | "claudePanel" | "almaApp";

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

  if (target === "herdr") {
    await openHerdrResume(session, context);
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

  if (target === "almaApp") {
    if (session.provider !== "alma") {
      vscode.window.showWarningMessage(t("alma.resumeOnlyForAlma"));
      return;
    }

    await openAlmaThread(session);
    return;
  }

  vscode.window.showWarningMessage(t("warning.unsupportedResumeTarget"));
}

export async function pickResumeTarget(session: AgentSession): Promise<ResumeTarget | undefined> {
  if (session.provider === "alma") {
    const picked = await vscode.window.showQuickPick<ResumeTargetOption>(
      [
        {
          label: t("quickpick.resumeWithAlmaLabel"),
          description: t("quickpick.resumeWithAlmaDescription"),
          target: "almaApp"
        }
      ],
      {
        title: t("quickpick.resumeWithTitle"),
        placeHolder: t("quickpick.resumeWithPlaceHolder")
      }
    );
    return picked?.target;
  }
  const tracker = getHerdrSessionTracker();
  const herdrMatch = tracker?.resolve(session);
  const herdrOption: ResumeTargetOption | undefined =
    tracker?.isDaemonAvailable() && session.provider !== "cursor-ide" && session.provider !== "chat"
      ? {
          label: t("quickpick.resumeWithHerdrLabel"),
          description: herdrMatch
            ? t("quickpick.resumeWithHerdrMatchedDescription")
            : t("quickpick.resumeWithHerdrDescription"),
          target: "herdr"
        }
      : undefined;

  const options: ResumeTargetOption[] = [
    ...(herdrMatch && herdrOption ? [herdrOption] : []),
    {
      label: t("quickpick.resumeWithVscodeLabel"),
      description: t("quickpick.resumeWithVscodeDescription"),
      target: "vscode"
    },
    {
      label: t("quickpick.resumeWithGhosttyLabel"),
      description: t("quickpick.resumeWithGhosttyDescription"),
      target: "ghostty"
    },
    ...(!herdrMatch && herdrOption ? [herdrOption] : [])
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