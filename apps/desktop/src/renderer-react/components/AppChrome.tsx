import { ICON_SIZE, ThemeIcon } from "./ThemeIcon";
import { useEffect, useState } from "react";
import { desktopApi } from "../bridge";
import { useI18n } from "../i18n";
import { BellNotificationButton } from "./BellNotificationButton";
import { useStage } from "../features/stage/StageContext";

type FloatingNoteDot = { noteId: string; title: string };

/**
 * The app is GTD-first: there is no primary-tab rail anymore. The header keeps
 * the global chrome — the sidebar toggle, the per-view toolbar slot,
 * floating-note dots, and the notification bell. The account menu lives in
 * the sidebar footer (see `AppSidebar`).
 */
export function AppChrome({
  sidebarCollapsed = false,
  onToggleSidebar
}: {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
} = {}): React.JSX.Element {
  const { ready, t } = useI18n();
  const [noteDots, setNoteDots] = useState<FloatingNoteDot[]>([]);
  let stage: ReturnType<typeof useStage> | null = null;
  try {
    // StageProvider is present in main board window; gracefully optional elsewhere
    stage = useStage();
  } catch {
    stage = null;
  }

  useEffect(() => {
    const api = desktopApi();
    let cancelled = false;
    if (typeof api.standaloneNoteList === "function") {
      void api.standaloneNoteList().then((notes) => {
        if (!cancelled && Array.isArray(notes)) setNoteDots(notes);
      }).catch(() => undefined);
    }
    const stop = typeof api.onStandaloneNotesChanged === "function"
      ? api.onStandaloneNotesChanged((notes) => {
          if (Array.isArray(notes)) setNoteDots(notes);
        })
      : undefined;
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  const focusNote = (dot: FloatingNoteDot) => {
    const api = desktopApi();
    if (typeof api.standaloneNoteOpen !== "function") return;
    void api.standaloneNoteOpen({ noteId: dot.noteId }).catch(() => undefined);
  };

  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);
  const sidebarLabel = sidebarCollapsed
    ? text("desktop.nav.expand", "Expand sidebar")
    : text("desktop.nav.collapse", "Collapse sidebar");

  return (
    <header className="top mac-top">
      {onToggleSidebar ? (
        <button
          type="button"
          className={`app-sidebar-toggle${sidebarCollapsed ? " is-collapsed" : ""}`}
          aria-label={sidebarLabel}
          title={sidebarLabel}
          aria-expanded={!sidebarCollapsed}
          aria-controls="react-nav"
          onClick={onToggleSidebar}
        >
          <ThemeIcon name="panel-left" size={ICON_SIZE.default} />
        </button>
      ) : null}
      <div id="app-header-slot" />
      <div id="chat-titlebar-slot" className="chat-titlebar-slot" />
      <div className="app-chrome-right">
        {noteDots.length > 0 ? (
          <div className="app-note-dots" role="group" aria-label={text("desktop.notes.floatingDots", "Floating notes")}>
            {noteDots.map((dot) => (
              <button
                key={dot.noteId}
                type="button"
                className="app-note-dot-btn"
                title={dot.title}
                aria-label={dot.title}
                onClick={() => focusNote(dot)}
              >
                <span className="app-note-dot" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
        <BellNotificationButton />
        <button
          type="button"
          className="app-settings-btn"
          aria-label={text("desktop.top.settings", "Settings")}
          title={text("desktop.top.settings", "Settings")}
          onClick={() => {
            void desktopApi().openSettingsWindow?.({ pane: "general" }).catch(() => undefined);
          }}
        >
          <ThemeIcon name="settings" size={ICON_SIZE.default} />
        </button>
        {stage ? (
          <button
            type="button"
            className={`app-stage-toggle-btn${stage.isOpen ? " is-active" : ""}`}
            aria-label={stage.isOpen ? text("desktop.stage.close", "Close Stage") : text("desktop.stage.open", "Open Stage")}
            title={stage.isOpen ? text("desktop.stage.close", "Close Stage") : text("desktop.stage.open", "Open Stage")}
            onClick={() => stage?.toggleStage()}
          >
            <ThemeIcon name="panel-right" size={ICON_SIZE.default} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
