import React, { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { AppChrome } from "./components/AppChrome";
import { Notifications } from "./components/Notifications";
import { useI18n } from "./i18n";
import { SessionsSheet } from "./features/SessionsSheet";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { ReportPanel } from "./features/report/ReportPanel";
import { AgentPanel } from "./features/agent/AgentPanel";
import { NotesPanel } from "./features/notes/NotesPanel";
import { WorkbenchPanel } from "./features/workbench/WorkbenchPanel";
import { GtdSheet } from "./features/report/GtdSheet";
import { settingsChangedToCustomEvents } from "./settingsBroadcast";

function applyTheme(theme: "system" | "light" | "dark" | undefined): void {
  const root = document.documentElement;
  const effective = theme && theme !== "system"
    ? theme
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  if (!theme || theme === "system") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "light dark";
  } else {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  }
  const light = document.getElementById("hljsLightCss") as HTMLLinkElement | null;
  const dark = document.getElementById("hljsDarkCss") as HTMLLinkElement | null;
  if (light) light.disabled = effective === "dark";
  if (dark) dark.disabled = effective !== "dark";
}

export function getDesktopWindowMode(): "main" | "settings" {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") === "settings" ? "settings" : "main";
  } catch {
    return "main";
  }
}

export function getInitialSettingsPane(): string {
  try {
    return new URLSearchParams(window.location.search).get("pane") || "general";
  } catch {
    return "general";
  }
}

function MainRuntimeBootstrap(): null {
  useEffect(() => {
    let active = true;
    const onThemeChange = (event: Event) => applyTheme((event as CustomEvent<"system" | "light" | "dark">).detail);
    window.addEventListener("agent-resume:theme-change", onThemeChange);
    void window.agentResume.getSettings().then((settings) => {
      if (active) applyTheme(settings.desktop?.theme);
    }).catch(() => undefined);
    void window.agentResume.syncSessions().catch(() => undefined);
    const stopSettings = typeof window.agentResume.onSettingsChanged === "function"
      ? window.agentResume.onSettingsChanged((detail) => {
          for (const ev of settingsChangedToCustomEvents(detail)) {
            window.dispatchEvent(new CustomEvent(ev.name, { detail: ev.detail }));
          }
        })
      : () => undefined;
    return () => {
      active = false;
      window.removeEventListener("agent-resume:theme-change", onThemeChange);
      stopSettings();
    };
  }, []);
  return null;
}

function SettingsRuntimeBootstrap(): null {
  useEffect(() => {
    let active = true;
    void window.agentResume.getSettings().then((settings) => {
      if (active) applyTheme(settings.desktop?.theme);
    }).catch(() => undefined);
    // Theme only — do not full-hydrate Settings drafts from broadcast (K17)
    const stopSettings = typeof window.agentResume.onSettingsChanged === "function"
      ? window.agentResume.onSettingsChanged((detail) => {
          applyTheme(detail.settings?.desktop?.theme);
        })
      : () => undefined;
    return () => {
      active = false;
      stopSettings();
    };
  }, []);
  return null;
}

function MainDesktopRuntime(): React.JSX.Element {
  return (
    <I18nProvider>
      <MainRuntimeBootstrap />
      <MainRendererRuntime />
    </I18nProvider>
  );
}

function MainRendererRuntime(): React.JSX.Element {
  const { ready } = useI18n();
  useEffect(() => {
    if (!ready) return;
    window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "report" }));
  }, [ready]);
  return (
    <>
      <AppChrome />
      <ReportPanel />
      <GtdSheet />
      <AgentPanel />
      <WorkbenchPanel />
      <NotesPanel />
      <SessionsSheet />
      <Notifications />
    </>
  );
}

function SettingsDesktopRuntime(): React.JSX.Element {
  const initialPane = getInitialSettingsPane();
  return (
    <I18nProvider>
      <SettingsRuntimeBootstrap />
      <SettingsPanel variant="window" initialPane={initialPane} />
    </I18nProvider>
  );
}

// Mode flag before first paint — drives settings-window CSS
const windowMode = getDesktopWindowMode();
document.documentElement.dataset.windowMode = windowMode;
if (windowMode === "settings") {
  document.title = "Settings";
}

const host = document.getElementById("react-chrome");
if (host) {
  if (!window.agentResume) {
    createRoot(host).render(
      <div className="renderer-bridge-error" role="alert">
        <h1>Agent Resume Desktop</h1>
        <p>This page must be opened by the Electron desktop application.</p>
      </div>
    );
  } else {
    createRoot(host).render(
      <StrictMode>
        {windowMode === "settings" ? <SettingsDesktopRuntime /> : <MainDesktopRuntime />}
      </StrictMode>
    );
  }
}
