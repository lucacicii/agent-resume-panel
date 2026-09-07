import type { DesktopTheme, PanelSettings } from "@agent-resume/core";

export type ThemeAppearance = "light" | "dark";

const CLASSIC_TERMINAL: Readonly<Record<string, string>> = {
  background: "#1e1e1e",
  foreground: "#f2f2f7",
  cursor: "#f2f2f7",
  cursorAccent: "#1e1e1e",
  selectionBackground: "rgba(255,255,255,.25)",
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
};

export type DesktopAppearanceState = Readonly<{
  requestedAppearance: DesktopTheme;
  appearance: ThemeAppearance;
}>;

function mediaMatches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

export function appearanceStateFromSettings(settings: Pick<PanelSettings, "desktop">): DesktopAppearanceState {
  const requestedAppearance: DesktopTheme = settings.desktop?.theme === "light" || settings.desktop?.theme === "dark"
    ? settings.desktop.theme
    : "system";
  const appearance: ThemeAppearance = requestedAppearance === "system"
    ? (mediaMatches("(prefers-color-scheme: dark)") ? "dark" : "light")
    : requestedAppearance;
  return { requestedAppearance, appearance };
}

export function applyDesktopAppearance(state: DesktopAppearanceState): void {
  const root = document.documentElement;
  root.dataset.theme = state.appearance;
  root.dataset.appearance = state.appearance;
  delete root.dataset.visualTheme;
  delete root.dataset.themeEffects;
  delete root.dataset.density;
  delete root.dataset.themeComponentVariant;
  delete root.dataset.themeIconVariant;
  root.style.colorScheme = state.appearance;
}

export function appThemeTerminal(_state: DesktopAppearanceState): Record<string, string> {
  return { ...CLASSIC_TERMINAL };
}
