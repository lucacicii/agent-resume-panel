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
  /** Double-click label rename; omit to disable. */
  onRename?: (noteId: string, newTitle: string) => void | Promise<void>;
  /** Tree root note id — not draggable in v1. */
  treeRootId?: string;
  detachLabel?: string;
  renameAriaLabel?: string;
  /** Context menu on a node; omit to disable. Receives noteId + screen coords. */
  onContextMenu?: (noteId: string, clientX: number, clientY: number) => void;
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

type RenameState = {
  noteId: string;
  value: string;
  original: string;
  left: number;
  top: number;
  width: number;
};

function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

function displayName(node: Pick<LaidOutNode, "title" | "filename">): string {
  if (node.title?.trim()) return node.title.trim();
  return node.filename.replace(/\.md$/i, "") || node.filename;
}

function labelYOffset(node: LaidOutNode): number {
  return node.isRoot || !node.isLeaf ? -14 : 20;
}

export function NoteLinkTree({
  root,
  selectedNoteId,
  aliases = {},
  onSelect,
  truncatedHint,
  onReparent,
  onRename,
  treeRootId,
  detachLabel,
  renameAriaLabel,
  onContextMenu
}: NoteLinkTreeProps): JSX.Element {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const renameRef = useRef<RenameState | null>(null);
  const skipBlurCommitRef = useRef(false);
  dragRef.current = drag;
  renameRef.current = rename;

  const layout = useMemo(() => layoutNoteTree(root), [root]);
  const rootId = treeRootId || root.noteId;
  const dragEnabled = typeof onReparent === "function";
  const renameEnabled = typeof onRename === "function";

  const projectLabel = (projectPath?: string) => {
    if (!projectPath) return "";
    return aliases[projectPath] || basename(projectPath);
  };

  const onKeyActivate = (event: KeyboardEvent, noteId: string) => {
    if (rename) return;
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
      if (renameRef.current) return;
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
      if (renameRef.current) {
        setDrag(null);
        return;
      }
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

  const beginRename = useCallback((node: LaidOutNode) => {
    if (!onRename) return;
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const labelY = labelYOffset(node);
    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const pt = svg.createSVGPoint();
    pt.x = node.x;
    pt.y = node.y + labelY;
    const screen = pt.matrixTransform(ctm);
    const crect = container.getBoundingClientRect();
    const name = displayName(node);
    const approxWidth = Math.max(120, Math.min(240, name.length * 8 + 24));

    setDrag(null);
    setRename({
      noteId: node.noteId,
      value: name,
      original: name,
      left: screen.x - crect.left,
      top: screen.y - crect.top,
      width: approxWidth
    });
  }, [onRename]);

  const cancelRename = useCallback(() => {
    skipBlurCommitRef.current = true;
    renameRef.current = null;
    setRename(null);
  }, []);

  const commitRename = useCallback(async () => {
    const current = renameRef.current;
    renameRef.current = null;
    setRename(null);
    if (!current || !onRename) {
      return;
    }
    const next = current.value.trim();
    if (!next || next === current.original) {
      return;
    }
    try {
      await onRename(current.noteId, next);
    } catch {
      // Parent surfaces errors via status.
    }
  }, [onRename]);

  useEffect(() => {
    if (!rename) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [rename?.noteId]);

  const onNodePointerDown = (event: ReactPointerEvent, node: LaidOutNode) => {
    if (renameRef.current) return;
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

  const onNodeDoubleClick = (event: React.MouseEvent, node: LaidOutNode) => {
    if (!renameEnabled) return;
    if (drag?.moved) return;
    event.preventDefault();
    event.stopPropagation();
    beginRename(node);
  };

  return (
    <div
      ref={containerRef}
      className={[
        "notes-link-dendrogram",
        drag?.moved ? "is-dragging" : "",
        rename ? "is-renaming" : ""
      ].filter(Boolean).join(" ")}
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
              const canDrag = dragEnabled && node.noteId !== rootId && !rename;
              const isEditing = rename?.noteId === node.noteId;
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
                    canDrag ? "is-draggable" : "",
                    isEditing ? "is-renaming" : "",
                    renameEnabled ? "is-renameable" : ""
                  ].filter(Boolean).join(" ")}
                  transform={`translate(${node.x} ${node.y})`}
                  role="treeitem"
                  tabIndex={0}
                  aria-label={fullTitle}
                  aria-selected={selected}
                  data-note-id={node.noteId}
                  onClick={() => {
                    if (renameRef.current) return;
                    // Draggable nodes select on pointerup; root (non-draggable) still uses click.
                    if (dragEnabled && node.noteId !== rootId) return;
                    onSelect(node.noteId);
                  }}
                  onDoubleClick={(event) => onNodeDoubleClick(event, node)}
                  onKeyDown={(event) => onKeyActivate(event, node.noteId)}
                  onPointerDown={(event) => onNodePointerDown(event, node)}
                  onContextMenu={(event) => {
                    if (!onContextMenu || renameRef.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu(node.noteId, event.clientX, event.clientY);
                  }}
                  onMouseEnter={() => setHoveredId(node.noteId)}
                  onMouseLeave={() => setHoveredId((current) => (current === node.noteId ? null : current))}
                  style={canDrag ? { cursor: drag?.moved ? "grabbing" : "grab" } : undefined}
                >
                  {selected || dropOk ? <circle className="notes-link-dendrogram-ring" r={radius + 5} /> : null}
                  <circle className="notes-link-dendrogram-dot" r={radius} />
                  {!isEditing ? (
                    <text
                      className="notes-link-dendrogram-label"
                      y={labelYOffset(node)}
                      textAnchor="middle"
                      dominantBaseline={node.isRoot || !node.isLeaf ? "auto" : "hanging"}
                    >
                      {truncateLabel(node.title || node.filename, node.isRoot ? 24 : 18)}
                    </text>
                  ) : null}
                  <title>
                    {fullTitle}
                    {renameEnabled ? " · double-click to rename" : ""}
                    {canDrag ? " · drag to reparent" : ""}
                  </title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      {layout.truncated && truncatedHint ? (
        <p className="muted notes-link-dendrogram-truncated">{truncatedHint}</p>
      ) : null}
      {rename ? (
        <input
          ref={renameInputRef}
          className="notes-link-dendrogram-rename-input"
          data-testid="notes-link-rename-input"
          style={{
            left: rename.left,
            top: rename.top,
            width: rename.width
          }}
          value={rename.value}
          aria-label={renameAriaLabel || "Rename note"}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setRename((current) => current ? { ...current, value: event.target.value } : current)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              skipBlurCommitRef.current = true;
              void commitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelRename();
            }
          }}
          onBlur={() => {
            if (skipBlurCommitRef.current) {
              skipBlurCommitRef.current = false;
              return;
            }
            void commitRename();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        />
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
