import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ shell: { openPath: vi.fn() } }));

import { discardGitChange } from "./workbenchFs";

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
});
