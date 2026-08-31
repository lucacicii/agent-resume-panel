import { useRef } from "react";

export function ResizeHandle({ label, onDelta }: { label: string; onDelta: (delta: number) => void }): React.JSX.Element {
  const start = useRef<number | null>(null);
  return <button
    type="button"
    className="pane-resizer"
    aria-label={label}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      start.current = event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.classList.add("is-pane-resizing");
    }}
    onPointerMove={(event) => {
      if (start.current === null) return;
      const delta = event.clientX - start.current;
      start.current = event.clientX;
      onDelta(delta);
    }}
    onPointerUp={(event) => {
      start.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      document.body.classList.remove("is-pane-resizing");
    }}
    onPointerCancel={() => { start.current = null; document.body.classList.remove("is-pane-resizing"); }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      onDelta(event.key === "ArrowLeft" ? -8 : 8);
    }}
  />;
}
