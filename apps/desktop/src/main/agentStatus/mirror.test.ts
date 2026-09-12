import { describe, expect, it } from "vitest";
import { PaneMirror } from "./mirror";
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

  it("counts writes so the sensor can skip unchanged panes", () => {
    const mirror = new PaneMirror({ cols: 40, rows: 6 });
    expect(mirror.contentSeq).toBe(0);
    mirror.write("a");
    mirror.write("b");
    expect(mirror.contentSeq).toBe(2);
    mirror.dispose();
  });
});
