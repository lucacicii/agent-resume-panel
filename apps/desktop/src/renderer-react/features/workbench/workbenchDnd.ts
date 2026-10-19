/**
 * Workbench drag-and-drop: Explorer / Git tree rows carry a raw absolute path
 * through a custom DataTransfer MIME; the embedded xterm accepts only those
 * internal drags and writes the shell-escaped path to the current PTY.
 */

import type { ShellKind } from "@agent-resume/core";

/** Workbench-internal MIME carrying a raw absolute path (not shell-escaped). */
export const WB_PATH_DND_MIME = "application/x-agent-resume-workbench-path";

/**
 * Shell dialect of the pane a path is being pasted into.
 *
 * The pane runs the app's default shell for this platform (PowerShell on
 * Windows). A pane whose shell the renderer cannot see is the exception, not
 * the rule, so this stays a platform default rather than a per-pane lookup.
 */
export function paneShellKind(): ShellKind {
  const platform =
    typeof window !== "undefined"
    && typeof window.agentResume?.platform === "string"
      ? window.agentResume.platform
      : undefined;
  return platform === "win32" ? "powershell" : "posix";
}

/**
 * Quote a path so the pane's shell receives it as one argument.
 *
 * POSIX: single quotes, embedded quotes become `'\''`.
 * PowerShell: single quotes, embedded quotes doubled.
 * Neither shell expands `$` or `%VAR%` inside single quotes, so a path is
 * pasted literally.
 */
export function shellQuotePath(path: string, shell: ShellKind = paneShellKind()): string {
  if (shell === "cmd") {
    return /[\s"&<>|^()]/.test(path) ? `"${path.replace(/"/g, '""')}"` : path;
  }
  if (shell === "powershell") {
    return `'${path.replace(/'/g, "''")}'`;
  }
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** True when a drag event carries the Workbench path MIME (internal drag). */
export function hasWorkbenchPathDnd(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined
): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types).includes(WB_PATH_DND_MIME);
}

/** Seed a dragstart with the absolute path via the Workbench MIME + text/plain. */
export function startWorkbenchPathDrag(
  event: { dataTransfer: DataTransfer | null },
  path: string
): void {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return;
  dataTransfer.setData(WB_PATH_DND_MIME, path);
  dataTransfer.setData("text/plain", path);
  dataTransfer.effectAllowed = "copy";
}
