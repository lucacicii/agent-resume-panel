import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { WorktreeCreateSheet } from "./WorktreeCreateSheet";

const MESSAGES = {
  "desktop.workbench.worktreeCreateTitle": "New Worktree",
  "desktop.workbench.worktreeRepo": "Repository",
  "desktop.workbench.worktreeBranch": "Branch",
  "desktop.workbench.worktreeBranchNew": "Create a new branch",
  "desktop.workbench.worktreeBranchExisting": "Use an existing branch",
  "desktop.workbench.worktreeBranchName": "Branch name",
  "desktop.workbench.worktreeBase": "Based on",
  "desktop.workbench.worktreeWillCreate": "Will create",
  "desktop.workbench.worktreeNoDeps": "No node_modules yet.",
  "desktop.workbench.worktreeInstall": "Install Dependencies in Terminal",
  "desktop.workbench.worktreeNotGitRepo": "Not a Git repository",
  "desktop.common.cancel": "Cancel",
  "desktop.common.close": "Close",
  "desktop.common.loading": "Loading…"
};

const ROOT = "/home/panel/.desktop/workspaces/n1/.worktrees";
const REPO = "/work/agent-resume-panel";

function installBridge() {
  window.agentResume = {
    getI18nBundle: async () => ({ locale: "en", messages: MESSAGES }),
    onLocaleChanged: () => () => undefined,
    terminalGitBranches: async () => ({ mode: "direct", current: "develop", localBranches: ["develop", "main"], remoteBranches: [] })
  } as unknown as typeof window.agentResume;
}

async function renderSheet(onCreate: (input: { repoRoot: string; branch: string; baseBranch?: string }) => Promise<{ path: string; branch: string }>) {
  const onOpenTerminal = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <WorktreeCreateSheet
      open
      onClose={onClose}
      repos={[{ repoRoot: REPO, label: "agent-resume-panel", baseBranch: "develop" }]}
      root={ROOT}
      preferredRepo={REPO}
      savedBaseBranch={{}}
      onCreate={onCreate}
      onOpenTerminal={onOpenTerminal}
    />,
    { wrapper: I18nProvider }
  );
  await act(async () => { await Promise.resolve(); });
  return { ...view, onOpenTerminal, onClose };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorktreeCreateSheet", () => {
  it("previews the directory with the same rule the main process uses", async () => {
    installBridge();
    await renderSheet(async () => ({ path: "", branch: "" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "New Worktree" }).hasAttribute("disabled")).toBe(true));

    fireEvent.change(screen.getByPlaceholderText("feat/my-change"), { target: { value: "feat/worktree-login" } });
    expect(screen.getByText("agent-resume-panel-feat-worktree-login")).toBeTruthy();
    // The basis defaults to the branch the repository is on.
    expect(screen.getByRole("button", { name: "Based on: develop" })).toBeTruthy();
  });

  it("creates the checkout the form describes, then offers a terminal in it", async () => {
    installBridge();
    const created = { path: `${ROOT}/agent-resume-panel-feat-x`, branch: "feat/x" };
    const onCreate = vi.fn(async () => created);
    const { onOpenTerminal } = await renderSheet(onCreate);
    await waitFor(() => expect(screen.getByRole("button", { name: "Based on: develop" })).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("feat/my-change"), { target: { value: "feat/x" } });
    fireEvent.click(screen.getByRole("button", { name: "New Worktree" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ repoRoot: REPO, branch: "feat/x", baseBranch: "develop" }));
    await waitFor(() => expect(screen.getByText(created.path)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Install Dependencies in Terminal" }));
    expect(onOpenTerminal).toHaveBeenCalledWith(created.path);
  });

  it("shows why a checkout could not be made and stays open", async () => {
    installBridge();
    const onCreate = vi.fn(async () => {
      throw new Error("fatal: 'feat/x' is already checked out at /wt/x");
    });
    const { onClose } = await renderSheet(onCreate);
    await waitFor(() => expect(screen.getByRole("button", { name: "Based on: develop" })).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText("feat/my-change"), { target: { value: "feat/x" } });
    fireEvent.click(screen.getByRole("button", { name: "New Worktree" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("already checked out");
    // Still a form: the branch can be corrected instead of the sheet starting over.
    expect(screen.getByPlaceholderText("feat/my-change")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("switches to reusing an existing branch instead of creating one", async () => {
    installBridge();
    const onCreate = vi.fn(async () => ({ path: `${ROOT}/agent-resume-panel-main`, branch: "main" }));
    await renderSheet(onCreate);
    await waitFor(() => expect(screen.getByRole("button", { name: "Based on: develop" })).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: "Use an existing branch" }));
    expect(screen.queryByPlaceholderText("feat/my-change")).toBeNull();
    // Nothing is created until a branch is picked from the menu.
    expect(screen.getByRole("button", { name: "New Worktree" }).hasAttribute("disabled")).toBe(true);
  });
});
