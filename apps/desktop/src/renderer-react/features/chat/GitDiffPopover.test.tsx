import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import React from "react";
import { GitDiffPopover } from "./GitDiffPopover";
import type { ThunderChatMessage, ThunderFileChangeRecord } from "@agent-resume/core";

describe("GitDiffPopover", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    window.agentResume = {
      ...window.agentResume,
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
      <GitDiffPopover
        isOpen={false}
        onClose={vi.fn()}
        workspaceDir="/repo"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("filters dirty files to only those modified in the conversation", async () => {
    const fileChanges: ThunderFileChangeRecord[] = [
      { path: "/repo/src/app.ts", tool: "write_file", action: "written" }
    ];

    render(
      <GitDiffPopover
        isOpen={true}
        onClose={vi.fn()}
        workspaceDir="/repo"
        fileChanges={fileChanges}
      />
    );

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
    const fileChanges: ThunderFileChangeRecord[] = [
      { path: "/repo/src/app.ts", tool: "write_file", action: "written" }
    ];

    render(
      <GitDiffPopover
        isOpen={true}
        onClose={vi.fn()}
        workspaceDir="/repo"
        fileChanges={fileChanges}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("const a = 2;")).toBeTruthy();
    });

    // Clicking header collapses it
    fireEvent.click(screen.getByText("src/app.ts"));
    await waitFor(() => {
      expect(screen.queryByText("const a = 2;")).toBeNull();
    });

    // Clicking header re-expands it
    fireEvent.click(screen.getByText("src/app.ts"));
    await waitFor(() => {
      expect(screen.getByText("const a = 2;")).toBeTruthy();
    });
  });

  it("generates AI commit message using rules from .arp and settings", async () => {
    const fileChanges: ThunderFileChangeRecord[] = [
      { path: "/repo/src/app.ts", tool: "write_file", action: "written" }
    ];

    render(
      <GitDiffPopover
        isOpen={true}
        onClose={vi.fn()}
        workspaceDir="/repo"
        fileChanges={fileChanges}
      />
    );

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
    expect(input.value).toBe("fix(app): update variable a to 2");
  });

  it("performs 1-click commit and push only on the conversation's files", async () => {
    const fileChanges: ThunderFileChangeRecord[] = [
      { path: "/repo/src/app.ts", tool: "write_file", action: "written" }
    ];
    const onCommitSuccess = vi.fn();

    render(
      <GitDiffPopover
        isOpen={true}
        onClose={vi.fn()}
        workspaceDir="/repo"
        fileChanges={fileChanges}
        onCommitSuccess={onCommitSuccess}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Commit & Push (1)")).toBeTruthy();
    });

    // 1-Click: directly click without typing message
    fireEvent.click(screen.getByText("Commit & Push (1)"));

    // 1. Auto-generates message
    await waitFor(() => {
      expect(window.agentResume.terminalGitSuggestCommit).toHaveBeenCalledWith({
        repoRoot: "/repo",
        paths: ["src/app.ts"]
      });
    });

    // 2. Commits ONLY the conversation file
    await waitFor(() => {
      expect(window.agentResume.terminalGitCommit).toHaveBeenCalledWith({
        repoRoot: "/repo",
        message: "fix(app): update variable a to 2",
        paths: ["src/app.ts"]
      });
    });

    // 3. Pushes to remote
    await waitFor(() => {
      expect(window.agentResume.terminalGitPush).toHaveBeenCalledWith({
        repoRoot: "/repo"
      });
    });

    expect(onCommitSuccess).toHaveBeenCalled();
  });

  it("shows empty state when no files were modified in this conversation", async () => {
    render(
      <GitDiffPopover
        isOpen={true}
        onClose={vi.fn()}
        workspaceDir="/repo"
        fileChanges={[]}
        messages={[]}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("No uncommitted Git changes in this conversation.")).toBeTruthy();
    });

    // Commit button is disabled
    const btn = screen.getByText("Commit & Push (0)").closest("button");
    expect(btn?.disabled).toBe(true);
  });
});
