import React, { useMemo, useState } from "react";
import type { BrowserDevtoolsLogEntry } from "../../../shared/browserTypes";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";
import { composeErrorPrompt } from "./probePrompt";

type ConsoleTab = "all" | "errors" | "warnings" | "network";

type BrowserConsoleDockProps = {
  logs: BrowserDevtoolsLogEntry[];
  isCollapsed: boolean;
  /** False while DevTools owns the debugger session; the feed is on hold then. */
  cdpAttached: boolean;
  onToggleCollapse: () => void;
  onClearLogs: () => void;
  onSendToSession: (text: string) => void;
};

const TABS: ConsoleTab[] = ["all", "errors", "warnings", "network"];

const TAB_LABEL_KEY: Record<ConsoleTab, string> = {
  all: "desktop.browser.console.tabAll",
  errors: "desktop.browser.console.tabErrors",
  warnings: "desktop.browser.console.tabWarnings",
  network: "desktop.browser.console.tabNetwork"
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.toTimeString().split(" ")[0]}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

export function BrowserConsoleDock({
  logs,
  isCollapsed,
  cdpAttached,
  onToggleCollapse,
  onClearLogs,
  onSendToSession
}: BrowserConsoleDockProps): React.JSX.Element {
  const { t } = useI18n();
  const [tab, setTab] = useState<ConsoleTab>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(
    () => ({
      all: logs.length,
      errors: logs.filter((entry) => entry.level === "error").length,
      warnings: logs.filter((entry) => entry.level === "warn").length
    }),
    [logs]
  );

  const filtered = useMemo(() => {
    let list = logs;
    if (tab === "errors") list = list.filter((entry) => entry.level === "error");
    else if (tab === "warnings") list = list.filter((entry) => entry.level === "warn");
    else if (tab === "network") list = list.filter((entry) => entry.category === "network");
    const needle = query.trim().toLowerCase();
    return needle ? list.filter((entry) => entry.text.toLowerCase().includes(needle)) : list;
  }, [logs, tab, query]);

  return (
    <div className="browser-console-dock">
      <div className="browser-console-bar">
        <div className="browser-console-tabs" role="tablist" aria-label={t("desktop.browser.probeConsole")}>
          {TABS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={tab === candidate}
              className={`browser-console-tab${tab === candidate ? " is-active" : ""}`}
              onClick={() => setTab(candidate)}
            >
              <span>{t(TAB_LABEL_KEY[candidate])}</span>
              {candidate === "network" ? null : (
                <span className={`browser-console-count${candidate === "errors" && counts.errors > 0 ? " is-alert" : ""}`}>
                  {counts[candidate]}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="browser-console-actions">
          {cdpAttached ? null : <span className="browser-console-offline">{t("desktop.browser.probeCdpOffline")}</span>}
          <input
            className="browser-console-filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
            aria-label={t("desktop.browser.console.filter")}
            placeholder={t("desktop.browser.console.filter")}
          />
          <button
            type="button"
            className="browser-console-action"
            title={t("desktop.browser.console.clear")}
            aria-label={t("desktop.browser.console.clear")}
            onClick={onClearLogs}
          >
            <ThemeIcon name="trash" size={ICON_SIZE.inline} />
          </button>
          <button
            type="button"
            className="browser-console-action"
            title={isCollapsed ? t("desktop.browser.console.expand") : t("desktop.browser.console.collapse")}
            aria-label={isCollapsed ? t("desktop.browser.console.expand") : t("desktop.browser.console.collapse")}
            onClick={onToggleCollapse}
          >
            <ThemeIcon name={isCollapsed ? "chevron-up" : "chevron-down"} size={ICON_SIZE.dense} />
          </button>
        </div>
      </div>

      {isCollapsed ? null : (
        <div className="browser-console-body">
          {filtered.length === 0 ? (
            <p className="browser-console-empty">{t("desktop.browser.console.empty")}</p>
          ) : (
            filtered.map((entry) => {
              const isProbe = entry.origin === "probe";
              const tone = entry.category === "network" ? "is-network" : `is-${entry.level}`;
              return (
                <div className="browser-console-row" key={entry.id}>
                  <div className="browser-console-head">
                    <span className="browser-console-time">{formatTime(entry.timestamp)}</span>
                    <span className={`browser-console-badge ${tone}`}>
                      {isProbe ? t("desktop.browser.console.probeTag") : `${entry.category}:${entry.level}`}
                    </span>
                    <span className="browser-console-text">{entry.text}</span>
                    {entry.level === "error" && !isProbe ? (
                      <button
                        type="button"
                        className="browser-console-fix"
                        onClick={() => onSendToSession(composeErrorPrompt(t, entry))}
                      >
                        <ThemeIcon name="wrench" size={ICON_SIZE.inline} />
                        <span>{t("desktop.browser.console.fix")}</span>
                      </button>
                    ) : null}
                  </div>
                  {entry.stack ? <pre className="browser-console-stack">{entry.stack}</pre> : null}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
