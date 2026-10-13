import { describe, expect, it } from "vitest";
import {
  PROGRAM_STATUS_REPLY,
  createScanState,
  drainProgramStatusQuery,
  drainReports,
  scanChunk
} from "./scan";

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

/** OSC 7501 Program Status Protocol: a report, or the feature-detection query. */
const PS = (body: string, terminator: "\x07" | "\x1b\\" = "\x07") => `\x1b]7501;${body}${terminator}`;

describe("OSC 7501 program status", () => {
  it("captures a report as a pane status and strips it from the stream", () => {
    const scan = createScanState();
    const forwarded = scanChunk(scan, `hello${PS("state=working:app=claude-code", "\x1b\\")}world`);
    expect(forwarded).toBe("helloworld");
    expect(drainReports(scan)).toEqual([{ state: "working", source: "osc7501:claude-code" }]);
  });

  it("maps every protocol state onto a panel state", () => {
    const scan = createScanState();
    scanChunk(
      scan,
      [
        PS("state=idle"),
        PS("state=working"),
        PS("state=done"),
        PS("state=blocked:kind=permission"),
        PS("state=error"),
        PS("state=clear")
      ].join("")
    );
    expect(drainReports(scan)).toEqual([
      { state: "idle", source: "osc7501" },
      { state: "working", source: "osc7501" },
      { state: "idle", source: "osc7501" },
      { state: "blocked", detail: "permission", source: "osc7501" },
      { state: "blocked", source: "osc7501" },
      { state: "idle", source: "osc7501" }
    ]);
  });

  it("drops a report that does not describe the pane's own state", () => {
    const scan = createScanState();
    scanChunk(scan, PS("state=sleeping"));
    scanChunk(scan, PS("app=claude-code"));
    scanChunk(scan, PS("id=us-east:state=working"));
    scanChunk(scan, PS("state=clear:id=us-east"));
    scanChunk(scan, `\x1b]7501;state=working:msg=${"A".repeat(5_000)}\x07`);
    expect(drainReports(scan)).toEqual([]);
    expect(scan.programStatusQuery).toBe(false);
  });

  it("reads an empty id as the root record", () => {
    const scan = createScanState();
    scanChunk(scan, PS("id=:state=working"));
    expect(drainReports(scan)).toEqual([{ state: "working", source: "osc7501" }]);
  });

  it("keeps the pairs around a malformed one and ignores an unusable app", () => {
    const scan = createScanState();
    scanChunk(scan, PS("state=working:NOPE:app=claude code"));
    expect(drainReports(scan)).toEqual([{ state: "working", source: "osc7501" }]);
  });

  it("answers the feature-detection query instead of reporting a state", () => {
    for (const terminator of ["\x07", "\x1b\\"] as const) {
      const scan = createScanState();
      expect(scanChunk(scan, `q${PS("?", terminator)}`)).toBe("q");
      expect(drainProgramStatusQuery(scan)).toBe(true);
      expect(PROGRAM_STATUS_REPLY).toBe("\x1b]7501;?\x1b\\");
      expect(drainProgramStatusQuery(scan)).toBe(false);
      expect(drainReports(scan)).toEqual([]);
    }
  });

  it("puts a report and a query split across chunks back together", () => {
    const scan = createScanState();
    expect(scanChunk(scan, "head\x1b]7501;state=work")).toBe("head");
    expect(scanChunk(scan, "ing\x1b\\tail")).toBe("tail");
    expect(drainReports(scan)).toEqual([{ state: "working", source: "osc7501" }]);

    const queryScan = createScanState();
    expect(scanChunk(queryScan, "x\x1b]7501;")).toBe("x");
    expect(scanChunk(queryScan, "?\x07more")).toBe("more");
    expect(drainProgramStatusQuery(queryScan)).toBe(true);
  });
});
