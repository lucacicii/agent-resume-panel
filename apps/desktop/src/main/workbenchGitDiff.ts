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

export type GitDiffLineSide = "additions" | "deletions";

export interface GitDiffLineTarget {
  side: GitDiffLineSide;
  lineNumber: number;
}

type ParsedGitDiffHunk = GitDiffHunk & {
  patch: string;
  fileHeader: string;
  bodyLines: string[];
};

type ParsedGitDiffBodyLine = {
  raw: string;
  kind: "context" | "addition" | "deletion" | "metadata";
  oldBefore: number;
  newBefore: number;
  oldLine?: number;
  newLine?: number;
};

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)?$/;
const LINE_PATCH_CONTEXT = 3;

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
    while (bodyLines.at(-1) === "") bodyLines.pop();
    const body = `${bodyLines.join("\n")}\n`;
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
      patch: `${fileHeader}${header}\n${body}`,
      fileHeader,
      bodyLines
    };
  });
}

function parseGitDiffBodyLines(hunk: ParsedGitDiffHunk): ParsedGitDiffBodyLine[] {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return hunk.bodyLines.map((raw) => {
    const oldBefore = oldLine;
    const newBefore = newLine;
    if (raw.startsWith(" ")) {
      oldLine += 1;
      newLine += 1;
      return { raw, kind: "context", oldBefore, newBefore, oldLine: oldBefore, newLine: newBefore };
    }
    if (raw.startsWith("-")) {
      oldLine += 1;
      return { raw, kind: "deletion", oldBefore, newBefore, oldLine: oldBefore };
    }
    if (raw.startsWith("+")) {
      newLine += 1;
      return { raw, kind: "addition", oldBefore, newBefore, newLine: newBefore };
    }
    if (raw.startsWith("\\")) return { raw, kind: "metadata", oldBefore, newBefore };
    throw new Error("无法解析 Git hunk 内容");
  });
}

/** Build a minimal patch for the contiguous change block containing one changed line. */
export function findGitDiffLinePatch(patch: string, target: GitDiffLineTarget): string | undefined {
  const targetKind = target.side === "additions" ? "addition" : "deletion";
  for (const hunk of parseGitDiffHunks(patch)) {
    const lines = parseGitDiffBodyLines(hunk);
    const targetIndex = lines.findIndex((line) => line.kind === targetKind && (
      target.side === "additions" ? line.newLine === target.lineNumber : line.oldLine === target.lineNumber
    ));
    if (targetIndex < 0) continue;

    let changeStart = targetIndex;
    while (changeStart > 0 && lines[changeStart - 1]?.kind !== "context") changeStart -= 1;
    let changeEnd = targetIndex + 1;
    while (changeEnd < lines.length && lines[changeEnd]?.kind !== "context") changeEnd += 1;

    let sliceStart = changeStart;
    let leadingContext = 0;
    while (sliceStart > 0 && leadingContext < LINE_PATCH_CONTEXT && lines[sliceStart - 1]?.kind === "context") {
      sliceStart -= 1;
      leadingContext += 1;
    }
    let sliceEnd = changeEnd;
    let trailingContext = 0;
    while (sliceEnd < lines.length && trailingContext < LINE_PATCH_CONTEXT && lines[sliceEnd]?.kind === "context") {
      sliceEnd += 1;
      trailingContext += 1;
    }

    const selected = lines.slice(sliceStart, sliceEnd);
    const oldStart = selected[0]?.oldBefore ?? hunk.oldStart;
    const newStart = selected[0]?.newBefore ?? hunk.newStart;
    const oldLines = selected.reduce((count, line) => count + Number(line.kind === "context" || line.kind === "deletion"), 0);
    const newLines = selected.reduce((count, line) => count + Number(line.kind === "context" || line.kind === "addition"), 0);
    const header = `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
    return `${hunk.fileHeader}${header}\n${selected.map((line) => line.raw).join("\n")}\n`;
  }
  return undefined;
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
  return parseGitDiffHunks(patch).map((hunk) => ({
    key: hunk.key,
    header: hunk.header,
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines
  }));
}
