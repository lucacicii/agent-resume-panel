import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { desktopApi } from "../../../bridge";
import type { BrowserSessionState, BrowserTabStateDto } from "../../../../shared/browserTypes";

export function ArtifactBrowserViewer(): React.JSX.Element {
  const [sessions, setSessions] = useState<BrowserSessionState[]>([]);
  const [activeSession, setActiveSession] = useState<BrowserSessionState | null>(null);
  const [urlInput, setUrlInput] = useState<string>("https://github.com");
  const [loading, setLoading] = useState(false);

  const activeTab = useMemo<BrowserTabStateDto | null>(() => {
    if (!activeSession || !activeSession.tabs || activeSession.tabs.length === 0) return null;
    return activeSession.tabs.find((t: BrowserTabStateDto) => t.tabId === activeSession.activeTabId) || activeSession.tabs[0];
  }, [activeSession]);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await desktopApi().browserList?.();
      if (Array.isArray(list)) {
        setSessions(list);
        if (list.length > 0 && !activeSession) {
          setActiveSession(list[0]);
          const tab = list[0].tabs?.find((t) => t.tabId === list[0].activeTabId) || list[0].tabs?.[0];
          if (tab?.url) setUrlInput(tab.url);
        }
      }
    } catch (err) {
      console.warn("Failed to list browser sessions:", err);
    }
  }, [activeSession]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const handleLaunchBrowser = async () => {
    setLoading(true);
    try {
      const workspace = localStorage.getItem("chat-selected-workspace") || "";
      const created = await desktopApi().browserCreate?.({
        projectPath: workspace || "/",
        startUrl: urlInput
      });
      if (created) {
        setActiveSession(created);
        void refreshSessions();
      }
    } catch (err) {
      console.warn("Failed to create browser:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = async () => {
    if (!activeSession || !urlInput) return;
    setLoading(true);
    try {
      const updated = await desktopApi().browserNavigate?.({
        browserId: activeSession.id,
        url: urlInput
      });
      if (updated) setActiveSession(updated);
    } catch (err) {
      console.warn("Failed to navigate:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleCiteUrl = () => {
    const url = activeTab?.url || urlInput;
    const title = activeTab?.title || "网页";
    window.dispatchEvent(
      new CustomEvent("agent-resume:composer-append", {
        detail: {
          text: `[网页: ${title}](${url}) `
        }
      })
    );
  };

  return (
    <div className="art-browser-container">
      {/* Browser address bar */}
      <div className="art-browser-toolbar">
        <div className="art-browser-nav-group">
          <button
            type="button"
            className="art-note-action-btn"
            onClick={() => void desktopApi().browserBack?.({ browserId: activeSession?.id || "" })}
            disabled={!activeSession}
            title="后退"
          >
            <ThemeIcon name="arrow-left" size={ICON_SIZE.dense} />
          </button>
          <button
            type="button"
            className="art-note-action-btn"
            onClick={() => void desktopApi().browserReload?.({ browserId: activeSession?.id || "" })}
            disabled={!activeSession}
            title="刷新"
          >
            <ThemeIcon name="refresh" size={ICON_SIZE.dense} />
          </button>
        </div>

        <div className="art-browser-url-bar">
          <ThemeIcon name="globe" size={ICON_SIZE.dense} className="art-browser-url-icon" />
          <input
            type="text"
            className="art-browser-url-input"
            value={urlInput}
            placeholder="输入网址 (https://...)"
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (!activeSession) void handleLaunchBrowser();
                else void handleNavigate();
              }
            }}
          />
        </div>

        <div className="art-browser-actions">
          {!activeSession ? (
            <button
              type="button"
              className="art-note-action-btn art-note-cite-btn"
              onClick={handleLaunchBrowser}
              disabled={loading}
              title="启动浏览器实例"
            >
              <ThemeIcon name="play" size={ICON_SIZE.inline} />
              <span>启动浏览器</span>
            </button>
          ) : (
            <button
              type="button"
              className="art-note-action-btn art-note-cite-btn"
              onClick={handleCiteUrl}
              title="引用网址到输入框"
            >
              <ThemeIcon name="paperclip" size={ICON_SIZE.inline} />
              <span>引用链接</span>
            </button>
          )}
        </div>
      </div>

      {/* Browser Main Surface */}
      <div className="art-browser-body">
        {!activeSession ? (
          <div className="stage-artifact-empty">
            <ThemeIcon name="globe" size={ICON_SIZE.hero} />
            <p className="stage-artifact-empty-text">当前无活跃浏览器会话</p>
            <p className="art-browser-hint">
              输入网址并点击“启动浏览器”，即可通过 CDP 代理实时协同操作
            </p>
          </div>
        ) : (
          <div className="stage-artifact-empty">
            <div className="art-browser-session-card">
              <div className="art-browser-session-head">
                <span className="art-browser-live-dot" />
                <span className="art-browser-session-title">
                  {activeTab?.title || activeTab?.url || "Session Running"}
                </span>
              </div>
              <p className="art-browser-session-url">{activeTab?.url}</p>
              <div className="art-browser-session-stats">
                <span>窗口: {activeSession.surface?.kind || "workbench"}</span>
                <span>标签页: {activeSession.tabs?.length || 1}</span>
              </div>
              <button
                type="button"
                className="art-browser-snap-btn"
                onClick={handleCiteUrl}
              >
                <ThemeIcon name="paperclip" size={ICON_SIZE.dense} />
                <span>将当前页面带入对话</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
