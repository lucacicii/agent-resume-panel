import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { TaskWorktreeInfo, TaskWorktreeListing, TaskWorktreeState } from "../../../../shared/worktreeTypes";
import { useWorktreeReminders } from "./useWorktreeReminders";
import type { TaskWorktrees } from "./useTaskWorktrees";

const MESSAGES = {
  "desktop.workbench.worktreeOpenNotice": "{0} worktree(s) of this task are still around.",
  "desktop.workbench.worktreeDoneNotice": "Task marked done, with {0} worktree(s) still around.",
  "desktop.workbench.worktreeCloseNotice": "Closing with {0} worktree(s) still on disk.",
  "desktop.workbench.worktreeReview": "Show Worktrees",
  "desktop.workbench.worktreeDontRemind": "Don't remind me again",
  "desktop.workbench.worktreeLater": "Later",
  "desktop.workbench.worktreeNothingDeleted": "Nothing is deleted — the panel only reminds you.",
  "desktop.common.close": "Close"
};

const REPO = "/work/app";
const MAIN = REPO;
const FEAT = "/home/panel/.desktop/workspaces/n1/.worktrees/app-feat-x";
const OTHER = "/home/panel/.desktop/workspaces/n1/.worktrees/app-feat-y";

function entry(path: string, branch: string, extra: Partial<TaskWorktreeInfo> = {}): TaskWorktreeInfo {
  return { path, branch, head: "0".repeat(40), detached: false, bare: false, locked: false, prunable: false, isMain: false, missing: false, merged: false, createdAtMs: null, ...extra };
}

function worktreesWith(worktrees: TaskWorktreeInfo[], state: Partial<TaskWorktreeState> = {}): TaskWorktrees {
  const listing: TaskWorktreeListing = {
    root: "/home/panel/.desktop/workspaces/n1/.worktrees",
    repos: [{ repoRoot: REPO, label: "app", exists: true, isGitRepo: true, baseBranch: "main", worktrees }]
  };
  return {
    root: listing.root,
    listing,
    checkouts: [],
    loading: false,
    error: null,
    state: { enabled: true, baseBranch: {}, ...state },
    saveState: async () => undefined,
    refresh: async () => undefined,
    rootFor: (_scope, repoRoot) => repoRoot,
    checkoutFor: () => null,
    isPinned: () => false,
    select: () => undefined,
    pin: () => undefined,
    unpin: () => undefined
  };
}

function installBridge(confirm: boolean) {
  const calls = { confirm: [] as Array<{ message: string; confirmLabel?: string; cancelLabel?: string; detail?: string; destructive?: boolean }> };
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
    onLocaleChanged: () => () => undefined,
    dialogConfirm: async (args: { message: string }) => {
      calls.confirm.push(args);
      return confirm;
    }
  } as unknown as typeof window.agentResume;
  return calls;
}

async function mount(options: { worktrees: TaskWorktrees; status?: string; confirm?: boolean; noteId?: string | null }) {
  const calls = installBridge(options.confirm ?? false);
  const onOpenWorktrees = vi.fn();
  const saveState = vi.fn(async (_patch: Partial<TaskWorktreeState>) => undefined);
  const worktrees = { ...options.worktrees, saveState };
  const rendered = renderHook(
    (props: { status?: string }) =>
      useWorktreeReminders({ noteId: options.noteId === undefined ? "n1" : options.noteId, status: props.status, worktrees, onOpenWorktrees }),
    { wrapper: I18nProvider, initialProps: { status: options.status } as { status?: string } }
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { ...rendered, calls, onOpenWorktrees, saveState };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWorktreeReminders", () => {
  it("says once what a task is still carrying, and remembers being waved away", async () => {
    const { calls, saveState } = await mount({
      worktrees: worktreesWith([entry(MAIN, "main", { isMain: true }), entry(FEAT, "feat/x"), entry(OTHER, "feat/y")]),
      confirm: true
    });
    await waitFor(() => expect(calls.confirm).toHaveLength(1));
    expect(calls.confirm[0].message).toBe("2 worktree(s) of this task are still around.");
    expect(calls.confirm[0].detail).toBe("app ▸ feat/x\napp ▸ feat/y");
    expect(calls.confirm[0].confirmLabel).toBe("Don't remind me again");
    // Alert style: Return and Escape mean "later", so forgetting takes a click.
    expect(calls.confirm[0].destructive).toBe(true);
    await waitFor(() => expect(saveState).toHaveBeenCalledTimes(1));
    expect(Object.keys(saveState.mock.calls[0][0].dismissed ?? {})).toEqual([FEAT, OTHER]);
  });

  it("leaves dismissed checkouts out, and asks nothing when they all are", async () => {
    const { calls } = await mount({
      worktrees: worktreesWith([entry(FEAT, "feat/x"), entry(OTHER, "feat/y")], { dismissed: { [FEAT]: 1 } })
    });
    await waitFor(() => expect(calls.confirm).toHaveLength(1));
    expect(calls.confirm[0].message).toBe("1 worktree(s) of this task are still around.");
    expect(calls.confirm[0].detail).toBe("app ▸ feat/y");

    const silent = await mount({ worktrees: worktreesWith([entry(FEAT, "feat/x")], { dismissed: { [FEAT]: 1 } }) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(silent.calls.confirm).toEqual([]);
  });

  it("asks nothing about a task with only its main checkout", async () => {
    const { calls } = await mount({ worktrees: worktreesWith([entry(MAIN, "main", { isMain: true })]) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.confirm).toEqual([]);
  });

  it("offers to show them when the task is marked done", async () => {
    const worktrees = worktreesWith([entry(FEAT, "feat/x")]);
    const { calls, rerender, onOpenWorktrees } = await mount({ worktrees, status: "next", confirm: true });
    // Still open: a task that has not finished is not an occasion to interrupt.
    expect(calls.confirm.filter((call) => call.message.startsWith("Task marked done"))).toEqual([]);

    await act(async () => {
      rerender({ status: "done" });
    });
    await waitFor(() => expect(calls.confirm.some((call) => call.message === "Task marked done, with 1 worktree(s) still around.")).toBe(true));
    expect(calls.confirm.at(-1)?.confirmLabel).toBe("Show Worktrees");
    expect(onOpenWorktrees).toHaveBeenCalledTimes(1);
  });

  it("does not mistake an already-finished task for one that just finished", async () => {
    const { calls } = await mount({ worktrees: worktreesWith([entry(FEAT, "feat/x")]), status: "done", confirm: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.confirm.filter((call) => call.message.startsWith("Task marked done"))).toEqual([]);
  });

  it("allows the close by default, and holds the window only when asked", async () => {
    const { result, calls, onOpenWorktrees } = await mount({ worktrees: worktreesWith([entry(FEAT, "feat/x")]), confirm: false });
    let allowed = true;
    await act(async () => {
      allowed = await result.current.remindBeforeClose();
    });
    const closing = calls.confirm.filter((call) => call.message.startsWith("Closing"));
    expect(allowed).toBe(true);
    expect(closing[0].message).toBe("Closing with 1 worktree(s) still on disk.");
    expect(closing[0].cancelLabel).toBe("Close");
    // The dialog says out loud that closing is not deleting.
    expect(closing[0].detail).toContain("Nothing is deleted");
    expect(onOpenWorktrees).not.toHaveBeenCalled();

    const review = await mount({ worktrees: worktreesWith([entry(FEAT, "feat/x")]), confirm: true });
    let held = true;
    await act(async () => {
      held = await review.result.current.remindBeforeClose();
    });
    expect(held).toBe(false);
    expect(review.onOpenWorktrees).toHaveBeenCalledTimes(1);
  });

  it("asks once per window, and never when there is nothing to report", async () => {
    const withCheckouts = await mount({ worktrees: worktreesWith([entry(FEAT, "feat/x")]) });
    await act(async () => {
      await withCheckouts.result.current.remindBeforeClose();
      await withCheckouts.result.current.remindBeforeClose();
    });
    // One dialog per close attempt, however many checkouts there are, and none on
    // a second attempt.
    expect(withCheckouts.calls.confirm.filter((call) => call.message.startsWith("Closing"))).toHaveLength(1);

    const clean = await mount({ worktrees: worktreesWith([entry(MAIN, "main", { isMain: true })]) });
    let allowed = false;
    await act(async () => {
      allowed = await clean.result.current.remindBeforeClose();
    });
    expect(allowed).toBe(true);
    expect(clean.calls.confirm).toEqual([]);
  });
});
