import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  shell: { openPath: vi.fn() },
  ipcMain: { removeHandler: vi.fn(), handle: vi.fn() }
}));

import { ipcMain } from "electron";

import {
  discardGitChange,
  discardGitHunk,
  discardGitLine,
  gitStatusForRepo,
  registerWorkbenchFsIpc,
  stageGitHunk,
  stageGitLine,
  unstageGitHunk,
  unstageGitLine
} from "./workbenchFs";
import { toGitDiffHunkMetadata } from "./workbenchGitDiff";

const repos: string[] = [];

function git(repo: string, ...args: string[]): string {
  return String(execFileSync("git", args, { cwd: repo, encoding: "utf8" }));
}

function createRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-workbench-git-"));
  repos.push(repo);
  git(repo, "init");
  git(repo, "config", "user.name", "Workbench Test");
  git(repo, "config", "user.email", "workbench@example.test");
  fs.writeFileSync(path.join(repo, "tracked.txt"), "base\n");
  git(repo, "add", "tracked.txt");
  git(repo, "commit", "-m", "initial");
  return repo;
}

afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});

describe("discardGitChange", () => {
  it("restores staged and worktree changes to the HEAD version", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, "staged\n");
    git(repo, "add", "tracked.txt");
    fs.writeFileSync(tracked, "working tree\n");

    await discardGitChange(repo, "tracked.txt");

    expect(fs.readFileSync(tracked, "utf8")).toBe("base\n");
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("removes untracked and newly staged files", async () => {
    const repo = createRepo();
    const untracked = path.join(repo, "untracked.txt");
    const added = path.join(repo, "added.txt");
    fs.writeFileSync(untracked, "untracked\n");
    fs.writeFileSync(added, "added\n");
    git(repo, "add", "added.txt");

    await discardGitChange(repo, "untracked.txt");
    await discardGitChange(repo, "added.txt");

    expect(fs.existsSync(untracked)).toBe(false);
    expect(fs.existsSync(added)).toBe(false);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("removes an untracked directory reported with a trailing slash", async () => {
    const repo = createRepo();
    const directory = path.join(repo, ".claude");
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "settings.json"), "{}\n");

    expect(git(repo, "status", "--porcelain")).toContain("?? .claude/");

    await discardGitChange(repo, ".claude/");

    expect(fs.existsSync(directory)).toBe(false);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("rejects paths outside the selected repository", async () => {
    const repo = createRepo();
    await expect(discardGitChange(repo, "../outside.txt")).rejects.toThrow("无效的文件路径");
  });

  it("retries and succeeds when .git/index.lock is transiently present", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, "modified\n");

    const lockPath = path.join(repo, ".git", "index.lock");
    fs.writeFileSync(lockPath, "");

    // Remove the lock file after 80ms to simulate a transient git process finishing up
    setTimeout(() => {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    }, 80);

    await discardGitChange(repo, "tracked.txt");

    expect(fs.readFileSync(tracked, "utf8")).toBe("base\n");
    expect(git(repo, "status", "--porcelain")).toBe("");
  });
});

describe("gitStatusForRepo", () => {
  it("lists files inside an untracked (newly created) directory individually", async () => {
    const repo = createRepo();
    fs.mkdirSync(path.join(repo, "newdir", "sub"), { recursive: true });
    fs.writeFileSync(path.join(repo, "newdir", "a.txt"), "a\n");
    fs.writeFileSync(path.join(repo, "newdir", "sub", "b.txt"), "b\n");

    const { staged, unstaged } = await gitStatusForRepo(repo);

    expect(staged).toEqual([]);
    const untrackedPaths = unstaged.map((change) => change.repoPath);
    // Files under the untracked directory must be reported individually so the
    // workbench git tree can display them (not collapsed to a single `newdir/`).
    expect(untrackedPaths).toContain("newdir/a.txt");
    expect(untrackedPaths).toContain("newdir/sub/b.txt");
    expect(untrackedPaths).not.toContain("newdir");
    expect(untrackedPaths).not.toContain("newdir/");
  });
});

describe("discardGitHunk", () => {
  function fixtureContent(first: string, second: string): string {
    const lines = Array.from({ length: 24 }, (_value, index) => `line ${index + 1}`);
    lines[1] = first;
    lines[20] = second;
    return `${lines.join("\n")}\n`;
  }

  it("discards only the selected working-tree hunk", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, fixtureContent("line 2", "line 21"));
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "add long fixture");
    fs.writeFileSync(tracked, fixtureContent("working first", "working second"));
    const patch = git(repo, "diff", "--no-color", "--unified=3", "--", "tracked.txt");
    const hunks = toGitDiffHunkMetadata(patch);
    expect(hunks.length).toBeGreaterThanOrEqual(2);

    await discardGitHunk(repo, "tracked.txt", false, hunks[0]);

    const lines = fs.readFileSync(tracked, "utf8").split("\n");
    expect(lines[1]).toBe("line 2");
    expect(lines[20]).toBe("working second");
  });

  it("discards only the selected staged hunk from the index", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, fixtureContent("line 2", "line 21"));
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "add long fixture");
    fs.writeFileSync(tracked, fixtureContent("staged first", "staged second"));
    git(repo, "add", "tracked.txt");
    const patch = git(repo, "diff", "--cached", "--no-color", "--unified=3", "--", "tracked.txt");
    const hunks = toGitDiffHunkMetadata(patch);
    expect(hunks.length).toBeGreaterThanOrEqual(2);

    await discardGitHunk(repo, "tracked.txt", true, hunks[0]);

    const worktreeLines = fs.readFileSync(tracked, "utf8").split("\n");
    const indexLines = git(repo, "show", ":tracked.txt").split("\n");
    expect(worktreeLines[1]).toBe("staged first");
    expect(worktreeLines[20]).toBe("staged second");
    expect(indexLines[1]).toBe("line 2");
    expect(indexLines[20]).toBe("staged second");
  });
});

describe("discardGitLine", () => {
  function fixtureContent(first: string, second: string): string {
    const lines = Array.from({ length: 16 }, (_value, index) => `line ${index + 1}`);
    lines[3] = first;
    lines[8] = second;
    return `${lines.join("\n")}\n`;
  }

  it("discards only the selected change block inside one working-tree hunk", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, fixtureContent("line 4", "line 9"));
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "add line fixture");
    fs.writeFileSync(tracked, fixtureContent("working first", "working second"));
    const patch = git(repo, "diff", "--no-color", "--unified=3", "--", "tracked.txt");
    expect(toGitDiffHunkMetadata(patch)).toHaveLength(1);

    await discardGitLine(repo, "tracked.txt", false, { side: "additions", lineNumber: 4 });

    const lines = fs.readFileSync(tracked, "utf8").split("\n");
    expect(lines[3]).toBe("line 4");
    expect(lines[8]).toBe("working second");
  });

  it("discards a selected staged change block without changing the worktree", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, fixtureContent("line 4", "line 9"));
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "add staged line fixture");
    fs.writeFileSync(tracked, fixtureContent("staged first", "staged second"));
    git(repo, "add", "tracked.txt");

    await discardGitLine(repo, "tracked.txt", true, { side: "deletions", lineNumber: 4 });

    const worktreeLines = fs.readFileSync(tracked, "utf8").split("\n");
    const indexLines = git(repo, "show", ":tracked.txt").split("\n");
    expect(worktreeLines[3]).toBe("staged first");
    expect(worktreeLines[8]).toBe("staged second");
    expect(indexLines[3]).toBe("line 4");
    expect(indexLines[8]).toBe("staged second");
  });

  it("discards an added line at the start of a file", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, "one\ntwo\n");
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "add short fixture");
    fs.writeFileSync(tracked, "added\none\ntwo\n");

    await discardGitLine(repo, "tracked.txt", false, { side: "additions", lineNumber: 1 });

    expect(fs.readFileSync(tracked, "utf8")).toBe("one\ntwo\n");
  });

  it("rejects a line that is no longer changed", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, "changed\n");

    await expect(discardGitLine(repo, "tracked.txt", false, {
      side: "additions",
      lineNumber: 99
    })).rejects.toThrow("已不是可回退的 Git 改动");
  });
});

describe("stageGitHunk / unstageGitHunk", () => {
  function fixtureContent(first: string, second: string): string {
    const lines = Array.from({ length: 24 }, (_value, index) => `line ${index + 1}`);
    lines[1] = first;
    lines[20] = second;
    return `${lines.join("\n")}\n`;
  }

  it("stages only the selected working-tree hunk into the index", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, fixtureContent("line 2", "line 21"));
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "add long fixture");
    fs.writeFileSync(tracked, fixtureContent("working first", "working second"));
    const patch = git(repo, "diff", "--no-color", "--unified=3", "--", "tracked.txt");
    const hunks = toGitDiffHunkMetadata(patch);
    expect(hunks.length).toBeGreaterThanOrEqual(2);

    await stageGitHunk(repo, "tracked.txt", hunks[0]);

    const worktreeLines = fs.readFileSync(tracked, "utf8").split("\n");
    const indexLines = git(repo, "show", ":tracked.txt").split("\n");
    expect(worktreeLines[1]).toBe("working first");
    expect(worktreeLines[20]).toBe("working second");
    expect(indexLines[1]).toBe("working first");
    expect(indexLines[20]).toBe("line 21");
  });

  it("unstages only the selected staged hunk from the index", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, fixtureContent("line 2", "line 21"));
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "add long fixture");
    fs.writeFileSync(tracked, fixtureContent("staged first", "staged second"));
    git(repo, "add", "tracked.txt");
    const patch = git(repo, "diff", "--cached", "--no-color", "--unified=3", "--", "tracked.txt");
    const hunks = toGitDiffHunkMetadata(patch);
    expect(hunks.length).toBeGreaterThanOrEqual(2);

    await unstageGitHunk(repo, "tracked.txt", hunks[0]);

    const worktreeLines = fs.readFileSync(tracked, "utf8").split("\n");
    const indexLines = git(repo, "show", ":tracked.txt").split("\n");
    expect(worktreeLines[1]).toBe("staged first");
    expect(worktreeLines[20]).toBe("staged second");
    expect(indexLines[1]).toBe("line 2");
    expect(indexLines[20]).toBe("staged second");
  });
});

describe("stageGitLine / unstageGitLine", () => {
  function fixtureContent(first: string, second: string): string {
    const lines = Array.from({ length: 16 }, (_value, index) => `line ${index + 1}`);
    lines[3] = first;
    lines[8] = second;
    return `${lines.join("\n")}\n`;
  }

  it("stages only the selected change block into the index", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, fixtureContent("line 4", "line 9"));
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "add line fixture");
    fs.writeFileSync(tracked, fixtureContent("working first", "working second"));

    await stageGitLine(repo, "tracked.txt", { side: "additions", lineNumber: 4 });

    const worktreeLines = fs.readFileSync(tracked, "utf8").split("\n");
    const indexLines = git(repo, "show", ":tracked.txt").split("\n");
    expect(worktreeLines[3]).toBe("working first");
    expect(worktreeLines[8]).toBe("working second");
    expect(indexLines[3]).toBe("working first");
    expect(indexLines[8]).toBe("line 9");
  });

  it("unstages only the selected change block from the index", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, fixtureContent("line 4", "line 9"));
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "-m", "add staged line fixture");
    fs.writeFileSync(tracked, fixtureContent("staged first", "staged second"));
    git(repo, "add", "tracked.txt");

    await unstageGitLine(repo, "tracked.txt", { side: "deletions", lineNumber: 4 });

    const worktreeLines = fs.readFileSync(tracked, "utf8").split("\n");
    const indexLines = git(repo, "show", ":tracked.txt").split("\n");
    expect(worktreeLines[3]).toBe("staged first");
    expect(worktreeLines[8]).toBe("staged second");
    expect(indexLines[3]).toBe("line 4");
    expect(indexLines[8]).toBe("staged second");
  });
});

describe("terminal:gitDiffSides", () => {
  it("opens a staged file diff via the index ref (:path), not the invalid ::path", async () => {
    const repo = createRepo();
    const tracked = path.join(repo, "tracked.txt");
    fs.writeFileSync(tracked, "staged content\n");
    git(repo, "add", "tracked.txt");
    fs.writeFileSync(tracked, "working tree content\n");

    registerWorkbenchFsIpc();
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitDiffSides")?.[1];
    expect(handler).toBeTruthy();

    const result = await handler!({} as never, { cwd: repo, path: "tracked.txt", staged: true });

    expect(result.newText).toBe("staged content\n");
    expect(result.oldText).toBe("base\n");
    expect(result.newLabel).toBe("Staged");
  });
});
