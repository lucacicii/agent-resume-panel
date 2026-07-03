import * as vscode from "vscode";
import { ACP_HANDOFF_TARGETS, CLI_HANDOFF_TARGETS, HANDOFF_TARGET_META } from "./targets";
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
      label: HANDOFF_TARGET_META[provider].label,
      target: provider
    }));

  if (!options.length) {
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(options, {
    title: "Hand Off to Another Agent",
    placeHolder: "Choose the target agent"
  });

  return picked?.target;
}