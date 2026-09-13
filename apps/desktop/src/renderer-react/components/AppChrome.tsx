import { ThemeIcon, type ThemeIconName } from "./ThemeIcon";
import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../bridge";
import { useI18n } from "../i18n";
import { type ActiveSessionDot } from "../features/workbench/activeSessionDots";
import { Tooltip } from "./Tooltip";
import { BellNotificationButton } from "./BellNotificationButton";
import { SessionDotsCluster } from "./SessionDotsCluster";

type PrimaryTab = "today" | "report" | "workbench" | "notes";
type FloatingNoteDot = { noteId: string; title: string };

const tabs: Array<{ id: PrimaryTab; icon: ThemeIconName; key: string; fallback: string }> = [
  { id: "today", icon: "zap", key: "desktop.tabs.today", fallback: "Today" },
  { id: "report", icon: "layout-dashboard", key: "desktop.tabs.report", fallback: "Report" },
  { id: "workbench", icon: "terminal", key: "desktop.tabs.workbench", fallback: "Workbench" },
  { id: "notes", icon: "file-text", key: "desktop.tabs.notes", fallback: "Notes" }
];

function eventDetail<T>(event: Event): T | undefined {
  return (event as CustomEvent<T>).detail;
}

export function AppChrome(): React.JSX.Element {
  const { ready, t } = useI18n();
  const [activeTab, setActiveTab] = useState<PrimaryTab>("today");
  const [sessionDots, setSessionDots] = useState<ActiveSessionDot[]>([]);
  const [noteDots, setNoteDots] = useState<FloatingNoteDot[]>([]);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Size the nav rail to the area below the app header (header height can
    // change once its contents are planned, so measure it live).
    const header = headerRef.current;
    if (!header || typeof ResizeObserver === "undefined") return;
    const update = () => {
      document.documentElement.style.setProperty("--app-header-height", `${header.offsetHeight}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onTabChange = (event: Event) => {
      const next = eventDetail<string>(event);
      if (next && tabs.some((tab) => tab.id === next)) setActiveTab(next as PrimaryTab);
    };
    const onTabRequest = (event: Event) => {
      const next = eventDetail<string>(event);
      if (!next || !tabs.some((tab) => tab.id === next)) return;
      setActiveTab(next as PrimaryTab);
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: next }));
    };
    const stopSessions = typeof window.agentResume.onOpenSessions === "function"
      ? window.agentResume.onOpenSessions(() => window.dispatchEvent(new Event("agent-resume:sessions-open")))
      : () => undefined;
    window.addEventListener("agent-resume:tab-change", onTabChange);
    window.addEventListener("agent-resume:tab-request", onTabRequest);
    return () => {
      window.removeEventListener("agent-resume:tab-change", onTabChange);
      window.removeEventListener("agent-resume:tab-request", onTabRequest);
      stopSessions();
    };
  }, []);

  useEffect(() => {
    const onActiveSessions = (event: Event) => {
      const detail = eventDetail<ActiveSessionDot[]>(event);
      if (Array.isArray(detail)) setSessionDots(detail);
    };
    window.addEventListener("agent-resume:active-sessions", onActiveSessions);
    return () => window.removeEventListener("agent-resume:active-sessions", onActiveSessions);
  }, []);

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

  const selectTab = (next: PrimaryTab) => {
    setActiveTab(next);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: next }));
  };

  const focusSessionFromRail = (dot: ActiveSessionDot) => {
    window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    window.dispatchEvent(new CustomEvent("agent-resume:workbench-focus-session", {
      detail: { paneKey: dot.paneKey, projectPath: dot.projectPath }
    }));
  };

  const focusNoteFromRail = (dot: FloatingNoteDot) => {
    const api = desktopApi();
    if (typeof api.standaloneNoteOpen !== "function") return;
    void api.standaloneNoteOpen({ noteId: dot.noteId }).catch(() => undefined);
  };

  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);

  return (
    <>
      <nav className="app-nav-rail" aria-label="Primary navigation">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`rail-btn${activeTab === tab.id ? " active" : ""}`}
            data-tab={tab.id}
            title={text(tab.key, tab.fallback)}
            aria-label={text(tab.key, tab.fallback)}
            onClick={() => selectTab(tab.id)}
          >
            <ThemeIcon name={tab.icon} aria-hidden="true" />
          </button>
        ))}
        {(noteDots.length > 0 || sessionDots.length > 0) && (
          <div className="rail-bottom-dots">
            {noteDots.length > 0 && (
              <div
                className="rail-notes-dots"
                role="group"
                aria-label={text("desktop.notes.floatingDots", "Floating notes")}
              >
                <span className="rail-dots-heading" aria-hidden="true" title={text("desktop.notes.floatingDots", "Floating notes")}>
                  <ThemeIcon name="file-text" size={12} />
                </span>
                {noteDots.map((dot) => (
                  <Tooltip key={dot.noteId} label={dot.title}>
                    <button
                      type="button"
                      className="rail-note-dot-btn"
                      aria-label={dot.title}
                      onClick={() => focusNoteFromRail(dot)}
                    >
                      <span className="rail-note-dot" aria-hidden="true" />
                    </button>
                  </Tooltip>
                ))}
              </div>
            )}
            {sessionDots.length > 0 && (
              <SessionDotsCluster
                dots={sessionDots}
                text={text}
                onFocus={focusSessionFromRail}
              />
            )}
          </div>
        )}
      </nav>
      <header ref={headerRef} className="top mac-top">
        <div id="app-header-slot" />
        <BellNotificationButton />
      </header>
    </>
  );
}
