import { describe, expect, it } from "vitest";
import {
  composeTrayItems,
  composeWorkbenchRows,
  hitTestTrayDot,
  hitTestTrayDotFromScreen,
  NOTE_COLOR_DARK,
  NOTE_COLOR_LIGHT,
  renderSessionDotsTrayPng,
  STATUS_COLORS_DARK,
  STATUS_COLORS_LIGHT,
  trayDotCenterX,
  trayIconSize,
  trayTooltip,
  TRAY_MAX_DOTS,
  type TrayWorkbench
} from "./sessionDotsTray";

const workbenches: TrayWorkbench[] = [
  { workbenchId: "wb-a", noteId: "t-a", title: "Alpha", status: "open" },
  { workbenchId: "wb-b", noteId: "t-b", title: "Needs you", status: "awaiting_user" },
  { workbenchId: "wb-c", noteId: "t-c", title: "Busy", status: "running" }
];

describe("hitTestTrayDot", () => {
  it("picks the nearest dot center, including the gap between dots", () => {
    const left = trayDotCenterX(0);
    const mid = trayDotCenterX(1);
    const right = trayDotCenterX(2);
    expect(hitTestTrayDot(left, 3)).toBe(0);
    expect(hitTestTrayDot((left + mid) / 2 - 0.1, 3)).toBe(0);
    expect(hitTestTrayDot((left + mid) / 2 + 0.1, 3)).toBe(1);
    expect(hitTestTrayDot(mid, 3)).toBe(1);
    expect(hitTestTrayDot(right, 3)).toBe(2);
    expect(hitTestTrayDot(0, 3)).toBe(0);
    expect(hitTestTrayDot(trayIconSize(3).width, 3)).toBe(2);
  });

  it("returns null when there are no dots", () => {
    expect(hitTestTrayDot(4, 0)).toBeNull();
  });

  it("uses screen X minus tray bounds when click position is missing", () => {
    const { width } = trayIconSize(3);
    const bounds = { x: 800, y: 0, width, height: 22 };
    expect(hitTestTrayDotFromScreen(800 + 1, bounds, 3)).toBe(0);
    expect(hitTestTrayDotFromScreen(800 + width / 2, bounds, 3)).toBe(1);
    expect(hitTestTrayDotFromScreen(800 + width - 1, bounds, 3)).toBe(2);
  });

  it("prefers the click-event local position when Electron provides it", () => {
    const { width } = trayIconSize(3);
    const bounds = { x: 800, y: 0, width, height: 22 };
    expect(hitTestTrayDotFromScreen(800 + width - 1, bounds, 3, { x: 2, y: 8 })).toBe(0);
  });
});

describe("composeTrayItems", () => {
  it("puts notes first, then workbenches, and caps the list", () => {
    const items = composeTrayItems(
      [{ noteId: "n1", title: "Scratch" }, { noteId: "n2", title: "Inbox" }],
      workbenches
    );
    expect(items.map((item) => item.kind)).toEqual(["note", "note", "workbench", "workbench", "workbench"]);
    expect(items[0]).toMatchObject({ kind: "note", noteId: "n1" });
    expect(items[2]).toMatchObject({ kind: "workbench", workbenchId: "wb-a" });
    const overflow = composeTrayItems(
      Array.from({ length: 4 }, (_, i) => ({ noteId: `n${i}`, title: `N${i}` })),
      Array.from({ length: 8 }, (_, i) => ({
        workbenchId: `wb-${i}`,
        noteId: `t-${i}`,
        title: `W${i}`,
        status: "open" as const
      }))
    );
    expect(overflow).toHaveLength(TRAY_MAX_DOTS);
    expect(overflow.filter((item) => item.kind === "note")).toHaveLength(4);
  });
});

describe("composeWorkbenchRows", () => {
  const dots = [
    { paneKey: "terminal:1", projectPath: "/p/api", title: "api agent", status: "awaiting_user" as const, workbenchId: "wb-1" },
    { paneKey: "terminal:2", projectPath: "/p/web", title: "web agent", status: "running" as const, workbenchId: "wb-2" }
  ];

  it("gives a gray dot to an open workbench with no session", () => {
    expect(composeWorkbenchRows([], [{ workbenchId: "wb-9", noteId: "t-9", title: "Empty task" }], new Map()))
      .toEqual([{ workbenchId: "wb-9", noteId: "t-9", title: "Empty task", status: "open" }]);
  });

  it("rolls sessions up per workbench and lists open windows first", () => {
    const rows = composeWorkbenchRows(
      dots,
      [{ workbenchId: "wb-1", noteId: "t-1", title: "Api task" }],
      new Map([["wb-2", { noteId: "t-2", label: "Web" }]])
    );
    expect(rows).toEqual([
      { workbenchId: "wb-1", noteId: "t-1", title: "Api task", status: "awaiting_user" },
      { workbenchId: "wb-2", noteId: "t-2", title: "Web", status: "running" }
    ]);
  });

  it("prefers a renamed workbench over the window title", () => {
    const rows = composeWorkbenchRows(
      [],
      [{ workbenchId: "wb-1", noteId: "t-1", title: "Task title" }],
      new Map([["wb-1", { noteId: "t-1", label: "Backend" }]])
    );
    expect(rows[0]?.title).toBe("Backend");
  });

  it("keeps unowned panes as their own rows", () => {
    expect(composeWorkbenchRows(
      [{ paneKey: "pane:7", projectPath: "/p/external", title: "", status: "running", workbenchId: "" }],
      [],
      new Map()
    )).toEqual([{ workbenchId: "", noteId: "", title: "external", status: "running" }]);
  });
});

describe("trayTooltip", () => {
  it("lists workbench titles with status and overflow", () => {
    const many: TrayWorkbench[] = [
      ...workbenches,
      ...Array.from({ length: 8 }, (_, i) => ({
        workbenchId: `x-${i}`,
        noteId: `t-x-${i}`,
        title: `Extra ${i}`,
        status: "open" as const
      }))
    ];
    const items = composeTrayItems([], many);
    const extra = many.length - items.length;
    const tip = trayTooltip(items, extra);
    expect(tip).toContain("Needs you · Waiting");
    expect(tip).toContain("Busy · Running");
    expect(tip).toMatch(/\+\d+ more/);
  });

  it("uses an empty-state line when nothing is open", () => {
    expect(trayTooltip([])).toBe("No open sessions");
  });

  it("lists floating note titles without a workbench suffix", () => {
    expect(trayTooltip(composeTrayItems([{ noteId: "n1", title: "Scratch pad" }], []))).toBe("Scratch pad");
  });
});

describe("renderSessionDotsTrayPng", () => {
  it("writes a PNG whose size matches the visible layout at 2x", () => {
    const png = renderSessionDotsTrayPng(composeTrayItems([], workbenches), { scale: 2, dark: true });
    expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const logical = trayIconSize(3);
    expect(width).toBe(logical.width * 2);
    expect(height).toBe(logical.height * 2);
  });
});

describe("tray color scheme", () => {
  it("maps quiet slate gray for open, energetic green for running, and memo gold for notes", () => {
    expect(STATUS_COLORS_LIGHT.open).toEqual([142, 142, 147]);
    expect(STATUS_COLORS_DARK.open).toEqual([99, 99, 102]);
    expect(STATUS_COLORS_LIGHT.running).toEqual([52, 199, 89]);
    expect(STATUS_COLORS_DARK.running).toEqual([48, 209, 88]);
    expect(STATUS_COLORS_LIGHT.connecting).toEqual([0, 122, 255]);
    expect(STATUS_COLORS_DARK.connecting).toEqual([10, 132, 255]);
    expect(STATUS_COLORS_LIGHT.awaiting_user).toEqual([255, 149, 0]);
    expect(STATUS_COLORS_DARK.awaiting_user).toEqual([255, 159, 10]);
    expect(NOTE_COLOR_LIGHT).toEqual([255, 204, 0]);
    expect(NOTE_COLOR_DARK).toEqual([255, 214, 10]);
  });
});
