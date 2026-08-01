import { hierarchy, tree, type HierarchyPointLink, type HierarchyPointNode } from "d3-hierarchy";
import { linkVertical } from "d3-shape";

export type LayoutTreeNode = {
  noteId: string;
  title: string;
  filename: string;
  projectPath?: string;
  children: LayoutTreeNode[];
};

export type LaidOutNode = {
  noteId: string;
  title: string;
  filename: string;
  projectPath?: string;
  x: number;
  y: number;
  depth: number;
  isLeaf: boolean;
  isRoot: boolean;
  childCount: number;
};

export type LaidOutEdge = {
  parentNoteId: string;
  childNoteId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** SVG path from d3-shape linkVertical */
  path: string;
};

export type NoteTreeLayout = {
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  truncated: boolean;
  nodeCount: number;
};

export type LayoutOptions = {
  /** Horizontal separation between sibling columns (px). */
  nodeGap?: number;
  /** Vertical gap between tree levels (px). */
  levelGap?: number;
  paddingX?: number;
  paddingY?: number;
  maxNodes?: number;
};

function countNodes(root: LayoutTreeNode, limit: number): { count: number; truncated: boolean } {
  let count = 0;
  let truncated = false;
  const walk = (node: LayoutTreeNode): void => {
    if (count >= limit) {
      truncated = true;
      return;
    }
    count += 1;
    for (const child of node.children) {
      if (count >= limit) {
        truncated = true;
        return;
      }
      walk(child);
    }
  };
  walk(root);
  return { count, truncated };
}

/** Truncate tree depth-first so layout stays bounded. */
function truncateTree(root: LayoutTreeNode, maxNodes: number): LayoutTreeNode {
  if (maxNodes < 1) {
    return { ...root, children: [] };
  }
  let remaining = maxNodes;
  const clone = (node: LayoutTreeNode): LayoutTreeNode | null => {
    if (remaining <= 0) {
      return null;
    }
    remaining -= 1;
    const children: LayoutTreeNode[] = [];
    for (const child of node.children) {
      if (remaining <= 0) {
        break;
      }
      const next = clone(child);
      if (next) {
        children.push(next);
      }
    }
    return {
      noteId: node.noteId,
      title: node.title,
      filename: node.filename,
      projectPath: node.projectPath,
      children
    };
  };
  return clone(root) ?? { ...root, children: [] };
}

const verticalLink = linkVertical<HierarchyPointLink<LayoutTreeNode>, HierarchyPointNode<LayoutTreeNode>>()
  .x((d) => d.x)
  .y((d) => d.y);

/**
 * Top-down tree layout via d3-hierarchy `tree()` + d3-shape `linkVertical()`.
 * Output shape stays stable for NoteLinkTree rendering.
 */
export function layoutNoteTree(root: LayoutTreeNode, options: LayoutOptions = {}): NoteTreeLayout {
  const nodeGap = options.nodeGap ?? 88;
  const levelGap = options.levelGap ?? 76;
  const paddingX = options.paddingX ?? 64;
  const paddingY = options.paddingY ?? 36;
  const maxNodes = options.maxNodes ?? 120;

  const { truncated: wouldTruncate } = countNodes(root, maxNodes + 1);
  const data = wouldTruncate ? truncateTree(root, maxNodes) : root;
  const truncated = wouldTruncate;

  const rootHierarchy = hierarchy(data, (d) => d.children);
  // nodeSize: [dx, dy] — dx is sibling spacing (x), dy is level spacing (y) for vertical tree.
  const treeLayout = tree<LayoutTreeNode>()
    .nodeSize([nodeGap, levelGap])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.15));

  const laid = treeLayout(rootHierarchy);

  // d3 tree places root at (0,0); shift into positive padded space.
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  laid.each((node) => {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  });
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
  }

  const shiftX = paddingX - minX;
  const shiftY = paddingY;

  const nodes: LaidOutNode[] = [];
  laid.each((node) => {
    const d = node.data;
    nodes.push({
      noteId: d.noteId,
      title: d.title,
      filename: d.filename,
      projectPath: d.projectPath,
      x: node.x + shiftX,
      y: node.y + shiftY,
      depth: node.depth,
      isLeaf: !node.children?.length,
      isRoot: node.depth === 0,
      childCount: node.children?.length ?? 0
    });
  });

  const edges: LaidOutEdge[] = (laid.links() as HierarchyPointLink<LayoutTreeNode>[]).map((link) => {
    const shifted: HierarchyPointLink<LayoutTreeNode> = {
      source: {
        ...link.source,
        x: link.source.x + shiftX,
        y: link.source.y + shiftY
      } as HierarchyPointNode<LayoutTreeNode>,
      target: {
        ...link.target,
        x: link.target.x + shiftX,
        y: link.target.y + shiftY
      } as HierarchyPointNode<LayoutTreeNode>
    };
    const path = verticalLink(shifted) ?? "";
    return {
      parentNoteId: link.source.data.noteId,
      childNoteId: link.target.data.noteId,
      x1: link.source.x + shiftX,
      y1: link.source.y + shiftY,
      x2: link.target.x + shiftX,
      y2: link.target.y + shiftY,
      path
    };
  });

  const contentWidth = Math.max(nodeGap, maxX - minX);
  const contentHeight = Math.max(levelGap * 0.5, maxY);
  const width = paddingX * 2 + contentWidth + 56;
  // Extra bottom pad so leaf titles under nodes are not clipped by the scroll box.
  const height = paddingY * 2 + contentHeight + (maxY === 0 ? 40 : 64);

  return {
    width,
    height,
    nodes,
    edges,
    truncated,
    nodeCount: nodes.length
  };
}

/** Prefer d3 path when present; fall back to cubic vertical bezier. */
export function edgePath(edge: LaidOutEdge): string {
  if (edge.path) {
    return edge.path;
  }
  const midY = (edge.y1 + edge.y2) / 2;
  return `M ${edge.x1} ${edge.y1} C ${edge.x1} ${midY}, ${edge.x2} ${midY}, ${edge.x2} ${edge.y2}`;
}

export function truncateLabel(text: string, maxChars = 18): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(1, maxChars - 1))}…`;
}
