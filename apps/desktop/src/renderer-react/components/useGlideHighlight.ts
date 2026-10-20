import { useCallback, useRef, useState } from "react";

export type GlideState = { top: number; height: number; visible: boolean; gliding: boolean };

export const HIDDEN_GLIDE: GlideState = { top: 0, height: 0, visible: false, gliding: false };

/**
 * The gliding hover highlight shared by nav and list surfaces: one pill that
 * travels between rows (top/height transition) instead of per-row backgrounds.
 * Rows register themselves by key; hovering the active row hides the pill
 * because that row already carries its own selection fill.
 *
 * The pill is *placed* on the first hover and only *travels* once it is already
 * on screen: `gliding` marks the travel case so the surface can switch the
 * geometry transition off for a placement and keep the row it faded out on.
 */
export function useGlideHighlight(activeKey: string | null) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement | null>());
  const [glide, setGlide] = useState<GlideState>(HIDDEN_GLIDE);

  const setRow = useCallback((key: string, node: HTMLElement | null) => {
    rowRefs.current.set(key, node);
  }, []);

  const moveGlide = useCallback(
    (key: string | null) => {
      if (!key || key === activeKey) {
        // Hide in place: the active row carries its own fill, and the pill
        // keeps its last position so it fades out instead of retreating.
        setGlide((current) => (current.visible ? { ...current, visible: false } : current));
        return;
      }
      const row = rowRefs.current.get(key);
      if (!row || !containerRef.current) {
        setGlide((current) => (current.visible ? { ...current, visible: false } : current));
        return;
      }
      setGlide((current) => ({
        top: row.offsetTop,
        height: row.offsetHeight,
        visible: true,
        // A pill that is already on screen travels to the new row; a hidden
        // one is placed there and only fades in.
        gliding: current.visible,
      }));
    },
    [activeKey]
  );

  const hideGlide = useCallback(
    () => setGlide((current) => (current.visible ? { ...current, visible: false } : current)),
    []
  );

  return { containerRef, setRow, glide, moveGlide, hideGlide };
}
