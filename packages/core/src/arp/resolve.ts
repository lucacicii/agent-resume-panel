import type { CommitMessagePromptOptions } from "../git/prompts";
import type { PanelSettings } from "../settings/types";
import type { ArpConfig } from "./types";

export type CommitMessageSettingsSource = Pick<PanelSettings, "workbench"> | null | undefined;

/**
 * Project `.arp` workbench git config overrides panel-home Desktop settings.
 * If `.arp` defines commit-message configuration, use it; otherwise fall back to system settings.
 */
export function resolveCommitMessagePromptOptions(
  arp?: ArpConfig | null,
  panelSettings?: CommitMessageSettingsSource
): CommitMessagePromptOptions {
  const project = arp?.workbench?.git?.commitMessage;
  if (project && Object.keys(project).length > 0) {
    const style =
      project.style ?? (project.customInstructions ? "custom" : panelSettings?.workbench?.gitCommitMessageStyle);
    const customInstructions =
      project.customInstructions ??
      (style === "custom" ? panelSettings?.workbench?.gitCommitCustomInstructions : undefined);
    const options: CommitMessagePromptOptions = {
      style,
      customInstructions
    };
    if (project.language) {
      options.language = project.language;
    }
    if (project.extraInstructions) {
      options.extraInstructions = project.extraInstructions;
    }
    return options;
  }
  return {
    style: panelSettings?.workbench?.gitCommitMessageStyle || "conventional",
    customInstructions: panelSettings?.workbench?.gitCommitCustomInstructions
  };
}
