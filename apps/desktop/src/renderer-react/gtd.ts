import type { GtdStatus, TaskGtdRollup } from "@agent-resume/core";

export type { GtdStatus } from "@agent-resume/core";

/**
 * The GTD states the desktop surfaces.
 *
 * Storage keeps the full core vocabulary (`inbox`, `next`, `waiting`,
 * `someday`, `reference`, `done`) because the catalog is shared with the
 * extension. The desktop only exposes four columns; the hidden states fold onto
 * "to do" through {@link desktopGtdColumn}.
 */
export const DESKTOP_GTD_STATUSES = ["inbox", "next", "waiting", "done"] as const satisfies readonly GtdStatus[];

export type DesktopGtdStatus = (typeof DESKTOP_GTD_STATUSES)[number];

/**
 * Fold any stored status onto a desktop column.
 *
 * `someday` and `reference` are no longer surfaced, so they read as "to do"
 * until the user re-triages them.
 */
export function desktopGtdColumn(status: GtdStatus | undefined): DesktopGtdStatus {
  switch (status) {
    case "next":
      return "next";
    case "waiting":
      return "waiting";
    case "done":
      return "done";
    default:
      return "inbox";
  }
}

/**
 * Board/list status for a task. Priority: waiting > in progress > to do > done.
 *
 * `done` only wins when every contributing mark is done; an explicit task pin
 * (`override`) always wins over the rollup. `someday`/`reference` contribute to
 * "to do" through {@link desktopGtdColumn} on the override path.
 */
export function desktopGtdColumnFromRollup(
  rollup: Pick<TaskGtdRollup, "counts" | "override" | "total"> | undefined,
  fallback?: GtdStatus
): DesktopGtdStatus {
  if (!rollup) return desktopGtdColumn(fallback);
  if (rollup.override) return desktopGtdColumn(rollup.override);
  const { counts, total } = rollup;
  if (counts.waiting > 0) return "waiting";
  if (counts.next > 0) return "next";
  if (total > 0 && counts.done === total) return "done";
  return "inbox";
}

/** i18n key for a status, folding hidden states onto their desktop column. */
export function desktopGtdLabelKey(status: GtdStatus | undefined): string {
  return `desktop.workbench.gtdStatus.${desktopGtdColumn(status)}`;
}
