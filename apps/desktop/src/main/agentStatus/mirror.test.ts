import { describe, expect, it } from "vitest";
import { MIRROR_UNICODE_VERSION, PaneMirror } from "./mirror";
import { createScanState, scanChunk } from "./scan";

/** Feed a pane's output through the same scan → mirror path the sensor uses. */
async function mirrorOf(chunks: readonly string[], size = { cols: 60, rows: 6 }): Promise<PaneMirror> {
  const mirror = new PaneMirror(size);
  const scan = createScanState();
  for (const chunk of chunks) mirror.write(scanChunk(scan, chunk));
  // xterm parses queued writes asynchronously; the sensor flushes before reading.
  await mirror.flush();
  return mirror;
}

describe("PaneMirror", () => {
  it("renders written text as the visible screen", async () => {
    const mirror = await mirrorOf(["hello\n", "world\r\n"]);
    const text = mirror.snapshotText();
    expect(text).toContain("hello");
    expect(text).toContain("world");
    mirror.dispose();
  });

  it("keeps only the visible rows plus headroom", async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line-${index}`).join("\r\n");
    const mirror = await mirrorOf([`${lines}\r\n`]);
    const snapshot = mirror.snapshotText(2).split("\n");
    expect(snapshot.length).toBeLessThanOrEqual(mirror.rows + 2);
    expect(snapshot.some((line) => line.includes("line-39"))).toBe(true);
    expect(snapshot.join("\n")).not.toContain("line-0\n");
    mirror.dispose();
  });

  it("applies carriage returns and screen clears like a terminal", async () => {
    const mirror = await mirrorOf(["first\r\n\x1b[2J\x1b[Hsecond"]);
    const text = mirror.snapshotText();
    expect(text).toContain("second");
    expect(text).not.toContain("first");
    mirror.dispose();
  });

  it("never shows the agent status sequence", async () => {
    const mirror = await mirrorOf(["\x1b]633;AR;awaiting\x07visible"]);
    const text = mirror.snapshotText();
    expect(text).toContain("visible");
    expect(text).not.toContain("633");
    mirror.dispose();
  });

  it("resizes without throwing and keeps reporting", async () => {
    const mirror = await mirrorOf(["abc"]);
    mirror.resize(20, 4);
    mirror.write("def");
    await mirror.flush();
    expect(mirror.snapshotText()).toContain("def");
    mirror.dispose();
  });

  it("undoes soft wraps so a wrapped dialog stays readable", async () => {
    // 60 columns: this line is longer than the pane, so the terminal breaks it.
    const dialogLine = " enter to select · tab/arrow keys to navigate · esc to cancel";
    const mirror = await mirrorOf([`${dialogLine}\r\n`], { cols: 60, rows: 6 });
    const text = mirror.snapshotText(0);
    expect(text).toContain("esc to cancel");
    expect(text.split("\n").filter((line) => line.includes("esc to cancel"))).toHaveLength(1);
    mirror.dispose();
  });

  it("keeps a wrap at a space boundary from gluing words together", async () => {
    const mirror = await mirrorOf(["12345678 to cancel\r\n"], { cols: 10, rows: 4 });
    expect(mirror.snapshotText(0).split("\n")[0]).toBe("12345678 to cancel");
    mirror.dispose();
  });

  it("loads the same Unicode width table as the renderer", async () => {
    // The public projection deliberately undoes soft wraps, which is exactly what
    // would hide the difference, so this test looks at the buffer on purpose.
    type Inspectable = {
      term: {
        unicode: { activeVersion: string };
        buffer: {
          active: {
            getLine(index: number):
              | { length: number; getCell(index: number): { getWidth(): number } | undefined }
              | undefined;
          };
        };
      };
    };
    const mirror = new PaneMirror({ cols: 10, rows: 3 });
    const term = (mirror as unknown as Inspectable).term;
    expect(term.unicode.activeVersion).toBe(MIRROR_UNICODE_VERSION);

    mirror.write("👍👍👍👍👍👍👍👍👍👍👍\r\n");
    await mirror.flush();
    const row = term.buffer.active.getLine(0)!;
    // Width 2 (Unicode 11) means five fit in ten cells; the default table makes
    // them narrow, so ten would fit and the cells would measure differently.
    expect(row.length).toBe(10);
    expect([0, 1, 2, 3, 4].map((index) => row.getCell(index * 2)?.getWidth())).toEqual([2, 2, 2, 2, 2]);
    expect(row.getCell(10)).toBeUndefined();
    mirror.dispose();
  });

  it("counts writes so the sensor can skip unchanged panes", () => {
    const mirror = new PaneMirror({ cols: 40, rows: 6 });
    expect(mirror.contentSeq).toBe(0);
    mirror.write("a");
    mirror.write("b");
    expect(mirror.contentSeq).toBe(2);
    mirror.dispose();
  });
});
