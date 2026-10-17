import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { TaskWorktreeInfo, TaskWorktreeListing } from "../../../shared/worktreeTypes";
import { TaskSettingsSheet } from "./TaskSettingsSheet";
import type { TaskWorktrees } from "./git/useTaskWorktrees";
import type { WorktreeCleanup } from "./git/useWorktreeCleanup";

const MESSAGES = {
  "desktop.workbench.taskSettings": "Task Settings",
  "desktop.workbench.taskSettingsFolders": "Folders",
  "desktop.workbench.taskNoProject": "No folders yet.",
  "desktop.workbench.addProject": "Add Folder",
  "desktop.workbench.removeProject": "Remove",
  "desktop.workbench.worktreeSection": "Worktrees",
  "desktop.workbench.worktreeEnable": "Enable worktree mode",
  "desktop.workbench.worktreeEnableHint": "Agents create one worktree per affected repository.",
  "desktop.workbench.worktreeRoot": "Location",
  "desktop.workbench.worktreeReminder": "{0} worktree(s) still on disk.",
  "desktop.workbench.worktreeListEmpty": "No worktrees yet.",
  "desktop.workbench.worktreeCreate": "New Worktree…",
  "desktop.workbench.worktreeMainCheckout": "Main checkout",
  "desktop.workbench.worktreeStateMerged": "Merged — safe to delete",
  "desktop.workbench.worktreeStateMissing": "Folder is gone",
  "desktop.workbench.worktreeStateLocked": "Locked",
  "desktop.workbench.worktreeDetached": "Detached HEAD",
  "desktop.workbench.worktreeDelete": "Delete…",
  "desktop.workbench.worktreeDeleteLocked": "This checkout is locked and cannot be removed: {0}",
  "desktop.workbench.worktreeLockedHint": "Locked: {0}",
  "desktop.workbench.worktreePrune": "Clean Up Stale Entries",
  "desktop.workbench.worktreePruneHint": "Removes records of checkouts whose folder is gone.",
  "desktop.workbench.worktreeOrphans": "{0} worktree(s) left behind by deleted tasks",
  "desktop.workbench.worktreeOrphanHint": "Their tasks no longer exist.",
  "desktop.common.revealInFinder": "Reveal in Finder"
};

const REPO = "/work/app";

function entry(path: string, branch: string | null, extra: Partial<TaskWorktreeInfo> = {}): TaskWorktreeInfo {
  return { path, branch, head: "0".repeat(40), detached: !branch, bare: false, locked: false, prunable: false, isMain: false, missing: false, merged: false, createdAtMs: null, ...extra };
}

function worktreesWith(worktrees: TaskWorktreeInfo[]): TaskWorktrees {
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
    state: { enabled: true, baseBranch: {} },
    saveState: async () => undefined,
    refresh: async () => null,
    dropVanishedCheckouts: async () => false,
    rootFor: (_scope, repoRoot) => repoRoot,
    checkoutFor: () => null,
    isPinned: () => false,
    select: () => undefined,
    pin: () => undefined,
    unpin: () => undefined
  };
}

function renderSheet(options: { worktrees: TaskWorktreeInfo[]; cleanup?: Partial<WorktreeCleanup> }): { remove: ReturnType<typeof vi.fn>; prune: ReturnType<typeof vi.fn> } {
  const remove = vi.fn(async () => true);
  const prune = vi.fn(async () => true);
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
    onLocaleChanged: () => () => undefined
  } as unknown as typeof window.agentResume;
  render(
    <TaskSettingsSheet
      open
      onClose={() => undefined}
      title="Cross-repo feature"
      statusColumn="inbox"
      statusLabel="Inbox"
      projects={[REPO]}
      aliases={{}}
      worktrees={worktreesWith(options.worktrees)}
      cleanup={{ busyPath: null, error: null, orphans: null, refreshOrphans: async () => undefined, remove, prune, ...options.cleanup }}
      onAddProject={() => undefined}
      onRemoveProject={() => undefined}
      onRevealPath={() => undefined}
      onCreateWorktree={() => undefined}
    />,
    { wrapper: I18nProvider }
  );
  return { remove, prune };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TaskSettingsSheet", () => {
  it("offers to delete a checkout, and never a repository's own working tree", async () => {
    renderSheet({
      worktrees: [entry(REPO, "main", { isMain: true }), entry(`${REPO}-feat`, "feat/x", { merged: true })]
    });
    // The main working tree has no row here at all: it is the repository itself,
    // named by the folder list above, and there is nothing about it to manage.
    expect(await screen.findByText("feat/x")).toBeTruthy();
    expect(screen.queryByText("Main checkout")).toBeNull();
    // One delete button for one removable checkout.
    expect(screen.getAllByRole("button", { name: "Delete…" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Clean Up Stale Entries" })).toBeNull();
  });

  it("leaves a repository with nothing but its own working tree out of the list", async () => {
    renderSheet({ worktrees: [entry(REPO, "main", { isMain: true })] });
    expect(await screen.findByText("No worktrees yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clean Up Stale Entries" })).toBeNull();
  });

  it("refuses a locked checkout up front and says what locked it", async () => {
    renderSheet({ worktrees: [entry(REPO, "main", { isMain: true }), entry(`${REPO}-locked`, "feat/locked", { locked: true, lockedReason: "being rebased" })] });
    const button = await screen.findByRole("button", { name: "Delete…" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toBe("Locked: being rebased");
  });

  it("clears a stale record instead of deleting a folder that is gone", async () => {
    const { prune } = renderSheet({
      worktrees: [entry(REPO, "main", { isMain: true }), entry(`${REPO}-gone`, "feat/gone", { missing: true })]
    });
    expect(await screen.findByText("Folder is gone")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
    screen.getByRole("button", { name: "Clean Up Stale Entries" }).click();
    expect(prune).toHaveBeenCalledWith([REPO]);
  });

  it("lists what deleted tasks left behind, with its own cleanup", async () => {
    const { prune } = renderSheet({
      worktrees: [entry(REPO, "main", { isMain: true })],
      cleanup: {
        orphans: {
          repos: [
            { repoRoot: REPO, label: "app", baseBranch: "main", worktrees: [entry("/home/panel/.desktop/workspaces/old/.worktrees/app-feat-old", "feat/old", { missing: true })] }
          ]
        }
      }
    });
    expect(await screen.findByText("1 worktree(s) left behind by deleted tasks")).toBeTruthy();
    expect(screen.getByText("app ▸ feat/old")).toBeTruthy();
    screen.getAllByRole("button", { name: "Clean Up Stale Entries" }).at(-1)?.click();
    expect(prune).toHaveBeenCalledWith([REPO]);
  });

  it("shows why a removal was refused", async () => {
    renderSheet({
      worktrees: [entry(REPO, "main", { isMain: true })],
      cleanup: { error: "fatal: validation failed, cannot remove working tree" }
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("cannot remove working tree");
  });
});
