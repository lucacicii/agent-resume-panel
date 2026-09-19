import { systemPreferences } from "electron";

/**
 * The user's macOS accent colour, read from System Settings → Appearance.
 *
 * macOS reports it as `"RRGGBBAA"` (for example `"0a84ffff"`). The renderer
 * only needs the opaque `#rrggbb` part: it feeds the `--accent-base` custom
 * property, and `styles.css` derives hover, active, tinted fill, focus ring,
 * and Markdown link colours from it, lifting the value for dark appearance the
 * way the system does.
 */
export function accentColorFromSystem(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const hex = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) return null;
  return `#${hex.slice(0, 6).toLowerCase()}`;
}

/** The current accent colour, or `null` to fall back to system blue. */
export function currentAccentColor(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    // The macOS signature returns a string; other platforms return a boolean.
    return accentColorFromSystem(systemPreferences.getAccentColor() as unknown);
  } catch {
    return null;
  }
}

/**
 * Watch for accent colour changes made while the app is running. Returns the
 * unsubscribe function; call it on quit.
 */
export function subscribeAccentColorChange(listener: (color: string | null) => void): () => void {
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
