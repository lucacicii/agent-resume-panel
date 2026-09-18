import { describe, expect, it } from "vitest";
import { mergeGitStatuses } from "./workbenchGitModel";

type GitStatusResult = Parameters<typeof mergeGitStatuses>[1][number];
type GitChange = GitStatusResult["staged"][number];

function change(repoRoot: string, repoPath: string): GitChange {
  return { path: repoPath, repoPath, repoRoot, status: "M", staged: false, unstaged: true };
}

function repoResult(root: string, repoPath: string): GitStatusResult {
  return {
    isRepo: true,
    root,
    staged: [],
    unstaged: [change(root, repoPath)],
    nestedRepos: [],
    tracking: [{ repoRoot: root, branch: "main", upstream: "origin/main", ahead: 1, behind: 0 }]
  };
}

describe("mergeGitStatuses", () => {
  it("passes a single project's result through unchanged", () => {
    const result = repoResult("/work/app", "src/app.ts");
    expect(mergeGitStatuses(["/work/app"], [result])).toBe(result);
  });

  it("merges several projects into one repo-grouped status", () => {
    const merged = mergeGitStatuses(
      ["/work/app", "/work/api"],
      [repoResult("/work/app", "src/app.ts"), repoResult("/work/api", "src/api.ts")]
    );

    expect(merged.isRepo).toBe(true);
    expect(merged.root).toBeNull();
    expect(merged.nestedRepos?.map((repo) => repo.root)).toEqual(["/work/app", "/work/api"]);
    expect(merged.nestedRepos?.map((repo) => repo.displayPath)).toEqual(["app", "api"]);
    expect(merged.staged).toEqual([]);
    expect(merged.unstaged.map((entry) => entry.repoRoot)).toEqual(["/work/app", "/work/api"]);
    expect(merged.tracking?.map((item) => item.repoRoot)).toEqual(["/work/app", "/work/api"]);
  });

  it("includes nested repositories discovered inside a project", () => {
    const project: GitStatusResult = {
      isRepo: false,
      root: null,
      staged: [],
      unstaged: [change("/work/mono/pkg-a", "index.ts")],
      nestedRepos: [{ root: "/work/mono/pkg-a", displayPath: "pkg-a" }],
      tracking: []
    };
    const merged = mergeGitStatuses(["/work/mono"], [project]);

    // A single project passes through, nested repos intact.
    expect(merged).toBe(project);
  });

  it("lists a project's own repo alongside sibling projects' nested repos", () => {
    const nested: GitStatusResult = {
      isRepo: true,
      root: null,
      staged: [],
      unstaged: [],
      nestedRepos: [{ root: "/work/mono/pkg-a", displayPath: "pkg-a" }],
      tracking: []
    };
    const merged = mergeGitStatuses(
      ["/work/mono", "/work/api"],
      [nested, repoResult("/work/api", "src/api.ts")]
    );

    expect(merged.root).toBeNull();
    expect(merged.nestedRepos?.map((repo) => repo.root)).toEqual(["/work/mono/pkg-a", "/work/api"]);
  });

  it("does not duplicate a repo shared between projects", () => {
    const merged = mergeGitStatuses(
      ["/work/app", "/work/app"],
      [repoResult("/work/app", "a.ts"), repoResult("/work/app", "b.ts")]
    );

    expect(merged.nestedRepos?.map((repo) => repo.root)).toEqual(["/work/app"]);
    expect(merged.unstaged).toHaveLength(2);
  });
});
