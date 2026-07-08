import * as vscode from "vscode";
import { AcpChatManager } from "../acp/acpChatManager";
import { t } from "../i18n";
import { AgentSession } from "../history";
import { executeHandoffCommand } from "../handoff/handoffCommand";

const HANDOFF_SOURCE_PROVIDERS = new Set([
  "codex",
  "claude",
  "agy",
  "grok",
  "opencode",
  "pi"
]);

export function canHandoffSession(session: AgentSession): boolean {
  return HANDOFF_SOURCE_PROVIDERS.has(session.provider);
}

export async function runContinueWithAgent(
  session: AgentSession,
  context: vscode.ExtensionContext,
  acpChatManager: AcpChatManager,
  webview?: vscode.Webview
): Promise<void> {
  if (!canHandoffSession(session)) {
    webview?.postMessage({ type: "handoffDone" });
    return;
  }

  webview?.postMessage({ type: "handoffLoading" });

  try {
    await executeHandoffCommand(
      { kind: "cli", session },
      undefined,
      {
        context,
        acpChatManager
      }
    );
    webview?.postMessage({ type: "handoffDone" });
  } catch (error) {
    const errorMessage = formatError(error);
    webview?.postMessage({ type: "handoffError", error: errorMessage });
    vscode.window.showErrorMessage(t("notification.handoffFailed", errorMessage));
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}