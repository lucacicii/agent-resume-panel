import React, { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { AppChrome } from "./components/AppChrome";
import { AppSidebar, type BoardView } from "./components/AppSidebar";
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
import { ArchiveView } from "./features/archive/ArchiveView";
import { SessionsView } from "./features/sessions/SessionsView";
import { NotesView } from "./features/notes/NotesView";
import { ScheduleView } from "./features/schedule/ScheduleView";
import { ChatView } from "./features/chat/ChatView";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BoardQuickAccess } from "./features/gtd/BoardQuickAccess";
import { settingsChangedToCustomEvents } from "./settingsBroadcast";
import { startMenuCommandBridge } from "./menuCommands";
import { updateConfig } from "./components/notificationStore";
import type { PanelSettings } from "@agent-resume/core";
import { applyDesktopAppearance, appearanceStateFromSettings, startSystemAccentSync, type DesktopAppearanceState } from "./themes";

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

function getDesktopWindowMode(): "main" | "standalone-note" | "browser" | "task" | "settings" {
  try {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    if (mode === "standalone-note") return "standalone-note";
    if (mode === "browser") return "browser";
    if (mode === "task") return "task";
    if (mode === "settings") return "settings";
    return "main";
  } catch {
    return "main";
  }
}

function getTaskWindowParams(): { noteId: string; workbenchId: string; runScript?: { name: string; command: string; cwd: string } } {
  try {
    const params = new URLSearchParams(window.location.search);
    const noteId = params.get("noteId") || "";
    const workbenchId = params.get("workbenchId") || "";
    // New windows receive the script through the URL (encoded twice: once by
    // the opener, once by the query serialization), so decode defensively.
    const rawRunScript = params.get("runScript");
    if (!noteId || !rawRunScript) return { noteId, workbenchId };
    try {
      const decoded = decodeURIComponent(rawRunScript);
      const parsed = JSON.parse(decoded) as { name?: unknown; command?: unknown; cwd?: unknown };
      if (typeof parsed?.command === "string" && typeof parsed?.cwd === "string") {
        return {
          noteId,
          workbenchId,
          runScript: {
            name: typeof parsed.name === "string" && parsed.name ? parsed.name : parsed.command,
            command: parsed.command,
            cwd: parsed.cwd
          }
        };
      }
    } catch {
      // A malformed param is dropped, not fatal: the task still opens.
    }
    return { noteId, workbenchId };
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
    const stopAccent = startSystemAccentSync();
    const stopMenuCommands = startMenuCommandBridge();
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
      stopAccent();
      stopMenuCommands();
    };
  }, []);
  return null;
}

function SettingsRuntimeBootstrap(): null {
  useEffect(() => {
    let active = true;
    const stopAccent = startSystemAccentSync();
    const stopMenuCommands = startMenuCommandBridge();
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
      stopAccent();
      stopMenuCommands();
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

/**
 * Track native fullscreen in the DOM.
 *
 * macOS hides the title bar in fullscreen, so the header must drop the
 * traffic-light inset and its drag strip; `data-fullscreen` is what the
 * stylesheet keys off.
 */
function WindowChromeRuntime(): null {
  useEffect(() => {
    const api = window.agentResume;
    if (typeof api?.onWindowFullscreenChanged !== "function") return;
    return api.onWindowFullscreenChanged((fullscreen) => {
      if (fullscreen) document.documentElement.dataset.fullscreen = "true";
      else delete document.documentElement.dataset.fullscreen;
    });
  }, []);
  return null;
}

function MainDesktopRuntime(): React.JSX.Element {
  return (
    <I18nProvider>
      <MainRendererReadySignal />
      <StartupMask />
      <MainRuntimeBootstrap />
      <WindowChromeRuntime />
      <MainRendererRuntime />
    </I18nProvider>
  );
}

/**
 * The board window.
 *
 * It is deliberately the cheap surface: the nav sidebar plus one of the two
 * primary views (GTD board or Notes), and no workbench. Workbenches own the
 * panes and the ptys, so they live in their own windows and the board opens
 * and focuses those instead.
 */
const BOARD_VIEW_KEY = "board-view";
const NAV_COLLAPSED_KEY = "board-nav-collapsed";

function storedBoardView(): BoardView {
  try {
    const stored = localStorage.getItem(BOARD_VIEW_KEY);
    if (stored === "notes" || stored === "schedule" || stored === "archive" || stored === "sessions") return stored;
    return "gtd";
  } catch {
    return "gtd";
  }
}

function storedNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function MainRendererRuntime(): React.JSX.Element {
  const [view, setView] = useState<BoardView>(storedBoardView);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(storedNavCollapsed);

  // The stylesheet keys host visibility off this attribute, the same way it
  // does for `data-fullscreen`; both views stay mounted-capable, only one shows.
  useEffect(() => {
    document.documentElement.dataset.boardView = view;
    try {
      localStorage.setItem(BOARD_VIEW_KEY, view);
    } catch {
      /* persistence is optional */
    }
  }, [view]);

  // ⌘1/⌘2 arrive as menu IPC (macOS eats registered accelerators); the quick
  // access palette dispatches the same switch as a window event.
  useEffect(() => {
    const api = window.agentResume;
    const stopMenu = typeof api?.onNavShow === "function"
      ? api.onNavShow((next) => setView(next))
      : undefined;
    const onPaletteView = (event: Event) => {
      const detail = (event as CustomEvent<BoardView>).detail;
      if (detail === "gtd" || detail === "notes" || detail === "schedule" || detail === "archive" || detail === "sessions") setView(detail);
    };
    window.addEventListener("agent-resume:board-view", onPaletteView);
    return () => {
      stopMenu?.();
      window.removeEventListener("agent-resume:board-view", onPaletteView);
    };
  }, []);

  // The sidebar collapse is owned here: the toggle lives in the header, the
  // rail width lives in the sidebar, and both read this one state.
  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* persistence is optional */
    }
  }, [sidebarCollapsed]);

  return (
    <>
      <AppSidebar view={view} onViewChange={setView} collapsed={sidebarCollapsed} />
      <AppChrome sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed((collapsed) => !collapsed)} />
      <GtdView active={view === "gtd"} />
      {view === "notes" ? <NotesView active /> : null}
      {view === "schedule" ? <ScheduleView active /> : null}
      {view === "chat" ? (
        <ErrorBoundary>
          <ChatView active />
        </ErrorBoundary>
      ) : null}
      {view === "archive" ? <ArchiveView active /> : null}
      {view === "sessions" ? <SessionsView active /> : null}
      <BoardQuickAccess />
      <SelectionSendHost />
      <Notifications />
    </>
  );
}

function getSettingsPane(): string {
  try {
    return new URLSearchParams(window.location.search).get("pane") || "general";
  } catch {
    return "general";
  }
}

/**
 * Set the window title from the app's language.
 *
 * `hiddenInset` windows show no title, but plain windows (Settings, browser,
 * notes) take theirs from `document.title`, which otherwise stays the English
 * string in `index.html`.
 */
function WindowTitleRuntime({ titleKey }: { titleKey: string }): null {
  const { ready, t } = useI18n();
  useEffect(() => {
    if (ready) document.title = t(titleKey);
  }, [ready, t, titleKey]);
  return null;
}

/** The Settings window: the panel is the whole window, not an overlay. */
function SettingsDesktopRuntime(): React.JSX.Element {
  return (
    <I18nProvider>
      <SettingsRuntimeBootstrap />
      <WindowChromeRuntime />
      <WindowTitleRuntime titleKey="desktop.settings.title" />
      <SettingsPanel initialPane={getSettingsPane()} />
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
      <WindowChromeRuntime />
      <WindowTitleRuntime titleKey="desktop.standaloneNote.title" />
      {noteId ? <StandaloneNoteWindow noteId={noteId} /> : <StandaloneNoteMissingId />}
    </I18nProvider>
  );
}

function BrowserDesktopRuntime(): React.JSX.Element {
  return (
    <I18nProvider>
      <SettingsRuntimeBootstrap />
      <WindowChromeRuntime />
      <WindowTitleRuntime titleKey="desktop.browser.windowTitle" />
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
      // A pending script run rides along with the task: the workbench mounts
      // with the task event above, so this lands on a live listener.
      if (params.runScript) {
        window.dispatchEvent(new CustomEvent("agent-resume:workbench-run-script", {
          detail: params.runScript
        }));
      }
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
      <WindowChromeRuntime />
      <TaskRendererRuntime />
    </I18nProvider>
  );
}

const windowMode = getDesktopWindowMode();
document.documentElement.dataset.windowMode = windowMode;

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
            : windowMode === "settings"
              ? <SettingsDesktopRuntime />
              : windowMode === "task"
                ? <TaskDesktopRuntime />
                : <MainDesktopRuntime />}
      </StrictMode>
    );
  }
}
