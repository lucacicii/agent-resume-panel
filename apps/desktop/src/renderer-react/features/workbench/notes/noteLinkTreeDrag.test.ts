import { describe, expect, it } from "vitest";
import type { LaidOutEdge } from "./noteLinkTreeLayout";
import { collectDescendantIds, isValidReparent } from "./noteLinkTreeDrag";

function edge(parent: string, child: string): LaidOutEdge {
  return {
    parentNoteId: parent,
    childNoteId: child,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    path: ""
  };
}

describe("noteLinkTreeDrag", () => {
  const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d")];
  // a
  // ├ b
  // │ └ d
  // └ c

  it("collects descendants", () => {
    expect([...collectDescendantIds(edges, "a")].sort()).toEqual(["b", "c", "d"]);
    expect([...collectDescendantIds(edges, "b")].sort()).toEqual(["d"]);
    expect(collectDescendantIds(edges, "c").size).toBe(0);
  });

  it("rejects self and descendant drops", () => {
    expect(isValidReparent(edges, "b", "b")).toBe(false);
    expect(isValidReparent(edges, "b", "d")).toBe(false); // cycle
    expect(isValidReparent(edges, "a", "d")).toBe(false); // a has no parent in edges as drag of root handled elsewhere
  });

  it("rejects drop on current parent (no-op)", () => {
    expect(isValidReparent(edges, "b", "a")).toBe(false);
  });

  it("allows reparent to another branch", () => {
    expect(isValidReparent(edges, "d", "c")).toBe(true);
    expect(isValidReparent(edges, "c", "b")).toBe(true);
  });

  it("allows detach when node has a parent", () => {
    expect(isValidReparent(edges, "b", null)).toBe(true);
    expect(isValidReparent(edges, "a", null)).toBe(false); // root has no parent edge
  });
});
