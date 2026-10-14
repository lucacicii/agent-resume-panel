import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ChatMain } from "./ChatMain";
import type { ThunderChatMessage } from "@agent-resume/core";
import type { RenderedChatMessage } from "./useThunderChat";

const messages: ThunderChatMessage[] = [{ role: "user", content: "Hello" }];

function baseProps() {
  return {
    sessionId: "sess_1",
    sessionTitle: "Test Chat",
    messages,
    isStreaming: true,
    liveSegments: [],
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
      getI18nBundle: vi.fn().mockResolvedValue({
        locale: "en",
        messages: {
          "desktop.chat.changes.label": "Changes",
          "desktop.chat.changes.tooltip": "View files changed in this conversation"
        }
      }),
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
        <ChatMain {...props} liveSegments={[{ kind: "text", text: "chunk-1" }]} />
      </I18nProvider>
    );
    expect(feed.scrollTop).toBe(2400);

    rerender(
      <I18nProvider>
        <ChatMain
          {...props}
          liveSegments={[
            { kind: "text", text: "chunk-1 chunk-2" },
            { kind: "reasoning", text: "thinking" }
          ]}
        />
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
        <ChatMain {...props} liveSegments={[{ kind: "text", text: "new content arrives" }]} />
      </I18nProvider>
    );
    expect(feed.scrollTop).toBe(0);

    // User scrolls back to the bottom → A strategy resumes.
    feed.scrollTop = 2400 - 400;
    fireEvent.scroll(feed);
    rerender(
      <I18nProvider>
        <ChatMain {...props} liveSegments={[{ kind: "text", text: "new content arrives again" }]} />
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

  it("renders a single Changes button that opens the Changes panel", async () => {
    const props = baseProps();
    renderChatMain(props);

    // The old Files / Git Diff buttons are gone.
    expect(document.querySelector('button[title="View modified files"]')).toBeNull();
    expect(
      document.querySelector('button[title="View Git diff and commit conversation changes"]')
    ).toBeNull();

    const changesBtn = await waitFor(() => {
      const button = document.querySelector(
        'button[title="View files changed in this conversation"]'
      );
      expect(button).toBeTruthy();
      return button;
    });
    expect(changesBtn?.textContent).toContain("Changes");

    // Popover is initially closed
    expect(document.querySelector(".tb-changes-popover")).toBeNull();

    // Clicking button opens the popover
    fireEvent.click(changesBtn!);
    expect(document.querySelector(".tb-changes-popover")).toBeTruthy();

    // Clicking close button inside popover closes it
    const closeBtn = document.querySelector(".tb-changes-popover .tb-trace-close-btn");
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);
    expect(document.querySelector(".tb-changes-popover")).toBeNull();
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
        'button[title="View files changed in this conversation"] .tb-header-badge'
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

describe("ChatMain timeline rail", () => {
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

  it("anchors every rendered message row for the rail to measure", () => {
    renderChatMain({
      ...baseProps(),
      isStreaming: false,
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" }
      ]
    });

    const anchors = Array.from(document.querySelectorAll("[data-timeline-index]")).map(
      (row) => (row as HTMLElement).dataset.timelineIndex
    );
    expect(anchors).toEqual(["0", "1"]);
  });

  it("anchors the streaming turn at the next index", () => {
    renderChatMain({
      ...baseProps(),
      isStreaming: true,
      messages: [{ role: "user", content: "Hello" }],
      liveSegments: [{ kind: "text", text: "partial answer" }]
    });

    const anchors = Array.from(document.querySelectorAll("[data-timeline-index]")).map(
      (row) => (row as HTMLElement).dataset.timelineIndex
    );
    expect(anchors).toEqual(["0", "1"]);
  });

  it("floats the rail beside the feed without taking layout width", () => {
    renderChatMain({ ...baseProps(), isStreaming: false });

    // The rail lives in the feed's own wrapper, not inside the scroll container.
    const body = document.querySelector(".tb-chat-body");
    expect(body).toBeTruthy();
    expect(body?.querySelector(".tb-chat-feed")).toBeTruthy();
    expect(body?.querySelector("[data-testid='chat-timeline']")).toBeTruthy();
    // It is a sibling of the feed, so it cannot scroll away with the messages.
    expect(document.querySelector(".tb-chat-feed [data-testid='chat-timeline']")).toBeNull();
  });

  it("keeps the rail inert while the conversation does not scroll", async () => {
    // jsdom never scrolls: the rail shell mounts for measurement and stays empty.
    renderChatMain({ ...baseProps(), isStreaming: false });

    await waitFor(() => expect(document.querySelector("[data-testid='chat-timeline']")).toBeTruthy());
    expect(document.querySelector(".tb-timeline-dot")).toBeNull();
    expect(document.querySelector("[data-testid='chat-timeline']")?.getAttribute("aria-hidden")).toBe("true");
  });
});

/**
 * The dots row is how finished turns stay reachable: the feed renders only the
 * running turn's segments, so a turn that ended is only visible through its dot.
 */
describe("ChatMain turn dots", () => {
  beforeEach(() => {
    window.agentResume = {
      getI18nBundle: vi.fn().mockResolvedValue({
        locale: "en",
        messages: {
          "desktop.chat.turns.label": "Turns",
          "desktop.chat.turns.turnN": "Turn {0}",
          "desktop.chat.turns.toolCount": "{0} tools",
          "desktop.chat.turns.statusRunning": "Running",
          "desktop.chat.turns.statusDone": "Done",
          "desktop.chat.turns.statusError": "Failed",
          "desktop.chat.turns.openHint": "Click to see its thinking and tools",
          "desktop.chat.turns.prev": "Previous turn",
          "desktop.chat.turns.next": "Next turn",
          "desktop.chat.turns.empty": "This turn produced no thinking or tool calls.",
          "desktop.common.close": "Close"
        }
      }),
      onI18nBundleChanged: vi.fn().mockReturnValue(() => undefined),
      onLocaleChanged: vi.fn().mockReturnValue(() => undefined),
      contextMenuShow: vi.fn().mockResolvedValue(null)
    } as any;
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * A run of three turns: one that finished, one that failed, one still running.
   * The dots carry the finished pair; the running one stays in the feed.
   */
  function turns() {
    return [
      {
        turn: 1,
        status: "done" as const,
        toolCount: 1,
        startedAtMs: Date.now() - 9000,
        durationMs: 3200,
        promptTokens: 100,
        completionTokens: 20,
        segments: [
          { kind: "reasoning" as const, text: "TURN1_THINKING" },
          { kind: "text" as const, text: "TURN1_ANSWER" }
        ]
      },
      {
        turn: 2,
        status: "error" as const,
        toolCount: 0,
        startedAtMs: Date.now() - 4000,
        durationMs: 800,
        segments: [{ kind: "reasoning" as const, text: "TURN2_THINKING" }]
      },
      {
        turn: 3,
        status: "running" as const,
        toolCount: 0,
        startedAtMs: Date.now(),
        segments: [{ kind: "reasoning" as const, text: "TURN3_FROZEN" }]
      }
    ];
  }

  it("draws a dot per finished turn, marks the failed one, and opens that turn on click", async () => {
    renderChatMain({ ...baseProps(), liveTurns: turns() } as any);

    await waitFor(() => {
      expect(document.querySelectorAll(".tb-turn-dot")).toHaveLength(2);
    });
    const dots = document.querySelectorAll(".tb-turn-dot");
    expect(dots[0].classList.contains("is-done")).toBe(true);
    expect(dots[1].classList.contains("is-error")).toBe(true);

    // Nothing is open until a dot is clicked.
    expect(document.querySelector(".tb-turn-overlay")).toBeNull();

    fireEvent.click(dots[0]);
    await waitFor(() => {
      expect(document.querySelector(".tb-turn-overlay")).toBeTruthy();
    });

    // The drawer shows turn 1 and only turn 1.
    const body = document.querySelector(".tb-turn-overlay-body")!;
    expect(body.textContent).toContain("TURN1_THINKING");
    expect(body.textContent).toContain("TURN1_ANSWER");
    expect(body.textContent).not.toContain("TURN2_THINKING");
  });

  it("leaves the running turn out of the dots, and still magnifies it from the drawer", async () => {
    renderChatMain({
      ...baseProps(),
      liveTurns: turns(),
      // The feed's live segments are the running turn's; the drawer must read these.
      liveSegments: [{ kind: "reasoning", text: "TURN3_LIVE" }]
    } as any);
    await waitFor(() => {
      expect(document.querySelectorAll(".tb-turn-dot")).toHaveLength(2);
    });
    // No dot claims to be running: the running turn is on screen in the feed.
    expect(document.querySelector(".tb-turn-dot.is-running")).toBeNull();

    fireEvent.click(document.querySelectorAll(".tb-turn-dot")[1]);
    await waitFor(() => expect(document.querySelector(".tb-turn-overlay-body")).toBeTruthy());
    expect(document.querySelector(".tb-turn-overlay-body")!.textContent).toContain("TURN2_THINKING");

    // The arrows still walk into the running turn, where they read live segments
    // rather than the frozen copy the turn itself holds.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => {
      expect(document.querySelector(".tb-turn-overlay-body")!.textContent).toContain("TURN3_LIVE");
    });
    expect(document.querySelector(".tb-turn-overlay-body")!.textContent).not.toContain("TURN3_FROZEN");
  });

  it("switches to another turn, and closes on a second click of the same dot", async () => {
    renderChatMain({ ...baseProps(), liveTurns: turns() } as any);
    await waitFor(() => {
      expect(document.querySelectorAll(".tb-turn-dot")).toHaveLength(2);
    });
    const dots = () => document.querySelectorAll(".tb-turn-dot");

    fireEvent.click(dots()[0]);
    await waitFor(() => expect(document.querySelector(".tb-turn-overlay-body")).toBeTruthy());
    expect(document.querySelector(".tb-turn-overlay-body")!.textContent).toContain("TURN1_THINKING");

    // A different dot swaps the drawer's contents rather than stacking one.
    fireEvent.click(dots()[1]);
    await waitFor(() => {
      expect(document.querySelector(".tb-turn-overlay-body")!.textContent).toContain("TURN2_THINKING");
    });
    expect(document.querySelectorAll(".tb-turn-overlay")).toHaveLength(1);
    expect(document.querySelector(".tb-turn-overlay-body")!.textContent).not.toContain("TURN1_THINKING");

    // Clicking the open dot again closes it.
    fireEvent.click(dots()[1]);
    await waitFor(() => expect(document.querySelector(".tb-turn-overlay")).toBeNull());
  });

  it("renders no dots row while the run's only turn is still running", () => {
    renderChatMain({ ...baseProps(), liveTurns: [turns()[2]] } as any);
    expect(document.querySelector(".tb-turn-dots")).toBeNull();
  });

  it("renders no dots row when the run has no turns", () => {
    renderChatMain({ ...baseProps(), liveTurns: [] } as any);
    expect(document.querySelector(".tb-turn-dots")).toBeNull();
    expect(document.querySelector(".tb-turn-overlay")).toBeNull();
  });

  it("hangs the pile off the agent's reply, right after its avatar", async () => {
    renderChatMain({ ...baseProps(), liveTurns: turns() } as any);
    await waitFor(() => {
      expect(document.querySelectorAll(".tb-turn-dot")).toHaveLength(2);
    });

    const row = document.querySelector(".tb-message-row.is-assistant")!;
    const avatar = row.querySelector(".tb-message-avatar")!;
    const dots = row.querySelector(".tb-turn-dots")!;

    // Inside the reply's own content column, and after the avatar in paint order.
    expect(dots.parentElement!.classList.contains("tb-message-container")).toBe(true);
    expect(avatar.compareDocumentPosition(dots) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the pile on the answer once the run is over, off the row it left behind", async () => {
    const settled = turns().map((turn) => ({ ...turn, status: "done" as const }));
    const answered: RenderedChatMessage[] = [
      { role: "user", content: "Hello" },
      // The run is over: its turns ride on the row it left behind — the same
      // place a reopened session reads them back from.
      { role: "assistant", content: "ANSWER", turns: settled }
    ];
    renderChatMain({
      ...baseProps(),
      isStreaming: false,
      messages: answered,
      // The row is what paints the pile; the stream's own copy went with the run.
      liveTurns: []
    } as any);

    await waitFor(() => {
      expect(document.querySelectorAll(".tb-turn-dot")).toHaveLength(3);
    });
    const rows = document.querySelectorAll(".tb-message-row.is-assistant");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelectorAll(".tb-turn-dot")).toHaveLength(3);

    // The dots still open their turn long after the run that produced it.
    fireEvent.click(rows[0].querySelectorAll(".tb-turn-dot")[1]);
    await waitFor(() => {
      expect(document.querySelector(".tb-turn-overlay-body")!.textContent).toContain("TURN2_THINKING");
    });
  });

  it("keeps each run's pile on its own reply", async () => {
    const run = (answer: string, marker: string): RenderedChatMessage => ({
      role: "assistant",
      content: answer,
      turns: [
        {
          turn: 1,
          status: "done",
          toolCount: 0,
          startedAtMs: 0,
          segments: [{ kind: "reasoning", text: marker }]
        }
      ]
    });
    renderChatMain({
      ...baseProps(),
      isStreaming: false,
      liveTurns: [],
      messages: [
        { role: "user", content: "first" },
        run("FIRST ANSWER", "FIRST_THINKING"),
        { role: "user", content: "second" },
        run("SECOND ANSWER", "SECOND_THINKING")
      ]
    } as any);

    await waitFor(() => {
      expect(document.querySelectorAll(".tb-turn-dots")).toHaveLength(2);
    });

    // Each pile opens its own run's turn, never the other run's.
    const rows = document.querySelectorAll(".tb-message-row.is-assistant");
    fireEvent.click(rows[0].querySelector(".tb-turn-dot")!);
    await waitFor(() => {
      expect(document.querySelector(".tb-turn-overlay-body")!.textContent).toContain("FIRST_THINKING");
    });
    expect(document.querySelector(".tb-turn-overlay-body")!.textContent).not.toContain("SECOND_THINKING");

    fireEvent.click(rows[1].querySelector(".tb-turn-dot")!);
    await waitFor(() => {
      expect(document.querySelector(".tb-turn-overlay-body")!.textContent).toContain("SECOND_THINKING");
    });
  });
});
