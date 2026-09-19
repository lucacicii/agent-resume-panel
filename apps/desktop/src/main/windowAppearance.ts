import { BrowserWindow, nativeTheme } from "electron";
import type { DesktopTheme } from "@agent-resume/core";

/**
 * The window background every `BrowserWindow` must be given.
 *
 * Electron's `backgroundColor` default is `#FFF`, and a window composites that
 * colour for the frames between its webContents being torn down and the native
 * window being destroyed. Without an explicit background, closing a window shows
 * a white flash. The values mirror `--color-window-bg` in
 * `renderer/styles.css` — keep the two in sync.
 */
export const WINDOW_BACKGROUND_LIGHT = "#f5f5f7";
export const WINDOW_BACKGROUND_DARK = "#1e1e1e";
/**
 * Window background for a window that lets the desktop through.
 *
 * The chrome and sidebars are translucent tokens, so the window under them must
 * not paint a colour of its own; the page decides what is opaque. Teardown
 * composites the window's own layers, so there is no white flash either.
 */
export const WINDOW_BACKGROUND_TRANSPARENT = "#00000000";

/**
 * Windows that own `vibrancy` / a transparent background.
 *
 * `applyWindowBackgrounds` must leave their background transparent: writing an
 * opaque colour on an appearance change would silently disable the effect.
 */
const translucentWindows = new Set<BrowserWindow>();

export function markTranslucentWindow(win: BrowserWindow): void {
  translucentWindows.add(win);
  win.on("closed", () => translucentWindows.delete(win));
}

/** The themed window background for the current system appearance. */
export function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND_DARK : WINDOW_BACKGROUND_LIGHT;
}

/**
 * Point Electron's native appearance at the in-app appearance setting.
 *
 * Without this, a user who picks Light while macOS is in Dark keeps dark native
 * chrome: menus, alerts, window frames, and scrollbars disagree with the app's
 * own content. `themeSource` also decides `shouldUseDarkColors`, so it must be
 * applied before the first window is created. Setting it emits `nativeTheme`
 * `updated` when the value actually changes, which re-applies window backgrounds.
 */
export function applyNativeThemeSource(theme: DesktopTheme | undefined): void {
  const next: DesktopTheme = theme === "light" || theme === "dark" ? theme : "system";
  if (nativeTheme.themeSource !== next) nativeTheme.themeSource = next;
  applyWindowBackgrounds();
}

/**
 * Re-apply the themed background to every open window. Called when the system
 * appearance changes, otherwise windows created under the previous appearance
 * keep a stale background until they are recreated.
 */
export function applyWindowBackgrounds(): void {
  const color = windowBackgroundColor();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || translucentWindows.has(win)) continue;
    win.setBackgroundColor(color);
  }
}
