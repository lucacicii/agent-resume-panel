import type { WorkbenchArrowDirection } from "../shared/workbenchShortcuts";

export interface DesktopShortcutInput {
  type: string;
  key?: string;
  code?: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export const DEFAULT_STANDALONE_NOTE_SHORTCUT = "CommandOrControl+D";

const SHORTCUT_MODIFIERS = new Set([
  "CommandOrControl",
  "Command",
  "Control",
  "Ctrl",
  "Alt",
  "Option",
  "Shift",
  "Super",
  "Meta"
]);

const SHORTCUT_KEYS = new Set([
  "Space",
  "Tab",
  "Capslock",
  "Numlock",
  "Scrolllock",
  "Backspace",
  "Delete",
  "Insert",
  "Return",
  "Enter",
  "Escape",
  "Up",
  "Down",
  "Left",
  "Right",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Plus",
  "Minus",
  "Comma",
  "Period",
  "Slash",
  "Semicolon",
  "Quote",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Equal",
  "Backquote"
]);

/** Conservative validation for values passed to Electron globalShortcut.register. */
export function isValidGlobalShortcut(value: string): boolean {
  const parts = value.trim().split("+").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const modifiers = parts.slice(0, -1);
  const key = parts.at(-1) || "";
  if (!modifiers.length || modifiers.some((modifier) => !SHORTCUT_MODIFIERS.has(modifier))) {
    return false;
  }
  if (/^[A-Z0-9]$/.test(key) || /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return true;
  }
  return SHORTCUT_KEYS.has(key);
}

export function normalizeGlobalShortcut(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) return "";
  return isValidGlobalShortcut(candidate) ? candidate : DEFAULT_STANDALONE_NOTE_SHORTCUT;
}

export function isQuickAccessShortcut(input: DesktopShortcutInput, commandMode: boolean): boolean {
  if (input.type !== "keyDown") return false;
  if (!(input.control || input.meta) || input.alt || input.shift !== commandMode) return false;
  const key = input.key?.toLowerCase();
  return key === "p" || input.code === "KeyP";
}

export function workbenchArrowDirectionFromInput(input: DesktopShortcutInput): WorkbenchArrowDirection | null {
  if (input.type !== "keyDown") return null;
  if (!(input.control || input.meta) || input.alt || input.shift) return null;
  const key = (input.key || input.code || "").toLowerCase();
  if (key === "arrowleft") return "left";
  if (key === "arrowright") return "right";
  if (key === "arrowup") return "up";
  if (key === "arrowdown") return "down";
  return null;
}
