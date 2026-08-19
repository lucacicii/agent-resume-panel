/**
 * Original git-log lane layout for the Workbench history gutter.
 *
 * Newest-first commits are placed onto sparse columns. A reserved lane remembers
 * which parent hash should next occupy that column. First parents continue the
 * current column; additional visible parents open or join other columns.
 */

export interface GitGraphCommitRefs {
  heads: string[];
  isHead: boolean;
  primaryLabel: string | null;
}

export interface GitGraphCommitInput {
  hash: string;
  parents: string[];
  decorations?: string;
  refs?: GitGraphCommitRefs;
}

export interface GitGraphCurve {
  fromCol: number;
  toCol: number;
  side: "left" | "right";
  colorIndex: number;
}

export interface GitGraphRow {
  index: number;
  commitColumn?: number;
  incomingTracks: number[];
  outgoingTracks: number[];
  curves: GitGraphCurve[];
  colorIndex: number;
  isHead: boolean;
  laneLabel?: string;
  laneLabelColorIndex?: number;
}

export interface GitGraphLayout {
  laneWidth: number;
  rowHeight: number;
  maxColumns: number;
  columnColors: number[];
  rows: GitGraphRow[];
}

const LANE_WIDTH = 14;
const ROW_HEIGHT = 52;
const LANE_LABEL_MAX = 16;
const COLOR_COUNT = 8;

type Lane = { hash: string; color: number };

function firstEmptyColumn(lanes: Array<Lane | null>): number {
  const hole = lanes.findIndex((lane) => lane === null);
  return hole === -1 ? lanes.length : hole;
}

function indexOfHash(lanes: Array<Lane | null>, hash: string): number {
  return lanes.findIndex((lane) => lane?.hash === hash);
}

function activeColumns(lanes: Array<Lane | null>): number[] {
  const columns: number[] = [];
  for (let i = 0; i < lanes.length; i++) {
    if (lanes[i]) columns.push(i);
  }
  return columns;
}

function curveSide(fromCol: number, toCol: number): "left" | "right" {
  return fromCol > toCol ? "left" : "right";
}

function uniqueVisibleParents(parents: string[], visible: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const parent of parents) {
    if (!visible.has(parent) || seen.has(parent)) continue;
    seen.add(parent);
    out.push(parent);
  }
  return out;
}

function isHeadCommit(commit: GitGraphCommitInput): boolean {
  return Boolean(commit.refs?.isHead) || /\bHEAD\b/.test(commit.decorations || "");
}

function resolveLaneLabel(refs?: GitGraphCommitRefs): string | undefined {
  if (!refs?.primaryLabel) return undefined;
  if (refs.heads.length === 0 && !refs.isHead) return undefined;
  if (refs.primaryLabel.length <= LANE_LABEL_MAX) return refs.primaryLabel;
  return `${refs.primaryLabel.slice(0, LANE_LABEL_MAX - 1)}…`;
}

function pushCurve(
  curves: GitGraphCurve[],
  fromCol: number,
  toCol: number,
  colorIndex: number
): void {
  if (fromCol === toCol) return;
  curves.push({
    fromCol,
    toCol,
    side: curveSide(fromCol, toCol),
    colorIndex
  });
}

export function buildGitGraphLayout(commits: GitGraphCommitInput[]): GitGraphLayout {
  if (commits.length === 0) {
    return {
      laneWidth: LANE_WIDTH,
      rowHeight: ROW_HEIGHT,
      maxColumns: 1,
      columnColors: [],
      rows: []
    };
  }

  const visible = new Set(commits.map((commit) => commit.hash));
  const lanes: Array<Lane | null> = [];
  const columnColors: number[] = [];
  const rows: GitGraphRow[] = [];
  let nextColor = 0;

  const takeColor = (): number => {
    const color = nextColor % COLOR_COUNT;
    nextColor += 1;
    return color;
  };

  const ensureColumn = (column: number): void => {
    while (lanes.length <= column) lanes.push(null);
  };

  for (let index = 0; index < commits.length; index++) {
    const commit = commits[index];
    const incomingFromAbove = activeColumns(lanes);

    let commitColumn = indexOfHash(lanes, commit.hash);
    let colorIndex: number;
    if (commitColumn < 0) {
      commitColumn = firstEmptyColumn(lanes);
      ensureColumn(commitColumn);
      colorIndex = takeColor();
    } else {
      colorIndex = lanes[commitColumn]!.color;
    }

    lanes[commitColumn] = null;

    const curves: GitGraphCurve[] = [];
    const parents = uniqueVisibleParents(commit.parents, visible);

    if (parents.length > 0) {
      const firstParent = parents[0];
      const existingFirst = indexOfHash(lanes, firstParent);
      if (existingFirst >= 0) {
        pushCurve(curves, commitColumn, existingFirst, colorIndex);
      } else {
        lanes[commitColumn] = { hash: firstParent, color: colorIndex };
      }

      for (const parent of parents.slice(1)) {
        const existing = indexOfHash(lanes, parent);
        if (existing >= 0) {
          pushCurve(curves, commitColumn, existing, colorIndex);
          continue;
        }
        const branchColumn = firstEmptyColumn(lanes);
        ensureColumn(branchColumn);
        const branchColor = takeColor();
        lanes[branchColumn] = { hash: parent, color: branchColor };
        columnColors[branchColumn] = branchColor;
        pushCurve(curves, commitColumn, branchColumn, branchColor);
      }
    }

    const outgoingTracks = activeColumns(lanes);
    const incoming = new Set(incomingFromAbove);
    if (outgoingTracks.includes(commitColumn)) incoming.add(commitColumn);
    const incomingTracks = [...incoming].sort((a, b) => a - b);

    columnColors[commitColumn] = colorIndex;
    for (let column = 0; column < lanes.length; column++) {
      const lane = lanes[column];
      if (lane) columnColors[column] = lane.color;
    }

    const laneLabel = resolveLaneLabel(commit.refs);
    rows.push({
      index,
      commitColumn,
      incomingTracks,
      outgoingTracks,
      curves,
      colorIndex,
      isHead: isHeadCommit(commit),
      ...(laneLabel ? { laneLabel, laneLabelColorIndex: colorIndex } : {})
    });
  }

  let maxColumn = -1;
  for (const row of rows) {
    maxColumn = Math.max(
      maxColumn,
      row.commitColumn ?? -1,
      ...row.incomingTracks,
      ...row.outgoingTracks,
      ...row.curves.flatMap((curve) => [curve.fromCol, curve.toCol])
    );
  }
  const maxColumns = Math.max(1, maxColumn + 1);

  return {
    laneWidth: LANE_WIDTH,
    rowHeight: ROW_HEIGHT,
    maxColumns,
    columnColors,
    rows
  };
}
