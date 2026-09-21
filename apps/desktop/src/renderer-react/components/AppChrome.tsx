import { ICON_SIZE, ThemeIcon } from "./ThemeIcon";
import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../bridge";
import { useI18n } from "../i18n";
import { showContextMenuAt } from "../nativeContextMenu";
import { BellNotificationButton } from "./BellNotificationButton";

type FloatingNoteDot = { noteId: string; title: string };

/**
 * The app is GTD-first: there is no primary-tab rail anymore. The header keeps
 * the global chrome — the sidebar toggle, the per-view toolbar slot,
 * floating-note dots, the notification bell, and the account/settings menu.
 */
export function AppChrome({ sidebarCollapsed, onToggleSidebar }: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}): React.JSX.Element {
  const { ready, t } = useI18n();
  const [noteDots, setNoteDots] = useState<FloatingNoteDot[]>([]);
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);

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

  const openSettings = (pane = "general") => {
    // Settings lives in its own window (⌘,), so ask the main process for it.
    void desktopApi().openSettingsWindow?.({ pane }).catch(() => undefined);
  };

  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);
  const avatarLabel = text("desktop.chrome.account", "Account");
  const settingsLabel = text("desktop.top.settings", "Settings");
  const sidebarLabel = sidebarCollapsed
    ? text("desktop.nav.expand", "Expand sidebar")
    : text("desktop.nav.collapse", "Collapse sidebar");

  /** The account menu is a native `NSMenu` anchored to the avatar button. */
  const openAccountMenu = async () => {
    const rect = avatarBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const chosen = await showContextMenuAt({ x: rect.left, y: rect.bottom + 4 }, [{ id: "settings", label: settingsLabel }]);
    if (chosen === "settings") openSettings();
  };

  return (
    <header className="top mac-top">
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
      <div id="app-header-slot" />
      {noteDots.length > 0 ? (
        <div className="app-note-dots" role="group" aria-label={text("desktop.notes.floatingDots", "Floating notes")}>
          {noteDots.map((dot) => (
            <button
              key={dot.noteId}
              type="button"
              className="app-note-dot-btn"
              // System tooltip: `title` is drawn by the platform with its own
              // delay, appearance, and language.
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
      <div className="app-account">
        <button
          ref={avatarBtnRef}
          type="button"
          className="app-account-btn"
          title={avatarLabel}
          aria-label={avatarLabel}
          aria-haspopup="menu"
          onClick={() => void openAccountMenu()}
        >
          <span className="app-account-avatar" aria-hidden="true">
            <ThemeIcon name="user" size={ICON_SIZE.default} />
          </span>
        </button>
      </div>
    </header>
  );
}
