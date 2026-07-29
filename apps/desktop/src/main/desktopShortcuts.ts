export interface DesktopShortcutInput {
  type: string;
  key?: string;
  code?: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export function isQuickAccessShortcut(input: DesktopShortcutInput, commandMode: boolean): boolean {
  if (input.type !== "keyDown") return false;
  if (!(input.control || input.meta) || input.alt || input.shift !== commandMode) return false;
  const key = input.key?.toLowerCase();
  return key === "p" || input.code === "KeyP";
}
