import { useEffect, useState } from "react";
import { useI18n } from "../i18n";

const STARTUP_MASK_FADE_MS = 200;

export function StartupMask(): React.JSX.Element | null {
  const { ready } = useI18n();
  const [hiding, setHiding] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDismissed(true);
      return;
    }
    setHiding(true);
    const timeout = window.setTimeout(() => setDismissed(true), STARTUP_MASK_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [ready]);

  if (dismissed) return null;

  return (
    <div
      className={`app-startup-mask${hiding ? " is-hiding" : ""}`}
      aria-live="polite"
      aria-busy={!hiding}
    >
      <div className="app-startup-backdrop" />
    </div>
  );
}

