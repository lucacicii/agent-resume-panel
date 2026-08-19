import type { AgentSessionSyncResult, PanelSettings } from "@agent-resume/core";
import { appearanceStateFromSettings, type DesktopAppearanceState } from "./themes";

export type SettingsChangedPayload = {
  settings: PanelSettings;
  section?: string;
  sync?: AgentSessionSyncResult;
};

/** One complete state keeps every renderer subsystem synchronized during a live switch. */
export type BridgedCustomEvent =
  | { name: "agent-resume:settings-saved"; detail: SettingsChangedPayload }
  | { name: "agent-resume:appearance-change"; detail: DesktopAppearanceState };

export function settingsChangedToCustomEvents(detail: SettingsChangedPayload): BridgedCustomEvent[] {
  return [
    { name: "agent-resume:settings-saved", detail },
    { name: "agent-resume:appearance-change", detail: appearanceStateFromSettings(detail.settings) }
  ];
}
