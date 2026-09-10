import type { JSX } from "react";
import { ThemeIcon } from "./ThemeIcon";
import { Tooltip } from "./Tooltip";
import { type ActiveSessionDot } from "../features/workbench/activeSessionDots";
import type { SessionDotStatus } from "../features/workbench/sessionStatus";

export function sessionDotStatusClass(status: SessionDotStatus): string {
  if (status === "open") return "";
  return ` is-${status === "awaiting_user" ? "awaiting" : status}`;
}

export function sessionDotStatusLabel(
  dot: ActiveSessionDot,
  text: (key: string, fallback: string) => string
): string {
  const status: SessionDotStatus = dot.status || "open";
  if (status === "awaiting_user") {
    if (dot.awaitingConfidence === "possible") {
      return text("desktop.workbench.sessionDot.possiblyAwaiting", "May need attention");
    }
    return text("desktop.workbench.sessionDot.awaiting", "Waiting for you");
  }
  if (status === "running") return text("desktop.workbench.sessionDot.running", "Running");
  if (status === "connecting") return text("desktop.workbench.sessionDot.connecting", "Connecting");
  if (status === "error") return text("desktop.workbench.sessionDot.error", "Error");
  return "";
}

export function sessionDotLabel(
  dot: ActiveSessionDot,
  text: (key: string, fallback: string) => string
): string {
  const status = sessionDotStatusLabel(dot, text);
  return status ? `${dot.title} · ${status}` : dot.title;
}

export function SessionDotsCluster({
  dots,
  text,
  onFocus,
  heading = true,
  nativeTitle = false
}: {
  dots: ActiveSessionDot[];
  text: (key: string, fallback: string) => string;
  onFocus: (dot: ActiveSessionDot) => void;
  heading?: boolean;
  nativeTitle?: boolean;
}): JSX.Element | null {
  if (dots.length === 0) return null;
  const headingLabel = text("desktop.workbench.sessionDots", "Active sessions");
  return (
    <div
      className="session-dots-cluster"
      role="group"
      aria-label={headingLabel}
    >
      {heading ? (
        <span className="session-dots-heading" aria-hidden="true" title={headingLabel}>
          <ThemeIcon name="terminal" size={12} />
        </span>
      ) : null}
      {dots.map((dot) => {
        const status: SessionDotStatus = dot.status || "open";
        const label = sessionDotLabel(dot, text);
        const button = (
          <button
            type="button"
            className="session-dot-btn"
            data-status={status}
            aria-label={label}
            title={nativeTitle ? label : undefined}
            onClick={() => onFocus(dot)}
          >
            <span className={`session-dot${sessionDotStatusClass(status)}`} aria-hidden="true" />
          </button>
        );
        return nativeTitle
          ? <span key={dot.paneKey} className="tooltip-wrap">{button}</span>
          : <Tooltip key={dot.paneKey} label={label}>{button}</Tooltip>;
      })}
    </div>
  );
}
