import * as vscode from "vscode";
import { t } from "../i18n";
import { ACP_HANDOFF_TARGETS, CLI_HANDOFF_TARGETS, getHandoffTargetLabel } from "./targets";
import { HandoffTargetProvider } from "./types";

interface TargetPickItem extends vscode.QuickPickItem {
  target: HandoffTargetProvider;
}

export async function pickHandoffTargetForPreview(
  sourceProvider: string,
  sourceKind: "cli" | "acp"
): Promise<HandoffTargetProvider | undefined> {
  const pool = sourceKind === "acp" ? ACP_HANDOFF_TARGETS : CLI_HANDOFF_TARGETS;
  const options: TargetPickItem[] = pool
    .filter((provider) => provider !== sourceProvider)
    .map((provider) => ({
      label: getHandoffTargetLabel(provider),
      target: provider
    }));

  if (!options.length) {
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(options, {
    title: t("quickpick.handoffTargetTitle"),
    placeHolder: t("quickpick.handoffTargetPlaceHolder")
  });

  return picked?.target;
}