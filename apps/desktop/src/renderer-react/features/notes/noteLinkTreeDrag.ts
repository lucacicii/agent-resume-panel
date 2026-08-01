import type { LaidOutEdge, LaidOutNode } from "./noteLinkTreeLayout";

export const DRAG_THRESHOLD_PX = 4;
export const DROP_HIT_RADIUS_PX = 28;

export type DropKind = "node" | "detach" | "none";

export type DropTarget =
  | { kind: "node"; noteId: string; valid: boolean }
  | { kind: "detach"; valid: boolean }
  | { kind: "none"; valid: false };

/** Child ids keyed by parent from layout edges. */
export function childrenByParent(edges: LaidOutEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.parentNoteId) ?? [];
    list.push(edge.childNoteId);
    map.set(edge.parentNoteId, list);
  }
  return map;
}

export function parentByChild(edges: LaidOutEdge[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const edge of edges) {
    map.set(edge.childNoteId, edge.parentNoteId);
  }
  return map;
}

/** All descendants of `rootId` (not including rootId). */
export function collectDescendantIds(edges: LaidOutEdge[], rootId: string): Set<string> {
  const byParent = childrenByParent(edges);
  const out = new Set<string>();
  const stack = [...(byParent.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of byParent.get(id) ?? []) {
      stack.push(child);
    }
  }
  return out;
}

/**
 * Whether dropping `draggedId` onto `dropParentId` is a valid reparent.
 * - null parent = detach (valid for any non-root drag source checked by caller)
 * - cannot drop on self or own descendants (cycle)
 * - drop on current parent is no-op (invalid for highlight purposes)
 */
export function isValidReparent(
  edges: LaidOutEdge[],
  draggedId: string,
  dropParentId: string | null
): boolean {
  if (dropParentId === null) {
    // Detach is valid if the node currently has a parent in this tree.
    return parentByChild(edges).has(draggedId);
  }
  if (dropParentId === draggedId) {
    return false;
  }
  if (parentByChild(edges).get(draggedId) === dropParentId) {
    return false;
  }
  const descendants = collectDescendantIds(edges, draggedId);
  if (descendants.has(dropParentId)) {
    return false;
  }
  return true;
}

export function hitTestNode(
  nodes: LaidOutNode[],
  svgX: number,
  svgY: number,
  radius = DROP_HIT_RADIUS_PX
): LaidOutNode | null {
  let best: LaidOutNode | null = null;
  let bestDist = radius;
  for (const node of nodes) {
    const dx = node.x - svgX;
    const dy = node.y - svgY;
    const dist = Math.hypot(dx, dy);
    if (dist <= bestDist) {
      bestDist = dist;
      best = node;
    }
  }
  return best;
}

export function clientToSvgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) {
    const rect = svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }
  const local = pt.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}
