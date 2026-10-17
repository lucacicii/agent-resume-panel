import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ensureExtensionCatalogSchema, setCatalogMeta } from "@agent-resume/core";
import { taskWorktreeRoot } from "./taskWorkspace";
import {
  isPathWithin,
  parseWorktreePorcelain,
  patchTaskWorktreeState,
  readTaskWorktreeState,
  worktreeCreate,
  worktreeInspect,
  worktreeListForTask,
  worktreeRemove
} from "./worktreeGit";
import { worktreeDirName } from "../shared/worktreeTypes";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args]);
  return String(stdout);
}

/**
 * A panel home holding one repository with a single commit. The temp directory
 * is resolved first: macOS hands out `/var/…`, a symlink into `/private/var/…`,
 * and a real panel home never has that indirection.
 */
async function setup(): Promise<{ panelHome: string; noteId: string; repoRoot: string }> {
  const panelHome = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-resume-worktree-")));
  roots.push(panelHome);
  const repoRoot = path.join(panelHome, "app");
  await fs.mkdir(repoRoot, { recursive: true });
  await git(repoRoot, ["init", "-b", "main"]);
  await git(repoRoot, ["config", "user.email", "test@example.com"]);
  await git(repoRoot, ["config", "user.name", "Test"]);
  await fs.writeFile(path.join(repoRoot, "README.md"), "hello\n");
  await git(repoRoot, ["add", "-A"]);
  await git(repoRoot, ["commit", "-m", "init"]);
  return { panelHome, noteId: "note-1", repoRoot };
}

function listTask(panelHome: string, noteId: string, repoRoot: string) {
  return worktreeListForTask({ panelHome, noteId, repos: [{ repoRoot, label: "app" }] });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("parseWorktreePorcelain", () => {
  it("reads records, branches and the detached flag", () => {
    const entries = parseWorktreePorcelain(
      [
        "worktree /repo",
        "HEAD aaaa",
        "branch refs/heads/main",
        "",
        "worktree /wt/one",
        "HEAD bbbb",
        "branch refs/heads/feat/x",
        "",
        "worktree /wt/two",
        "HEAD cccc",
        "detached",
        ""
      ].join("\n")
    );
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ path: "/repo", branch: "main", isMain: true, detached: false });
    expect(entries[1]).toMatchObject({ path: "/wt/one", branch: "feat/x", isMain: false });
    expect(entries[2]).toMatchObject({ path: "/wt/two", branch: null, detached: true, head: "cccc" });
  });

  it("keeps locked and prunable reasons, and ignores unknown keys", () => {
    const entries = parseWorktreePorcelain(
      ["worktree /repo", "HEAD aaaa", "branch refs/heads/main", "future-key value", "", "worktree /gone", "HEAD bbbb", "prunable gitdir file points to non-existent location", "locked being rebased", ""].join(
        "\n"
      )
    );
    expect(entries[0]).toMatchObject({ isMain: true, locked: false, prunable: false });
    expect(entries[1]).toMatchObject({
      prunable: true,
      prunableReason: "gitdir file points to non-existent location",
      locked: true,
      lockedReason: "being rebased"
    });
  });
});

describe("worktreeDirName", () => {
  it("makes a readable name from repository and branch", () => {
    expect(worktreeDirName("agent-resume-panel", "feat/worktree-login")).toBe("agent-resume-panel-feat-worktree-login");
    expect(worktreeDirName("thunder", "fix/data_root")).toBe("thunder-fix-data_root");
  });

  it("keeps letters that are not ASCII so a Chinese name stays recognisable", () => {
    expect(worktreeDirName("原型工具", "feat/x")).toBe("原型工具-feat-x");
  });

  it("never returns an empty or dot-leading fragment", () => {
    expect(worktreeDirName("...", "...")).toBe("repo-worktree");
    expect(worktreeDirName("", "")).toBe("repo-worktree");
  });
});

describe("isPathWithin", () => {
  it("treats the directory itself as within, but not a sibling sharing a prefix", () => {
    expect(isPathWithin("/a/b", "/a/b")).toBe(true);
    expect(isPathWithin("/a/b/c", "/a/b")).toBe(true);
    expect(isPathWithin("/a/bc", "/a/b")).toBe(false);
    expect(isPathWithin("/a", "/a/b")).toBe(false);
  });
});

describe("worktreeGit", () => {
  it("creates a checkout under the task root and lists only that root", async () => {
    const { panelHome, noteId, repoRoot } = await setup();
    const root = taskWorktreeRoot(panelHome, noteId);
    expect(root).toBe(path.join(panelHome, ".desktop", "workspaces", noteId, ".worktrees"));

    const created = await worktreeCreate({ panelHome, noteId, repoRoot, branch: "feat/one" });
    expect(created.path).toBe(path.join(root, "app-feat-one"));
    expect(created.baseBranch).toBe("main");

    const listing = await listTask(panelHome, noteId, repoRoot);
    expect(listing.root).toBe(root);
    const [repo] = listing.repos;
    expect(repo).toMatchObject({ exists: true, isGitRepo: true, baseBranch: "main" });
    expect(repo.worktrees).toHaveLength(1);
    expect(repo.worktrees[0]).toMatchObject({ path: created.path, branch: "feat/one", missing: false });

    // A worktree created elsewhere — an agent that ignored the convention — is
    // visible to git but belongs to no task root, so it stays out of the listing.
    const outside = path.join(panelHome, "elsewhere");
    await git(repoRoot, ["worktree", "add", outside, "-b", "feat/outside"]);
    const after = await listTask(panelHome, noteId, repoRoot);
    expect(after.repos[0].worktrees.map((item) => item.path)).toEqual([created.path]);
  });

  it("reports a checkout as merged only once its commit is in the base branch", async () => {
    const { panelHome, noteId, repoRoot } = await setup();
    const created = await worktreeCreate({ panelHome, noteId, repoRoot, branch: "feat/two" });
    await fs.writeFile(path.join(created.path, "work.txt"), "work\n");
    await git(created.path, ["add", "-A"]);
    await git(created.path, ["commit", "-m", "work"]);

    expect((await listTask(panelHome, noteId, repoRoot)).repos[0].worktrees[0].merged).toBe(false);

    await git(repoRoot, ["merge", "--ff-only", "feat/two"]);
    expect((await listTask(panelHome, noteId, repoRoot)).repos[0].worktrees[0].merged).toBe(true);
  });

  it("counts what is at risk before a checkout is removed", async () => {
    const { panelHome, noteId, repoRoot } = await setup();
    const created = await worktreeCreate({ panelHome, noteId, repoRoot, branch: "feat/three" });

    const clean = await worktreeInspect({ repoRoot, targetPath: created.path });
    expect(clean).toMatchObject({ exists: true, dirty: false, stagedCount: 0, unstagedCount: 0, isMain: false });

    await fs.writeFile(path.join(created.path, "dirty.txt"), "x\n");
    const dirty = await worktreeInspect({ repoRoot, targetPath: created.path });
    expect(dirty.dirty).toBe(true);
    expect(dirty.unstagedCount).toBe(1);
  });

  it("refuses a dirty checkout, then removes it once the work is committed", async () => {
    const { panelHome, noteId, repoRoot } = await setup();
    const created = await worktreeCreate({ panelHome, noteId, repoRoot, branch: "feat/four" });
    await fs.writeFile(path.join(created.path, "dirty.txt"), "x\n");

    await expect(worktreeRemove({ repoRoot, targetPath: created.path })).rejects.toThrow();

    await git(created.path, ["add", "-A"]);
    await git(created.path, ["commit", "-m", "keep"]);
    await worktreeRemove({ repoRoot, targetPath: created.path });
    expect(await fs.stat(created.path).catch(() => null)).toBeNull();
    // The branch survives: removing a checkout is not deleting work.
    expect(await git(repoRoot, ["branch", "--list", "feat/four"])).toContain("feat/four");
  });

  it("refuses to remove a path this repository never registered", async () => {
    const { panelHome, repoRoot } = await setup();
    const stray = path.join(panelHome, "not-a-worktree");
    await fs.mkdir(stray, { recursive: true });
    await expect(worktreeRemove({ repoRoot, targetPath: stray })).rejects.toThrow(/已注册的 worktree/);
    expect(await fs.stat(stray)).not.toBeNull();
  });

  it("refuses a worktree root nested in the repository it would check out", async () => {
    const { repoRoot } = await setup();
    // panelHome inside the repository puts the task root inside it too.
    const nestedHome = path.join(repoRoot, "panel-home");
    roots.push(nestedHome);
    await fs.mkdir(nestedHome, { recursive: true });
    await expect(
      worktreeCreate({ panelHome: nestedHome, noteId: "note-2", repoRoot, branch: "feat/nested" })
    ).rejects.toThrow(/互相嵌套/);
  });

  it("round-trips per-task settings and survives a corrupt value", async () => {
    const { panelHome, noteId } = await setup();
    const db = path.join(panelHome, "catalog.db");
    await ensureExtensionCatalogSchema(db);

    expect(await readTaskWorktreeState(db, noteId)).toEqual({ enabled: false, baseBranch: {} });
    await patchTaskWorktreeState(db, noteId, { enabled: true, baseBranch: { "/repo": "develop" } });
    expect(await readTaskWorktreeState(db, noteId)).toMatchObject({ enabled: true, baseBranch: { "/repo": "develop" } });
    await patchTaskWorktreeState(db, noteId, { baseBranch: { "/other": "main" } });
    expect((await readTaskWorktreeState(db, noteId)).baseBranch).toEqual({ "/repo": "develop", "/other": "main" });

    // The value is opaque JSON in a plain KV table, so a garbled one has to fall
    // back to the default rather than break every workbench of that task.
    await setCatalogMeta(db, `desktop.worktree.task:${noteId}`, "{not json");
    expect(await readTaskWorktreeState(db, noteId)).toEqual({ enabled: false, baseBranch: {} });
  });
});
