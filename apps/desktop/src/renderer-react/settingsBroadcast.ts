import type { AgentSessionSyncResult, PanelSettings } from "@agent-resume/core";

export type SettingsChangedPayload = {
  settings: PanelSettings;
  section?: string;
  sync?: AgentSessionSyncResult;
};

export type BridgedCustomEvent =
  | { name: "agent-resume:settings-saved"; detail: SettingsChangedPayload }
  | { name: "agent-resume:theme-change"; detail: "system" | "light" | "dark" };

/**
 * Map main-process `settings:changed` IPC payload into same-document CustomEvents
 * so Workbench / theme listeners keep working without multi-window awareness.
 * Main window only — settings window must not call this for full hydrate.
 */
export function settingsChangedToCustomEvents(detail: SettingsChangedPayload): BridgedCustomEvent[] {
  const events: BridgedCustomEvent[] = [
    { name: "agent-resume:settings-saved", detail }
  ];
  const theme = detail.settings?.desktop?.theme;
  if (theme === "system" || theme === "light" || theme === "dark") {
    events.push({ name: "agent-resume:theme-change", detail: theme });
  }
  return events;
}
