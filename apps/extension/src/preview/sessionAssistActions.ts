import * as vscode from "vscode";
import { AgentSession } from "../history";
import { loadSessionPreview } from "../history/preview";
import { renameSessionWithCatalog } from "../catalog/rename";
import { loadRenameHomes } from "../history/rename/homes";
import { getLlmConfig, isLlmConfigured } from "../llm/config";
import { setCachedSummary } from "../llm/summaryCache";
import { suggestSessionTitle, summarizeSession } from "../llm/sessionAssist";
import { SessionTreeProvider } from "../tree/sessionTree";
import { t } from "../i18n";
import { openSettingsPanel } from "../settings/settingsPanel";

export async function ensureLlmConfigured(context: vscode.ExtensionContext): Promise<boolean> {
  if (await isLlmConfigured(context)) {
    return true;
  }

  const openSettingsButton = t("dialog.buttonOpenSettings");
  const picked = await vscode.window.showWarningMessage(
    t("warning.llmNotConfigured"),
    openSettingsButton
  );

  if (picked === openSettingsButton) {
    await openSettingsPanel(context);
  }

  return false;
}

export async function runSummarize(
  session: AgentSession,
  context: vscode.ExtensionContext,
  webview?: vscode.Webview,
  tree?: SessionTreeProvider
): Promise<void> {
  if (!(await ensureLlmConfigured(context))) {
    webview?.postMessage({ type: "summaryError", error: t("error.llmNotConfigured") });
    return;
  }

  webview?.postMessage({ type: "summaryLoading" });

  try {
    const preview = await loadSessionPreview(session, loadRenameHomes());
    const llmConfig = await getLlmConfig(context);
    const summary = await summarizeSession(context, preview.messages);
    if (llmConfig) {
      await setCachedSummary(context, session, llmConfig.outputLanguage, summary);
      tree?.updateSessionSummary(session, summary);
    }
    webview?.postMessage({ type: "summaryResult", summary });
  } catch (error) {
    const errorMessage = formatError(error);
    webview?.postMessage({ type: "summaryError", error: errorMessage });
    vscode.window.showErrorMessage(t("notification.summarizeFailed", errorMessage));
  }
}

export async function runAutoRename(
  session: AgentSession,
  tree: SessionTreeProvider,
  refreshTree: () => Promise<void>,
  context: vscode.ExtensionContext,
  options?: {
    webview?: vscode.Webview;
    panel?: vscode.WebviewPanel;
  }
): Promise<void> {
  if (!(await ensureLlmConfigured(context))) {
    options?.webview?.postMessage({ type: "autoRenameDone" });
    return;
  }

  options?.webview?.postMessage({ type: "autoRenameLoading" });

  try {
    const preview = await loadSessionPreview(session, loadRenameHomes());
    const newTitle = await suggestSessionTitle(context, session, preview.messages);

    if (!newTitle) {
      throw new Error(t("error.llmEmptyTitle"));
    }

    await renameSessionWithCatalog(session, newTitle, loadRenameHomes());
    await refreshTree();

    if (options?.panel) {
      options.panel.title = t("panel.sessionPreviewTitle", newTitle);
    }

    options?.webview?.postMessage({ type: "titleUpdated", title: newTitle });
    options?.webview?.postMessage({ type: "autoRenameDone" });
    vscode.window.showInformationMessage(t("notification.sessionRenamedTo", newTitle));
  } catch (error) {
    const errorMessage = formatError(error);
    options?.webview?.postMessage({ type: "autoRenameDone" });
    vscode.window.showErrorMessage(t("notification.autoRenameFailed", errorMessage));
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}