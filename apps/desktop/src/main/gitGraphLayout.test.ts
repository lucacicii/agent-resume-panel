import { describe, expect, it } from "vitest";
import { buildGitGraphLayout, type GitGraphCommitInput } from "./gitGraphLayout";

function commit(
  hash: string,
  parents: string[],
  extras: Partial<GitGraphCommitInput> = {}
): GitGraphCommitInput {
  return { hash, parents, ...extras };
}

describe("buildGitGraphLayout", () => {
  it("returns an empty single-column layout", () => {
    const layout = buildGitGraphLayout([]);
    expect(layout.rows).toEqual([]);
    expect(layout.maxColumns).toBe(1);
    expect(layout.laneWidth).toBe(14);
    expect(layout.rowHeight).toBe(52);
  });

  it("keeps a linear history on one column", () => {
    const layout = buildGitGraphLayout([
      commit("a", ["b"]),
      commit("b", ["c"]),
      commit("c", [])
    ]);
    expect(layout.rows.map((row) => row.commitColumn)).toEqual([0, 0, 0]);
    expect(layout.rows[0].outgoingTracks).toEqual([0]);
    expect(layout.rows[1].incomingTracks).toEqual([0]);
    expect(layout.rows[1].outgoingTracks).toEqual([0]);
    expect(layout.rows[2].incomingTracks).toEqual([0]);
    expect(layout.rows[2].outgoingTracks).toEqual([]);
    expect(layout.rows.every((row) => row.curves.length === 0)).toBe(true);
    expect(layout.maxColumns).toBe(1);
  });

  it("opens a second lane for a merge parent", () => {
    const layout = buildGitGraphLayout([
      commit("m", ["a", "b"]),
      commit("a", ["c"]),
      commit("b", ["c"]),
      commit("c", [])
    ]);
    expect(layout.rows[0].commitColumn).toBe(0);
    expect(layout.rows[0].outgoingTracks).toEqual([0, 1]);
    expect(layout.rows[0].curves).toEqual([
      { fromCol: 0, toCol: 1, side: "right", colorIndex: 1 }
    ]);
    expect(layout.rows[1].commitColumn).toBe(0);
    expect(layout.rows[1].incomingTracks).toEqual([0, 1]);
    expect(layout.rows[2].commitColumn).toBe(1);
    expect(layout.rows[2].curves).toEqual([
      { fromCol: 1, toCol: 0, side: "left", colorIndex: 1 }
    ]);
    expect(layout.rows[3].commitColumn).toBe(0);
    expect(layout.rows[3].outgoingTracks).toEqual([]);
    expect(layout.maxColumns).toBe(2);
  });

  it("joins a later child into an already reserved parent lane", () => {
    const layout = buildGitGraphLayout([
      commit("a", ["c"]),
      commit("b", ["c"]),
      commit("c", [])
    ]);
    expect(layout.rows[0].commitColumn).toBe(0);
    expect(layout.rows[1].commitColumn).toBe(1);
    expect(layout.rows[1].incomingTracks).toEqual([0]);
    expect(layout.rows[1].curves).toEqual([
      { fromCol: 1, toCol: 0, side: "left", colorIndex: 1 }
    ]);
    expect(layout.rows[2].commitColumn).toBe(0);
  });

  it("ignores parents that are not in the visible commit list", () => {
    const layout = buildGitGraphLayout([commit("a", ["missing"])]);
    expect(layout.rows).toHaveLength(1);
    expect(layout.rows[0].commitColumn).toBe(0);
    expect(layout.rows[0].outgoingTracks).toEqual([]);
    expect(layout.rows[0].curves).toEqual([]);
  });

  it("marks HEAD from decorations or refs and truncates lane labels", () => {
    const layout = buildGitGraphLayout([
      commit("a", ["b"], {
        decorations: "HEAD -> main",
        refs: { heads: ["very-long-branch-name"], isHead: true, primaryLabel: "very-long-branch-name" }
      }),
      commit("b", [], {
        refs: { heads: [], isHead: false, primaryLabel: "origin/main" }
      })
    ]);
    expect(layout.rows[0].isHead).toBe(true);
    expect(layout.rows[0].laneLabel).toBe("very-long-branc…");
    expect(layout.rows[0].laneLabelColorIndex).toBe(layout.rows[0].colorIndex);
    expect(layout.rows[1].isHead).toBe(false);
    expect(layout.rows[1].laneLabel).toBeUndefined();
  });
});
