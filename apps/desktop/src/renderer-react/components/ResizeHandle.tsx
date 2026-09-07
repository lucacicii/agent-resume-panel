import { useRef } from "react";

export function ResizeHandle({
  label,
  onDelta,
  orientation = "vertical"
}: {
  label: string;
  onDelta: (delta: number) => void;
  orientation?: "vertical" | "horizontal";
}): React.JSX.Element {
  const start = useRef<number | null>(null);
  const isHorizontalBar = orientation === "horizontal";
  return <button
    type="button"
    className={`pane-resizer${isHorizontalBar ? " is-horizontal" : ""}`}
    aria-label={label}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      start.current = isHorizontalBar ? event.clientY : event.clientX;
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.classList.add(isHorizontalBar ? "is-pane-resizing-v" : "is-pane-resizing");
    }}
    onPointerMove={(event) => {
      if (start.current === null) return;
      const currentPos = isHorizontalBar ? event.clientY : event.clientX;
      const delta = currentPos - start.current;
      start.current = currentPos;
      onDelta(delta);
    }}
    onPointerUp={(event) => {
      start.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      document.body.classList.remove("is-pane-resizing", "is-pane-resizing-v");
    }}
    onPointerCancel={() => {
      start.current = null;
      document.body.classList.remove("is-pane-resizing", "is-pane-resizing-v");
    }}
    onKeyDown={(event) => {
      if (isHorizontalBar) {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onDelta(event.key === "ArrowUp" ? -8 : 8);
      } else {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        onDelta(event.key === "ArrowLeft" ? -8 : 8);
      }
    }}
  />;
}
