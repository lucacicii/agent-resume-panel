/**
 * Per-pane screen mirror.
 *
 * The sensor lives in the process that owns the PTY, so it can keep its own
 * headless VT parser instead of reading the renderer's xterm instance. That is
 * what makes status independent of whether a pane is mounted in the UI: a
 * background workbench tab keeps reporting exactly like a visible one.
 *
 * Three things keep the mirror in step with what the user actually sees:
 *   - the same bytes (the sensor mirrors exactly what it forwards to xterm),
 *   - the same options that affect the *buffer*. Font, theme and letter spacing
 *     only affect painting, but the width table does not: emoji whose width
 *     changed between Unicode 6 and 11 wrap differently, so the mirror loads the
 *     same Unicode 11 addon the renderer loads, and
 *   - soft wraps undone, so a line the terminal broke in two still reads as one
 *     line to a rule.
 */

import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/headless";

/**
 * Rows of scrollback kept per pane. Full-screen TUIs use the alternate buffer
 * (no scrollback), but inline agents paint into the normal buffer and the
 * snapshot wants a few rows above the viewport.
 */
export const MIRROR_SCROLLBACK = 200;
/** Rows above the viewport included in a snapshot, mirroring the old UI read. */
export const SCREEN_HEADROOM_ROWS = 5;
/** Width table version; the renderer sets the same one (`TerminalView`). */
export const MIRROR_UNICODE_VERSION = "11";

export class PaneMirror {
  private readonly term: Terminal;
  private writes = 0;
  private disposed = false;

  constructor(input: { cols: number; rows: number }) {
    this.term = new Terminal({
      cols: Math.max(2, Math.floor(input.cols)),
      rows: Math.max(2, Math.floor(input.rows)),
      scrollback: MIRROR_SCROLLBACK,
      // `buffer` and `unicode` are proposed APIs in the headless build; reading
      // the screen and matching the renderer's widths are the point of a mirror.
      allowProposedApi: true
    });
    // Widths must be active before the first write, same order as the renderer.
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = MIRROR_UNICODE_VERSION;
  }

  /** Number of writes seen. The sensor uses it to skip unchanged panes. */
  get contentSeq(): number {
    return this.writes;
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  write(chunk: string): void {
    if (!chunk || this.disposed) return;
    this.writes += 1;
    this.term.write(chunk);
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return;
    const nextCols = Math.max(2, Math.floor(cols));
    const nextRows = Math.max(2, Math.floor(rows));
    if (nextCols === this.term.cols && nextRows === this.term.rows) return;
    this.term.resize(nextCols, nextRows);
  }

  /**
   * Visible screen plus `headroom` rows above it, as plain text.
   *
   * Soft wraps are undone: a line the terminal broke in two is one logical line
   * here, because a rule's literal ("esc to cancel") has to match whether or not
   * the pane is narrow enough to wrap it. Trailing spaces survive while joining
   * — otherwise a wrap at a space boundary would glue two words together — and
   * each logical line is trimmed once it is complete.
   */
  snapshotText(headroom = SCREEN_HEADROOM_ROWS): string {
    const buffer = this.term.buffer.active;
    const start = Math.max(0, buffer.baseY - headroom);
    const end = Math.min(buffer.length, buffer.baseY + this.term.rows);
    const logical: string[] = [];
    for (let index = start; index < end; index += 1) {
      const line = buffer.getLine(index);
      if (!line) continue;
      const text = line.translateToString(false);
      // A continuation row belongs to the row above it; when the window starts
      // mid-line there is nothing to join onto, so it starts a line of its own.
      if (line.isWrapped && logical.length) logical[logical.length - 1] += text;
      else logical.push(text);
    }
    return logical.map((line) => line.replace(/\s+$/, "")).join("\n");
  }

  /**
   * Resolve once everything written so far has been parsed.
   *
   * xterm parses queued writes asynchronously, so a snapshot taken immediately
   * after `write` can miss the newest bytes. The sensor flushes before reading.
   */
  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise((resolve) => {
      this.term.write("", () => resolve());
    });
  }

  dispose(): void {
    this.disposed = true;
    this.term.dispose();
  }
}
