import type { AgentSession } from "@agent-resume/core";

/** The catalog identity of a session. */
export function sessionKey(session: AgentSession): string {
  return `${session.provider}:${session.id}`;
}

export function projectLabel(projectPath: string | undefined): string {
  if (!projectPath) return "";
  return projectPath.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || projectPath;
}

/** The row subtitle: summary first, else branch · model. */
export function sessionSubtitle(session: AgentSession): string {
  const summary = session.sessionSummary?.trim();
  if (summary) return summary;
  const parts = [session.branch, session.model].filter((value): value is string => Boolean(value));
  return parts.join(" · ");
}

/** Timestamp as "3 days ago", in the UI locale. */
export function relativeTime(timestamp: number, locale: string): string {
  if (!timestamp) return "";
  const absolute = new Date(timestamp).toLocaleString();
  if (typeof Intl.RelativeTimeFormat !== "function") return absolute;
  const diff = timestamp - Date.now(); // negative in the past
  const abs = Math.abs(diff);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < minute) return format.format(0, "second");
  if (abs < hour) return format.format(Math.round(diff / minute), "minute");
  if (abs < day) return format.format(Math.round(diff / hour), "hour");
  return format.format(Math.round(diff / day), "day");
}
