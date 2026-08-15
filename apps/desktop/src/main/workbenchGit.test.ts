import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ipcMain } from "electron";

vi.mock("electron", () => ({
  ipcMain: { removeHandler: vi.fn(), handle: vi.fn() }
}));

import { collectGitCommitContext, queryGitCommitFileDiffSides, queryGitFileLog, registerWorkbenchGitIpc } from "./workbenchGit";

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

/** Inits a nested git repo and registers it as a gitlink in the parent. */
function makeSubmodule(parent: string, name: string): string {
  const sub = path.join(parent, name);
  fs.mkdirSync(sub, { recursive: true });
  git(sub, "init", "-b", "main");
  git(sub, "config", "user.name", "Workbench Test");
  git(sub, "config", "user.email", "workbench@example.test");
  commitFile(sub, "nested.txt", "base\n", "initial nested file");
  git(parent, "add", "--", name);
  git(parent, "commit", "-m", "add submodule");
  return sub;
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
    expect(result.commits.find((commit) => commit.hash === featureHash)?.refs.heads).toContain("feature");
    expect(result.commits.find((commit) => commit.hash === mainHash)?.refs.heads).toContain("main");
    expect(result.commits.find((commit) => commit.hash === remoteHash)?.refs.remotes).toContain("origin/remote-only");
    expect(result.layout.rows).toHaveLength(result.commits.length);
    // Rename-aware per-commit path: the original name before the rename, the
    // new name from the rename commit onward.
    expect(result.commits.find((commit) => commit.hash === oldHash)?.pathAtCommit).toBe("old.txt");
    expect(result.commits.find((commit) => commit.hash === renameHash)?.pathAtCommit).toBe("new.txt");
    expect(result.commits.find((commit) => commit.hash === featureHash)?.pathAtCommit).toBe("new.txt");
    expect(result.commits.find((commit) => commit.hash === mainHash)?.pathAtCommit).toBe("new.txt");
    expect(result.commits.find((commit) => commit.hash === remoteHash)?.pathAtCommit).toBe("new.txt");
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

  it("includes commits reachable only through tags once --all is used", async () => {
    const repo = createRepo();
    commitFile(repo, "tracked.txt", "base\n", "initial");
    git(repo, "checkout", "-b", "tag-only");
    const taggedHash = commitFile(repo, "tracked.txt", "tagged\n", "tagged change");
    git(repo, "tag", "v1.0");
    git(repo, "checkout", "main");
    git(repo, "branch", "-D", "tag-only");

    const result = await queryGitFileLog(repo, path.join(repo, "tracked.txt"), 150);
    const hashes = new Set(result.commits.map((commit) => commit.hash));

    // Reachable only via the tag: --branches/--remotes would omit it, --all includes it.
    expect(hashes).toContain(taggedHash);
    expect(result.commits.find((commit) => commit.hash === taggedHash)?.refs.tags).toContain("v1.0");
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

describe("queryGitCommitFileDiffSides", () => {
  it("resolves rename sides so a renamed file shows parent and commit content with hunks", async () => {
    const repo = createRepo();
    commitFile(repo, "old.txt", "line one\nline two\nline three\n", "initial");
    git(repo, "mv", "old.txt", "new.txt");
    fs.writeFileSync(path.join(repo, "new.txt"), "line one\nline two changed\nline three\n");
    git(repo, "add", "--", "new.txt");
    git(repo, "commit", "-m", "rename with edit");
    const renameHash = git(repo, "rev-parse", "HEAD");

    const result = await queryGitCommitFileDiffSides(repo, renameHash, "new.txt");

    expect(result.oldText).toContain("line two");
    expect(result.oldText).not.toContain("line two changed");
    expect(result.newText).toContain("line two changed");
    expect(result.oldLabel).toBe(`${renameHash.slice(0, 7)}^`);
    expect(result.newLabel).toBe(renameHash.slice(0, 7));
    expect(result.hunks.length).toBeGreaterThan(0);
  });

  it("keeps the plain path for non-rename commits and falls back to --root for the initial commit", async () => {
    const repo = createRepo();
    const rootHash = commitFile(repo, "tracked.txt", "hello\n", "initial");
    const editHash = commitFile(repo, "tracked.txt", "hello world\n", "edit");

    const rootResult = await queryGitCommitFileDiffSides(repo, rootHash, "tracked.txt");
    expect(rootResult.oldText).toBe("");
    expect(rootResult.newText).toBe("hello\n");
    expect(rootResult.hunks.length).toBeGreaterThan(0);

    const editResult = await queryGitCommitFileDiffSides(repo, editHash, "tracked.txt");
    expect(editResult.oldText).toBe("hello\n");
    expect(editResult.newText).toBe("hello world\n");
    expect(editResult.hunks.length).toBeGreaterThan(0);
  });
});

describe("terminal:gitShow", () => {
  it("reports rename/copy entries with their old path for old -> new display", async () => {
    const repo = createRepo();
    commitFile(repo, "old.txt", "old\n", "initial");
    git(repo, "mv", "old.txt", "new.txt");
    git(repo, "commit", "-m", "rename file");
    const renameHash = git(repo, "rev-parse", "HEAD");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitShow");
    expect(registration).toBeTruthy();
    const handler = registration![1];

    const result = await handler({} as never, { repoRoot: repo, hash: renameHash }) as { files: Array<{ status: string; path: string; oldPath?: string }> };

    expect(result.files).toEqual([{ status: "R100", path: "new.txt", oldPath: "old.txt" }]);
  });
});

describe("collectGitCommitContext", () => {
  it("collects staged and unstaged diffs only for selected paths", async () => {
    const repo = createRepo();
    commitFile(repo, "selected-staged.txt", "staged base\n", "add staged fixture");
    commitFile(repo, "selected-unstaged.txt", "unstaged base\n", "add unstaged fixture");
    commitFile(repo, "not-selected.txt", "ignored base\n", "add ignored fixture");
    fs.writeFileSync(path.join(repo, "selected-staged.txt"), "selected staged marker\n");
    fs.writeFileSync(path.join(repo, "selected-unstaged.txt"), "selected unstaged marker\n");
    fs.writeFileSync(path.join(repo, "not-selected.txt"), "unselected marker\n");
    git(repo, "add", "--", "selected-staged.txt");

    const context = await collectGitCommitContext(repo, ["selected-staged.txt", "selected-unstaged.txt"]);

    expect(context.statusText).toContain("selected-staged.txt");
    expect(context.statusText).toContain("selected-unstaged.txt");
    expect(context.statusText).not.toContain("not-selected.txt");
    expect(context.diffText).toContain("[staged changes]");
    expect(context.diffText).toContain("selected staged marker");
    expect(context.diffText).toContain("[unstaged changes]");
    expect(context.diffText).toContain("selected unstaged marker");
    expect(context.diffText).not.toContain("unselected marker");
  });

  it("rejects an empty selected path list", async () => {
    const repo = createRepo();
    await expect(collectGitCommitContext(repo, [])).rejects.toThrow("请选择要生成提交信息的文件");
  });
});

describe("terminal:gitCommit", () => {
  it("commits a selected Unicode path and leaves unselected changes out of the commit", async () => {
    const repo = createRepo();
    const unicodePath = "public/files/授信额度申请批量导入.xlsx";
    const unselectedPath = "keep-out.txt";
    commitFile(repo, unicodePath, "base\n", "initial Unicode file");
    commitFile(repo, unselectedPath, "base\n", "initial unselected file");
    fs.writeFileSync(path.join(repo, unicodePath), "changed\n");
    fs.writeFileSync(path.join(repo, unselectedPath), "changed\n");
    git(repo, "add", "--", unselectedPath);

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitCommit");
    expect(registration).toBeTruthy();
    const handler = registration![1];

    await handler({} as never, {
      repoRoot: repo,
      message: "fix: support Unicode Git paths",
      paths: [unicodePath]
    });

    expect(git(repo, "show", "--format=", "--name-only", "-z", "HEAD").split("\0").filter(Boolean)).toEqual([unicodePath]);
    expect(git(repo, "diff", "--cached", "--name-only", "--", unselectedPath)).toBe("");
    expect(git(repo, "diff", "--name-only", "--", unselectedPath)).toBe(unselectedPath);
  });

  it("skips a dirty submodule whose gitlink did not move and commits the rest", async () => {
    const repo = createRepo();
    commitFile(repo, "app.txt", "base\n", "initial app file");
    const sub = makeSubmodule(repo, "sub");
    // Dirty the submodule working tree WITHOUT committing inside it.
    fs.writeFileSync(path.join(sub, "nested.txt"), "changed\n");
    // Also modify a normal parent file.
    fs.writeFileSync(path.join(repo, "app.txt"), "parent change\n");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitCommit");
    const handler = registration![1];

    const result = await handler({} as never, {
      repoRoot: repo,
      message: "chore: bump parent",
      paths: ["sub", "app.txt"]
    }) as { ok: boolean; skipped?: string[] };

    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual(["sub"]);
    // The parent file was committed; the submodule gitlink stayed at the original nested commit.
    expect(git(repo, "show", "--format=", "--name-only", "-z", "HEAD").split("\0").filter(Boolean)).toEqual(["app.txt"]);
    expect(git(repo, "ls-tree", "HEAD", "sub")).toContain(git(path.join(repo, "sub"), "rev-parse", "HEAD"));
  });

  it("rejects a commit whose only selected change is an uncommittable dirty submodule", async () => {
    const repo = createRepo();
    const sub = makeSubmodule(repo, "sub");
    fs.writeFileSync(path.join(sub, "nested.txt"), "changed\n");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitCommit");
    const handler = registration![1];

    await expect(handler({} as never, {
      repoRoot: repo,
      message: "chore: bump",
      paths: ["sub"]
    })).rejects.toThrow(/子模块 sub 内部有未提交的改动/);
  });

  it("commits a submodule whose HEAD moved (committable gitlink update)", async () => {
    const repo = createRepo();
    const sub = makeSubmodule(repo, "sub");
    // Commit inside the submodule: the parent gitlink is now outdated.
    const newHead = commitFile(sub, "nested.txt", "updated\n", "update nested content");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitCommit");
    const handler = registration![1];

    const result = await handler({} as never, {
      repoRoot: repo,
      message: "chore: bump sub",
      paths: ["sub"]
    }) as { ok: boolean; skipped?: string[] };

    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual([]);
    expect(git(repo, "ls-tree", "HEAD", "sub")).toContain(newHead);
  });

  it("surfaces git's stdout diagnostic when the selection has nothing to commit", async () => {
    const repo = createRepo();
    commitFile(repo, "clean.txt", "base\n", "initial clean file");
    commitFile(repo, "dirty.txt", "base\n", "initial dirty file");
    fs.writeFileSync(path.join(repo, "dirty.txt"), "changed\n");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitCommit");
    const handler = registration![1];

    await expect(handler({} as never, {
      repoRoot: repo,
      message: "chore: bump",
      paths: ["clean.txt"]
    })).rejects.toThrow(/no changes added to commit/);
  });

  it("commits an untracked directory reported with a trailing slash by porcelain status", async () => {
    const repo = createRepo();
    fs.mkdirSync(path.join(repo, "newdir"), { recursive: true });
    fs.writeFileSync(path.join(repo, "newdir", "inner.txt"), "new\n");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitCommit");
    const handler = registration![1];

    const result = await handler({} as never, {
      repoRoot: repo,
      message: "feat: add new folder",
      paths: ["newdir/"]
    }) as { ok: boolean; skipped?: string[] };

    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual([]);
    expect(git(repo, "show", "--format=", "--name-only", "-z", "HEAD").split("\0").filter(Boolean)).toEqual(["newdir/inner.txt"]);
  });
});

describe("terminal:gitStage / terminal:gitUnstage", () => {
  it("stages an unstaged file and unstages it back", async () => {
    const repo = createRepo();
    commitFile(repo, "tracked.txt", "base\n", "initial");
    fs.writeFileSync(path.join(repo, "tracked.txt"), "changed\n");

    registerWorkbenchGitIpc(() => "en");
    const stageHandler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitStage")?.[1];
    const unstageHandler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitUnstage")?.[1];
    expect(stageHandler).toBeTruthy();
    expect(unstageHandler).toBeTruthy();

    await stageHandler!({} as never, { repoRoot: repo, paths: ["tracked.txt"] });
    expect(git(repo, "status", "--porcelain")).toBe("M  tracked.txt");

    await unstageHandler!({} as never, { repoRoot: repo, paths: ["tracked.txt"] });
    expect(git(repo, "status", "--porcelain")).toBe("M tracked.txt");
  });

  it("stages files inside an untracked (newly created) directory individually", async () => {
    const repo = createRepo();
    fs.mkdirSync(path.join(repo, "newdir", "sub"), { recursive: true });
    fs.writeFileSync(path.join(repo, "newdir", "a.txt"), "a\n");
    fs.writeFileSync(path.join(repo, "newdir", "sub", "b.txt"), "b\n");

    registerWorkbenchGitIpc(() => "en");
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitStage")?.[1];
    expect(handler).toBeTruthy();

    await handler!({} as never, { repoRoot: repo, paths: ["newdir/a.txt", "newdir/sub/b.txt"] });
    const status = git(repo, "status", "--porcelain");
    expect(status).toContain("A  newdir/a.txt");
    expect(status).toContain("A  newdir/sub/b.txt");
  });

  it("rejects an empty path list", async () => {
    const repo = createRepo();
    registerWorkbenchGitIpc(() => "en");
    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitStage")?.[1];
    expect(handler).toBeTruthy();
    await expect(handler!({} as never, { repoRoot: repo, paths: [] })).rejects.toThrow("请选择要暂存的文件");
  });
});

describe("terminal:gitMerge", () => {
  it("fast-forwards the current branch when the merged commit is an ancestor", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");
    git(repo, "checkout", "-b", "feature");
    commitFile(repo, "feature.txt", "feature\n", "feature work");
    const featureTip = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "main");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitMerge");
    expect(registration).toBeTruthy();
    const handler = registration![1];

    const result = await handler({} as never, { repoRoot: repo, hash: featureTip }) as { ok: boolean };

    expect(result.ok).toBe(true);
    // main fast-forwarded onto the feature tip (no merge commit).
    expect(git(repo, "rev-parse", "HEAD")).toBe(featureTip);
    expect(git(repo, "branch", "--show-current")).toBe("main");
  });

  it("creates a merge commit for divergent histories", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");
    git(repo, "checkout", "-b", "feature");
    commitFile(repo, "feature.txt", "feature\n", "feature work");
    const featureTip = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "main");
    commitFile(repo, "main.txt", "main\n", "main work");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitMerge");
    const handler = registration![1];

    const result = await handler({} as never, { repoRoot: repo, hash: featureTip }) as { ok: boolean };

    expect(result.ok).toBe(true);
    // A merge commit has two parents.
    expect(git(repo, "show", "-s", "--format=%P", "HEAD").split(/\s+/).filter(Boolean)).toHaveLength(2);
  });

  it("rejects an invalid commit hash", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitMerge");
    const handler = registration![1];

    await expect(handler({} as never, { repoRoot: repo, hash: "not-a-hash!" })).rejects.toThrow(/无效的 commit hash/);
  });
});

describe("terminal:gitCherryPick", () => {
  it("applies the picked commit onto the current branch", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");
    git(repo, "checkout", "-b", "feature");
    commitFile(repo, "feature1.txt", "one\n", "feature one");
    commitFile(repo, "feature2.txt", "two\n", "feature two");
    const featureTwo = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "main");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitCherryPick");
    expect(registration).toBeTruthy();
    const handler = registration![1];

    const result = await handler({} as never, { repoRoot: repo, hash: featureTwo }) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(git(repo, "branch", "--show-current")).toBe("main");
    // Only the second commit's change is replayed: feature2.txt exists, feature1.txt does not.
    expect(fs.readFileSync(path.join(repo, "feature2.txt"), "utf8")).toBe("two\n");
    expect(fs.existsSync(path.join(repo, "feature1.txt"))).toBe(false);
    // The replay has a different parent (main tip), so it is a new commit.
    expect(git(repo, "rev-parse", "HEAD")).not.toBe(featureTwo);
  });
});

describe("terminal:gitReset", () => {
  it("soft reset moves the branch without touching the index or worktree", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");
    commitFile(repo, "second.txt", "second\n", "second commit");
    const first = git(repo, "rev-parse", "HEAD~1");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitReset");
    expect(registration).toBeTruthy();
    const handler = registration![1];

    const result = await handler({} as never, { repoRoot: repo, hash: first, mode: "soft" }) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(git(repo, "rev-parse", "HEAD")).toBe(first);
    // second.txt is still staged after a soft reset.
    expect(git(repo, "status", "--porcelain")).toContain("A  second.txt");
    expect(fs.readFileSync(path.join(repo, "second.txt"), "utf8")).toBe("second\n");
  });

  it("mixed reset unstages changes but keeps the worktree", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");
    commitFile(repo, "second.txt", "second\n", "second commit");
    const first = git(repo, "rev-parse", "HEAD~1");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitReset");
    const handler = registration![1];

    const result = await handler({} as never, { repoRoot: repo, hash: first, mode: "mixed" }) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(git(repo, "status", "--porcelain")).toContain("?? second.txt");
    expect(fs.readFileSync(path.join(repo, "second.txt"), "utf8")).toBe("second\n");
  });

  it("hard reset discards index and worktree changes", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");
    commitFile(repo, "second.txt", "second\n", "second commit");
    const first = git(repo, "rev-parse", "HEAD~1");
    fs.writeFileSync(path.join(repo, "second.txt"), "dirty\n");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitReset");
    const handler = registration![1];

    const result = await handler({} as never, { repoRoot: repo, hash: first, mode: "hard" }) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(git(repo, "rev-parse", "HEAD")).toBe(first);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("rejects an unknown reset mode", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");
    const first = git(repo, "rev-parse", "HEAD");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitReset");
    const handler = registration![1];

    await expect(handler({} as never, { repoRoot: repo, hash: first, mode: "extreme" })).rejects.toThrow(/无效的 reset 模式/);
  });
});

describe("terminal:gitCheckoutCommit", () => {
  it("checks out the commit with a detached HEAD", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");
    const first = git(repo, "rev-parse", "HEAD");
    commitFile(repo, "second.txt", "second\n", "second commit");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitCheckoutCommit");
    expect(registration).toBeTruthy();
    const handler = registration![1];

    const result = await handler({} as never, { repoRoot: repo, hash: first }) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(git(repo, "rev-parse", "HEAD")).toBe(first);
    // Detached: no current branch; the worktree no longer has second.txt.
    expect(() => git(repo, "symbolic-ref", "--quiet", "--short", "HEAD")).toThrow();
    expect(fs.existsSync(path.join(repo, "second.txt"))).toBe(false);
  });
});

describe("terminal:gitBranchFromCommit", () => {
  it("creates and checks out a branch at the commit", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");
    const first = git(repo, "rev-parse", "HEAD");
    commitFile(repo, "second.txt", "second\n", "second commit");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitBranchFromCommit");
    expect(registration).toBeTruthy();
    const handler = registration![1];

    const result = await handler({} as never, { repoRoot: repo, hash: first, branch: "fix/from-commit" }) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(git(repo, "branch", "--show-current")).toBe("fix/from-commit");
    expect(git(repo, "rev-parse", "HEAD")).toBe(first);
    expect(fs.existsSync(path.join(repo, "second.txt"))).toBe(false);
  });

  it("rejects an invalid branch name", async () => {
    const repo = createRepo();
    commitFile(repo, "base.txt", "base\n", "initial commit");
    const first = git(repo, "rev-parse", "HEAD");

    registerWorkbenchGitIpc(() => "en");
    const registration = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "terminal:gitBranchFromCommit");
    const handler = registration![1];

    await expect(handler({} as never, { repoRoot: repo, hash: first, branch: "-evil" })).rejects.toThrow(/无效的分支名/);
  });
});
