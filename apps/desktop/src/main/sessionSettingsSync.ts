import type { PanelSettings } from "@agent-resume/core";

export interface SaveSettingsOptions {
  triggerSync?: boolean;
}

function normalizeAgentHomes(settings: PanelSettings) {
  return settings.agentHomes ?? {};
}

function normalizeSessionSync(settings: PanelSettings) {
  return settings.sessionSync ?? {};
}

export function shouldSyncSessionsAfterSettingsSave(
  previous: PanelSettings,
  saved: PanelSettings,
  options?: SaveSettingsOptions
): boolean {
  if (options?.triggerSync === true) {
    return true;
  }
  if (options?.triggerSync === false) {
    return false;
  }

  const panelHomeChanged = (previous.panelHome || "").trim() !== (saved.panelHome || "").trim();
  const sessionSyncChanged =
    JSON.stringify(normalizeSessionSync(previous)) !== JSON.stringify(normalizeSessionSync(saved));
  const agentHomesChanged =
    JSON.stringify(normalizeAgentHomes(previous)) !== JSON.stringify(normalizeAgentHomes(saved));

  return panelHomeChanged || sessionSyncChanged || agentHomesChanged;
}