import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { removeHandler: vi.fn(), handle: vi.fn() }
}));

import { queryGitFileLog } from "./workbenchGit";

const roots: string[] = [];

function git(repo: string, ...args: string[]): string {
  return String(execFileSync("git", args, { cwd: repo, encoding: "utf8" })).trim();
}

function createRepo(parent?: string): string {
  const repo = parent
    ? path.join(parent, "nested-repo")
    : fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-file-history-"));
  if (parent) fs.mkdirSync(repo, { recursive: true });
  else roots.push(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Workbench Test");
  git(repo, "config", "user.email", "workbench@example.test");
  return repo;
}

function commitFile(repo: string, relativePath: string, content: string, message: string): string {
  const file = path.join(repo, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  git(repo, "add", "--", relativePath);
  git(repo, "commit", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("queryGitFileLog", () => {
  it("loads all local and remote branch history while following renames", async () => {
    const repo = createRepo();
    const oldHash = commitFile(repo, "old.txt", "old\n", "old name");
    git(repo, "mv", "old.txt", "new.txt");
    git(repo, "commit", "-m", "rename file");
    const renameHash = git(repo, "rev-parse", "HEAD");

    git(repo, "checkout", "-b", "feature");
    const featureHash = commitFile(repo, "new.txt", "feature\n", "feature change");
    git(repo, "checkout", "main");
    const mainHash = commitFile(repo, "new.txt", "main\n", "main change");

    git(repo, "checkout", "-b", "remote-only", renameHash);
    const remoteHash = commitFile(repo, "new.txt", "remote\n", "remote-only change");
    git(repo, "update-ref", "refs/remotes/origin/remote-only", remoteHash);
    git(repo, "checkout", "main");
    git(repo, "branch", "-D", "remote-only");

    const result = await queryGitFileLog(repo, path.join(repo, "new.txt"), 150);
    const hashes = new Set(result.commits.map((commit) => commit.hash));

    expect(result.repoRoot).toBe(fs.realpathSync(repo));
    expect(result.repoPath).toBe("new.txt");
    expect(hashes).toEqual(new Set([oldHash, renameHash, featureHash, mainHash, remoteHash]));
    expect(result.layout.rows).toHaveLength(result.commits.length);
  });

  it("resolves the nearest nested repository and returns an empty history for an untracked file", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-file-history-project-"));
    roots.push(projectRoot);
    const repo = createRepo(projectRoot);
    commitFile(repo, "tracked.txt", "tracked\n", "initial");
    const untracked = path.join(repo, "untracked.txt");
    fs.writeFileSync(untracked, "untracked\n");

    const result = await queryGitFileLog(projectRoot, untracked, 150);

    expect(result.repoRoot).toBe(fs.realpathSync(repo));
    expect(result.repoPath).toBe("untracked.txt");
    expect(result.commits).toEqual([]);
  });

  it("rejects directories and paths outside the selected project", async () => {
    const repo = createRepo();
    commitFile(repo, "tracked.txt", "tracked\n", "initial");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-file-history-outside-"));
    roots.push(outside);
    const outsideFile = path.join(outside, "outside.txt");
    fs.writeFileSync(outsideFile, "outside\n");

    await expect(queryGitFileLog(repo, repo)).rejects.toThrow("不是文件");
    await expect(queryGitFileLog(repo, outsideFile)).rejects.toThrow("路径超出允许范围");
  });
});
