import { desktopApi } from "../../../bridge";

type DesktopApi = ReturnType<typeof desktopApi>;

export function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

export type GitStatusResult = Awaited<ReturnType<DesktopApi["terminalGitStatus"]>>;
export type GitRepoTracking = NonNullable<GitStatusResult["tracking"]>[number];
export type TerminalGitInfo = Awaited<ReturnType<DesktopApi["terminalGitInfo"]>>;
export type TerminalGitBranches = Awaited<ReturnType<DesktopApi["terminalGitBranches"]>>;
export type GitChange = GitStatusResult["staged"][number];
export type GitLog = Awaited<ReturnType<DesktopApi["terminalGitLog"]>>;
export type GitLogCommit = GitLog["commits"][number];
export type GitShow = Awaited<ReturnType<DesktopApi["terminalGitShow"]>>;
export type GitGraphLayout = GitLog["layout"];
export type GitGraphRow = GitGraphLayout["rows"][number];
export type GitHistoryContext =
  | { kind: "repository"; repoRoot: string }
  | { kind: "file"; projectRoot: string; filePath: string; repoRoot: string; repoPath: string };
export type CommitSuggestion = Awaited<ReturnType<DesktopApi["terminalGitSuggestCommit"]>>;

/** Local porcelain status poll while Workbench is active. */
export const GIT_STATUS_POLL_MS = 10_000;
/** Debounce before re-running status after a watched file change. */
export const GIT_REFRESH_DEBOUNCE_MS = 300;
/** Remote fetch cadence while Workbench is active. */
export const GIT_AUTO_FETCH_MS = 60_000;
/** Cap nested monorepo fetch fan-out per sweep. */
export const GIT_AUTO_FETCH_MAX_ROOTS = 8;

export type GitTreeNode = {
  name: string;
  path: string;
  isDirectory: boolean;
  children: GitTreeNode[];
  change?: GitChange;
  /** Precomputed flattened changes of the subtree (directories); the single change for files. */
  changes: GitChange[];
  /** Precomputed repo-relative paths of the subtree (directories). */
  repoPaths: string[];
};

export type ActiveGitDiff = {
  repoRoot: string;
  repoPath: string;
  staged: boolean;
};

export type GitStageTarget = { repoRoot: string; paths: string[] };

function statusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

export function gitOperationError(error: unknown): string {
  return statusError(error).replace(/^Error invoking remote method 'terminal:[^']+': Error:\s*/, "");
}

export function gitStatusLetter(status: string): string {
  const normalized = status.trim() || "?";
  if (normalized === "?" || normalized === "A") return "A";
  if (normalized === "D") return "D";
  return "M";
}

export function gitStatusClass(status: string): string {
  const letter = gitStatusLetter(status);
  return letter === "A" ? "is-add" : letter === "D" ? "is-del" : "is-mod";
}

export function gitChangeTreePath(change: Pick<GitChange, "path" | "repoPath">): string {
  return change.repoPath || change.path;
}

export function buildGitChangeTree(changes: GitChange[]): GitTreeNode[] {
  const roots: GitTreeNode[] = [];
  const directories = new Map<string, GitTreeNode>();

  for (const change of changes) {
    const treePath = gitChangeTreePath(change);
    const parts = treePath.split("/").map((part) => part.trim()).filter(Boolean);
    let parentPath = "";
    let siblings = roots;
    for (const [index, name] of parts.entries()) {
      const isFile = index === parts.length - 1;
      const path = parentPath ? `${parentPath}/${name}` : name;
      if (isFile) {
        siblings.push({ name, path: treePath, isDirectory: false, children: [], change, changes: [], repoPaths: [] });
        continue;
      }
      let directory = directories.get(path);
      if (!directory) {
        directory = { name, path, isDirectory: true, children: [], changes: [], repoPaths: [] };
        directories.set(path, directory);
        siblings.push(directory);
      }
      parentPath = path;
      siblings = directory.children;
    }
  }

  const sort = (nodes: GitTreeNode[]) => {
    nodes.sort((left, right) => Number(right.isDirectory) - Number(left.isDirectory) || left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
    nodes.filter((node) => node.isDirectory).forEach((node) => sort(node.children));
  };
  sort(roots);
  roots.forEach(computeGitNodeMetadata);
  return roots;
}

/** One pass over the tree caching each directory's flattened changes/repo paths for cheap re-renders. */
export function computeGitNodeMetadata(node: GitTreeNode): void {
  if (!node.isDirectory) {
    const change = node.change;
    node.changes = change ? [change] : [];
    node.repoPaths = change ? [change.repoPath] : [];
    return;
  }
  const changes: GitChange[] = [];
  const repoPaths: string[] = [];
  for (const child of node.children) {
    computeGitNodeMetadata(child);
    changes.push(...child.changes);
    repoPaths.push(...child.repoPaths);
  }
  node.changes = changes;
  node.repoPaths = repoPaths;
}

export function gitDirectoryExpandKey(repoRoot: string, directoryPath: string): string {
  return repoRoot ? `${repoRoot}\0${directoryPath}` : directoryPath;
}

export function gitDirectoryKeys(changes: GitChange[]): Set<string> {
  const keys = new Set<string>();
  for (const change of changes) {
    const parts = gitChangeTreePath(change).split("/").map((part) => part.trim()).filter(Boolean);
    let parentPath = "";
    for (const name of parts.slice(0, -1)) {
      parentPath = parentPath ? `${parentPath}/${name}` : name;
      keys.add(gitDirectoryExpandKey(change.repoRoot, parentPath));
    }
  }
  return keys;
}

export function reconcileExpandedGitDirectories(current: Set<string>, changes: GitChange[]): Set<string> {
  const available = gitDirectoryKeys(changes);
  const next = new Set<string>();
  for (const key of current) {
    if (available.has(key)) next.add(key);
  }
  return next;
}

export function gitGroupCheckboxState(repoRoot: string, stagedEntries: GitChange[], unstagedEntries: GitChange[]): boolean | "mixed" {
  const stagedCount = stagedEntries.filter((change) => change.repoRoot === repoRoot).length;
  const unstagedCount = unstagedEntries.filter((change) => change.repoRoot === repoRoot).length;
  if (stagedCount && unstagedCount) return "mixed";
  if (stagedCount) return true;
  return false;
}

export function gitChangeKey(change: Pick<GitChange, "repoRoot" | "repoPath">): string {
  return `${change.repoRoot}\0${change.repoPath}`;
}

export function gitChangeFilePath(change: Pick<GitChange, "repoRoot" | "repoPath">): string {
  const repoRoot = change.repoRoot.replace(/[\\/]+$/, "");
  const repoPath = change.repoPath.replace(/^[\\/]+/, "");
  return `${repoRoot}/${repoPath}`;
}

export function gitNodeDragPath(node: GitTreeNode): string | null {
  if (!node.isDirectory) return node.change ? gitChangeFilePath(node.change) : null;
  const repoRoot = node.changes[0]?.repoRoot || "";
  return repoRoot ? gitChangeFilePath({ repoRoot, repoPath: node.path }) : null;
}

export function uniqueGitChanges(changes: GitChange[]): GitChange[] {
  const unique = new Map<string, GitChange>();
  for (const change of changes) unique.set(gitChangeKey(change), change);
  return [...unique.values()];
}

/**
 * Move targeted changes between the staged/unstaged lists locally so checkbox
 * clicks respond instantly; a trailing status refresh converges the details.
 */
export function stageGitChangesOptimistically(
  state: GitStatusResult,
  targets: GitStageTarget[],
  targetStaged: boolean
): GitStatusResult {
  const wanted = new Set<string>();
  for (const target of targets) {
    for (const repoPath of target.paths) {
      wanted.add(gitChangeKey({ repoRoot: target.repoRoot, repoPath }));
    }
  }
  const place = (change: GitChange): GitChange => targetStaged
    ? { ...change, staged: true, unstaged: false }
    : { ...change, staged: false, unstaged: true };
  const staged: GitChange[] = [];
  const seenStaged = new Set<string>();
  const unstaged: GitChange[] = [];
  const seenUnstaged = new Set<string>();
  const push = (list: GitChange[], seen: Set<string>, change: GitChange) => {
    const key = gitChangeKey(change);
    if (seen.has(key)) return;
    seen.add(key);
    list.push(change);
  };
  for (const change of state.staged) {
    const key = gitChangeKey(change);
    if (wanted.has(key) && !targetStaged) push(unstaged, seenUnstaged, place(change));
    else push(staged, seenStaged, change);
  }
  for (const change of state.unstaged) {
    const key = gitChangeKey(change);
    if (wanted.has(key) && targetStaged) push(staged, seenStaged, place(change));
    else push(unstaged, seenUnstaged, change);
  }
  return { ...state, staged, unstaged };
}

export function normalizeGitStageTargets(targets: GitStageTarget | GitStageTarget[]): GitStageTarget[] {
  return (Array.isArray(targets) ? targets : [targets]).filter((target) => target.repoRoot && target.paths.length);
}

export function groupGitChangesByRepo(changes: GitChange[]): GitStageTarget[] {
  const groups = new Map<string, string[]>();
  const seen = new Map<string, Set<string>>();
  for (const change of changes) {
    if (!change.repoRoot) continue;
    const paths = groups.get(change.repoRoot) || [];
    const used = seen.get(change.repoRoot) || new Set<string>();
    if (!used.has(change.repoPath)) {
      used.add(change.repoPath);
      paths.push(change.repoPath);
      groups.set(change.repoRoot, paths);
      seen.set(change.repoRoot, used);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([repoRoot, paths]) => ({ repoRoot, paths }));
}

export function gitRepositoryLabel(git: GitStatusResult, repoRoot: string): string {
  return git.nestedRepos?.find((repository) => repository.root === repoRoot)?.displayPath || basename(repoRoot);
}

export function gitRepositoryCount(git: GitStatusResult): number {
  const roots = new Set<string>();
  if (git.root) roots.add(git.root);
  git.nestedRepos?.forEach((repository) => roots.add(repository.root));
  for (const change of [...git.staged, ...git.unstaged]) {
    if (change.repoRoot) roots.add(change.repoRoot);
  }
  return roots.size;
}

export function dirtyGitRoots(result: GitStatusResult): string[] {
  const roots = new Set<string>();
  for (const change of [...result.staged, ...result.unstaged]) {
    if (change.repoRoot) roots.add(change.repoRoot);
  }
  return [...roots];
}

export function defaultGitRoot(result: GitStatusResult, availableRoots: string[]): string {
  const dirty = new Set(dirtyGitRoots(result));
  if (dirty.size) {
    const fromNested = (result.nestedRepos || []).find((repository) => dirty.has(repository.root));
    if (fromNested) return fromNested.root;
    if (result.root && dirty.has(result.root)) return result.root;
    const sorted = [...dirty].sort((left, right) => left.localeCompare(right));
    if (sorted[0]) return sorted[0];
  }
  return result.root || result.nestedRepos?.[0]?.root || availableRoots[0] || "";
}

export function trackingForRoot(git: GitStatusResult | null, gitRoot: string): GitRepoTracking | null {
  if (!git?.tracking?.length) return null;
  if (gitRoot) {
    return git.tracking.find((item) => item.repoRoot === gitRoot) || null;
  }
  return git.tracking[0] || null;
}

export function graphColumnX(layout: GitGraphLayout, column: number): number {
  return column * layout.laneWidth + layout.laneWidth / 2;
}

export function graphCurvePath(fromX: number, toX: number, rowHeight: number, side: "left" | "right"): string {
  const midY = rowHeight / 2;
  const bend = Math.max(10, Math.abs(toX - fromX) * 0.75);
  if (side === "left") return `M ${fromX} ${midY} C ${fromX - bend} ${midY + rowHeight * 0.2}, ${toX + bend * 0.35} ${midY + rowHeight * 0.3}, ${toX} ${rowHeight}`;
  return `M ${toX} ${rowHeight} C ${toX - bend * 0.35} ${midY + rowHeight * 0.3}, ${fromX + bend} ${midY + rowHeight * 0.2}, ${fromX} ${midY}`;
}

export function formatGitCommitDate(dateSeconds: number, locale: string): string {
  if (!Number.isFinite(dateSeconds)) return "";
  const date = new Date(dateSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return date.toLocaleDateString();
  }
}

export function gitCommitBranchNames(commit: GitLogCommit): string[] {
  return [...new Set([...(commit.refs.heads || []), ...(commit.refs.remotes || [])])];
}
