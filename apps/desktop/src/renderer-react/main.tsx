import React, { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { AppChrome } from "./components/AppChrome";
import { StartupMask } from "./components/StartupMask";
import { Notifications } from "./components/Notifications";
import { useI18n } from "./i18n";
import { SessionsSheet } from "./features/SessionsSheet";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { ReportPanel } from "./features/report/ReportPanel";
import { AgentPanel } from "./features/agent/AgentPanel";
import { NotesPanel } from "./features/notes/NotesPanel";
import { StandaloneNoteWindow } from "./features/notes/StandaloneNoteWindow";
import { BrowserStandaloneWindow } from "./features/browser/BrowserStandaloneWindow";
import { WorkbenchPanel } from "./features/workbench/WorkbenchPanel";
import { DiffWorkerPool } from "./features/workbench/diffWorkerPool";
import { FlowPanel } from "./features/flow/FlowPanel";
import { KanbanPanel } from "./features/kanban/KanbanPanel";
import { GtdSheet } from "./features/report/GtdSheet";
import { settingsChangedToCustomEvents } from "./settingsBroadcast";
import { updateConfig } from "./components/notificationStore";
import type { PanelSettings } from "@agent-resume/core";
import { applyDesktopAppearance, appearanceStateFromSettings, type DesktopAppearanceState } from "./themes";

export function applyTheme(settings: Parameters<typeof appearanceStateFromSettings>[0]): DesktopAppearanceState {
  const state = appearanceStateFromSettings(settings);
  applyDesktopAppearance(state);
  const light = document.getElementById("hljsLightCss") as HTMLLinkElement | null;
  const dark = document.getElementById("hljsDarkCss") as HTMLLinkElement | null;
  if (light) light.disabled = state.appearance === "dark";
  if (dark) dark.disabled = state.appearance !== "dark";
  return state;
}

function applyAppearanceState(state: DesktopAppearanceState): void {
  applyDesktopAppearance(state);
  const light = document.getElementById("hljsLightCss") as HTMLLinkElement | null;
  const dark = document.getElementById("hljsDarkCss") as HTMLLinkElement | null;
  if (light) light.disabled = state.appearance === "dark";
  if (dark) dark.disabled = state.appearance !== "dark";
}

function syncNotificationConfig(settings: PanelSettings): void {
  const n = settings.notifications;
  updateConfig({
    autoClearMinutes: typeof n?.autoClearMinutes === "number" ? n.autoClearMinutes : 60,
    maxHistory: typeof n?.maxHistory === "number" ? n.maxHistory : 100
  });
}

export function getDesktopWindowMode(): "main" | "settings" | "standalone-note" | "browser" {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "settings") return "settings";
    if (params.get("mode") === "standalone-note") return "standalone-note";
    if (params.get("mode") === "browser") return "browser";
    return "main";
  } catch {
    return "main";
  }
}

export function getStandaloneNoteId(): string {
  try {
    return new URLSearchParams(window.location.search).get("noteId") || "";
  } catch {
    return "";
  }
}

export function getBrowserId(): string {
  try {
    return new URLSearchParams(window.location.search).get("browserId") || "";
  } catch {
    return "";
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
    const onAppearanceChange = (event: Event) => applyAppearanceState((event as CustomEvent<DesktopAppearanceState>).detail);
    const onSystemAppearance = () => {
      void window.agentResume.getSettings().then((settings) => {
        if (active) applyTheme(settings);
      }).catch(() => undefined);
    };
    window.addEventListener("agent-resume:appearance-change", onAppearanceChange);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", onSystemAppearance);
    reduceMotion.addEventListener("change", onSystemAppearance);
    void window.agentResume.getSettings().then((settings) => {
      if (active) {
        applyTheme(settings);
        syncNotificationConfig(settings);
      }
    }).catch(() => undefined);
    const stopSettings = typeof window.agentResume.onSettingsChanged === "function"
      ? window.agentResume.onSettingsChanged((detail) => {
          if (active) syncNotificationConfig(detail.settings);
          for (const ev of settingsChangedToCustomEvents(detail)) {
            window.dispatchEvent(new CustomEvent(ev.name, { detail: ev.detail }));
          }
        })
      : () => undefined;
    return () => {
      active = false;
      window.removeEventListener("agent-resume:appearance-change", onAppearanceChange);
      media.removeEventListener("change", onSystemAppearance);
      reduceMotion.removeEventListener("change", onSystemAppearance);
      stopSettings();
    };
  }, []);
  return null;
}

function SettingsRuntimeBootstrap(): null {
  useEffect(() => {
    let active = true;
    const onAppearanceChange = (event: Event) => applyAppearanceState((event as CustomEvent<DesktopAppearanceState>).detail);
    const onSystemAppearance = () => {
      void window.agentResume.getSettings().then((settings) => {
        if (active) applyTheme(settings);
      }).catch(() => undefined);
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    window.addEventListener("agent-resume:appearance-change", onAppearanceChange);
    media.addEventListener("change", onSystemAppearance);
    reduceMotion.addEventListener("change", onSystemAppearance);
    void window.agentResume.getSettings().then((settings) => {
      if (active) applyTheme(settings);
    }).catch(() => undefined);
    // Appearance only — do not full-hydrate Settings drafts from broadcast.
    const stopSettings = typeof window.agentResume.onSettingsChanged === "function"
      ? window.agentResume.onSettingsChanged((detail) => {
          if (active) applyTheme(detail.settings);
        })
      : () => undefined;
    return () => {
      active = false;
      window.removeEventListener("agent-resume:appearance-change", onAppearanceChange);
      media.removeEventListener("change", onSystemAppearance);
      reduceMotion.removeEventListener("change", onSystemAppearance);
      stopSettings();
    };
  }, []);
  return null;
}

function MainRendererReadySignal(): null {
  useEffect(() => {
    const timer = window.setTimeout(() => window.agentResume.notifyRendererReady(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

function MainDesktopRuntime(): React.JSX.Element {
  return (
    <I18nProvider>
      <MainRendererReadySignal />
      <StartupMask />
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
      <DiffWorkerPool>
        <WorkbenchPanel />
      </DiffWorkerPool>
      <NotesPanel />
      <FlowPanel />
      <KanbanPanel />
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

function StandaloneNoteMissingId(): React.JSX.Element {
  const { t } = useI18n();
  return <div className="renderer-bridge-error" role="alert"><p>{t("desktop.standaloneNote.missingId")}</p></div>;
}

function StandaloneNoteDesktopRuntime(): React.JSX.Element {
  const noteId = getStandaloneNoteId();
  return (
    <I18nProvider>
      <SettingsRuntimeBootstrap />
      {noteId ? <StandaloneNoteWindow noteId={noteId} /> : <StandaloneNoteMissingId />}
    </I18nProvider>
  );
}

function BrowserDesktopRuntime(): React.JSX.Element {
  return (
    <I18nProvider>
      <SettingsRuntimeBootstrap />
      <BrowserStandaloneWindow />
    </I18nProvider>
  );
}

// Mode flag before first paint — drives settings-window CSS
const windowMode = getDesktopWindowMode();
document.documentElement.dataset.windowMode = windowMode;
if (windowMode === "settings") {
  document.title = "Settings";
} else if (windowMode === "standalone-note") {
  document.title = "Standalone Note";
} else if (windowMode === "browser") {
  document.title = "Browser";
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
        {windowMode === "settings"
          ? <SettingsDesktopRuntime />
          : windowMode === "standalone-note"
            ? <StandaloneNoteDesktopRuntime />
            : windowMode === "browser"
              ? <BrowserDesktopRuntime />
              : <MainDesktopRuntime />}
      </StrictMode>
    );
  }
}
