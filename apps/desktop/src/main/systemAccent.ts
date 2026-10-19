import { BrowserWindow, systemPreferences } from "electron";

/**
 * The user's system accent colour.
 *
 * macOS reports it as `"RRGGBBAA"` (for example `"0a84ffff"`) via
 * `systemPreferences.getAccentColor()`. Windows reports the same RGBA form
 * through `BrowserWindow.getAccentColor()`, which returns `false` when the user
 * disabled accent-colour highlighting; there is no separate system-wide colour
 * API there.
 *
 * The renderer only needs the opaque `#rrggbb` part: it feeds the
 * `--accent-base` custom property, and `styles.css` derives hover, active,
 * tinted fill, focus ring, and Markdown link colours from it, lifting the value
 * for dark appearance the way the system does.
 */
export function accentColorFromSystem(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const hex = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return null;
  return `#${hex.slice(0, 6).toLowerCase()}`;
}

/** The current accent colour, or `null` to fall back to system blue. */
export function currentAccentColor(): string | null {
  try {
    if (process.platform === "darwin") {
      return accentColorFromSystem(systemPreferences.getAccentColor() as unknown);
    }
    if (process.platform === "win32") {
      // Any window answers; a hidden one is enough for the query.
      const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
      return accentColorFromSystem(win?.getAccentColor() as unknown);
    }
  } catch {
    // A system preference that cannot be read is not an error: the renderer
    // falls back to the default palette.
  }
  return null;
}

/**
 * Watch for accent colour changes made while the app is running. Returns the
 * unsubscribe function; call it on quit.
 */
export function subscribeAccentColorChange(listener: (color: string | null) => void): () => void {
  if (process.platform === "win32") {
    const handler = (_event: Electron.Event, newColor: string) => {
      listener(accentColorFromSystem(newColor));
    };
    try {
      systemPreferences.on("accent-color-changed", handler);
    } catch {
      return () => undefined;
    }
    return () => {
      try {
        systemPreferences.removeListener("accent-color-changed", handler);
      } catch {
        // The app may already be tearing down.
      }
    };
  }
  if (process.platform !== "darwin") return () => undefined;
  let id: number;
  try {
    id = systemPreferences.subscribeNotification("AppleColorPreferencesChangedNotification", () => {
      listener(currentAccentColor());
    });
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      systemPreferences.unsubscribeNotification(id);
    } catch {
      // The app may already be tearing down.
    }
  };
}
