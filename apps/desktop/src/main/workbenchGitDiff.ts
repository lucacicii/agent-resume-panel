export interface GitDiffHunk {
  key: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface GitDiffHunkTarget {
  key?: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

type ParsedGitDiffHunk = GitDiffHunk & { patch: string };

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)?$/;

function hunkKey(oldStart: number, oldLines: number, newStart: number, newLines: number, body: string): string {
  return `${oldStart}:${oldLines}:${newStart}:${newLines}:${body}`;
}

/** Parse the file hunks from a text Git patch without interpreting file contents. */
export function parseGitDiffHunks(patch: string): ParsedGitDiffHunk[] {
  const lines = patch.split("\n");
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (HUNK_HEADER_PATTERN.test(lines[index] || "")) starts.push(index);
  }
  if (!starts.length) return [];

  const fileHeader = lines.slice(0, starts[0]).join("\n").replace(/\n*$/, "\n");
  return starts.map((start, hunkIndex) => {
    const header = lines[start] || "";
    const match = HUNK_HEADER_PATTERN.exec(header);
    if (!match) throw new Error("无法解析 Git hunk 头");
    const end = starts[hunkIndex + 1] ?? lines.length;
    const bodyLines = lines.slice(start + 1, end);
    const body = bodyLines.join("\n").replace(/\n*$/, "\n");
    const oldStart = Number(match[1]);
    const oldLines = Number(match[2] || "1");
    const newStart = Number(match[3]);
    const newLines = Number(match[4] || "1");
    return {
      key: hunkKey(oldStart, oldLines, newStart, newLines, body),
      header,
      oldStart,
      oldLines,
      newStart,
      newLines,
      patch: `${fileHeader}${header}\n${body}`
    };
  });
}

export function findGitDiffHunk(
  patch: string,
  target: GitDiffHunkTarget
): ParsedGitDiffHunk | undefined {
  const hunks = parseGitDiffHunks(patch);
  return hunks.find((hunk) => (
    (target.key ? hunk.key === target.key : true)
    && hunk.oldStart === target.oldStart
    && hunk.oldLines === target.oldLines
    && hunk.newStart === target.newStart
    && hunk.newLines === target.newLines
  ));
}

export function toGitDiffHunkMetadata(patch: string): GitDiffHunk[] {
  return parseGitDiffHunks(patch).map(({ patch: _patch, ...hunk }) => hunk);
}
