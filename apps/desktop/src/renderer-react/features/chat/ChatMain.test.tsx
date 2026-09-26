import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ChatMain } from "./ChatMain";
import type { ThunderChatMessage } from "@agent-resume/core";

const messages: ThunderChatMessage[] = [{ role: "user", content: "Hello" }];

function baseProps() {
  return {
    sessionId: "sess_1",
    sessionTitle: "Test Chat",
    messages,
    isStreaming: true,
    streamingText: "",
    streamingReasoning: "",
    streamingTools: [],
    models: [],
    selectedModel: "",
    onSelectModel: vi.fn(),
    thinkingLevel: "off",
    onSelectThinkingLevel: vi.fn(),
    workspaceDir: "",
    onSelectWorkspaceDir: vi.fn(),
    onSendMessage: vi.fn(),
    onCancelTask: vi.fn(),
    onNewSession: vi.fn()
  };
}

function mockFeedMetrics(feed: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(feed, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(feed, "clientHeight", { configurable: true, value: clientHeight });
}

function renderChatMain(props: Parameters<typeof ChatMain>[0]) {
  const rendered = render(
    <I18nProvider>
      <ChatMain {...props} />
    </I18nProvider>
  );
  const feed = document.querySelector(".tb-chat-feed") as HTMLElement;
  mockFeedMetrics(feed, 2400, 400);
  return { ...rendered, feed };
}

describe("ChatMain auto-scroll", () => {
  beforeEach(() => {
    window.agentResume = {
      getI18nBundle: vi.fn().mockResolvedValue({ locale: "en", messages: {} }),
      onI18nBundleChanged: vi.fn().mockReturnValue(() => undefined),
      onLocaleChanged: vi.fn().mockReturnValue(() => undefined),
      contextMenuShow: vi.fn().mockResolvedValue(null)
    } as any;
  });

  afterEach(() => {
    cleanup();
  });

  it("follows the newest content while the user stays at the bottom", () => {
    const props = baseProps();
    const { feed, rerender } = renderChatMain(props);
    feed.scrollTop = 0;

    rerender(
      <I18nProvider>
        <ChatMain {...props} streamingText="chunk-1" />
      </I18nProvider>
    );
    expect(feed.scrollTop).toBe(2400);

    rerender(
      <I18nProvider>
        <ChatMain {...props} streamingText="chunk-1 chunk-2" streamingReasoning="thinking" />
      </I18nProvider>
    );
    expect(feed.scrollTop).toBe(2400);
  });

  it("stops following after the user scrolls away, and resumes at the bottom", () => {
    const props = baseProps();
    const { feed, rerender } = renderChatMain(props);

    // User scrolls away from the bottom → B strategy.
    feed.scrollTop = 0;
    fireEvent.scroll(feed);

    rerender(
      <I18nProvider>
        <ChatMain {...props} streamingText="new content arrives" />
      </I18nProvider>
    );
    expect(feed.scrollTop).toBe(0);

    // User scrolls back to the bottom → A strategy resumes.
    feed.scrollTop = 2400 - 400;
    fireEvent.scroll(feed);
    rerender(
      <I18nProvider>
        <ChatMain {...props} streamingText="new content arrives again" />
      </I18nProvider>
    );
    expect(feed.scrollTop).toBe(2400);
  });

  it("jumps to the bottom when the conversation changes", () => {
    const props = baseProps();
    const { feed, rerender } = renderChatMain(props);

    feed.scrollTop = 0;
    fireEvent.scroll(feed);

    rerender(
      <I18nProvider>
        <ChatMain {...props} sessionId="sess_2" />
      </I18nProvider>
    );
    expect(feed.scrollTop).toBe(2400);
  });

  it("renders the Git Diff button and opens GitDiffPopover when clicked", () => {
    const props = baseProps();
    renderChatMain(props);

    const diffBtn = document.querySelector('button[title="View Git diff and commit conversation changes"]');
    expect(diffBtn).toBeTruthy();
    expect(diffBtn?.textContent).toContain("Git Diff");

    // Popover is initially closed
    expect(document.querySelector(".tb-git-diff-popover")).toBeNull();

    // Clicking button opens the popover
    fireEvent.click(diffBtn!);
    expect(document.querySelector(".tb-git-diff-popover")).toBeTruthy();

    // Clicking close button inside popover closes it
    const closeBtn = document.querySelector(".tb-git-diff-popover .tb-trace-close-btn");
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(document.querySelector(".tb-git-diff-popover")).toBeNull();
  });

  it("counts conversation changes across a shared workspace and scans nested repos", async () => {
    const gitStatus = vi.fn().mockImplementation(async ({ cwd }: { cwd: string }) => {
      if (cwd === "/work/mono") {
        return {
          isRepo: true,
          root: null,
          nestedRepos: [{ root: "/work/mono/pkg-a", displayPath: "pkg-a" }],
          staged: [],
          unstaged: [
            { path: "pkg-a/a.ts", repoPath: "a.ts", repoRoot: "/work/mono/pkg-a", status: "modified" }
          ]
        };
      }
      return {
        isRepo: true,
        root: "/work/mono/pkg-b",
        staged: [],
        unstaged: [
          { path: "b.ts", repoPath: "b.ts", repoRoot: "/work/mono/pkg-b", status: "modified" }
        ]
      };
    });
    window.agentResume = {
      ...window.agentResume,
      getSettings: vi.fn().mockResolvedValue({ workbench: { gitNestedScanMaxDepth: 4 } }),
      notesRead: vi.fn().mockResolvedValue({
        record: { work: { projects: ["/work/mono/pkg-b"] } },
        content: ""
      }),
      terminalGitStatus: gitStatus
    } as any;

    renderChatMain({
      ...baseProps(),
      workspaceDir: "/work/mono",
      workspaceSource: "gtd" as const,
      taskNoteId: "task_1",
      fileChanges: [
        { path: "/work/mono/pkg-a/a.ts", tool: "write_file", action: "written" },
        { path: "/work/mono/pkg-b/b.ts", tool: "write_file", action: "written" }
      ]
    });

    await waitFor(() => {
      const badge = document.querySelector(
        'button[title="View Git diff and commit conversation changes"] .tb-header-badge'
      );
      expect(badge?.textContent).toBe("2");
    });
    // Both the task's workspace root and the shared project are scanned the same
    // way the workbench scans project roots.
    expect(gitStatus).toHaveBeenCalledWith({
      cwd: "/work/mono",
      nestedScan: { maxDepth: 4, ignoreDirs: undefined }
    });
    expect(gitStatus).toHaveBeenCalledWith({
      cwd: "/work/mono/pkg-b",
      nestedScan: { maxDepth: 4, ignoreDirs: undefined }
    });
  });
});

describe("ChatMain find-in-conversation", () => {
  beforeEach(() => {
    window.agentResume = {
      getI18nBundle: vi.fn().mockResolvedValue({ locale: "en", messages: {} }),
      onI18nBundleChanged: vi.fn().mockReturnValue(() => undefined),
      onLocaleChanged: vi.fn().mockReturnValue(() => undefined),
      contextMenuShow: vi.fn().mockResolvedValue(null)
    } as any;
  });

  afterEach(() => {
    cleanup();
  });

  const openSearch = async () => {
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    await waitFor(() => {
      expect(document.querySelector(".tb-chat-search")).toBeTruthy();
    });
    return document.querySelector(".tb-chat-search-input") as HTMLInputElement;
  };

  it("hides the search bar until Cmd+F is pressed", async () => {
    renderChatMain({ ...baseProps(), isStreaming: false });

    expect(document.querySelector(".tb-chat-search")).toBeNull();

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    await waitFor(() => {
      expect(document.querySelector(".tb-chat-search")).toBeTruthy();
    });
  });

  it("renders a match count for a query present in the messages", async () => {
    renderChatMain({
      ...baseProps(),
      isStreaming: false,
      messages: [
        { role: "user", content: "fix the login bug" },
        { role: "assistant", content: "The **bug** was a null deref" }
      ]
    });

    const input = await openSearch();

    fireEvent.change(input, { target: { value: "bug" } });

    await waitFor(() => {
      const count = document.querySelector(".tb-chat-search-count");
      expect(count?.textContent).toBe("1/2");
      expect(count?.classList.contains("is-empty")).toBe(false);
    });

    // Prev/next navigation is offered once matches exist
    expect(document.querySelector(".tb-chat-search-nav")).toBeTruthy();
  });

  it("shows an empty count when nothing matches and clears on Escape", async () => {
    renderChatMain({ ...baseProps(), isStreaming: false });

    const input = await openSearch();
    fireEvent.change(input, { target: { value: "zebra" } });

    await waitFor(() => {
      const count = document.querySelector(".tb-chat-search-count");
      expect(count?.textContent).toBe("0/0");
      expect(count?.classList.contains("is-empty")).toBe(true);
    });
    expect(document.querySelector(".tb-chat-search-nav")).toBeNull();

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => {
      expect(document.querySelector(".tb-chat-search")).toBeNull();
    });
  });

  it("advances the active match with Enter and wraps around", async () => {
    renderChatMain({
      ...baseProps(),
      isStreaming: false,
      messages: [
        { role: "user", content: "alpha beta" },
        { role: "assistant", content: "beta gamma" }
      ]
    });

    const input = await openSearch();
    fireEvent.change(input, { target: { value: "beta" } });

    await waitFor(() => {
      expect(document.querySelector(".tb-chat-search-count")?.textContent).toBe("1/2");
    });

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(document.querySelector(".tb-chat-search-count")?.textContent).toBe("2/2");
    });

    // Wrap back to the first match
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(document.querySelector(".tb-chat-search-count")?.textContent).toBe("1/2");
    });
  });

  it("translates an assistant message and restores the original on second click", async () => {
    const selectionRunAction = vi.fn().mockResolvedValue({ text: "你好，世界" });
    window.agentResume = {
      ...(window.agentResume as any),
      selectionRunAction
    } as any;

    renderChatMain({
      ...baseProps(),
      isStreaming: false,
      messages: [{ role: "assistant", content: "Hello, world" }]
    });

    const translateBtn = await waitFor(() => {
      const btn = document.querySelector('button[title="desktop.chat.translate"]') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      return btn;
    });

    fireEvent.click(translateBtn);

    await waitFor(() => {
      expect(selectionRunAction).toHaveBeenCalledWith({ actionId: "translate", text: "Hello, world" });
      expect(document.querySelector(".tb-message-bubble")?.textContent).toContain("你好，世界");
    });

    // Second click restores the original text
    const restoreBtn = document.querySelector('button[title="desktop.chat.restore"]') as HTMLButtonElement;
    expect(restoreBtn).toBeTruthy();
    fireEvent.click(restoreBtn);
    await waitFor(() => {
      expect(document.querySelector(".tb-message-bubble")?.textContent).toContain("Hello, world");
      expect(document.querySelector(".tb-message-bubble")?.textContent).not.toContain("你好，世界");
    });
  });
});
