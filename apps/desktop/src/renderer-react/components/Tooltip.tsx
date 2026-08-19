import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";

const HOVER_DELAY_MS = 120;

/**
 * Lightweight portal tooltip: shows `label` next to the wrapped trigger on
 * hover or keyboard focus. Rendered at <body> via a portal so it is never
 * clipped by an overflow container (the nav rail's dot cluster scrolls).
 *
 * The wrapped control keeps its own `aria-label` as the accessible name; the
 * tooltip is a visible affordance, not a duplicate of it.
 */
export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    const update = () => {
      const wr = wrap.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      const gap = 8;
      const left = Math.max(8, Math.min(wr.right + gap, window.innerWidth - tr.width - 8));
      const top = Math.max(8, Math.min(wr.top + wr.height / 2 - tr.height / 2, window.innerHeight - tr.height - 8));
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    update();
    const raf = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const show = () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  };
  const hide = () => {
    window.clearTimeout(timerRef.current);
    setOpen(false);
  };

  return (
    <span
      ref={wrapRef}
      className="tooltip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open
        ? createPortal(
            <div ref={tipRef} role="tooltip" className="tooltip">{label}</div>,
            document.body
          )
        : null}
    </span>
  );
}
