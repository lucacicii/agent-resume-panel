/**
 * Native context menus, renderer side.
 *
 * The main process owns `NSMenu`; the renderer supplies localized labels and
 * gets back the id of the chosen item. Coordinates are the same client
 * coordinates the browser reports for a right-click, which is what Electron's
 * `popup({ x, y })` expects.
 */
import { desktopApi } from "./bridge";

export interface NativeContextMenuItem {
  id?: string;
  label?: string;
  type?: "normal" | "separator" | "checkbox";
  enabled?: boolean;
  checked?: boolean;
  submenu?: NativeContextMenuItem[];
}

/**
 * Show a native menu anchored at a point and get the chosen item's id back.
 *
 * The point is in the same client coordinates the browser reports for a
 * right-click, which is what Electron's `popup({ x, y })` expects.
 * `anchor` decides which menu edge lands on the point: "top" (the default)
 * opens the menu downward; "bottom" opens it upward — for controls pinned to
 * a surface's bottom edge.
 */
export async function showContextMenuAt(
  point: { x: number; y: number },
  items: NativeContextMenuItem[],
  anchor: "top" | "bottom" = "top"
): Promise<string | null> {
  const api = desktopApi();
  if (typeof api?.contextMenuShow !== "function") return null;
  try {
    return await api.contextMenuShow({ x: Math.round(point.x), y: Math.round(point.y), items, anchor });
  } catch {
    return null;
  }
}

/** Convenience for `onContextMenu` handlers. */
export function contextMenuPoint(event: { clientX: number; clientY: number }): { x: number; y: number } {
  return { x: event.clientX, y: event.clientY };
}
