import { useEffect, useRef, useState } from "react";
import { desktopApi } from "../bridge";
import { useI18n } from "../i18n";

const STARTUP_MASK_FADE_MS = 320;

export function StartupMask(): React.JSX.Element | null {
  const { ready, t } = useI18n();
  const [syncComplete, setSyncComplete] = useState(false);
  const [hiding, setHiding] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const syncPromise = useRef<Promise<unknown> | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!syncPromise.current) {
      syncPromise.current = desktopApi().syncSessions().catch((error: unknown) => {
        console.warn("Initial desktop session sync failed", error);
      });
    }
    let active = true;
    void syncPromise.current.finally(() => {
      if (active) setSyncComplete(true);
    });
    return () => {
      active = false;
    };
  }, [ready]);

  useEffect(() => {
    if (!ready || !syncComplete) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDismissed(true);
      return;
    }
    setHiding(true);
    const timeout = window.setTimeout(() => setDismissed(true), STARTUP_MASK_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [ready, syncComplete]);

  if (dismissed) return null;

  const message = ready ? t("desktop.workbench.syncingSessions") : "Syncing agent sessions…";
  return (
    <div className={`app-startup-mask${hiding ? " is-hiding" : ""}`} aria-live="polite" aria-busy={!hiding}>
      <div className="app-startup-backdrop" />
      <div className="app-startup-panel" role="status">
        <div className="app-startup-icon" aria-hidden="true">
          <img
            className="app-startup-icon-img"
            src="../resources/icon.png"
            alt=""
            width="72"
            height="72"
            decoding="async"
          />
        </div>
        <div className="app-startup-status">
          <span className="gen-progress-pulse" aria-hidden="true" />
          <p className="app-startup-message">{message}</p>
        </div>
      </div>
    </div>
  );
}
