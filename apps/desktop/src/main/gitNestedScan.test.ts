import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-resume/core", () => ({
  expandHome: (value: string) => value
}));

import { checkoutGitBranch, listGitBranchesWithNested } from "./gitNestedScan";

const roots: string[] = [];

function git(repo: string, ...args: string[]): string {
  return String(execFileSync("git", args, { cwd: repo, encoding: "utf8" })).trim();
}

function createRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-git-branches-"));
  roots.push(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Workbench Test");
  git(repo, "config", "user.email", "workbench@example.test");
  fs.writeFileSync(path.join(repo, "README.md"), "initial\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "initial");
  return repo;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("Git branch listing and checkout", () => {
  it("separates local branches from origin branches and omits origin/HEAD", async () => {
    const repo = createRepo();
    const head = git(repo, "rev-parse", "HEAD");
    git(repo, "branch", "local-feature");
    git(repo, "update-ref", "refs/remotes/origin/remote-feature", head);
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

    const result = await listGitBranchesWithNested(repo);

    expect(result.mode).toBe("direct");
    expect(result.current).toBe("main");
    expect(result.localBranches).toEqual(["local-feature", "main"]);
    expect(result.branches).toEqual(["local-feature", "main"]);
    expect(result.remoteBranches).toEqual([{
      remote: "origin",
      name: "remote-feature",
      fullName: "origin/remote-feature"
    }]);
  });

  it("creates a local tracking branch when checking out an origin branch", async () => {
    const repo = createRepo();
    const head = git(repo, "rev-parse", "HEAD");
    git(repo, "remote", "add", "origin", repo);
    git(repo, "update-ref", "refs/remotes/origin/feature/ui", head);

    await checkoutGitBranch(repo, "feature/ui", "origin");

    expect(git(repo, "branch", "--show-current")).toBe("feature/ui");
    expect(git(repo, "for-each-ref", "--format=%(upstream:short)", "refs/heads/feature/ui")).toBe("origin/feature/ui");
  });

  it("uses an existing local branch when selecting its origin counterpart", async () => {
    const repo = createRepo();
    const head = git(repo, "rev-parse", "HEAD");
    git(repo, "branch", "feature");
    git(repo, "update-ref", "refs/remotes/origin/feature", head);

    await checkoutGitBranch(repo, "feature", "origin");

    expect(git(repo, "branch", "--show-current")).toBe("feature");
    expect(git(repo, "for-each-ref", "--format=%(upstream:short)", "refs/heads/feature")).toBe("");
  });
});
