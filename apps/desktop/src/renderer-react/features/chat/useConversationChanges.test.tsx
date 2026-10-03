import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useConversationChanges } from "./useConversationChanges";

type HookProps = Parameters<typeof useConversationChanges>[0];

function baseStatus(overrides: Record<string, unknown> = {}) {
  return {
    isRepo: true,
    root: "/repo",
    staged: [],
    unstaged: [],
    ...overrides
  };
}

describe("useConversationChanges", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    window.agentResume = {
      ...window.agentResume,
      terminalGitStatus: vi.fn().mockResolvedValue(baseStatus())
    } as any;
  });

  it("uses the committable file count as the badge inside a git workspace", async () => {
    window.agentResume.terminalGitStatus = vi.fn().mockResolvedValue(
      baseStatus({
        unstaged: [
          { path: "src/a.ts", repoPath: "src/a.ts", status: "modified" },
          { path: "src/b.ts", repoPath: "src/b.ts", status: "modified" }
        ]
      })
    );

    const { result } = renderHook((props: HookProps) => useConversationChanges(props), {
      initialProps: {
        workspaceDir: "/repo",
        fileChanges: [
          { path: "/repo/src/a.ts", tool: "write_file", action: "written" },
          { path: "/repo/src/b.ts", tool: "write_file", action: "written" }
        ]
      }
    });

    await waitFor(() => expect(result.current.files.length).toBe(2));
    expect(result.current.badgeCount).toBe(2);
    expect(result.current.footprintCount).toBe(2);
  });

  it("falls back to the footprint count when git status is unavailable", async () => {
    window.agentResume.terminalGitStatus = vi.fn().mockRejectedValue(new Error("not a repo"));

    const { result } = renderHook((props: HookProps) => useConversationChanges(props), {
      initialProps: {
        workspaceDir: "/repo",
        fileChanges: [{ path: "/repo/src/a.ts", tool: "write_file", action: "written" }]
      }
    });

    await waitFor(() => expect(result.current.status).toBeNull());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.badgeCount).toBe(1);
  });

  it("still counts the footprint when the workspace is empty", async () => {
    const { result } = renderHook((props: HookProps) => useConversationChanges(props), {
      initialProps: {
        workspaceDir: "",
        fileChanges: [{ path: "/repo/src/a.ts", tool: "write_file", action: "written" }]
      }
    });

    await waitFor(() => expect(result.current.footprintCount).toBe(1));
    expect(result.current.files).toEqual([]);
    expect(result.current.badgeCount).toBe(1);
  });

  it("classifies footprint entries with no pending diff", async () => {
    window.agentResume.terminalGitStatus = vi.fn().mockResolvedValue(
      baseStatus({
        unstaged: [{ path: "src/dirty.ts", repoPath: "src/dirty.ts", status: "modified" }]
      })
    );

    const { result } = renderHook((props: HookProps) => useConversationChanges(props), {
      initialProps: {
        workspaceDir: "/repo",
        fileChanges: [
          { path: "/repo/src/dirty.ts", tool: "write_file", action: "written" },
          { path: "/repo/src/done.ts", tool: "write_file", action: "written" },
          { path: "/elsewhere/x.ts", tool: "write_file", action: "written" },
          { path: "/repo/src/fail.ts", tool: "write_file", action: "failed" }
        ]
      }
    });

    await waitFor(() => expect(result.current.noDiffEntries.length).toBe(3));
    const reasons = Object.fromEntries(
      result.current.noDiffEntries.map((entry) => [entry.path, entry.reason])
    );
    // The dirty file is not in the no-diff list.
    expect(reasons["src/dirty.ts"]).toBeUndefined();
    expect(reasons["src/done.ts"]).toBe("committed");
    expect(reasons["/elsewhere/x.ts"]).toBe("not-in-repo");
    expect(reasons["src/fail.ts"]).toBe("failed");
  });

  it("coalesces concurrent refreshes into a single status sweep", async () => {
    const gitStatus = vi.fn().mockResolvedValue(baseStatus());
    window.agentResume.terminalGitStatus = gitStatus;

    const { result } = renderHook((props: HookProps) => useConversationChanges(props), {
      initialProps: { workspaceDir: "/repo" }
    });

    await waitFor(() => expect(gitStatus).toHaveBeenCalled());
    gitStatus.mockClear();

    await act(async () => {
      await Promise.all([result.current.refresh(), result.current.refresh()]);
    });

    expect(gitStatus).toHaveBeenCalledTimes(1);
  });
});
