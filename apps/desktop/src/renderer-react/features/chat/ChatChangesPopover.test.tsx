import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import React from "react";
import { I18nProvider } from "../../i18n";
import { ChatChangesPopover } from "./ChatChangesPopover";
import { useConversationChanges } from "./useConversationChanges";
import type { ConversationChanges } from "./useConversationChanges";
import type { GitNestedScanOptions } from "./gitDiffUtils";
import type { ThunderChatMessage, ThunderFileChangeRecord } from "@agent-resume/core";

const messages = {
  "desktop.chat.changes.label": "Changes",
  "desktop.chat.changes.tooltip": "View files changed in this conversation",
  "desktop.chat.changes.refresh": "Refresh",
  "desktop.chat.changes.tabDiff": "Diff",
  "desktop.chat.changes.tabFootprint": "Footprint",
  "desktop.chat.changes.tabDiffHint": "Uncommitted changes in this conversation",
  "desktop.chat.changes.tabFootprintHint": "Every file this conversation touched",
  "desktop.chat.changes.noPendingDiff": "No pending diff",
  "desktop.chat.changes.reasonCommitted": "committed",
  "desktop.chat.changes.reasonNotInRepo": "not in repo",
  "desktop.chat.changes.reasonFailed": "write failed",
  "desktop.chat.changes.unstageWarning": "Unselected staged files will be unstaged."
};

interface HarnessProps {
  isOpen?: boolean;
  workspaceDir: string;
  workspaceDirs?: string[];
  nestedScan?: GitNestedScanOptions;
  fileChanges?: ThunderFileChangeRecord[];
  messages?: ThunderChatMessage[];
  onCommitSuccess?: () => void;
}

function Harness({ isOpen = true, ...options }: HarnessProps): React.JSX.Element {
  const changes = useConversationChanges({
    workspaceDir: options.workspaceDir,
    workspaceDirs: options.workspaceDirs,
    nestedScan: options.nestedScan,
    fileChanges: options.fileChanges,
    messages: options.messages
  });
  return (
    <ChatChangesPopover
      isOpen={isOpen}
      onClose={vi.fn()}
      workspaceDir={options.workspaceDir}
      changes={changes}
      onCommitSuccess={options.onCommitSuccess}
    />
  );
}

function renderPopover(props: HarnessProps) {
  return render(
    <I18nProvider>
      <Harness {...props} />
    </I18nProvider>
  );
}

function stubChanges(overrides: Partial<ConversationChanges> = {}): ConversationChanges {
  return {
    status: null,
    repoRoots: [],
    files: [],
    noDiffEntries: [],
    footprintFiles: [],
    badgeCount: 0,
    footprintCount: 0,
    isLoading: false,
    hasLoaded: true,
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe("ChatChangesPopover", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    window.agentResume = {
      ...window.agentResume,
      getI18nBundle: vi.fn().mockResolvedValue({ locale: "en", messages }),
      onI18nBundleChanged: vi.fn().mockReturnValue(() => undefined),
      onLocaleChanged: vi.fn().mockReturnValue(() => undefined),
      terminalGitInfo: vi.fn().mockResolvedValue({
        isRepo: true,
        repoRoot: "/repo",
        branch: "feature/diff"
      }),
      terminalGitStatus: vi.fn().mockResolvedValue({
        isRepo: true,
        root: "/repo",
        unstaged: [
          { path: "src/app.ts", repoPath: "src/app.ts", status: "modified" },
          { path: "src/other-agent.ts", repoPath: "src/other-agent.ts", status: "modified" }
        ],
        staged: []
      }),
      terminalGitDiffSides: vi.fn().mockResolvedValue({
        oldLabel: "HEAD",
        newLabel: "Working Tree",
        oldText: "const a = 1;\n",
        newText: "const a = 2;\n",
        hunks: [],
        patch: `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,1 +1,1 @@
-const a = 1;
+const a = 2;`
      }),
      terminalGitSuggestCommit: vi.fn().mockResolvedValue({
        message: "fix(app): update variable a to 2",
        source: "llm"
      }),
      terminalGitCommit: vi.fn().mockResolvedValue({ ok: true }),
      terminalGitPush: vi.fn().mockResolvedValue({ ok: true })
    } as any;
  });

  it("returns null when isOpen is false", () => {
    const { container } = render(
      <I18nProvider>
        <ChatChangesPopover
          isOpen={false}
          onClose={vi.fn()}
          workspaceDir="/repo"
          changes={stubChanges()}
        />
      </I18nProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it("filters dirty files to only those modified in the conversation", async () => {
    renderPopover({
      workspaceDir: "/repo",
      fileChanges: [{ path: "/repo/src/app.ts", tool: "write_file", action: "written" }]
    });

    // Shows 1 file in this conversation, even though status returned 2 dirty files
    await waitFor(() => {
      expect(screen.getByText("src/app.ts")).toBeTruthy();
    });
    expect(screen.queryByText("src/other-agent.ts")).toBeNull();
    expect(screen.getByText("1 file")).toBeTruthy();

    // Accordion diff lines are rendered
    await waitFor(() => {
      expect(screen.getByText("const a = 1;")).toBeTruthy();
      expect(screen.getByText("const a = 2;")).toBeTruthy();
    });
  });

  it("toggles accordion item collapse and expansion", async () => {
    renderPopover({
      workspaceDir: "/repo",
      fileChanges: [{ path: "/repo/src/app.ts", tool: "write_file", action: "written" }]
    });

    await waitFor(() => {
      expect(screen.getByText("const a = 2;")).toBeTruthy();
    });

    const diffPanel = within(document.querySelector("#tb-changes-panel-diff") as HTMLElement);
    fireEvent.click(diffPanel.getByText("src/app.ts"));
    await waitFor(() => {
      expect(screen.queryByText("const a = 2;")).toBeNull();
    });

    fireEvent.click(diffPanel.getByText("src/app.ts"));
    await waitFor(() => {
      expect(screen.getByText("const a = 2;")).toBeTruthy();
    });
  });

  it("generates an AI commit message using the selected paths", async () => {
    renderPopover({
      workspaceDir: "/repo",
      fileChanges: [{ path: "/repo/src/app.ts", tool: "write_file", action: "written" }]
    });

    await waitFor(() => {
      expect(screen.getByText("AI Message")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("AI Message"));

    await waitFor(() => {
      expect(window.agentResume.terminalGitSuggestCommit).toHaveBeenCalledWith({
        repoRoot: "/repo",
        paths: ["src/app.ts"]
      });
    });

    const input = screen.getByPlaceholderText(
      "Commit message (auto-generated from .arp / settings if empty)..."
    ) as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).toBe("fix(app): update variable a to 2");
    });
  });

  it("performs 1-click commit and push only on the conversation's files", async () => {
    const onCommitSuccess = vi.fn();
    renderPopover({
      workspaceDir: "/repo",
      fileChanges: [{ path: "/repo/src/app.ts", tool: "write_file", action: "written" }],
      onCommitSuccess
    });

    await waitFor(() => {
      expect(screen.getByText("Commit & Push (1)")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Commit & Push (1)"));

    await waitFor(() => {
      expect(window.agentResume.terminalGitSuggestCommit).toHaveBeenCalledWith({
        repoRoot: "/repo",
        paths: ["src/app.ts"]
      });
    });
    await waitFor(() => {
      expect(window.agentResume.terminalGitCommit).toHaveBeenCalledWith({
        repoRoot: "/repo",
        message: "fix(app): update variable a to 2",
        paths: ["src/app.ts"]
      });
    });
    await waitFor(() => {
      expect(window.agentResume.terminalGitPush).toHaveBeenCalledWith({ repoRoot: "/repo" });
    });

    expect(onCommitSuccess).toHaveBeenCalled();
  });

  it("commits only the selected subset when a file is unchecked", async () => {
    window.agentResume.terminalGitStatus = vi.fn().mockResolvedValue({
      isRepo: true,
      root: "/repo",
      staged: [],
      unstaged: [
        { path: "src/a.ts", repoPath: "src/a.ts", status: "modified" },
        { path: "src/b.ts", repoPath: "src/b.ts", status: "modified" }
      ]
    });

    renderPopover({
      workspaceDir: "/repo",
      fileChanges: [
        { path: "/repo/src/a.ts", tool: "write_file", action: "written" },
        { path: "/repo/src/b.ts", tool: "write_file", action: "written" }
      ]
    });

    await waitFor(() => {
      expect(screen.getByText("Commit & Push (2)")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select src/b.ts" }));
    await waitFor(() => {
      expect(screen.getByText("Commit & Push (1)")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Commit & Push (1)"));
    await waitFor(() => {
      expect(window.agentResume.terminalGitCommit).toHaveBeenCalledWith({
        repoRoot: "/repo",
        message: "fix(app): update variable a to 2",
        paths: ["src/a.ts"]
      });
    });
  });

  it("shows empty state when no files were modified in this conversation", async () => {
    renderPopover({ workspaceDir: "/repo", fileChanges: [] });

    await waitFor(() => {
      expect(screen.getByText("No uncommitted Git changes in this conversation.")).toBeTruthy();
    });

    const btn = screen.getByText("Commit & Push (0)").closest("button");
    expect(btn?.disabled).toBe(true);
  });

  it("opens on the Footprint tab and skips diff loading when nothing is dirty", async () => {
    renderPopover({
      workspaceDir: "/repo",
      fileChanges: [{ path: "/repo/src/committed.ts", tool: "write_file", action: "written" }]
    });

    // The file is in the footprint but not dirty in git.
    await waitFor(() => {
      expect(screen.getByText("src/committed.ts")).toBeTruthy();
    });
    expect(window.agentResume.terminalGitDiffSides).not.toHaveBeenCalled();
    expect(screen.getByText("No pending diff (1)")).toBeTruthy();
  });

  it("switches tabs by click and arrow keys", async () => {
    renderPopover({
      workspaceDir: "/repo",
      fileChanges: [{ path: "/repo/src/app.ts", tool: "write_file", action: "written" }]
    });

    await waitFor(() => {
      expect(screen.getByText("const a = 2;")).toBeTruthy();
    });
    const diffCallsAfterLoad = (window.agentResume.terminalGitDiffSides as any).mock.calls.length;

    fireEvent.click(screen.getByRole("tab", { name: /Footprint/ }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Footprint/ }).getAttribute("aria-selected")).toBe(
        "true"
      );
    });
    // Inactive tab does not refetch diffs.
    expect((window.agentResume.terminalGitDiffSides as any).mock.calls.length).toBe(
      diffCallsAfterLoad
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: /Footprint/ }), { key: "ArrowLeft" });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Diff/ }).getAttribute("aria-selected")).toBe(
        "true"
      );
    });
  });

  it("detects nested repositories and commits each dirty repo", async () => {
    window.agentResume.terminalGitStatus = vi.fn().mockResolvedValue({
      isRepo: true,
      root: null,
      nestedRepos: [
        { root: "/work/mono/pkg-a", displayPath: "pkg-a" },
        { root: "/work/mono/pkg-b", displayPath: "pkg-b" }
      ],
      staged: [],
      unstaged: [
        { path: "pkg-a/index.ts", repoPath: "index.ts", repoRoot: "/work/mono/pkg-a", status: "modified" },
        { path: "pkg-b/index.ts", repoPath: "index.ts", repoRoot: "/work/mono/pkg-b", status: "modified" }
      ]
    });

    renderPopover({
      workspaceDir: "/work/mono",
      workspaceDirs: ["/work/mono"],
      nestedScan: { maxDepth: 6 },
      fileChanges: [
        { path: "/work/mono/pkg-a/index.ts", tool: "write_file", action: "written" },
        { path: "/work/mono/pkg-b/index.ts", tool: "write_file", action: "written" }
      ]
    });

    await waitFor(() => {
      expect(screen.getByText("2 files")).toBeTruthy();
    });
    expect(window.agentResume.terminalGitStatus).toHaveBeenCalledWith({
      cwd: "/work/mono",
      nestedScan: { maxDepth: 6 }
    });
    expect(screen.getByText("pkg-a")).toBeTruthy();
    expect(screen.getByText("pkg-b")).toBeTruthy();
    await waitFor(() => {
      expect(window.agentResume.terminalGitDiffSides).toHaveBeenCalledWith({
        cwd: "/work/mono/pkg-a",
        path: "index.ts",
        staged: false
      });
      expect(window.agentResume.terminalGitDiffSides).toHaveBeenCalledWith({
        cwd: "/work/mono/pkg-b",
        path: "index.ts",
        staged: false
      });
    });

    fireEvent.click(screen.getByText("Commit & Push (2)"));

    await waitFor(() => {
      expect(window.agentResume.terminalGitCommit).toHaveBeenCalledWith({
        repoRoot: "/work/mono/pkg-a",
        message: "fix(app): update variable a to 2",
        paths: ["index.ts"]
      });
      expect(window.agentResume.terminalGitCommit).toHaveBeenCalledWith({
        repoRoot: "/work/mono/pkg-b",
        message: "fix(app): update variable a to 2",
        paths: ["index.ts"]
      });
    });
    await waitFor(() => {
      expect(window.agentResume.terminalGitPush).toHaveBeenCalledWith({ repoRoot: "/work/mono/pkg-a" });
      expect(window.agentResume.terminalGitPush).toHaveBeenCalledWith({ repoRoot: "/work/mono/pkg-b" });
    });
  });

  it("keeps committing other repos when one push fails, and can retry", async () => {
    window.agentResume.terminalGitStatus = vi.fn().mockResolvedValue({
      isRepo: true,
      root: null,
      nestedRepos: [
        { root: "/work/mono/pkg-a", displayPath: "pkg-a" },
        { root: "/work/mono/pkg-b", displayPath: "pkg-b" }
      ],
      staged: [],
      unstaged: [
        { path: "pkg-a/index.ts", repoPath: "index.ts", repoRoot: "/work/mono/pkg-a", status: "modified" },
        { path: "pkg-b/index.ts", repoPath: "index.ts", repoRoot: "/work/mono/pkg-b", status: "modified" }
      ]
    });
    window.agentResume.terminalGitPush = vi
      .fn()
      .mockRejectedValueOnce(new Error("push rejected"))
      .mockResolvedValue({ ok: true });

    renderPopover({
      workspaceDir: "/work/mono",
      workspaceDirs: ["/work/mono"],
      fileChanges: [
        { path: "/work/mono/pkg-a/index.ts", tool: "write_file", action: "written" },
        { path: "/work/mono/pkg-b/index.ts", tool: "write_file", action: "written" }
      ]
    });

    await waitFor(() => {
      expect(screen.getByText("Commit & Push (2)")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Commit & Push (2)"));

    await waitFor(() => {
      expect(screen.getByText("Retry push")).toBeTruthy();
    });
    // Both repos were committed despite the pkg-a push failure.
    expect(window.agentResume.terminalGitCommit).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText("Retry push"));
    await waitFor(() => {
      expect(screen.queryByText("Retry push")).toBeNull();
    });
  });
});
