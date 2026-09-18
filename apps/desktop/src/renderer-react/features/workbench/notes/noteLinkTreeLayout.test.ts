import { describe, expect, it } from "vitest";
import { edgePath, layoutNoteTree, type LayoutTreeNode } from "./noteLinkTreeLayout";

function node(id: string, title: string, children: LayoutTreeNode[] = []): LayoutTreeNode {
  return { noteId: id, title, filename: `${id}.md`, children };
}

describe("layoutNoteTree (d3-hierarchy)", () => {
  it("centers a single root with finite coordinates", () => {
    const layout = layoutNoteTree(node("a", "Root"));
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toHaveLength(0);
    expect(Number.isFinite(layout.nodes[0].x)).toBe(true);
    expect(layout.nodes[0].y).toBeGreaterThan(0);
    expect(layout.nodes[0].isRoot).toBe(true);
    expect(layout.nodes[0].isLeaf).toBe(true);
  });

  it("fans siblings under a parent via d3 tree()", () => {
    const layout = layoutNoteTree(
      node("root", "Root", [node("b", "B"), node("c", "C"), node("d", "D")])
    );
    expect(layout.nodes).toHaveLength(4);
    expect(layout.edges).toHaveLength(3);
    const root = layout.nodes.find((n) => n.noteId === "root")!;
    const leaves = layout.nodes.filter((n) => n.depth === 1);
    expect(leaves).toHaveLength(3);
    const xs = leaves.map((n) => n.x).sort((a, b) => a - b);
    expect(xs[0]).toBeLessThan(xs[2]);
    // d3 tree centers parent over children
    const mid = (xs[0] + xs[2]) / 2;
    expect(Math.abs(root.x - mid)).toBeLessThan(2);
    // edges include d3-shape paths
    expect(layout.edges.every((e) => e.path.startsWith("M"))).toBe(true);
  });

  it("lays out a deep chain top to bottom", () => {
    const layout = layoutNoteTree(node("a", "A", [node("b", "B", [node("c", "C")])]));
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.noteId, n]));
    expect(byId.a.y).toBeLessThan(byId.b.y);
    expect(byId.b.y).toBeLessThan(byId.c.y);
    expect(layout.edges).toHaveLength(2);
  });

  it("truncates oversized trees before hierarchy", () => {
    const many = Array.from({ length: 30 }, (_, i) => node(`c${i}`, `C${i}`));
    const layout = layoutNoteTree(node("root", "Root", many), { maxNodes: 10 });
    expect(layout.truncated).toBe(true);
    expect(layout.nodeCount).toBeLessThanOrEqual(10);
  });

  it("edgePath uses d3 path when available", () => {
    const layout = layoutNoteTree(node("a", "A", [node("b", "B")]));
    const edge = layout.edges[0];
    expect(edgePath(edge)).toBe(edge.path);
    expect(edgePath(edge).includes("C")).toBe(true);
  });
});
