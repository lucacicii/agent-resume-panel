import { ThemeIcon, type ThemeIconName } from "./ThemeIcon";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { type ActiveSessionDot, type SessionDotStatus } from "../features/workbench/activeSessionDots";
import { Tooltip } from "./Tooltip";

type PrimaryTab = "report" | "agent" | "workbench" | "notes" | "flow" | "kanban";

const tabs: Array<{ id: PrimaryTab; icon: ThemeIconName; key: string; fallback: string }> = [
  { id: "report", icon: "activity", key: "desktop.tabs.report", fallback: "Report" },
  { id: "agent", icon: "bot", key: "desktop.tabs.agent", fallback: "Agent" },
  { id: "workbench", icon: "terminal", key: "desktop.tabs.workbench", fallback: "Workbench" },
  { id: "notes", icon: "file-text", key: "desktop.tabs.notes", fallback: "Notes" },
  { id: "flow", icon: "waypoints", key: "desktop.tabs.flow", fallback: "Flow" },
  { id: "kanban", icon: "square-kanban", key: "desktop.tabs.kanban", fallback: "Kanban" }
];

function eventDetail<T>(event: Event): T | undefined {
  return (event as CustomEvent<T>).detail;
}

export function AppChrome(): React.JSX.Element {
  const { ready, t } = useI18n();
  const [activeTab, setActiveTab] = useState<PrimaryTab>("report");
  const [sessionDots, setSessionDots] = useState<ActiveSessionDot[]>([]);
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

  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);

  const statusLabel = (dot: ActiveSessionDot): string => {
    const status: SessionDotStatus = dot.status || "open";
    if (status === "awaiting_user") {
      if (dot.awaitingConfidence === "possible") {
        return text("desktop.workbench.sessionDot.possiblyAwaiting", "May need attention");
      }
      return text("desktop.workbench.sessionDot.awaiting", "Waiting for you");
    }
    if (status === "running") return text("desktop.workbench.sessionDot.running", "Running");
    if (status === "connecting") return text("desktop.workbench.sessionDot.connecting", "Connecting");
    if (status === "error") return text("desktop.workbench.sessionDot.error", "Error");
    return "";
  };

  const dotLabel = (dot: ActiveSessionDot): string => {
    const status = statusLabel(dot);
    return status ? `${dot.title} · ${status}` : dot.title;
  };

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
        {sessionDots.length > 0 && (
          <div className="rail-session-dots">
            {sessionDots.map((dot) => {
              const status: SessionDotStatus = dot.status || "open";
              const label = dotLabel(dot);
              return (
                <Tooltip key={dot.paneKey} label={label}>
                  <button
                    type="button"
                    className="rail-session-dot-btn"
                    data-status={status}
                    aria-label={label}
                    onClick={() => focusSessionFromRail(dot)}
                  >
                    <span
                      className={`rail-session-dot${status !== "open" ? ` is-${status === "awaiting_user" ? "awaiting" : status}` : ""}`}
                      aria-hidden="true"
                    />
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
      </nav>
      {/* Header is intentionally empty for now — its contents are planned later.
          Per-tab toolbars (e.g. Kanban) portal into #app-header-slot while active. */}
      <header ref={headerRef} className="top mac-top">
        <div id="app-header-slot" />
      </header>
    </>
  );
}
