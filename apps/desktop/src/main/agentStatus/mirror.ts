/**
 * Per-pane screen mirror.
 *
 * The sensor lives in the process that owns the PTY, so it can keep its own
 * headless VT parser instead of reading the renderer's xterm instance. That is
 * what makes status independent of whether a pane is mounted in the UI: a
 * background workbench tab keeps reporting exactly like a visible one.
 */

import { Terminal } from "@xterm/headless";

/**
 * Rows of scrollback kept per pane. Full-screen TUIs use the alternate buffer
 * (no scrollback), but inline agents paint into the normal buffer and the
 * snapshot wants a few rows above the viewport.
 */
export const MIRROR_SCROLLBACK = 200;
/** Rows above the viewport included in a snapshot, mirroring the old UI read. */
export const SCREEN_HEADROOM_ROWS = 5;

export class PaneMirror {
  private readonly term: Terminal;
  private writes = 0;
  private disposed = false;

  constructor(input: { cols: number; rows: number }) {
    this.term = new Terminal({
      cols: Math.max(2, Math.floor(input.cols)),
      rows: Math.max(2, Math.floor(input.rows)),
      scrollback: MIRROR_SCROLLBACK,
      // `buffer` is a proposed API in the headless build; reading the screen is
      // the whole point of this mirror.
      allowProposedApi: true
    });
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

  /** Visible screen plus `headroom` rows above it, as plain text. */
  snapshotText(headroom = SCREEN_HEADROOM_ROWS): string {
    const buffer = this.term.buffer.active;
    const start = Math.max(0, buffer.baseY - headroom);
    const end = Math.min(buffer.length, buffer.baseY + this.term.rows);
    const lines: string[] = [];
    for (let index = start; index < end; index += 1) {
      const line = buffer.getLine(index);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join("\n");
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
