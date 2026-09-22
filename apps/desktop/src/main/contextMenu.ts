import { BrowserWindow, Menu, clipboard, shell, type WebContents } from "electron";

/**
 * Native context menus.
 *
 * macOS users expect the system menu: it highlights with the accent colour,
 * flips at screen edges, is keyboard navigable, and offers Services and the
 * standard editing commands. Everything the OS can draw is drawn by the OS here;
 * a DOM menu is only for surfaces an `NSMenu` cannot express (tag grids, agent
 * pickers, colour swatches).
 */

/** A renderer-supplied menu description; `id` is echoed back on selection. */
export interface ContextMenuItemSpec {
  id?: string;
  label?: string;
  type?: "normal" | "separator" | "checkbox";
  enabled?: boolean;
  checked?: boolean;
  submenu?: ContextMenuItemSpec[];
}

const MAX_ITEMS = 60;
const MAX_DEPTH = 3;
const MAX_LABEL_LENGTH = 200;
const MAX_ID_LENGTH = 120;

/** Renderer input is untrusted: clamp depth, count, and string sizes. */
export function sanitizeContextMenuItems(value: unknown, depth = 1): ContextMenuItemSpec[] {
  if (!Array.isArray(value) || depth > MAX_DEPTH) return [];
  const items: ContextMenuItemSpec[] = [];
  for (const entry of value.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const type = raw.type === "separator" ? "separator" : raw.type === "checkbox" ? "checkbox" : "normal";
    if (type === "separator") {
      items.push({ type: "separator" });
      continue;
    }
    if (typeof raw.label !== "string" || !raw.label.trim()) continue;
    const item: ContextMenuItemSpec = { label: raw.label.slice(0, MAX_LABEL_LENGTH), type };
    if (typeof raw.id === "string" && raw.id.trim()) item.id = raw.id.slice(0, MAX_ID_LENGTH);
    if (raw.enabled === false) item.enabled = false;
    if (type === "checkbox") item.checked = raw.checked === true;
    if (Array.isArray(raw.submenu)) {
      const submenu = sanitizeContextMenuItems(raw.submenu, depth + 1);
      if (submenu.length) item.submenu = submenu;
    }
    items.push(item);
  }
  return items;
}

/** Turn a spec list into a menu template; selecting an item resolves its id. */
export function contextMenuTemplate(
  items: readonly ContextMenuItemSpec[],
  onSelect: (id: string) => void
): Electron.MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item.type === "separator") return { type: "separator" } as Electron.MenuItemConstructorOptions;
    return {
      label: item.label,
      type: item.type === "checkbox" ? "checkbox" : "normal",
      enabled: item.enabled !== false,
      checked: item.type === "checkbox" ? item.checked === true : undefined,
      ...(item.submenu ? { submenu: contextMenuTemplate(item.submenu, onSelect) } : {}),
      ...(item.id
        ? {
            click: () => {
              onSelect(item.id as string);
            }
          }
        : {})
    } as Electron.MenuItemConstructorOptions;
  });
}

/** Opt-in trace: `AR_DEBUG_MENUS=1` logs every native menu the app builds. */
function debugMenus(label: string, items: readonly ContextMenuItemSpec[] | readonly Electron.MenuItemConstructorOptions[]): void {
  if (process.env.AR_DEBUG_MENUS !== "1") return;
  console.log(`[menus] ${label}:`, JSON.stringify(items.map((item) => ("role" in item ? `role:${item.role}` : item.label ?? item.type ?? "?"))));
}

/**
 * macOS menu row height at the system default text size (points). `NSMenu`
 * anchors a pop-up on an item's top-left corner (Apple: "the top left corner of
 * the specified item is positioned at the specified location"), so a
 * bottom-anchored popup must lift its anchor by one row for the menu's lower
 * edge to land on the caller's point.
 */
const ESTIMATED_MENU_ITEM_HEIGHT = 22;

/**
 * Show a native menu at a point in `win` and resolve with the chosen item id,
 * or null when the menu is dismissed.
 *
 * `anchor` decides which edge lands on the point: "top" (the default) opens
 * the menu downward from the point; "bottom" opens it upward, for controls
 * pinned to a surface's bottom edge (e.g. the sidebar account row).
 */
export function showContextMenu(
  win: BrowserWindow | null,
  items: readonly ContextMenuItemSpec[],
  point: { x: number; y: number },
  anchor: "top" | "bottom" = "top"
): Promise<string | null> {
  if (!items.length) return Promise.resolve(null);
  debugMenus("renderer context menu", items);
  return new Promise((resolve) => {
    let selected: string | null = null;
    const menu = Menu.buildFromTemplate(
      contextMenuTemplate(items, (id) => {
        selected = id;
      })
    );
    // "bottom": the caller's point is where the menu's lower edge should sit.
    // Positioning the last item there (minus its row) stacks every item upward.
    const y = Math.max(0, Math.round(anchor === "bottom" ? point.y - ESTIMATED_MENU_ITEM_HEIGHT : point.y));
    menu.popup({
      ...(win ? { window: win } : {}),
      x: Math.max(0, Math.round(point.x)),
      y,
      ...(anchor === "bottom" ? { positioningItem: menu.items.length - 1 } : {}),
      callback: () => resolve(selected)
    });
  });
}

/** The subset of `context-menu` event params this module reacts to. */
export interface ContextMenuTarget {
  isEditable: boolean;
  selectionText: string;
  linkURL: string;
  misspelledWord: string;
  dictionarySuggestions: readonly string[];
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canDelete: boolean;
    canSelectAll: boolean;
  };
}

/** Actions the default menu performs; injected so the template stays testable. */
export interface ContextMenuActions {
  translate: (key: string) => string;
  replaceMisspelling: (word: string) => void;
  addToDictionary: (word: string) => void;
  openLink: (url: string) => void;
  copyText: (text: string) => void;
}

/**
 * The standard macOS menu for a text field, an editor, a selection, or a link.
 *
 * Roles are used wherever Electron has one, so those items keep the system's own
 * localized titles and actions; only the app-specific entries (spelling
 * suggestions, dictionary, link actions) carry a label from our catalog.
 */
export function defaultContextMenuTemplate(
  target: ContextMenuTarget,
  actions: ContextMenuActions
): Electron.MenuItemConstructorOptions[] {
  const items: Electron.MenuItemConstructorOptions[] = [];
  const suggestions = target.misspelledWord
    ? target.dictionarySuggestions.slice(0, 5)
    : [];

  if (suggestions.length) {
    for (const word of suggestions) {
      items.push({
        label: word,
        click: () => actions.replaceMisspelling(word)
      });
    }
    items.push({ type: "separator" });
    items.push({
      label: actions.translate("desktop.menu.addToDictionary"),
      click: () => actions.addToDictionary(target.misspelledWord)
    });
    items.push({ type: "separator" });
  }

  if (target.linkURL) {
    items.push({
      label: actions.translate("desktop.menu.openLink"),
      click: () => actions.openLink(target.linkURL)
    });
    items.push({
      label: actions.translate("desktop.menu.copyLink"),
      click: () => actions.copyText(target.linkURL)
    });
    items.push({ type: "separator" });
  }

  if (target.isEditable) {
    items.push(
      { role: "undo", enabled: target.editFlags.canUndo },
      { role: "redo", enabled: target.editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: target.editFlags.canCut },
      { role: "copy", enabled: target.editFlags.canCopy },
      { role: "paste", enabled: target.editFlags.canPaste },
      { role: "pasteAndMatchStyle", enabled: target.editFlags.canPaste },
      { role: "delete", enabled: target.editFlags.canDelete },
      { role: "selectAll", enabled: target.editFlags.canSelectAll },
      { type: "separator" },
      { role: "toggleSpellChecker" },
      { role: "showSubstitutions" }
    );
  } else if (target.selectionText) {
    items.push(
      { role: "copy", enabled: target.editFlags.canCopy },
      { type: "separator" },
      { role: "startSpeaking", enabled: true },
      { role: "stopSpeaking", enabled: true }
    );
  }

  if (process.platform === "darwin") {
    if (items.length) items.push({ type: "separator" });
    items.push({ role: "services" });
  }

  // A trailing separator would render as a stray divider.
  while (items.length && items[items.length - 1]?.type === "separator") items.pop();
  return items;
}

/** True when the default menu has something useful to offer for this target. */
export function hasDefaultContextMenu(target: ContextMenuTarget): boolean {
  return Boolean(
    target.isEditable || target.selectionText.trim() || target.linkURL || target.misspelledWord
  );
}

/**
 * Install the standard menu on a web contents.
 *
 * Applied from one `web-contents-created` hook in the main process, so every
 * window — board, workbench, note, browser page — gets it without each window
 * module having to remember.
 */
export function attachDefaultContextMenu(
  contents: WebContents,
  deps: { translate: (key: string) => string }
): void {
  contents.on("context-menu", (_event, params) => {
    const target: ContextMenuTarget = {
      isEditable: params.isEditable,
      selectionText: params.selectionText,
      linkURL: params.linkURL,
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: params.dictionarySuggestions,
      editFlags: {
        canUndo: params.editFlags.canUndo,
        canRedo: params.editFlags.canRedo,
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste,
        canDelete: params.editFlags.canDelete,
        canSelectAll: params.editFlags.canSelectAll
      }
    };
    if (!hasDefaultContextMenu(target)) return;
    const template = defaultContextMenuTemplate(target, {
        translate: deps.translate,
        replaceMisspelling: (word) => {
          if (!contents.isDestroyed()) contents.replaceMisspelling(word);
        },
        addToDictionary: (word) => {
          if (!contents.isDestroyed()) contents.session.addWordToSpellCheckerDictionary(word);
        },
        openLink: (url) => {
          void shell.openExternal(url).catch(() => undefined);
        },
        copyText: (text) => clipboard.writeText(text)
      });
    debugMenus("editable/selection context menu", template);
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(contents) ?? undefined });
  });
}
