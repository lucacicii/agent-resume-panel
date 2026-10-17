import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { TaskWorktreeInfo, TaskWorktreeListing, TaskWorktreeState } from "../../../../shared/worktreeTypes";
import { useTaskWorktrees } from "./useTaskWorktrees";

const REPOS = ["/work/app", "/work/lib"];
const MAIN_APP = "/work/app";
const FEAT_APP = "/wt/app-feat-x";
const MAIN_LIB = "/work/lib";

function entry(path: string, branch: string | null, extra: Partial<TaskWorktreeInfo> = {}): TaskWorktreeInfo {
  return { path, branch, head: "0".repeat(40), detached: !branch, bare: false, locked: false, prunable: false, isMain: false, missing: false, merged: false, createdAtMs: null, ...extra };
}

const LISTING: TaskWorktreeListing = {
  root: "/home/panel/.desktop/workspaces/n1/.worktrees",
  repos: [
    {
      repoRoot: MAIN_APP,
      label: "app",
      exists: true,
      isGitRepo: true,
      baseBranch: "main",
      worktrees: [entry(MAIN_APP, "main", { isMain: true }), entry(FEAT_APP, "feat/x")]
    },
    {
      repoRoot: MAIN_LIB,
      label: "lib",
      exists: true,
      isGitRepo: true,
      baseBranch: "main",
      // Its worktree's folder is gone: there is nothing there to look at.
      worktrees: [entry(MAIN_LIB, "main", { isMain: true }), entry("/wt/lib-gone", "feat/gone", { missing: true })]
    }
  ]
};

function installBridge(options: { list?: TaskWorktreeListing | null; state?: Partial<TaskWorktreeState> } = {}) {
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: {} }),
    onLocaleChanged: () => () => undefined,
    workbenchListWorktrees: async () => options.list ?? null,
    notesGetWorktreeSettings: async () => ({ enabled: false, baseBranch: {}, ...options.state }),
    notesSetWorktreeSettings: async (args: { noteId: string; patch: Partial<TaskWorktreeState> }) => ({ enabled: false, baseBranch: {}, ...options.state, ...args.patch }),
    onWorkbenchFileSystemChanged: () => () => undefined
  } as unknown as typeof window.agentResume;
}

async function mount(options: { list?: TaskWorktreeListing | null; state?: Partial<TaskWorktreeState>; repos?: string[] } = {}) {
  installBridge(options);
  const repos = options.repos ?? REPOS;
  const rendered = renderHook(() => useTaskWorktrees({ noteId: "n1", repos }), { wrapper: I18nProvider });
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTaskWorktrees", () => {
  it("leaves every root alone until something diverts it", async () => {
    const { result } = await mount({ list: LISTING });
    expect(result.current.checkouts.map((option) => option.path)).toEqual([MAIN_APP, FEAT_APP, MAIN_LIB]);
    for (const scope of ["default", "files", "git", "search", "terminal"] as const) {
      expect(result.current.rootFor(scope, MAIN_APP)).toBe(MAIN_APP);
      expect(result.current.rootFor(scope, MAIN_LIB)).toBe(MAIN_LIB);
    }
  });

  it("diverts only the repository the chosen checkout belongs to", async () => {
    const { result } = await mount({ list: LISTING });
    act(() => result.current.select("files", MAIN_APP, FEAT_APP));
    await waitFor(() => expect(result.current.rootFor("files", MAIN_APP)).toBe(FEAT_APP));
    // The other repository of the task stays where it is...
    expect(result.current.rootFor("files", MAIN_LIB)).toBe(MAIN_LIB);
    // ...and an unpinned scope moves the shared default, so every pane follows.
    expect(result.current.rootFor("git", MAIN_APP)).toBe(FEAT_APP);
    expect(result.current.isPinned("files")).toBe(false);
  });

  it("keeps a pinned pane where it was when the workbench moves on", async () => {
    const { result } = await mount({ list: LISTING });
    act(() => result.current.pin("git"));
    await waitFor(() => expect(result.current.isPinned("git")).toBe(true));

    act(() => result.current.select("files", MAIN_APP, FEAT_APP));
    await waitFor(() => expect(result.current.rootFor("files", MAIN_APP)).toBe(FEAT_APP));
    expect(result.current.rootFor("git", MAIN_APP)).toBe(MAIN_APP);

    // A pinned pane only moves itself, and unpinning hands it back to the fold.
    act(() => result.current.select("git", MAIN_APP, FEAT_APP));
    await waitFor(() => expect(result.current.rootFor("git", MAIN_APP)).toBe(FEAT_APP));
    expect(result.current.rootFor("files", MAIN_APP)).toBe(FEAT_APP);
    act(() => result.current.unpin("git"));
    await waitFor(() => expect(result.current.isPinned("git")).toBe(false));
  });

  it("returns a repository to its main checkout when that is what is chosen", async () => {
    const { result } = await mount({ list: LISTING });
    act(() => result.current.select("default", MAIN_APP, FEAT_APP));
    await waitFor(() => expect(result.current.rootFor("default", MAIN_APP)).toBe(FEAT_APP));
    act(() => result.current.select("default", MAIN_APP, MAIN_APP));
    await waitFor(() => expect(result.current.rootFor("default", MAIN_APP)).toBe(MAIN_APP));
    expect(result.current.checkoutFor("default", MAIN_APP)).toBeNull();
  });

  it("survives a bridge that answers with nothing", async () => {
    // An older or failed call gives no listing at all: the panel then has no
    // checkout control rather than a crash on an unexpected shape.
    const { result } = await mount({ list: null });
    expect(result.current.checkouts).toEqual([]);
    expect(result.current.rootFor("files", MAIN_APP)).toBe(MAIN_APP);
    expect(result.current.state).toEqual({ enabled: false, baseBranch: {} });
  });

  it("reports the task's worktree setting", async () => {
    const { result } = await mount({ list: LISTING, state: { enabled: true } });
    await waitFor(() => expect(result.current.state.enabled).toBe(true));
    expect(result.current.root).toBe(LISTING.root);
  });
});
