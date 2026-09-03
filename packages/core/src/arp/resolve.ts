import type { CommitMessagePromptOptions } from "../git/prompts";
import type { PanelSettings } from "../settings/types";
import type { ArpConfig } from "./types";

export type CommitMessageSettingsSource = Pick<PanelSettings, "workbench"> | null | undefined;

/**
 * Project `.arp` workbench git config overrides panel-home Desktop settings.
 * Missing project fields fall back to `settings.desktop.json`, then code defaults.
 */
export function resolveCommitMessagePromptOptions(
  arp?: ArpConfig | null,
  panelSettings?: CommitMessageSettingsSource
): CommitMessagePromptOptions {
  const project = arp?.workbench?.git?.commitMessage;
  const options: CommitMessagePromptOptions = {
    style: project?.style ?? panelSettings?.workbench?.gitCommitMessageStyle,
    customInstructions:
      project?.customInstructions ?? panelSettings?.workbench?.gitCommitCustomInstructions
  };
  if (project?.extraInstructions) {
    options.extraInstructions = project.extraInstructions;
  }
  return options;
}
