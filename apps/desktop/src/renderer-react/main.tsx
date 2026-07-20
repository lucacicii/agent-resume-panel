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

function RuntimeBootstrap(): null {
  useEffect(() => {
    let active = true;
    const onThemeChange = (event: Event) => applyTheme((event as CustomEvent<"system" | "light" | "dark">).detail);
    window.addEventListener("agent-resume:theme-change", onThemeChange);
    void window.agentResume.getSettings().then((settings) => {
      if (active) applyTheme(settings.desktop?.theme);
    }).catch(() => undefined);
    void window.agentResume.syncSessions().catch(() => undefined);
    return () => {
      active = false;
      window.removeEventListener("agent-resume:theme-change", onThemeChange);
    };
  }, []);
  return null;
}

function DesktopRuntime(): React.JSX.Element {
  return (
    <I18nProvider>
      <RuntimeBootstrap />
      <RendererRuntime />
    </I18nProvider>
  );
}

function RendererRuntime(): React.JSX.Element {
  const { ready } = useI18n();
  useEffect(() => {
    if (!ready) return;
    window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "report" }));
  }, [ready]);
  return <><AppChrome /><ReportPanel /><GtdSheet /><AgentPanel /><WorkbenchPanel /><NotesPanel /><SessionsSheet /><SettingsPanel /><Notifications /></>;
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
        <DesktopRuntime />
      </StrictMode>
    );
  }
}
