import React, { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import type { BrowserSessionState } from "../../../shared/browserTypes";
import { BrowserChrome } from "./BrowserChrome";

export type BrowserPaneViewProps = {
  browserId: string;
  projectPath: string;
  active: boolean;
  /** When true, show dock placeholder instead of live chrome bounds host. */
  poppedOut?: boolean;
  onSessionChange?: (session: BrowserSessionState | null) => void;
  onDestroyed?: () => void;
};

function measureHostRect(el: HTMLElement): { x: number; y: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
}

export function BrowserPaneView({
  browserId,
  projectPath,
  active,
  poppedOut = false,
  onSessionChange,
  onDestroyed
}: BrowserPaneViewProps): React.JSX.Element {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<BrowserSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applySession = useCallback(
    (next: BrowserSessionState | null) => {
      setSession(next);
      onSessionChange?.(next);
    },
    [onSessionChange]
  );

  useEffect(() => {
    let cancelled = false;
    void desktopApi()
      .browserGet({ browserId })
      .then((state) => {
        if (!cancelled) applySession(state);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [applySession, browserId]);

  useEffect(() => {
    const stop = desktopApi().onBrowserEvent((event) => {
      if (event.type === "state" && event.session.id === browserId) {
        applySession(event.session);
      }
      if (event.type === "surface" && event.browserId === browserId) {
        setSession((current) => (current ? { ...current, surface: event.surface } : current));
      }
      if (event.type === "crash" && event.browserId === browserId) {
        setError(event.reason);
      }
    });
    return stop;
  }, [applySession, browserId]);

  // Report bounds + visibility for live workbench attachment.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const isLive = active && !poppedOut && session?.surface.kind === "workbench";

    void desktopApi().browserSetVisible({ browserId, visible: Boolean(isLive) });

    if (!isLive) return;

    let frame = 0;
    const report = () => {
      frame = 0;
      const rect = measureHostRect(host);
      void desktopApi().browserAttachBounds({ browserId, rect });
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(report);
    };

    schedule();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(host);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener("resize", schedule);
      void desktopApi().browserSetVisible({ browserId, visible: false });
    };
  }, [active, browserId, poppedOut, session?.surface.kind]);

  const run = useCallback(
    async (action: () => Promise<BrowserSessionState | { session: BrowserSessionState | null; destroyed: boolean } | { ok: boolean }>) => {
      try {
        setError(null);
        const result = await action();
        if (result && typeof result === "object") {
          if ("destroyed" in result && result.destroyed) {
            applySession(null);
            onDestroyed?.();
            return;
          }
          if ("session" in result && result.session) {
            applySession(result.session);
            return;
          }
          if ("id" in result) {
            applySession(result as BrowserSessionState);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [applySession, onDestroyed]
  );

  if (poppedOut || session?.surface.kind === "window") {
    return (
      <div className="browser-pane browser-pane-placeholder" hidden={!active}>
        <div className="browser-pane-placeholder-card">
          <p>{t("desktop.browser.poppedOutHint")}</p>
          <div className="browser-pane-placeholder-actions">
            <button
              type="button"
              className="browser-chrome-btn is-primary"
              onClick={() => void run(() => desktopApi().browserFocus({ browserId }).then(() => session as BrowserSessionState))}
            >
              {t("desktop.browser.showInWindow")}
            </button>
            <button
              type="button"
              className="browser-chrome-btn is-primary"
              onClick={() => void run(() => desktopApi().browserSetSurface({ browserId, surface: "workbench" }))}
            >
              {t("desktop.browser.returnToWorkbench")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="browser-pane" hidden={!active}>
      <BrowserChrome
        session={session}
        onNavigate={(url) => void run(() => desktopApi().browserNavigate({ browserId, url }))}
        onBack={() => void run(() => desktopApi().browserBack({ browserId }))}
        onForward={() => void run(() => desktopApi().browserForward({ browserId }))}
        onReload={() => void run(() => desktopApi().browserReload({ browserId }))}
        onStop={() => void run(() => desktopApi().browserStop({ browserId }))}
        onNewTab={() => void run(() => desktopApi().browserNewTab({ browserId }))}
        onCloseTab={(tabId) => void run(() => desktopApi().browserCloseTab({ browserId, tabId }))}
        onActivateTab={(tabId) => void run(() => desktopApi().browserActivateTab({ browserId, tabId }))}
        onPopOut={() => void run(() => desktopApi().browserSetSurface({ browserId, surface: "window" }))}
        onClearCookies={() => void run(() => desktopApi().browserClearCookies({ browserId }))}
      />
      {error ? <div className="browser-pane-error" role="alert">{error}</div> : null}
      <div ref={hostRef} className="browser-pane-host" data-project-path={projectPath} aria-hidden="true" />
    </div>
  );
}
