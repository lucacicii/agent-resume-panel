import * as vscode from "vscode";
import { t } from "../i18n";

const RELOAD_WINDOW_COMMAND = "workbench.action.reloadWindow";

export function isUnregisteredConfigurationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("not a registered configuration");
}

export async function isAgentResumeSettingRegistered(key: string): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("agentResume");
  const current = config.get(key);
  try {
    await config.update(key, current, vscode.ConfigurationTarget.Global);
    return true;
  } catch (error) {
    if (isUnregisteredConfigurationError(error)) {
      return false;
    }
    throw error;
  }
}

export async function promptReloadIfContributionsStale(context: vscode.ExtensionContext): Promise<void> {
  const declaresUiLanguage = Boolean(
    context.extension.packageJSON?.contributes?.configuration?.properties?.["agentResume.uiLanguage"]
  );
  if (!declaresUiLanguage) {
    return;
  }

  if (await isAgentResumeSettingRegistered("uiLanguage")) {
    return;
  }

  await promptReloadWindow(t("warning.extensionReloadRequiredAfterUpgrade"));
}

export async function promptReloadWindow(message: string): Promise<void> {
  const reload = t("dialog.buttonReloadWindow");
  const choice = await vscode.window.showWarningMessage(message, reload);
  if (choice === reload) {
    await vscode.commands.executeCommand(RELOAD_WINDOW_COMMAND);
  }
}