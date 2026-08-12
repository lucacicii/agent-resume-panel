import { ThemeIcon, type ThemeIconName } from "./ThemeIcon";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

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

  const selectTab = (next: PrimaryTab) => {
    setActiveTab(next);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: next }));
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
      </nav>
      {/* Header is intentionally empty for now — its contents are planned later.
          Per-tab toolbars (e.g. Kanban) portal into #app-header-slot while active. */}
      <header className="top mac-top">
        <div id="app-header-slot" />
      </header>
    </>
  );
}
