import React, { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { AppChrome } from "./components/AppChrome";
import { StartupMask } from "./components/StartupMask";
import { Notifications } from "./components/Notifications";
import { SelectionSendHost } from "./selection/SelectionSendHost";
import { useI18n } from "./i18n";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { StandaloneNoteWindow } from "./features/workbench/notes/StandaloneNoteWindow";
import { BrowserStandaloneWindow } from "./features/browser/BrowserStandaloneWindow";
import { WorkbenchPanel } from "./features/workbench/WorkbenchPanel";
import { taskFromRecord } from "./features/workbench/task";
import { GtdView } from "./features/gtd/GtdView";
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

function getDesktopWindowMode(): "main" | "standalone-note" | "browser" | "task" {
  try {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    if (mode === "standalone-note") return "standalone-note";
    if (mode === "browser") return "browser";
    if (mode === "task") return "task";
    return "main";
  } catch {
    return "main";
  }
}

function getTaskWindowParams(): { noteId: string; workbenchId: string } {
  try {
    const params = new URLSearchParams(window.location.search);
    return { noteId: params.get("noteId") || "", workbenchId: params.get("workbenchId") || "" };
  } catch {
    return { noteId: "", workbenchId: "" };
  }
}

function getStandaloneNoteId(): string {
  try {
    return new URLSearchParams(window.location.search).get("noteId") || "";
  } catch {
    return "";
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
    media.addEventListener("change", onSystemAppearance);
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
    window.addEventListener("agent-resume:appearance-change", onAppearanceChange);
    media.addEventListener("change", onSystemAppearance);
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

/**
 * The board window.
 *
 * It is deliberately the cheap surface: the board plus the settings overlay,
 * and no workbench. Workbenches own the panes and the ptys, so they live in
 * their own windows and the board opens and focuses those instead.
 */
function MainRendererRuntime(): React.JSX.Element {
  return (
    <>
      <AppChrome />
      <GtdView active />
      <SettingsPanel variant="embedded" />
      <SelectionSendHost />
      <Notifications />
    </>
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

function TaskWindowMissingParams(): React.JSX.Element {
  const { t } = useI18n();
  return <div className="renderer-bridge-error" role="alert"><p>{t("desktop.gtd.windowMissing")}</p></div>;
}

/**
 * A workbench window.
 *
 * The window hosts exactly one workbench and no board or app chrome, so its
 * cost is the fixed bundle plus the panes of that one workbench. The task is
 * handed to the workbench through the same `agent-resume:workbench-task` event
 * the board uses — the window does not reach into workbench state.
 */
function TaskRendererRuntime(): React.JSX.Element {
  const { ready, t } = useI18n();
  const [title, setTitle] = useState("");
  const missingParams = !getTaskWindowParams().noteId;
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!ready || bootstrappedRef.current) return;
    const params = getTaskWindowParams();
    if (!params.noteId) return;
    bootstrappedRef.current = true;
    let cancelled = false;
    void (async () => {
      let detail: Record<string, unknown> = { noteId: params.noteId };
      try {
        const records = typeof window.agentResume.notesListTasks === "function"
          ? await window.agentResume.notesListTasks()
          : [];
        const record = records.find((item) => item.noteId === params.noteId);
        if (record) {
          const task = taskFromRecord(record);
          detail = { ...task, projects: task.projects ?? [] };
        }
      } catch {
        // A minimal payload still scopes the workbench; it resolves the rest itself.
      }
      if (cancelled) return;
      setTitle(typeof detail.title === "string" && detail.title ? detail.title : t("desktop.workbench.taskView"));
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-task", {
        detail: { ...detail, workbenchId: params.workbenchId }
      }));
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: "workbench" }));
    })();
    return () => { cancelled = true; };
  }, [ready, t]);

  useEffect(() => {
    if (!title) return;
    document.title = title;
    void window.agentResume.taskWindowSetTitle?.({ title }).catch(() => undefined);
  }, [title]);

  if (missingParams) return <TaskWindowMissingParams />;

  return (
    <>
      <WorkbenchPanel />
      <SelectionSendHost />
      <Notifications />
    </>
  );
}

function TaskDesktopRuntime(): React.JSX.Element {
  return (
    <I18nProvider>
      <MainRuntimeBootstrap />
      <TaskRendererRuntime />
    </I18nProvider>
  );
}

const windowMode = getDesktopWindowMode();
document.documentElement.dataset.windowMode = windowMode;
if (windowMode === "standalone-note") {
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
        {windowMode === "standalone-note"
          ? <StandaloneNoteDesktopRuntime />
          : windowMode === "browser"
            ? <BrowserDesktopRuntime />
            : windowMode === "task"
              ? <TaskDesktopRuntime />
              : <MainDesktopRuntime />}
      </StrictMode>
    );
  }
}
