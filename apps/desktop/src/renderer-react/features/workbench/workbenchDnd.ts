/**
 * Workbench drag-and-drop: Explorer / Git tree rows carry a raw absolute path
 * through a custom DataTransfer MIME; the embedded xterm accepts only those
 * internal drags and writes the shell-escaped path to the current PTY.
 */

/** Workbench-internal MIME carrying a raw absolute path (not shell-escaped). */
export const WB_PATH_DND_MIME = "application/x-agent-resume-workbench-path";

/**
 * POSIX single-quote shell escaping. Embedded single quotes become `'\''`
 * (close quote, escaped quote, reopen quote), so the quoted result is safe to
 * paste into a shell or a TUI input line without being split or executed.
 */
export function shellQuotePath(path: string): string {
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
