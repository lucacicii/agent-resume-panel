import { BrowserWindow, nativeTheme } from "electron";

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

/** The themed window background for the current system appearance. */
export function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND_DARK : WINDOW_BACKGROUND_LIGHT;
}

/**
 * Re-apply the themed background to every open window. Called when the system
 * appearance changes, otherwise windows created under the previous appearance
 * keep a stale background until they are recreated.
 */
export function applyWindowBackgrounds(): void {
  const color = windowBackgroundColor();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setBackgroundColor(color);
  }
}
