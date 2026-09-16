/**
 * Presentation helpers for session status dots. These lived on the deleted
 * `SessionDotsCluster` component; work-item rows and workbench status chips
 * still render the same dot vocabulary, so the mapping lives here now.
 */

import type { ActiveSessionDot } from "../activeSessionDots";
import type { SessionDotStatus } from ".";

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
