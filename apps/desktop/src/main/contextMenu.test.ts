import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => null },
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn(), items: [] })) },
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn() }
}));

import { Menu } from "electron";
import {
  contextMenuTemplate,
  defaultContextMenuTemplate,
  hasDefaultContextMenu,
  sanitizeContextMenuItems,
  showContextMenu,
  type ContextMenuActions,
  type ContextMenuTarget
} from "./contextMenu";

function target(overrides: Partial<ContextMenuTarget> = {}): ContextMenuTarget {
  return {
    isEditable: true,
    selectionText: "",
    linkURL: "",
    misspelledWord: "",
    dictionarySuggestions: [],
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: false,
      canDelete: false,
      canSelectAll: true
    },
    ...overrides
  };
}

function actions(): ContextMenuActions & { calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string) => (...args: unknown[]) => {
    calls[name] = args;
  };
  return {
    calls,
    translate: (key) => `[${key}]`,
    replaceMisspelling: record("replaceMisspelling"),
    addToDictionary: record("addToDictionary"),
    openLink: record("openLink"),
    copyText: record("copyText")
  };
}

describe("sanitizeContextMenuItems", () => {
  it("keeps labels, ids, separators, and checkbox state", () => {
    const items = sanitizeContextMenuItems([
      { id: "rename", label: "Rename" },
      { type: "separator" },
      { id: "pin", label: "Pinned", type: "checkbox", checked: true }
    ]);
    expect(items).toEqual([
      { id: "rename", label: "Rename", type: "normal" },
      { type: "separator" },
      { id: "pin", label: "Pinned", type: "checkbox", checked: true }
    ]);
  });

  it("drops entries without a usable label and clamps string sizes", () => {
    const items = sanitizeContextMenuItems([
      { id: "no-label" },
      { label: "   " },
      { id: "long", label: "x".repeat(500) }
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].label).toHaveLength(200);
  });

  it("stops at the depth limit", () => {
    const deep = { id: "a", label: "a", submenu: [{ id: "b", label: "b", submenu: [{ id: "c", label: "c", submenu: [{ id: "d", label: "d" }] }] }] };
    const items = sanitizeContextMenuItems([deep]);
    const level1 = items[0].submenu?.[0];
    const level2 = level1?.submenu?.[0];
    expect(level2?.submenu).toBeUndefined();
  });

  it("ignores non-arrays", () => {
    expect(sanitizeContextMenuItems(undefined)).toEqual([]);
    expect(sanitizeContextMenuItems("nope")).toEqual([]);
  });
});

describe("contextMenuTemplate", () => {
  it("reports the id of the selected item", () => {
    const onSelect = vi.fn();
    const template = contextMenuTemplate([{ id: "open", label: "Open" }], onSelect);
    (template[0].click as () => void)();
    expect(onSelect).toHaveBeenCalledWith("open");
  });

  it("nests submenus", () => {
    const template = contextMenuTemplate(
      [{ id: "status", label: "Status", submenu: [{ id: "next", label: "Next" }] }],
      () => undefined
    );
    expect(Array.isArray(template[0].submenu)).toBe(true);
  });
});

describe("hasDefaultContextMenu", () => {
  it("is false for a plain non-editable target", () => {
    expect(hasDefaultContextMenu(target({ isEditable: false }))).toBe(false);
  });

  it("is true for selections, links, and misspelled words", () => {
    expect(hasDefaultContextMenu(target({ isEditable: false, selectionText: "hi" }))).toBe(true);
    expect(hasDefaultContextMenu(target({ isEditable: false, linkURL: "https://x.dev" }))).toBe(true);
    expect(hasDefaultContextMenu(target({ isEditable: false, misspelledWord: "teh" }))).toBe(true);
  });
});

describe("defaultContextMenuTemplate", () => {
  it("offers the standard editing roles with disabled state from editFlags", () => {
    const template = defaultContextMenuTemplate(target(), actions());
    const roles = template.map((item) => item.role).filter(Boolean);
    expect(roles).toEqual(
      expect.arrayContaining(["undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll"])
    );
    const undo = template.find((item) => item.role === "undo");
    expect(undo?.enabled).toBe(false);
  });

  it("applies spelling suggestions and dictionary actions", () => {
    const mock = actions();
    const template = defaultContextMenuTemplate(
      target({ misspelledWord: "teh", dictionarySuggestions: ["the", "ten"] }),
      mock
    );
    expect(template[0].label).toBe("the");
    (template[0].click as () => void)();
    expect(mock.calls.replaceMisspelling).toEqual(["the"]);

    const add = template.find((item) => item.label === "[desktop.menu.addToDictionary]");
    (add?.click as () => void)();
    expect(mock.calls.addToDictionary).toEqual(["teh"]);
  });

  it("adds link actions before the editing block", () => {
    const mock = actions();
    const template = defaultContextMenuTemplate(target({ linkURL: "https://x.dev" }), mock);
    const open = template.find((item) => item.label === "[desktop.menu.openLink]");
    (open?.click as () => void)();
    expect(mock.calls.openLink).toEqual(["https://x.dev"]);
    expect(template.indexOf(open as never)).toBeLessThan(
      template.findIndex((item) => item.role === "undo")
    );
  });

  it("offers copy and speech for a non-editable selection", () => {
    const template = defaultContextMenuTemplate(
      target({ isEditable: false, selectionText: "picked" }),
      actions()
    );
    const roles = template.map((item) => item.role);
    expect(roles).toContain("copy");
    expect(roles).toContain("startSpeaking");
    expect(roles).not.toContain("cut");
  });

  it("never ends with a separator", () => {
    for (const value of [target(), target({ isEditable: false, selectionText: "x" })]) {
      const template = defaultContextMenuTemplate(value, actions());
      expect(template[template.length - 1]?.type).not.toBe("separator");
    }
  });
});

describe("showContextMenu", () => {
  /** A menu mock that records popup options and can choose an item or dismiss. */
  function mockMenu(itemCount: number): {
    popup: ReturnType<typeof vi.fn>;
    choose: () => void;
    dismiss: () => void;
  } {
    const popup = vi.fn();
    const items = Array.from({ length: itemCount });
    let choose: () => void = () => undefined;
    vi.mocked(Menu.buildFromTemplate).mockImplementationOnce(
      ((template: Electron.MenuItemConstructorOptions[]) => {
        // `contextMenuTemplate` closes the chosen id over this callback.
        choose = template.find((item) => typeof item.click === "function")?.click as () => void;
        return { popup, items };
      }) as unknown as typeof Menu.buildFromTemplate
    );
    return {
      popup,
      choose: () => choose(),
      dismiss: () => popup.mock.calls[0]?.[0]?.callback?.()
    };
  }

  it("pops up downward from the point by default", async () => {
    const { popup, dismiss } = mockMenu(1);
    const promise = showContextMenu(null, [{ id: "open", label: "Open" }], { x: 10, y: 20 });

    expect(popup).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 20 }));
    expect(popup.mock.calls[0][0]).not.toHaveProperty("positioningItem");

    dismiss();
    await expect(promise).resolves.toBeNull();
  });

  it("bottom-anchors the menu so it opens upward from the point", async () => {
    const { popup, dismiss } = mockMenu(3);
    const promise = showContextMenu(null, [{ id: "settings", label: "Settings" }], { x: 8, y: 100 }, "bottom");

    const options = popup.mock.calls[0][0];
    // The anchor lifts by one row so the menu's lower edge lands on the point.
    expect(options.y).toBe(100 - 22);
    // Positioning the last item there stacks every item above it.
    expect(options.positioningItem).toBe(2);

    dismiss();
    await expect(promise).resolves.toBeNull();
  });

  it("keeps the anchor inside the screen when the point sits high", async () => {
    const { popup, dismiss } = mockMenu(1);
    const promise = showContextMenu(null, [{ id: "settings", label: "Settings" }], { x: 0, y: 4 }, "bottom");

    expect(popup.mock.calls[0][0].y).toBe(0);

    dismiss();
    await expect(promise).resolves.toBeNull();
  });

  it("resolves with the chosen item id", async () => {
    const { popup, choose, dismiss } = mockMenu(1);
    const promise = showContextMenu(null, [{ id: "open", label: "Open" }], { x: 1, y: 2 });

    choose();
    dismiss();
    await expect(promise).resolves.toBe("open");
  });
});
