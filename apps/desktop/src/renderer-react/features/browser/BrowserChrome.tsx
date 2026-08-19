import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";
import type { BrowserSessionState, BrowserTabStateDto } from "../../../shared/browserTypes";

export type BrowserChromeProps = {
  session: BrowserSessionState | null;
  compact?: boolean;
  /** Standalone window chrome includes traffic-light padding. */
  windowMode?: boolean;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onNewTab: () => void;
  onCloseTab: (tabId: string) => void;
  onActivateTab: (tabId: string) => void;
  onPopOut?: () => void;
  onDock?: () => void;
  onClearCookies?: () => void;
};

function activeTab(session: BrowserSessionState | null): BrowserTabStateDto | null {
  if (!session) return null;
  return session.tabs.find((tab) => tab.tabId === session.activeTabId) || session.tabs[0] || null;
}

export function BrowserChrome({
  session,
  compact = false,
  windowMode = false,
  onNavigate,
  onBack,
  onForward,
  onReload,
  onStop,
  onNewTab,
  onCloseTab,
  onActivateTab,
  onPopOut,
  onDock,
  onClearCookies
}: BrowserChromeProps): React.JSX.Element {
  const { t } = useI18n();
  const tab = activeTab(session);
  const [urlDraft, setUrlDraft] = useState(tab?.url || "");

  useEffect(() => {
    setUrlDraft(tab?.url || "");
  }, [tab?.url, tab?.tabId]);

  const canGoBack = Boolean(tab?.canGoBack);
  const canGoForward = Boolean(tab?.canGoForward);
  const loading = Boolean(tab?.loading);
  const surfaceKind = session?.surface.kind;

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      onNavigate(urlDraft);
    },
    [onNavigate, urlDraft]
  );

  const tabs = useMemo(() => session?.tabs || [], [session?.tabs]);

  return (
    <div className={`browser-chrome${compact ? " is-compact" : ""}${windowMode ? " is-window" : ""}`}>
      {!compact ? (
        <div className="browser-chrome-tabs" role="tablist" aria-label={t("desktop.browser.tabs")}>
          {tabs.map((item) => (
            <div
              key={item.tabId}
              className={`browser-chrome-tab${item.tabId === session?.activeTabId ? " is-active" : ""}`}
              role="tab"
              aria-selected={item.tabId === session?.activeTabId}
            >
              <button type="button" className="browser-chrome-tab-label" onClick={() => onActivateTab(item.tabId)}>
                {item.loading ? <ThemeIcon name="loader" className="spin" size={12} aria-hidden="true" /> : <ThemeIcon name="globe" size={12} aria-hidden="true" />}
                <span>{item.title || item.url || t("desktop.browser.newTab")}</span>
              </button>
              <button
                type="button"
                className="browser-chrome-tab-close"
                aria-label={t("desktop.browser.closeTab")}
                onClick={() => onCloseTab(item.tabId)}
              >
                <ThemeIcon name="close" size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="browser-chrome-new-tab" aria-label={t("desktop.browser.newTab")} onClick={onNewTab}>
            <ThemeIcon name="file-plus" size={13} />
          </button>
        </div>
      ) : null}

      <div className="browser-chrome-toolbar">
        <div className="browser-chrome-nav">
          <button type="button" className="browser-chrome-btn" disabled={!canGoBack} aria-label={t("desktop.browser.back")} onClick={onBack}>
            <ThemeIcon name="arrow-left" size={14} />
          </button>
          <button type="button" className="browser-chrome-btn" disabled={!canGoForward} aria-label={t("desktop.browser.forward")} onClick={onForward}>
            <ThemeIcon name="arrow-right" size={14} />
          </button>
          <button
            type="button"
            className="browser-chrome-btn"
            aria-label={loading ? t("desktop.browser.stop") : t("desktop.browser.reload")}
            onClick={() => (loading ? onStop() : onReload())}
          >
            <ThemeIcon name={loading ? "close" : "refresh"} size={14} className={loading ? undefined : undefined} />
          </button>
        </div>
        <form className="browser-chrome-url-form" onSubmit={submit}>
          <ThemeIcon name="globe" size={13} aria-hidden="true" />
          <input
            className="browser-chrome-url"
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-label={t("desktop.browser.address")}
            placeholder={t("desktop.browser.addressPlaceholder")}
          />
        </form>
        <div className="browser-chrome-actions">
          {onClearCookies ? (
            <button type="button" className="browser-chrome-btn" aria-label={t("desktop.browser.clearCookies")} title={t("desktop.browser.clearCookies")} onClick={onClearCookies}>
              <ThemeIcon name="shield-check" size={14} />
            </button>
          ) : null}
          {surfaceKind === "workbench" && onPopOut ? (
            <button type="button" className="browser-chrome-btn" aria-label={t("desktop.browser.popOut")} title={t("desktop.browser.popOut")} onClick={onPopOut}>
              <ThemeIcon name="external-link" size={14} />
            </button>
          ) : null}
          {surfaceKind === "window" && onDock ? (
            <button type="button" className="browser-chrome-btn" aria-label={t("desktop.browser.dock")} title={t("desktop.browser.dock")} onClick={onDock}>
              <ThemeIcon name="panel-right" size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
