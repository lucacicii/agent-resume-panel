import React, { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import type { BrowserSessionState } from "../../../shared/browserTypes";
import { BrowserChrome } from "./BrowserChrome";

function getBrowserIdFromQuery(): string {
  try {
    return new URLSearchParams(window.location.search).get("browserId") || "";
  } catch {
    return "";
  }
}

function measureHostRect(el: HTMLElement): { x: number; y: number; width: number; height: number } {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
}

export function BrowserStandaloneWindow(): React.JSX.Element {
  const { t } = useI18n();
  const browserId = getBrowserIdFromQuery();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<BrowserSessionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!browserId) return;
    let cancelled = false;
    void desktopApi()
      .browserGet({ browserId })
      .then((state) => {
        if (!cancelled) setSession(state);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    const stop = desktopApi().onBrowserEvent((event) => {
      if (event.type === "state" && event.session.id === browserId) setSession(event.session);
      if (event.type === "surface" && event.browserId === browserId) {
        setSession((current) => (current ? { ...current, surface: event.surface } : current));
      }
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [browserId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !browserId || session?.surface.kind !== "window") return;
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
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(host);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      ro?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [browserId, session?.surface.kind]);

  const run = useCallback(
    async (action: () => Promise<BrowserSessionState | { session: BrowserSessionState | null; destroyed: boolean }>) => {
      try {
        setError(null);
        const result = await action();
        if ("destroyed" in result && result.destroyed) {
          setSession(null);
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
    []
  );

  if (!browserId) {
    return <div className="renderer-bridge-error" role="alert"><p>{t("desktop.browser.missingId")}</p></div>;
  }

  return (
    <section className="browser-standalone-window" aria-label={t("desktop.browser.windowTitle")}>
      <BrowserChrome
        session={session}
        windowMode
        onNavigate={(url) => void run(() => desktopApi().browserNavigate({ browserId, url }))}
        onBack={() => void run(() => desktopApi().browserBack({ browserId }))}
        onForward={() => void run(() => desktopApi().browserForward({ browserId }))}
        onReload={() => void run(() => desktopApi().browserReload({ browserId }))}
        onStop={() => void run(() => desktopApi().browserStop({ browserId }))}
        onNewTab={() => void run(() => desktopApi().browserNewTab({ browserId }))}
        onCloseTab={(tabId) => void run(() => desktopApi().browserCloseTab({ browserId, tabId }))}
        onActivateTab={(tabId) => void run(() => desktopApi().browserActivateTab({ browserId, tabId }))}
        onDock={() => void run(() => desktopApi().browserSetSurface({ browserId, surface: "workbench" }))}
        onClearCookies={() => void run(() => desktopApi().browserClearCookies({ browserId }))}
      />
      {error ? <div className="browser-pane-error" role="alert">{error}</div> : null}
      <div ref={hostRef} className="browser-standalone-host" />
    </section>
  );
}
