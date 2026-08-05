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
import { FlowPanel } from "./features/flow/FlowPanel";
import { GtdSheet } from "./features/report/GtdSheet";
import { FloatingSessionNote } from "./features/workbench/FloatingSessionNote";
import { settingsChangedToCustomEvents } from "./settingsBroadcast";
import { applyDesktopAppearance, appearanceStateFromSettings, type DesktopAppearanceState } from "./themes";
import { desktopApi } from "./bridge";
import type { FloatingSessionNoteTarget } from "../shared/floatingNoteTypes";

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

export function getDesktopWindowMode(): "main" | "settings" | "floating-note" {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "settings") return "settings";
    if (params.get("mode") === "floating-note") return "floating-note";
    return "main";
  } catch {
    return "main";
  }
}

export function getFloatingSessionNoteTarget(search = window.location.search): FloatingSessionNoteTarget | null {
  try {
    const params = new URLSearchParams(search);
    const provider = params.get("provider")?.trim() || "";
    const sessionId = params.get("sessionId")?.trim() || "";
    if (!provider || !sessionId) return null;
    const projectPath = params.get("projectPath")?.trim() || "";
    const projectName = params.get("projectName")?.trim() || undefined;
    const sessionTitle = params.get("sessionTitle")?.trim() || sessionId;
    return {
      provider,
      sessionId,
      projectPath,
      ...(projectName ? { projectName } : {}),
      sessionTitle
    };
  } catch {
    return null;
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
      if (active) applyTheme(settings);
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
      <FlowPanel />
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

function FloatingNoteDesktopRuntime({ target }: { target: FloatingSessionNoteTarget }): React.JSX.Element {
  return (
    <I18nProvider>
      <FloatingSessionNote
        target={target}
        draggable={false}
        onClose={() => {
          void desktopApi().closeFloatingNoteWindow();
        }}
      />
    </I18nProvider>
  );
}

// Mode flag before first paint — drives settings-window CSS
const windowMode = getDesktopWindowMode();
const floatingNoteTarget = windowMode === "floating-note" ? getFloatingSessionNoteTarget() : null;
document.documentElement.dataset.windowMode = windowMode;
if (windowMode === "settings") {
  document.title = "Settings";
} else if (windowMode === "floating-note" && floatingNoteTarget) {
  const project = floatingNoteTarget.projectName || floatingNoteTarget.projectPath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || "";
  const session = floatingNoteTarget.sessionTitle || floatingNoteTarget.sessionId;
  document.title = project && session ? `${project} · ${session}` : project || session || "Floating note";
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
          : windowMode === "floating-note"
            ? floatingNoteTarget
              ? <FloatingNoteDesktopRuntime target={floatingNoteTarget} />
              : <div className="renderer-bridge-error" role="alert"><h1>Agent Resume Desktop</h1><p>Invalid floating note target.</p></div>
            : <MainDesktopRuntime />}
      </StrictMode>
    );
  }
}
