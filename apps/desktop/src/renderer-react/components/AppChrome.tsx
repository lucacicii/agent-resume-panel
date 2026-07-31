import { ThemeIcon } from "./ThemeIcon";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

type PrimaryTab = "report" | "agent" | "workbench" | "notes";

interface UpdateState {
  available: boolean;
  version: string;
}

const tabs: Array<{ id: PrimaryTab; key: string; fallback: string }> = [
  { id: "report", key: "desktop.tabs.report", fallback: "Report" },
  { id: "agent", key: "desktop.tabs.agent", fallback: "Agent" },
  { id: "workbench", key: "desktop.tabs.workbench", fallback: "Workbench" },
  { id: "notes", key: "desktop.tabs.notes", fallback: "Notes" }
];

function eventDetail<T>(event: Event): T | undefined {
  return (event as CustomEvent<T>).detail;
}

export function AppChrome(): React.JSX.Element {
  const { ready, t } = useI18n();
  const [activeTab, setActiveTab] = useState<PrimaryTab>("report");
  const [update, setUpdate] = useState<UpdateState>({ available: false, version: "" });

  useEffect(() => {
    const onTabChange = (event: Event) => {
      const next = eventDetail<string>(event);
      if (next && tabs.some((tab) => tab.id === next)) setActiveTab(next as PrimaryTab);
    };
    const onUpdateChange = (event: Event) => {
      const next = eventDetail<UpdateState>(event);
      if (next) setUpdate(next);
    };
    const onTabRequest = (event: Event) => {
      const next = eventDetail<string>(event);
      if (!next || !tabs.some((tab) => tab.id === next)) return;
      setActiveTab(next as PrimaryTab);
      window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: next }));
    };
    window.addEventListener("agent-resume:tab-change", onTabChange);
    window.addEventListener("agent-resume:update-change", onUpdateChange);
    window.addEventListener("agent-resume:tab-request", onTabRequest);
    if (typeof window.agentResume.checkForUpdate === "function") {
      void window.agentResume.checkForUpdate({ force: false }).then((result) => {
        if (result.ok && result.updateAvailable) setUpdate({ available: true, version: result.latestVersion });
      }).catch(() => undefined);
    }
    return () => {
      window.removeEventListener("agent-resume:tab-change", onTabChange);
      window.removeEventListener("agent-resume:update-change", onUpdateChange);
      window.removeEventListener("agent-resume:tab-request", onTabRequest);
    };
  }, []);

  const selectTab = (next: PrimaryTab) => {
    setActiveTab(next);
    window.dispatchEvent(new CustomEvent("agent-resume:tab-change", { detail: next }));
  };

  const openSettings = (pane: "general" | "about" = "general") => {
    if (typeof window.agentResume.openSettingsWindow === "function") {
      void window.agentResume.openSettingsWindow({ pane });
    }
  };

  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);
  const updateTitle = update.version
    ? t("desktop.top.settingsUpdateAvailable", update.version)
    : text("desktop.top.settingsTitle", "Settings");

  return (
    <header className="top mac-top">
      <nav className="tabs primary-tabs" aria-label="Primary navigation">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab${activeTab === tab.id ? " active" : ""}`}
            data-tab={tab.id}
            onClick={() => selectTab(tab.id)}
          >
            {text(tab.key, tab.fallback)}
          </button>
        ))}
      </nav>
      <div className="top-actions">
        <button
          type="button"
          className="icon-btn"
          id="btnOpenSessions"
          title={text("desktop.top.sessionsRefTitle", "Sessions")}
          aria-label={text("desktop.top.sessionsRefTitle", "Sessions")}
          onClick={() => window.dispatchEvent(new Event("agent-resume:sessions-open"))}
        >
          <ThemeIcon name="history" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          id="btnOpenSettings"
          title={text("desktop.top.settingsTitle", "Settings")}
          aria-label={text("desktop.top.settingsTitle", "Settings")}
          onClick={() => openSettings()}
        >
          <ThemeIcon name="settings" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`icon-btn icon-btn-update${update.available ? "" : " is-hidden"}`}
          id="btnOpenAboutUpdate"
          hidden={!update.available}
          aria-hidden={!update.available}
          title={update.available ? updateTitle : undefined}
          aria-label={updateTitle}
          onClick={() => openSettings("about")}
        >
          <ThemeIcon name="download" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
