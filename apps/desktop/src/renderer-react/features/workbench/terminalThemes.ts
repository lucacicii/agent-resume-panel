import type { ITheme } from "@xterm/xterm";
import { appThemeTerminal, type DesktopAppearanceState } from "../../themes";

/** Keep in sync with packages/core WorkbenchTerminalThemeId. */
export type WorkbenchTerminalThemeId =
  | "follow-app"
  | "default-dark"
  | "default-light"
  | "solarized-dark"
  | "solarized-light"
  | "one-dark"
  | "dracula";

/** Built-in embedded xterm color presets (desktop Workbench). */
export const WORKBENCH_TERMINAL_THEME_IDS: readonly WorkbenchTerminalThemeId[] = [
  "follow-app",
  "default-dark",
  "default-light",
  "solarized-dark",
  "solarized-light",
  "one-dark",
  "dracula"
] as const;

const THEME_ID_SET = new Set<string>(WORKBENCH_TERMINAL_THEME_IDS);

/** Full xterm themes — pass the whole object when updating so ANSI colors do not leak across presets. */
type TerminalPresetId = Exclude<WorkbenchTerminalThemeId, "follow-app">;

const THEMES: Record<TerminalPresetId, ITheme> = {
  "default-dark": {
    background: "#1e1e1e",
    foreground: "#f2f2f7",
    cursor: "#f2f2f7",
    cursorAccent: "#1e1e1e",
    selectionBackground: "rgba(255, 255, 255, 0.25)",
    selectionInactiveBackground: "rgba(255, 255, 255, 0.12)",
    black: "#1e1e1e",
    red: "#f44747",
    green: "#6a9955",
    yellow: "#dcdcaa",
    blue: "#569cd6",
    magenta: "#c586c0",
    cyan: "#4ec9b0",
    white: "#d4d4d4",
    brightBlack: "#808080",
    brightRed: "#f44747",
    brightGreen: "#6a9955",
    brightYellow: "#dcdcaa",
    brightBlue: "#569cd6",
    brightMagenta: "#c586c0",
    brightCyan: "#4ec9b0",
    brightWhite: "#ffffff"
  },
  "default-light": {
    background: "#fafafa",
    foreground: "#1e1e1e",
    cursor: "#1e1e1e",
    cursorAccent: "#fafafa",
    selectionBackground: "rgba(0, 0, 0, 0.18)",
    selectionInactiveBackground: "rgba(0, 0, 0, 0.08)",
    black: "#1e1e1e",
    red: "#c72e0f",
    green: "#0e7a2f",
    yellow: "#9a6700",
    blue: "#0451a5",
    magenta: "#9b59b6",
    cyan: "#0e7490",
    white: "#383a42",
    brightBlack: "#5c6370",
    brightRed: "#e45649",
    brightGreen: "#50a14f",
    brightYellow: "#c18401",
    brightBlue: "#4078f2",
    brightMagenta: "#a626a4",
    brightCyan: "#0184bc",
    brightWhite: "#1e1e1e"
  },
  "solarized-dark": {
    background: "#002b36",
    foreground: "#839496",
    cursor: "#839496",
    cursorAccent: "#002b36",
    selectionBackground: "rgba(147, 161, 161, 0.3)",
    selectionInactiveBackground: "rgba(147, 161, 161, 0.15)",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3"
  },
  "solarized-light": {
    background: "#fdf6e3",
    foreground: "#657b83",
    cursor: "#657b83",
    cursorAccent: "#fdf6e3",
    selectionBackground: "rgba(7, 54, 66, 0.18)",
    selectionInactiveBackground: "rgba(7, 54, 66, 0.08)",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3"
  },
  "one-dark": {
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#528bff",
    cursorAccent: "#282c34",
    selectionBackground: "rgba(103, 110, 128, 0.4)",
    selectionInactiveBackground: "rgba(103, 110, 128, 0.2)",
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff"
  },
  dracula: {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "rgba(68, 71, 90, 0.7)",
    selectionInactiveBackground: "rgba(68, 71, 90, 0.35)",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff"
  }
};

export function resolveTerminalThemeId(value: string | undefined | null): WorkbenchTerminalThemeId {
  if (value && THEME_ID_SET.has(value)) {
    return value as WorkbenchTerminalThemeId;
  }
  return "follow-app";
}

export function resolveTerminalTheme(
  id: string | undefined | null,
  appearance?: DesktopAppearanceState
): ITheme {
  const resolved = resolveTerminalThemeId(id);
  if (resolved === "follow-app") {
    return appearance ? appThemeTerminal(appearance) : { ...THEMES["default-dark"] };
  }
  return { ...THEMES[resolved] };
}
