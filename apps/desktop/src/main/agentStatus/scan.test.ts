import { describe, expect, it } from "vitest";
import { createScanState, drainReports, scanChunk } from "./scan";

const AR = (state: string, detail?: string) =>
  `\x1b]633;AR;${state}${detail ? `;${detail}` : ""}\x07`;

describe("scanChunk", () => {
  it("captures an agent status sequence, reports it, and strips it from the stream", () => {
    const scan = createScanState();
    const forwarded = scanChunk(scan, `hello${AR("awaiting", "prompt")}world`);
    expect(forwarded).toBe("helloworld");
    expect(drainReports(scan)).toEqual([{ state: "blocked", detail: "prompt" }]);
  });

  it("maps the three protocol states onto agent states", () => {
    const scan = createScanState();
    scanChunk(scan, `${AR("running")}${AR("idle")}${AR("awaiting")}`);
    expect(drainReports(scan).map((report) => report.state)).toEqual(["working", "idle", "blocked"]);
    expect(drainReports(scan)).toEqual([]);
  });

  it("holds back a sequence split across chunks instead of leaking it to the terminal", () => {
    const scan = createScanState();
    const first = scanChunk(scan, `partial\x1b]633;AR;awai`);
    expect(first).toBe("partial");
    const second = scanChunk(scan, `ting\x07tail`);
    expect(second).toBe("tail");
    expect(drainReports(scan)).toEqual([{ state: "blocked", detail: undefined }]);
  });

  it("drops a runaway partial sequence rather than growing without bound", () => {
    const scan = createScanState();
    scanChunk(scan, `x\x1b]${"y".repeat(5_000)}`);
    expect(scan.carry).toBe("");
    expect(scanChunk(scan, "more")).toBe("more");
  });

  it("tracks the terminal title", () => {
    const scan = createScanState();
    scanChunk(scan, "\x1b]0;⠂ claude\x07");
    expect(scan.oscTitle).toBe("⠂ claude");
    scanChunk(scan, "\x1b]2;second\x1b\\");
    expect(scan.oscTitle).toBe("second");
  });

  it("tracks OSC 9;4 progress", () => {
    const scan = createScanState();
    scanChunk(scan, "\x1b]9;4;0\x07");
    expect(scan.oscProgress).toBe("0");
  });

  it("tracks cursor visibility (DEC private mode 25)", () => {
    const scan = createScanState();
    scanChunk(scan, "\x1b[?25l");
    expect(scan.cursorHidden).toBe(true);
    scanChunk(scan, "\x1b[?25h");
    expect(scan.cursorHidden).toBe(false);
  });

  it("leaves unrelated escape sequences untouched", () => {
    const scan = createScanState();
    const chunk = "\x1b[31mred\x1b[0m";
    expect(scanChunk(scan, chunk)).toBe(chunk);
    expect(drainReports(scan)).toEqual([]);
  });
});
