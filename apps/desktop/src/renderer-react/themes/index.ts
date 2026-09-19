import type { DesktopTheme, PanelSettings } from "@agent-resume/core";

type ThemeAppearance = "light" | "dark";

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

/**
 * Inject the user's macOS accent colour.
 *
 * `styles.css` keeps `--color-accent` and everything derived from it (hover,
 * active, tinted fill, focus ring, Markdown links) pointing at `--accent-base`,
 * so setting one custom property re-themes selection and focus app-wide. A null
 * or malformed value removes the override and the CSS fallback applies.
 */
export function applySystemAccent(accent: string | null | undefined): void {
  const root = document.documentElement;
  if (typeof accent === "string" && /^#[0-9a-f]{6}$/i.test(accent)) {
    root.style.setProperty("--accent-base", accent.toLowerCase());
  } else {
    root.style.removeProperty("--accent-base");
  }
}

/**
 * Apply the current accent and follow System Settings → Appearance while the
 * app runs. Returns the unsubscribe function.
 */
export function startSystemAccentSync(): () => void {
  const api = window.agentResume;
  if (typeof api?.systemAccent !== "function") return () => undefined;
  let active = true;
  void api.systemAccent()
    .then((accent) => {
      if (active) applySystemAccent(accent);
    })
    .catch(() => undefined);
  const stop = typeof api.onSystemAccentChanged === "function"
    ? api.onSystemAccentChanged((accent) => applySystemAccent(accent))
    : undefined;
  return () => {
    active = false;
    stop?.();
  };
}

export function appThemeTerminal(_state: DesktopAppearanceState): Record<string, string> {
  return { ...CLASSIC_TERMINAL };
}
