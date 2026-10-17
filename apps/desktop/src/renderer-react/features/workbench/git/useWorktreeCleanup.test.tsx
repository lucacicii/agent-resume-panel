import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { TaskWorktreeOrphans, WorktreeRiskReport } from "../../../../shared/worktreeTypes";
import { useWorktreeCleanup } from "./useWorktreeCleanup";

const MESSAGES = {
  "desktop.workbench.worktreeDeleteConfirm": "Remove the worktree {0}?",
  "desktop.workbench.worktreeDeleted": "Worktree removed: {0}",
  "desktop.workbench.worktreeDeleteLocked": "This checkout is locked and cannot be removed: {0}",
  "desktop.workbench.worktreeStateDirty": "{0} uncommitted changes",
  "desktop.workbench.worktreeRiskUnmerged": "{0} commit(s) not in the base branch",
  "desktop.workbench.worktreeRiskUnpushed": "{0} commit(s) not pushed",
  "desktop.workbench.worktreeRiskSessions": "{0} terminal(s) still open in this folder",
  "desktop.workbench.worktreeRiskBranchKept": "The branch {0} is kept.",
  "desktop.workbench.worktreeRiskDetached": "This checkout is on a detached HEAD.",
  "desktop.workbench.worktreePrune": "Clean Up Stale Entries",
  "desktop.workbench.worktreePruneConfirm": "Forget the {0} repository's records?",
  "desktop.common.delete": "Delete"
};

const REPO = "/work/app";
const CHECKOUT = "/home/panel/.desktop/workspaces/n1/.worktrees/app-feat-x";

function report(extra: Partial<WorktreeRiskReport> = {}): WorktreeRiskReport {
  return {
    exists: true,
    dirty: false,
    stagedCount: 0,
    unstagedCount: 0,
    unmergedCommits: 0,
    mergedIntoBase: true,
    aheadOfUpstream: null,
    liveSessionsInPath: 0,
    branch: "feat/x",
    baseBranch: "main",
    detached: false,
    locked: false,
    prunable: false,
    isMain: false,
    ...extra
  };
}

const ORPHANS: TaskWorktreeOrphans = {
  repos: [{ repoRoot: REPO, label: "app", baseBranch: "main", worktrees: [] }]
};

function installBridge(options: { risk?: WorktreeRiskReport; confirm?: boolean; orphans?: TaskWorktreeOrphans | null; gone?: boolean } = {}) {
  const calls = {
    remove: [] as Array<{ repoRoot: string; path: string; force?: boolean }>,
    prune: [] as Array<{ repoRoot: string }>,
    confirm: [] as Array<{ message: string; confirmLabel?: string; detail?: string }>,
    orphanQueries: 0
  };
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
    onLocaleChanged: () => () => undefined,
    workbenchInspectWorktree: async () => options.risk ?? report(),
    workbenchRemoveWorktree: async (args: { repoRoot: string; path: string; force?: boolean }) => {
      calls.remove.push(args);
      return { pruned: false };
    },
    workbenchPruneWorktrees: async (args: { repoRoot: string }) => {
      calls.prune.push(args);
      return { ok: true };
    },
    workbenchListOrphanWorktrees: async () => {
      calls.orphanQueries += 1;
      return options.orphans ?? null;
    },
    dialogConfirm: async (args: { message: string; confirmLabel?: string; detail?: string }) => {
      calls.confirm.push(args);
      return options.confirm ?? true;
    }
  } as unknown as typeof window.agentResume;
  return calls;
}

async function mount(options: Parameters<typeof installBridge>[0] & { active?: boolean } = {}) {
  const calls = installBridge(options);
  const onRemoved = vi.fn();
  const rendered = renderHook(
    () => useWorktreeCleanup({
      noteId: "n1",
      repos: [REPO],
      active: options.active ?? true,
      checkoutGone: async () => options.gone ?? false,
      onRemoved
    }),
    { wrapper: I18nProvider }
  );
  // The i18n bundle arrives in an effect; the messages must be in place before a
  // label is asserted.
  await act(async () => {
    await Promise.resolve();
  });
  return { ...rendered, calls, onRemoved };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWorktreeCleanup", () => {
  it("quotes the real risk before removing, and forces only what is dirty", async () => {
    const { result, calls, onRemoved } = await mount({
      risk: report({ dirty: true, stagedCount: 1, unstagedCount: 2, unmergedCommits: 3, liveSessionsInPath: 1 })
    });
    await act(async () => {
      expect(await result.current.remove({ repoRoot: REPO, path: CHECKOUT, branchLabel: "feat/x" })).toBe(true);
    });
    await waitFor(() => expect(calls.remove).toHaveLength(1));

    expect(calls.confirm[0].message).toBe("Remove the worktree feat/x?");
    expect(calls.confirm[0].confirmLabel).toBe("Delete");
    // Every number in the dialog comes from the inspection, not from the panel's
    // stale idea of the checkout.
    expect(calls.confirm[0].detail).toContain("3 uncommitted changes");
    expect(calls.confirm[0].detail).toContain("3 commit(s) not in the base branch");
    expect(calls.confirm[0].detail).toContain("1 terminal(s) still open in this folder");
    // Removing a worktree never costs the branch, and the dialog says so.
    expect(calls.confirm[0].detail).toContain("The branch feat/x is kept.");
    expect(calls.remove[0]).toMatchObject({ repoRoot: REPO, path: CHECKOUT, force: true });
    expect(onRemoved).toHaveBeenCalledWith(expect.objectContaining({ path: CHECKOUT }));
  });

  it("says nothing about a checkout that went away before the button was pressed", async () => {
    const { result, calls, onRemoved } = await mount({ gone: true });
    await act(async () => {
      expect(await result.current.remove({ repoRoot: REPO, path: CHECKOUT, branchLabel: "feat/x" })).toBe(true);
    });
    // Nothing to weigh and nothing to confirm: the row is already gone, and whose
    // hand removed it — the agent's, or Finder's — is not the panel's to report on.
    expect(calls.confirm).toEqual([]);
    expect(calls.remove).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("leaves a clean checkout to git without the force flag", async () => {
    const { result, calls } = await mount();
    await act(async () => {
      await result.current.remove({ repoRoot: REPO, path: CHECKOUT, branchLabel: "feat/x" });
    });
    expect(calls.remove[0].force).toBe(false);
    expect(calls.confirm[0].detail).not.toContain("uncommitted");
  });

  it("removes nothing when the confirmation is dismissed", async () => {
    const { result, calls, onRemoved } = await mount({ confirm: false, risk: report({ dirty: true, unstagedCount: 1 }) });
    await act(async () => {
      expect(await result.current.remove({ repoRoot: REPO, path: CHECKOUT, branchLabel: "feat/x" })).toBe(false);
    });
    // Git's own refusal is what protects a dirty checkout, so a dismissed dialog
    // has to leave the flag alone.
    expect(calls.remove).toEqual([]);
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("refuses a locked checkout without asking, and says why", async () => {
    const { result, calls } = await mount();
    await act(async () => {
      expect(await result.current.remove({ repoRoot: REPO, path: CHECKOUT, branchLabel: "feat/x", locked: true, lockedReason: "being rebased" })).toBe(false);
    });
    expect(calls.confirm).toEqual([]);
    expect(calls.remove).toEqual([]);
    expect(result.current.error).toContain("being rebased");
  });

  it("surfaces what git said when a removal fails", async () => {
    installBridge();
    (window.agentResume as unknown as { workbenchRemoveWorktree: () => Promise<never> }).workbenchRemoveWorktree = async () => {
      throw new Error("fatal: validation failed, cannot remove working tree");
    };
    const onRemoved = vi.fn();
    const { result } = renderHook(
      () => useWorktreeCleanup({ noteId: "n1", repos: [REPO], active: true, checkoutGone: async () => false, onRemoved }),
      { wrapper: I18nProvider }
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.remove({ repoRoot: REPO, path: CHECKOUT, branchLabel: "feat/x" });
    });
    await waitFor(() => expect(result.current.error).toContain("cannot remove working tree"));
    expect(onRemoved).not.toHaveBeenCalled();
    expect(result.current.busyPath).toBeNull();
  });

  it("lists what deleted tasks left behind, only while the sheet is open", async () => {
    const closed = await mount({ orphans: ORPHANS, active: false });
    expect(closed.calls.orphanQueries).toBe(0);

    const open = await mount({ orphans: ORPHANS });
    await waitFor(() => expect(open.result.current.orphans?.repos).toHaveLength(1));

    const empty = await mount({ orphans: null });
    await waitFor(() => expect(empty.result.current.orphans).toBeNull());
  });

  it("clears stale records per repository, and only after asking", async () => {
    const { result, calls } = await mount();
    await act(async () => {
      expect(await result.current.prune([REPO])).toBe(true);
    });
    expect(calls.prune).toEqual([{ repoRoot: REPO }]);
    expect(calls.confirm[0].message).toContain("1 repository");

    const cancelled = await mount({ confirm: false });
    await act(async () => {
      expect(await cancelled.result.current.prune([REPO])).toBe(false);
    });
    expect(cancelled.calls.prune).toEqual([]);
  });
});
