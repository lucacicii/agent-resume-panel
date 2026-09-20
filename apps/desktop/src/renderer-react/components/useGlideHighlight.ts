import { useCallback, useRef, useState } from "react";

export type GlideState = { top: number; height: number; visible: boolean };

export const HIDDEN_GLIDE: GlideState = { top: 0, height: 0, visible: false };

/**
 * The gliding hover highlight shared by nav and list surfaces: one pill that
 * travels between rows (top/height transition) instead of per-row backgrounds.
 * Rows register themselves by key; hovering the active row hides the pill
 * because that row already carries its own selection fill.
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
        setGlide(HIDDEN_GLIDE);
        return;
      }
      const row = rowRefs.current.get(key);
      if (!row || !containerRef.current) {
        setGlide(HIDDEN_GLIDE);
        return;
      }
      setGlide({ top: row.offsetTop, height: row.offsetHeight, visible: true });
    },
    [activeKey]
  );

  const hideGlide = useCallback(() => setGlide(HIDDEN_GLIDE), []);

  return { containerRef, setRow, glide, moveGlide, hideGlide };
}
