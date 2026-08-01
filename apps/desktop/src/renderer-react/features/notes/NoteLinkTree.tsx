import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  clientToSvgPoint,
  DRAG_THRESHOLD_PX,
  hitTestNode,
  isValidReparent
} from "./noteLinkTreeDrag";
import {
  edgePath,
  layoutNoteTree,
  truncateLabel,
  type LaidOutNode,
  type LayoutTreeNode
} from "./noteLinkTreeLayout";

export type NoteLinkTreeProps = {
  root: LayoutTreeNode;
  selectedNoteId?: string;
  aliases?: Record<string, string>;
  onSelect: (noteId: string) => void;
  truncatedHint?: string;
  /** Drag-reparent; omit to disable drag. null parent = detach to root note. */
  onReparent?: (childNoteId: string, newParentNoteId: string | null) => void | Promise<void>;
  /** Tree root note id — not draggable in v1. */
  treeRootId?: string;
  detachLabel?: string;
};

type DragState = {
  noteId: string;
  title: string;
  startClientX: number;
  startClientY: number;
  pointerId: number;
  moved: boolean;
  ghostX: number;
  ghostY: number;
  dropNoteId: string | null;
  dropDetach: boolean;
  dropValid: boolean;
};

function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

export function NoteLinkTree({
  root,
  selectedNoteId,
  aliases = {},
  onSelect,
  truncatedHint,
  onReparent,
  treeRootId,
  detachLabel
}: NoteLinkTreeProps): JSX.Element {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const layout = useMemo(() => layoutNoteTree(root), [root]);
  const rootId = treeRootId || root.noteId;
  const dragEnabled = typeof onReparent === "function";

  const projectLabel = (projectPath?: string) => {
    if (!projectPath) return "";
    return aliases[projectPath] || basename(projectPath);
  };

  const onKeyActivate = (event: KeyboardEvent, noteId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(noteId);
    }
  };

  const resolveDrop = useCallback(
    (clientX: number, clientY: number, draggedId: string): Pick<DragState, "dropNoteId" | "dropDetach" | "dropValid"> => {
      const detachEl = document.querySelector(".notes-link-dendrogram-detach");
      if (detachEl) {
        const rect = detachEl.getBoundingClientRect();
        if (
          clientX >= rect.left
          && clientX <= rect.right
          && clientY >= rect.top
          && clientY <= rect.bottom
        ) {
          const valid = isValidReparent(layout.edges, draggedId, null);
          return { dropNoteId: null, dropDetach: true, dropValid: valid };
        }
      }

      const svg = svgRef.current;
      if (!svg) {
        return { dropNoteId: null, dropDetach: false, dropValid: false };
      }
      const { x, y } = clientToSvgPoint(svg, clientX, clientY);
      const hit = hitTestNode(layout.nodes, x, y);
      if (!hit || hit.noteId === draggedId) {
        return { dropNoteId: null, dropDetach: false, dropValid: false };
      }
      const valid = isValidReparent(layout.edges, draggedId, hit.noteId);
      return { dropNoteId: hit.noteId, dropDetach: false, dropValid: valid };
    },
    [layout.edges, layout.nodes]
  );

  const endDrag = useCallback(
    async (state: DragState, commit: boolean) => {
      setDrag(null);
      if (!commit || !state.moved || !onReparent) {
        if (!state.moved) {
          onSelect(state.noteId);
        }
        return;
      }
      if (!state.dropValid) {
        return;
      }
      if (state.dropDetach) {
        await onReparent(state.noteId, null);
        return;
      }
      if (state.dropNoteId) {
        await onReparent(state.noteId, state.dropNoteId);
      }
    },
    [onReparent, onSelect]
  );

  useEffect(() => {
    if (!drag) return;

    const onMove = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const dx = event.clientX - current.startClientX;
      const dy = event.clientY - current.startClientY;
      const moved = current.moved || Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
      const drop = moved
        ? resolveDrop(event.clientX, event.clientY, current.noteId)
        : { dropNoteId: null as string | null, dropDetach: false, dropValid: false };
      setDrag({
        ...current,
        moved,
        ghostX: event.clientX,
        ghostY: event.clientY,
        ...drop
      });
    };

    const onUp = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== current.pointerId) return;
      void endDrag(
        {
          ...current,
          ...(current.moved ? resolveDrop(event.clientX, event.clientY, current.noteId) : {})
        },
        true
      );
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) {
        void endDrag(dragRef.current, false);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey as unknown as EventListener);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey as unknown as EventListener);
    };
  }, [drag, endDrag, resolveDrop]);

  const onNodePointerDown = (event: ReactPointerEvent, node: LaidOutNode) => {
    if (!dragEnabled || event.button !== 0) return;
    if (node.noteId === rootId) return; // v1: root not draggable
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    setDrag({
      noteId: node.noteId,
      title: node.title,
      startClientX: event.clientX,
      startClientY: event.clientY,
      pointerId: event.pointerId,
      moved: false,
      ghostX: event.clientX,
      ghostY: event.clientY,
      dropNoteId: null,
      dropDetach: false,
      dropValid: false
    });
  };

  return (
    <div
      className={`notes-link-dendrogram${drag?.moved ? " is-dragging" : ""}`}
      data-testid="notes-link-dendrogram"
    >
      {dragEnabled ? (
        <div
          className={[
            "notes-link-dendrogram-detach",
            drag?.moved ? "is-visible" : "",
            drag?.moved && drag.dropDetach && drag.dropValid ? "is-drop-ok" : "",
            drag?.moved && drag.dropDetach && !drag.dropValid ? "is-drop-bad" : ""
          ].filter(Boolean).join(" ")}
          data-testid="notes-link-detach-zone"
        >
          {detachLabel || "Drop here to unlink (become a main note)"}
        </div>
      ) : null}
      <div className="notes-link-dendrogram-scroll">
        <svg
          ref={svgRef}
          className="notes-link-dendrogram-svg"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="tree"
          aria-label={root.title}
        >
          <g className="notes-link-dendrogram-edges" aria-hidden="true">
            {layout.edges.map((edge) => {
              const active =
                hoveredId === edge.parentNoteId
                || hoveredId === edge.childNoteId
                || selectedNoteId === edge.parentNoteId
                || selectedNoteId === edge.childNoteId
                || (drag?.moved && (
                  drag.noteId === edge.parentNoteId
                  || drag.noteId === edge.childNoteId
                  || drag.dropNoteId === edge.parentNoteId
                  || drag.dropNoteId === edge.childNoteId
                ));
              return (
                <path
                  key={`${edge.parentNoteId}->${edge.childNoteId}`}
                  className={`notes-link-dendrogram-edge${active ? " is-active" : ""}`}
                  d={edgePath(edge)}
                  fill="none"
                />
              );
            })}
          </g>
          <g className="notes-link-dendrogram-nodes">
            {layout.nodes.map((node) => {
              const selected = selectedNoteId === node.noteId;
              const hovered = hoveredId === node.noteId;
              const isDragSource = drag?.noteId === node.noteId;
              const isDropTarget = drag?.moved && drag.dropNoteId === node.noteId;
              const dropOk = isDropTarget && drag?.dropValid;
              const dropBad = isDropTarget && !drag?.dropValid;
              const radius = node.isRoot ? 6 : selected || dropOk ? 5 : 3.5;
              const proj = projectLabel(node.projectPath);
              const fullTitle = proj ? `${node.title} · ${proj}` : node.title;
              const canDrag = dragEnabled && node.noteId !== rootId;
              return (
                <g
                  key={node.noteId}
                  className={[
                    "notes-link-dendrogram-node",
                    node.isRoot ? "is-root" : "",
                    node.isLeaf ? "is-leaf" : "",
                    selected ? "is-selected" : "",
                    hovered ? "is-hovered" : "",
                    isDragSource && drag?.moved ? "is-drag-source" : "",
                    dropOk ? "is-drop-ok" : "",
                    dropBad ? "is-drop-bad" : "",
                    canDrag ? "is-draggable" : ""
                  ].filter(Boolean).join(" ")}
                  transform={`translate(${node.x} ${node.y})`}
                  role="treeitem"
                  tabIndex={0}
                  aria-label={fullTitle}
                  aria-selected={selected}
                  data-note-id={node.noteId}
                  onClick={() => {
                    // Draggable nodes select on pointerup; root (non-draggable) still uses click.
                    if (dragEnabled && canDrag) return;
                    onSelect(node.noteId);
                  }}
                  onKeyDown={(event) => onKeyActivate(event, node.noteId)}
                  onPointerDown={(event) => onNodePointerDown(event, node)}
                  onMouseEnter={() => setHoveredId(node.noteId)}
                  onMouseLeave={() => setHoveredId((current) => (current === node.noteId ? null : current))}
                  style={canDrag ? { cursor: drag?.moved ? "grabbing" : "grab" } : undefined}
                >
                  {selected || dropOk ? <circle className="notes-link-dendrogram-ring" r={radius + 5} /> : null}
                  <circle className="notes-link-dendrogram-dot" r={radius} />
                  <text
                    className="notes-link-dendrogram-label"
                    y={node.isRoot || !node.isLeaf ? -14 : 20}
                    textAnchor="middle"
                    dominantBaseline={node.isRoot || !node.isLeaf ? "auto" : "hanging"}
                  >
                    {truncateLabel(node.title || node.filename, node.isRoot ? 24 : 18)}
                  </text>
                  <title>{fullTitle}{canDrag ? " · drag to reparent" : ""}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {layout.truncated && truncatedHint ? (
        <p className="muted notes-link-dendrogram-truncated">{truncatedHint}</p>
      ) : null}
      {drag?.moved ? (
        <div
          className={`notes-link-dendrogram-ghost${drag.dropValid ? " is-valid" : " is-invalid"}`}
          style={{ left: drag.ghostX, top: drag.ghostY }}
          aria-hidden="true"
        >
          <span className="notes-link-dendrogram-ghost-dot" />
          <span className="notes-link-dendrogram-ghost-label">{truncateLabel(drag.title, 20)}</span>
        </div>
      ) : null}
    </div>
  );
}
