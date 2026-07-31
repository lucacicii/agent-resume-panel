import type {
  DesktopTheme,
  DesktopThemeEffects,
  DesktopVisualThemeId,
  PanelSettings
} from "@agent-resume/core";

export type ThemeAppearance = "light" | "dark";
export type ThemeDensity = "comfortable" | "relaxed" | "compact";

/**
 * Declarative, built-in theme manifest. Theme packages are data only: tokens,
 * fonts, icons, and host-approved variants; they never execute arbitrary CSS/JS.
 */
export type ThemeDefinition = Readonly<{
  id: DesktopVisualThemeId;
  version: "1";
  nameKey: string;
  descriptionKey: string;
  supportedAppearances: readonly ThemeAppearance[];
  defaultAppearance: ThemeAppearance;
  density: ThemeDensity;
  fonts: Readonly<{ body: string; heading: string; mono: string }>;
  tokens: Readonly<Record<string, string>>;
  /** Host-owned geometry; theme data never targets arbitrary business selectors. */
  componentVariant: "classic" | "night-city" | "dos";
  iconVariant: "rounded" | "hud" | "pixel";
  motion: Readonly<{ ambient: boolean; interactionGlitch: boolean; scanPeriodSeconds: number }>;
  effects: Readonly<{ grid: boolean; scanlines: boolean; glow: boolean; noise: boolean }>;
  terminal: Readonly<Record<string, string>>;
}>;

const systemSans = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", sans-serif';
const systemMono = 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "PingFang SC", "Hiragino Sans GB", "Noto Sans Mono CJK SC", monospace';

export const THEME_DEFINITIONS: Readonly<Record<DesktopVisualThemeId, ThemeDefinition>> = {
  classic: {
    id: "classic", version: "1", nameKey: "desktop.settings.visualThemeClassic",
    descriptionKey: "desktop.settings.visualThemeClassicDesc", supportedAppearances: ["light", "dark"],
    defaultAppearance: "light", density: "comfortable",
    fonts: { body: systemSans, heading: systemSans, mono: systemMono }, tokens: {},
    componentVariant: "classic", iconVariant: "rounded",
    motion: { ambient: false, interactionGlitch: false, scanPeriodSeconds: 0 },
    effects: { grid: false, scanlines: false, glow: false, noise: false },
    terminal: {
      background: "#1e1e1e", foreground: "#f2f2f7", cursor: "#f2f2f7", cursorAccent: "#1e1e1e",
      selectionBackground: "rgba(255,255,255,.25)", black: "#1e1e1e", red: "#f44747", green: "#6a9955",
      yellow: "#dcdcaa", blue: "#569cd6", magenta: "#c586c0", cyan: "#4ec9b0", white: "#d4d4d4",
      brightBlack: "#808080", brightRed: "#f44747", brightGreen: "#6a9955", brightYellow: "#dcdcaa",
      brightBlue: "#569cd6", brightMagenta: "#c586c0", brightCyan: "#4ec9b0", brightWhite: "#ffffff"
    }
  },
  cyberpunk: {
    id: "cyberpunk", version: "1", nameKey: "desktop.settings.visualThemeCyberpunk",
    descriptionKey: "desktop.settings.visualThemeCyberpunkDesc", supportedAppearances: ["dark"],
    defaultAppearance: "dark", density: "relaxed",
    // Local/system faces only; no remote font requests are permitted by renderer CSP.
    fonts: {
      body: 'Inter, "Avenir Next", "PingFang SC", "Hiragino Sans GB", sans-serif',
      heading: '"Avenir Next Condensed", "Arial Narrow", "PingFang SC", sans-serif',
      mono: '"SF Mono", Menlo, Monaco, Consolas, "PingFang SC", "Hiragino Sans GB", monospace'
    },
    tokens: {
      "--theme-cut": "12px", "--theme-glow": "0 0 22px rgba(0, 240, 255, .24)",
      "--cyber-cyan": "#00f0ff", "--cyber-magenta": "#ff2bd6", "--cyber-hazard": "#ffd400"
    },
    componentVariant: "night-city", iconVariant: "hud",
    motion: { ambient: true, interactionGlitch: true, scanPeriodSeconds: 7 },
    effects: { grid: true, scanlines: true, glow: true, noise: true },
    terminal: {
      background: "#05040d", foreground: "#eaffff", cursor: "#ff2bd6", cursorAccent: "#05040d",
      selectionBackground: "rgba(0,240,255,.30)", black: "#05040d", red: "#ff3b5c", green: "#63f7b4",
      yellow: "#ffd400", blue: "#46a7ff", magenta: "#ff2bd6", cyan: "#00f0ff", white: "#d5eaff",
      brightBlack: "#6a6387", brightRed: "#ff7190", brightGreen: "#9affd8", brightYellow: "#ffe978",
      brightBlue: "#8ac7ff", brightMagenta: "#ff8ee8", brightCyan: "#83f8ff", brightWhite: "#ffffff"
    }
  },
  dos: {
    id: "dos", version: "1", nameKey: "desktop.settings.visualThemeDos",
    descriptionKey: "desktop.settings.visualThemeDosDesc", supportedAppearances: ["dark"],
    defaultAppearance: "dark", density: "compact",
    fonts: { body: systemMono, heading: systemMono, mono: systemMono },
    tokens: { "--theme-cut": "0px", "--theme-glow": "none" },
    componentVariant: "dos", iconVariant: "pixel",
    motion: { ambient: false, interactionGlitch: false, scanPeriodSeconds: 0 },
    effects: { grid: false, scanlines: true, glow: false, noise: false },
    // Amber phosphor palette: warm, low-saturation ANSI colors keep DOS character
    // without the harsh electric-blue output of the previous palette.
    terminal: {
      background: "#17120d", foreground: "#f0d7a0", cursor: "#f3b94f", cursorAccent: "#17120d",
      selectionBackground: "rgba(243,185,79,.30)", black: "#17120d", red: "#d87963", green: "#9fbf75",
      yellow: "#e6b65c", blue: "#b08b5a", magenta: "#b58a72", cyan: "#8db7a6", white: "#e5d2ab",
      brightBlack: "#75634d", brightRed: "#ec9a80", brightGreen: "#c1d99d", brightYellow: "#f6d68e",
      brightBlue: "#d0a46b", brightMagenta: "#d0a287", brightCyan: "#b7d7c3", brightWhite: "#fff1d0"
    }
  }
};

export function themeDefinition(value: string | undefined | null): ThemeDefinition {
  return value === "cyberpunk" || value === "dos" ? THEME_DEFINITIONS[value] : THEME_DEFINITIONS.classic;
}

export type DesktopAppearanceState = Readonly<{
  visualTheme: DesktopVisualThemeId;
  requestedAppearance: DesktopTheme;
  appearance: ThemeAppearance;
  effects: DesktopThemeEffects;
  density: ThemeDensity;
}>;

function mediaMatches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

export function isReducedMotion(): boolean {
  return mediaMatches("(prefers-reduced-motion: reduce)");
}

export function appearanceStateFromSettings(settings: Pick<PanelSettings, "desktop">): DesktopAppearanceState {
  const definition = themeDefinition(settings.desktop?.visualTheme);
  const rawAppearance: DesktopTheme = settings.desktop?.theme || "system";
  const requestedAppearance: DesktopTheme = rawAppearance === "system"
    ? (definition.supportedAppearances.length > 1 ? "system" : definition.defaultAppearance)
    : definition.supportedAppearances.includes(rawAppearance) ? rawAppearance : definition.defaultAppearance;
  const appearance: ThemeAppearance = requestedAppearance === "system"
    ? (mediaMatches("(prefers-color-scheme: dark)") ? "dark" : "light")
    : requestedAppearance;
  return {
    visualTheme: definition.id,
    requestedAppearance,
    appearance: definition.supportedAppearances.includes(appearance) ? appearance : definition.defaultAppearance,
    effects: isReducedMotion() || settings.desktop?.themeEffects === "reduced" ? "reduced" : "full",
    density: definition.density
  };
}

export function applyDesktopAppearance(state: DesktopAppearanceState): void {
  const root = document.documentElement;
  const definition = themeDefinition(state.visualTheme);
  root.dataset.visualTheme = state.visualTheme;
  root.dataset.appearance = state.appearance;
  root.dataset.theme = state.appearance; // Existing CSS compatibility bridge.
  root.dataset.themeEffects = state.effects;
  root.dataset.density = state.density;
  root.dataset.themeComponentVariant = definition.componentVariant;
  root.dataset.themeIconVariant = definition.iconVariant;
  root.style.setProperty("--theme-scan-period", `${definition.motion.scanPeriodSeconds || 0}s`);
  root.style.colorScheme = state.appearance;
  root.style.setProperty("--font-family-system", definition.fonts.body);
  root.style.setProperty("--font-family-heading", definition.fonts.heading);
  root.style.setProperty("--font-family-mono", definition.fonts.mono);
  for (const [name, value] of Object.entries(definition.tokens)) root.style.setProperty(name, value);
}

export function appThemeTerminal(state: DesktopAppearanceState): Record<string, string> {
  return { ...themeDefinition(state.visualTheme).terminal };
}
