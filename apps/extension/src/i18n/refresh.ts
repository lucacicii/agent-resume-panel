import * as vscode from "vscode";
import { resetI18nCache, t } from "./index";
import { applyUiLocaleContext } from "./uiLocaleContext";

export interface LocalizedUiRefreshTargets {
  sessionTree?: { refresh: () => void };
  acpTree?: { refresh: () => void };
  gtdTree?: { refresh: () => void };
  notesTree?: { refresh: () => void };
  refreshSettingsPanel?: () => Promise<void>;
  refreshSessionSearch?: () => Promise<void>;
  refreshSessionPreview?: () => Promise<void>;
  refreshSessionManager?: () => Promise<void>;
  refreshAcpChatPanels?: () => Promise<void>;
}

let targets: LocalizedUiRefreshTargets = {};

export function registerLocalizedUiRefreshTargets(next: LocalizedUiRefreshTargets): void {
  targets = { ...targets, ...next };
}

export async function refreshAllLocalizedUi(showToast = true): Promise<void> {
  resetI18nCache();
  await applyUiLocaleContext();
  targets.sessionTree?.refresh();
  targets.acpTree?.refresh();
  targets.gtdTree?.refresh();
  targets.notesTree?.refresh();

  await Promise.all([
    targets.refreshSettingsPanel?.(),
    targets.refreshSessionSearch?.(),
    targets.refreshSessionPreview?.(),
    targets.refreshSessionManager?.(),
    targets.refreshAcpChatPanels?.()
  ]);

  if (showToast) {
    vscode.window.showInformationMessage(t("notification.uiLanguageChanged"));
  }
}