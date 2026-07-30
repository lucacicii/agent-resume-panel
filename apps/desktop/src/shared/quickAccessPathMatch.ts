export interface FuzzyPathMatch {
  score: number;
  indices: number[];
}

export interface QuickAccessPathCandidate {
  path: string;
  relativePath: string;
  kind?: "file" | "directory";
}

export type MatchedQuickAccessPath<T extends QuickAccessPathCandidate = QuickAccessPathCandidate> = T & FuzzyPathMatch;

export function normalizeQuickAccessQuery(query: string): string {
  return query
    .trim()
    .replace(/^(?:"|')|(?:"|')$/g, "")
    .replace(/\\/g, "/")
    .toLocaleLowerCase()
    .replace(/\s+/g, "");
}

export function fuzzyMatchPath(candidate: string, query: string): FuzzyPathMatch | null {
  const needle = normalizeQuickAccessQuery(query);
  if (!needle) return { score: 0, indices: [] };
  const original = candidate.replace(/\\/g, "/");
  const haystack = original.toLocaleLowerCase();
  const basenameStart = haystack.lastIndexOf("/") + 1;
  const basename = haystack.slice(basenameStart);
  const indices: number[] = [];
  let cursor = 0;
  let score = 0;

  for (const character of needle) {
    const index = haystack.indexOf(character, cursor);
    if (index < 0) return null;
    const previous = indices[indices.length - 1];
    const consecutive = previous !== undefined && index === previous + 1;
    const segmentStart = index === 0 || haystack[index - 1] === "/" || haystack[index - 1] === "-" || haystack[index - 1] === "_" || haystack[index - 1] === ".";
    const camelStart = index > 0 && /[a-z0-9]/.test(original[index - 1]) && /[A-Z]/.test(original[index]);
    score += 4;
    if (consecutive) score += 12;
    if (segmentStart || camelStart) score += 10;
    if (index >= basenameStart) score += 8;
    if (previous !== undefined) score -= Math.min(8, index - previous - 1);
    indices.push(index);
    cursor = index + 1;
  }

  if (haystack === needle) score += 1_500;
  else if (haystack.startsWith(needle)) score += 800;
  if (basename === needle) score += 1_000;
  else if (basename.startsWith(needle)) score += 600;
  else if (basename.includes(needle)) score += 300;
  const contiguous = haystack.indexOf(needle);
  if (contiguous >= 0) score += contiguous >= basenameStart ? 240 : 120;
  score -= Math.min(120, haystack.length);
  score -= indices[0] || 0;
  return { score, indices };
}

export function matchQuickAccessPath<T extends QuickAccessPathCandidate>(
  candidate: T,
  query: string
): MatchedQuickAccessPath<T> | null {
  const relativeMatch = fuzzyMatchPath(candidate.relativePath, query);
  const absoluteMatch = fuzzyMatchPath(candidate.path, query);
  if (!relativeMatch && !absoluteMatch) return null;
  if (!absoluteMatch || (relativeMatch && relativeMatch.score >= absoluteMatch.score)) {
    return { ...candidate, ...(relativeMatch || absoluteMatch)! };
  }
  const normalizedAbsolute = candidate.path.replace(/\\/g, "/");
  const normalizedRelative = candidate.relativePath.replace(/\\/g, "/");
  const relativeOffset = normalizedAbsolute.toLocaleLowerCase().lastIndexOf(normalizedRelative.toLocaleLowerCase());
  const indices = relativeOffset >= 0
    ? absoluteMatch.indices.filter((index) => index >= relativeOffset).map((index) => index - relativeOffset)
    : [];
  return { ...candidate, score: absoluteMatch.score, indices };
}

export function compareQuickAccessPathMatches(
  a: MatchedQuickAccessPath,
  b: MatchedQuickAccessPath
): number {
  if (a.kind !== b.kind) {
    const scoreGap = Math.abs(a.score - b.score);
    if (scoreGap < 120) return a.kind === "directory" ? -1 : 1;
  }
  return b.score - a.score || a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: "base" });
}
