import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BrowserDevtoolsLogEntry,
  BrowserProbeMarkup,
  BrowserProbeStrings,
  BrowserProbeTarget,
  BrowserSessionState
} from "../../../shared/browserTypes";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { BrowserChrome } from "./BrowserChrome";
import { BrowserConsoleDock } from "./BrowserConsoleDock";
import { BrowserProbeToolbar } from "./BrowserProbeToolbar";
import { BrowserProbeTray } from "./BrowserProbeTray";

type BrowserSidePanelProps = {
  /** Workbench panel visibility: false means no bounds reporting and no probe. */
  active: boolean;
  /** Browser sessions in this panel's scope, newest first. */
  browsers: Array<{
    key: string;
    browserId: string;
    projectPath: string;
    title: string;
    surfaceKind: "workbench" | "window";
  }>;
  /** Directory the panel belongs to; null means nothing selected yet. */
  projectPath: string | null;
  onRequestCreate: () => void;
  onOpenSource: (path: string, line?: number) => void;
  onSendToSession: (text: string) => void;
};

const MAX_LOGS = 300;

function measureHostRect(el: HTMLElement): { x: number; y: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
}

/**
 * Browser panel for the workbench sidebar: chrome, the native view host, the
 * probe tray and the console. The live `WebContentsView` is parented by the main
 * process onto the measured host rect, so everything here is chrome only.
 */
export function BrowserSidePanel({
  active,
  browsers,
  projectPath,
  onRequestCreate,
  onOpenSource,
  onSendToSession
}: BrowserSidePanelProps): React.JSX.Element {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<BrowserSessionState | null>(null);
  /** Sessions the main process destroyed: the pane list in WorkbenchPanel is not told. */
  const [deadIds, setDeadIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inspectMode, setInspectMode] = useState<"inspect" | "markup" | "off">("off");
  const [inspectTarget, setInspectTarget] = useState<BrowserProbeTarget | null>(null);
  const [markups, setMarkups] = useState<BrowserProbeMarkup[]>([]);
  const [logs, setLogs] = useState<BrowserDevtoolsLogEntry[]>([]);
  const [cdpAttached, setCdpAttached] = useState(false);
  const [viewportMode, setViewportMode] = useState("responsive");
  const [zoom, setZoom] = useState("1.0");
  const [consoleCollapsed, setConsoleCollapsed] = useState(true);

  const live = useMemo(
    () => browsers.filter((item) => !deadIds.includes(item.browserId)),
    [browsers, deadIds]
  );
  // No auto-switch: a session the agent opens must not steal the one being read.
  const selected = live.find((item) => item.browserId === sessionId) ?? live[0] ?? null;
  const browserId = selected?.browserId ?? null;
  const activeTabId = session && session.id === browserId ? session.activeTabId : null;
  const isLive = active && session?.surface.kind === "workbench";
  const errorCount = useMemo(() => logs.filter((entry) => entry.level === "error").length, [logs]);

  const probeStrings = useMemo<BrowserProbeStrings>(
    () => ({
      dialogTitle: t("desktop.browser.probeScript.dialogTitle"),
      dialogHint: t("desktop.browser.probeScript.dialogHint"),
      dialogDefaultNote: t("desktop.browser.probeScript.dialogDefaultNote"),
      overlayTip: t("desktop.browser.probeScript.overlayTip"),
      noTarget: t("desktop.browser.probeScript.noTarget"),
      cancel: t("desktop.common.cancel"),
      confirm: t("desktop.common.confirm")
    }),
    [t]
  );

  const markDead = useCallback((id: string) => {
    setDeadIds((current) => (current.includes(id) ? current : [...current, id]));
  }, []);

  useEffect(() => {
    if (!browserId) return;
    let cancelled = false;
    setError(null);
    setSession(null);
    setInspectMode("off");
    setInspectTarget(null);
    setMarkups([]);
    setLogs([]);
    setCdpAttached(false);
    void desktopApi()
      .browserGet({ browserId })
      .then((state) => {
        if (cancelled) return;
        if (!state) {
          markDead(browserId);
          return;
        }
        setSession(state);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [browserId, markDead]);

  useEffect(() => {
    if (!browserId) return;
    return desktopApi().onBrowserEvent((event) => {
      if (event.type === "state") {
        if (event.session.id === browserId) setSession(event.session);
        return;
      }
      if (event.browserId !== browserId) return;
      switch (event.type) {
        case "surface":
          setSession((current) => (current ? { ...current, surface: event.surface } : current));
          return;
        case "crash":
          setError(event.reason);
          return;
        case "devtoolsAttached":
          if (event.tabId === activeTabId) setCdpAttached(event.attached);
          return;
        case "devtoolsLog":
          if (event.tabId === activeTabId) {
            setLogs((current) => [event.entry, ...current].slice(0, MAX_LOGS));
          }
          return;
        case "devtoolsLogsCleared":
          if (event.tabId === activeTabId) setLogs([]);
          return;
        case "probeInspect":
          if (event.tabId === activeTabId) {
            setInspectTarget(event.target);
            setInspectMode("off");
          }
          return;
        case "probeMarkup":
          if (event.tabId === activeTabId) {
            setMarkups((current) =>
              current.some((markup) => markup.id === event.markup.id) ? current : [...current, event.markup]
            );
          }
          return;
        case "probeCancelled":
          // ESC cleared the page's own boxes and selection along with the mode.
          if (event.tabId === activeTabId) {
            setInspectMode("off");
            setInspectTarget(null);
            setMarkups([]);
          }
          return;
        default:
          return;
      }
    });
  }, [activeTabId, browserId]);

  useEffect(() => {
    if (!browserId || !activeTabId || !isLive) return;
    void desktopApi().browserSetProbeActive({
      browserId,
      tabId: activeTabId,
      active: true,
      strings: probeStrings
    });
    // Holds the tab's debugger session, so it is released on hide, tab switch and unmount alike.
    // Release also hands the page back (the probe hides its overlay), so the toolbar
    // must stop claiming a mode is armed.
    return () => {
      void desktopApi().browserSetProbeActive({ browserId, tabId: activeTabId, active: false });
      setInspectMode("off");
    };
  }, [activeTabId, browserId, isLive, probeStrings]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !browserId) return;
    void desktopApi().browserSetVisible({ browserId, visible: Boolean(isLive) });
    if (!isLive) return;

    let frame = 0;
    const report = () => {
      frame = 0;
      void desktopApi().browserAttachBounds({ browserId, rect: measureHostRect(host) });
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(report);
    };

    schedule();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(host);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      void desktopApi().browserSetVisible({ browserId, visible: false });
    };
  }, [activeTabId, browserId, isLive]);

  const run = useCallback(
    async (
      action: () => Promise<
        | BrowserSessionState
        | { session: BrowserSessionState | null; destroyed: boolean }
        | { ok: boolean }
        | { ok: boolean; open: boolean }
      >
    ) => {
      try {
        setError(null);
        const result = await action();
        if (!result || typeof result !== "object") return;
        if ("destroyed" in result && result.destroyed) {
          setSession(null);
          if (browserId) markDead(browserId);
          return;
        }
        if ("session" in result && result.session) {
          setSession(result.session);
          return;
        }
        if ("id" in result) setSession(result as BrowserSessionState);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [browserId, markDead]
  );

  const handleToggleInspect = useCallback(() => {
    if (!browserId) return;
    const next = inspectMode === "inspect" ? "off" : "inspect";
    setInspectMode(next);
    // Entering pick mode drops the probe's own annotation boxes, so the list goes with them.
    if (next === "inspect") setMarkups([]);
    void desktopApi().browserSetInspectMode({ browserId, tabId: activeTabId ?? undefined, mode: next });
  }, [activeTabId, browserId, inspectMode]);

  const handleToggleMarkup = useCallback(() => {
    if (!browserId) return;
    const next = inspectMode === "markup" ? "off" : "markup";
    setInspectMode(next);
    if (next === "off") setMarkups([]);
    void desktopApi().browserSetInspectMode({ browserId, tabId: activeTabId ?? undefined, mode: next });
  }, [activeTabId, browserId, inspectMode]);

  const handleRemoveMarkup = useCallback(
    (id: string) => {
      setMarkups((current) => current.filter((markup) => markup.id !== id));
      if (!browserId) return;
      void desktopApi().browserClearMarkups({ browserId, tabId: activeTabId ?? undefined, id });
    },
    [activeTabId, browserId]
  );

  const handleClearMarkups = useCallback(() => {
    setMarkups([]);
    if (!browserId) return;
    void desktopApi().browserClearMarkups({ browserId, tabId: activeTabId ?? undefined });
  }, [activeTabId, browserId]);

  const handleViewportChange = useCallback((value: string) => setViewportMode(value), []);

  const handleZoomChange = useCallback(
    (value: string) => {
      setZoom(value);
      if (!browserId) return;
      void desktopApi().browserSetZoom({ browserId, tabId: activeTabId ?? undefined, factor: Number(value) });
    },
    [activeTabId, browserId]
  );

  const handleToggleConsole = useCallback(() => setConsoleCollapsed((current) => !current), []);

  const handleClearLogs = useCallback(() => {
    setLogs([]);
    if (!browserId) return;
    void desktopApi().browserClearDevtoolsLogs({ browserId, tabId: activeTabId ?? undefined });
  }, [activeTabId, browserId]);

  if (!projectPath) {
    return (
      <div className="wb-side-pane browser-side-pane">
        <p className="muted">{t("desktop.workbench.selectProjectHint")}</p>
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="wb-side-pane browser-side-pane">
        <div className="browser-pane-placeholder-card">
          <p>{t("desktop.browser.probeEmpty")}</p>
          <div className="browser-pane-placeholder-actions">
            <button type="button" className="browser-chrome-btn is-primary" onClick={onRequestCreate}>
              {t("desktop.browser.newBrowser")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (session?.surface.kind === "window") {
    return (
      <div className="wb-side-pane browser-side-pane">
        <div className="browser-pane-placeholder-card">
          <p>{t("desktop.browser.poppedOutHint")}</p>
          <div className="browser-pane-placeholder-actions">
            <button
              type="button"
              className="browser-chrome-btn is-primary"
              onClick={() => void run(() => desktopApi().browserFocus({ browserId: selected.browserId }))}
            >
              {t("desktop.browser.showInWindow")}
            </button>
            <button
              type="button"
              className="browser-chrome-btn is-primary"
              onClick={() =>
                void run(() => desktopApi().browserSetSurface({ browserId: selected.browserId, surface: "workbench" }))
              }
            >
              {t("desktop.browser.returnToWorkbench")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="browser-side-panel">
      {live.length > 1 ? (
        <div className="browser-session-strip">
          <select
            className="browser-chrome-select"
            value={selected.browserId}
            aria-label={t("desktop.workbench.sidePanelBrowser")}
            onChange={(event) => setSessionId(event.target.value)}
          >
            {live.map((item) => (
              <option key={item.browserId} value={item.browserId}>
                {item.title}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <BrowserChrome
        session={session}
        extra={
          <BrowserProbeToolbar
            inspectMode={inspectMode}
            markupCount={markups.length}
            errorCount={errorCount}
            consoleCollapsed={consoleCollapsed}
            viewportMode={viewportMode}
            zoom={zoom}
            cdpAttached={cdpAttached}
            onToggleInspect={handleToggleInspect}
            onToggleMarkup={handleToggleMarkup}
            onToggleDevTools={() =>
              void run(() =>
                desktopApi().browserToggleDevTools({ browserId: selected.browserId, tabId: activeTabId ?? undefined })
              )
            }
            onToggleConsole={handleToggleConsole}
            onViewportChange={handleViewportChange}
            onZoomChange={handleZoomChange}
          />
        }
        onNavigate={(url) => void run(() => desktopApi().browserNavigate({ browserId: selected.browserId, url }))}
        onBack={() => void run(() => desktopApi().browserBack({ browserId: selected.browserId }))}
        onForward={() => void run(() => desktopApi().browserForward({ browserId: selected.browserId }))}
        onReload={() => void run(() => desktopApi().browserReload({ browserId: selected.browserId }))}
        onStop={() => void run(() => desktopApi().browserStop({ browserId: selected.browserId }))}
        onNewTab={() => void run(() => desktopApi().browserNewTab({ browserId: selected.browserId }))}
        onCloseTab={(tabId) => void run(() => desktopApi().browserCloseTab({ browserId: selected.browserId, tabId }))}
        onActivateTab={(tabId) =>
          void run(() => desktopApi().browserActivateTab({ browserId: selected.browserId, tabId }))
        }
        onPopOut={() => void run(() => desktopApi().browserSetSurface({ browserId: selected.browserId, surface: "window" }))}
        onClearCookies={() => void run(() => desktopApi().browserClearCookies({ browserId: selected.browserId }))}
      />
      {error ? (
        <div className="browser-pane-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="browser-viewport-area">
        <div className="browser-viewport-frame" data-viewport={viewportMode}>
          <div ref={hostRef} className="browser-pane-host" data-project-path={selected.projectPath} aria-hidden="true" />
        </div>
      </div>
      <BrowserProbeTray
        target={inspectTarget}
        markups={markups}
        onClearTarget={() => setInspectTarget(null)}
        onRemoveMarkup={handleRemoveMarkup}
        onClearMarkups={handleClearMarkups}
        onOpenSource={onOpenSource}
        onSendToSession={onSendToSession}
      />
      <BrowserConsoleDock
        logs={logs}
        isCollapsed={consoleCollapsed}
        cdpAttached={cdpAttached}
        onToggleCollapse={handleToggleConsole}
        onClearLogs={handleClearLogs}
        onSendToSession={onSendToSession}
      />
    </div>
  );
}
