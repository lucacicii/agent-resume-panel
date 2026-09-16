import { ThemeIcon } from "./ThemeIcon";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../bridge";
import { useI18n } from "../i18n";
import { Tooltip } from "./Tooltip";
import { BellNotificationButton } from "./BellNotificationButton";

type FloatingNoteDot = { noteId: string; title: string };

/**
 * The app is GTD-first: there is no primary-tab rail anymore. The header keeps
 * the global chrome — the per-view toolbar slot, floating-note dots, the
 * notification bell, and the account/settings menu.
 */
export function AppChrome(): React.JSX.Element {
  const { ready, t } = useI18n();
  const [noteDots, setNoteDots] = useState<FloatingNoteDot[]>([]);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);
  const avatarMenuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!avatarMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (avatarBtnRef.current?.contains(target) || avatarMenuRef.current?.contains(target)) return;
      setAvatarMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAvatarMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [avatarMenuOpen]);

  useEffect(() => {
    if (!avatarMenuOpen) return;
    const btn = avatarBtnRef.current;
    const menu = avatarMenuRef.current;
    if (!btn || !menu) return;
    const rect = btn.getBoundingClientRect();
    const gap = 8;
    const left = Math.min(rect.right + gap, window.innerWidth - menu.offsetWidth - 8);
    const top = Math.max(8, Math.min(rect.bottom - menu.offsetHeight, window.innerHeight - menu.offsetHeight - 8));
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${top}px`;
  }, [avatarMenuOpen]);

  const focusNote = (dot: FloatingNoteDot) => {
    const api = desktopApi();
    if (typeof api.standaloneNoteOpen !== "function") return;
    void api.standaloneNoteOpen({ noteId: dot.noteId }).catch(() => undefined);
  };

  const openSettings = (pane = "general") => {
    setAvatarMenuOpen(false);
    window.dispatchEvent(new CustomEvent("agent-resume:settings-open", { detail: pane }));
  };

  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);
  const avatarLabel = text("desktop.chrome.account", "Account");
  const settingsLabel = text("desktop.top.settings", "Settings");

  return (
    <header className="top mac-top">
      <div id="app-header-slot" />
      {noteDots.length > 0 ? (
        <div className="app-note-dots" role="group" aria-label={text("desktop.notes.floatingDots", "Floating notes")}>
          {noteDots.map((dot) => (
            <Tooltip key={dot.noteId} label={dot.title}>
              <button
                type="button"
                className="app-note-dot-btn"
                aria-label={dot.title}
                onClick={() => focusNote(dot)}
              >
                <span className="app-note-dot" aria-hidden="true" />
              </button>
            </Tooltip>
          ))}
        </div>
      ) : null}
      <BellNotificationButton />
      <div className="app-account">
        <Tooltip label={avatarLabel}>
          <button
            ref={avatarBtnRef}
            type="button"
            className={`app-account-btn${avatarMenuOpen ? " is-open" : ""}`}
            aria-label={avatarLabel}
            aria-haspopup="menu"
            aria-expanded={avatarMenuOpen}
            onClick={() => setAvatarMenuOpen((open) => !open)}
          >
            <span className="app-account-avatar" aria-hidden="true">
              <ThemeIcon name="user" size={16} />
            </span>
          </button>
        </Tooltip>
        {avatarMenuOpen
          ? createPortal(
              <div ref={avatarMenuRef} className="rail-account-menu" role="menu" aria-label={avatarLabel}>
                <button
                  type="button"
                  role="menuitem"
                  className="rail-account-menu-item"
                  onClick={() => openSettings("general")}
                >
                  <ThemeIcon name="settings" size={14} aria-hidden="true" />
                  {settingsLabel}
                </button>
              </div>,
              document.body
            )
          : null}
      </div>
    </header>
  );
}
