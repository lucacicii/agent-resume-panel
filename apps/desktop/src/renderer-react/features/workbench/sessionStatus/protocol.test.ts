import { describe, expect, it } from "vitest";
import { parseReportedStatus, stripAnsi, stripReportedStatus, trackCursorVisibility } from "./protocol";

describe("stripAnsi", () => {
  it("removes CSI sequences", () => {
    expect(stripAnsi("\x1b[31mAllow once\x1b[0m")).toBe("Allow once");
  });

  it("removes OSC sequences", () => {
    expect(stripAnsi("\x1b]0;Title\x07Hello")).toBe("Hello");
  });
});

describe("parseReportedStatus", () => {
  it("parses Agent Resume status sequences", () => {
    expect(parseReportedStatus("\x1b]633;AR;awaiting;select\x07")).toEqual({
      status: "awaiting_user",
      awaitingConfidence: "confirmed",
      detail: "select"
    });
    expect(parseReportedStatus("\x1b]633;AR;running\x07")).toEqual({
      status: "running",
      detail: undefined
    });
    expect(parseReportedStatus("\x1b]633;AR;idle\x07")).toEqual({
      status: "open",
      detail: undefined
    });
  });

  it("accepts ST-terminated sequences as well as BEL", () => {
    expect(parseReportedStatus("\x1b]633;AR;awaiting;confirm\x1b\\")).toMatchObject({
      status: "awaiting_user",
      detail: "confirm"
    });
  });

  it("parses VS Code shell integration markers", () => {
    expect(parseReportedStatus("\x1b]633;A\x07")).toEqual({ status: "open" });
    expect(parseReportedStatus("\x1b]633;C\x07")).toEqual({ status: "running" });
    expect(parseReportedStatus("\x1b]633;D;0\x07")).toEqual({ status: "open" });
    expect(parseReportedStatus("\x1b]633;D;1\x07")).toEqual({ status: "error" });
  });

  it("returns null for chunks without a status signal", () => {
    expect(parseReportedStatus("Hello world\r\n")).toBeNull();
    expect(parseReportedStatus("\x1b]633;P;Cwd=/tmp\x07")).toBeNull();
    expect(parseReportedStatus("")).toBeNull();
  });
});

describe("stripReportedStatus", () => {
  it("removes status sequences without touching surrounding output", () => {
    expect(stripReportedStatus("Prefix\x1b]633;AR;awaiting;select\x07Suffix")).toBe("PrefixSuffix");
  });

  it("leaves unrelated chunks untouched", () => {
    expect(stripReportedStatus("plain output")).toBe("plain output");
  });
});

describe("trackCursorVisibility", () => {
  it("records hide and show as the last state wins", () => {
    const tracking = new Map<number, boolean>();
    trackCursorVisibility("before\x1b[?25l", tracking, 7);
    expect(tracking.get(7)).toBe(true);
    trackCursorVisibility("\x1b[?25h", tracking, 7);
    expect(tracking.get(7)).toBe(false);
  });

  it("resolves multiple toggles within one chunk", () => {
    const tracking = new Map<number, boolean>();
    trackCursorVisibility("\x1b[?25h\x1b[?25l\x1b[?25h", tracking, 1);
    expect(tracking.get(1)).toBe(false);
  });
});
