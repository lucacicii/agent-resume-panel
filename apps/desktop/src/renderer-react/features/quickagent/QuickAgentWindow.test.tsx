import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../../i18n";
import { QuickAgentWindow } from "./QuickAgentWindow";
import type { ThunderModelInfo } from "@agent-resume/core";

const MODELS: ThunderModelInfo[] = [
  {
    id: "gpt-4o",
    provider: "openai",
    name: "GPT-4o",
    selection_id: "openai/gpt-4o",
    available: true,
    reasoning: false,
    thinking_levels: ["off"],
    default_thinking_level: "off"
  }
];

const CONVERSATIONS = [
  {
    id: "sess_1",
    title: "Quick question",
    status: "active",
    message_count: 2,
    turn_count: 1,
    total_tokens: 10,
    created_at_ms: Date.now() - 1000,
    updated_at_ms: Date.now() - 500
  }
];

function installBridge(overrides: Record<string, unknown> = {}): void {
  window.agentResume = {
    getI18nBundle: vi.fn().mockResolvedValue({
      locale: "en",
      messages: {
        "desktop.quickAgent.title": "Quick Agent",
        "desktop.quickAgent.pin": "Keep on Top",
        "desktop.quickAgent.unpin": "Stop Keeping on Top",
        "desktop.quickAgent.newSession": "New Conversation",
        "desktop.quickAgent.hide": "Hide Window",
        "desktop.quickAgent.handoff": "Continue in Workbench"
      }
    }),
    onI18nBundleChanged: vi.fn().mockReturnValue(() => undefined),
    onLocaleChanged: vi.fn().mockReturnValue(() => undefined),
    getSettings: vi.fn().mockResolvedValue({}),
    thunderGetStatus: vi.fn().mockResolvedValue({
      available: true,
      repoPath: "/path/to/thunder",
      daemonPath: "/path/to/thunder/daemon.sh",
      tuiPath: "/path/to/thunder/thunder-tui",
      models: MODELS,
      source: "dev-sibling"
    }),
    thunderListModels: vi.fn().mockResolvedValue(MODELS),
    thunderChatListConversations: vi.fn().mockResolvedValue(CONVERSATIONS),
    thunderChatGetConversation: vi.fn().mockResolvedValue({
      id: "sess_1",
      title: "Quick question",
      model: "openai/gpt-4o",
      workspace: "/work/repo",
      thinking_level: "off",
      status: "active",
      messages: [
        { role: "user", content: "git status" },
        { role: "assistant", content: "Working tree is clean." }
      ],
      created_at_ms: Date.now() - 1000,
      updated_at_ms: Date.now() - 500
    }),
    thunderChatGetActiveStream: vi.fn().mockResolvedValue(null),
    thunderChatGetTrace: vi.fn().mockResolvedValue(null),
    thunderChatRunTask: vi.fn().mockResolvedValue({ finalContent: "done", finishReason: "Done" }),
    thunderChatCancelTask: vi.fn().mockResolvedValue(true),
    onThunderChatEvent: vi.fn().mockReturnValue(() => undefined),
    onThunderModelsChanged: vi.fn().mockReturnValue(() => undefined),
    onThunderModeChanged: vi.fn().mockReturnValue(() => undefined),
    thunderChatGetPermissionState: vi.fn().mockResolvedValue({ mode: "yolo" }),
    thunderChatSetMode: vi.fn().mockResolvedValue({ mode: "yolo" }),
    thunderChatAnswerUi: vi.fn().mockResolvedValue(true),
    notesRead: vi.fn().mockResolvedValue({ record: { work: { projects: [] } }, content: "" }),
    quickAgentGetState: vi.fn().mockResolvedValue({ open: true, pinned: false }),
    terminalGitStatus: vi.fn().mockResolvedValue({
      isRepo: true,
      root: "/work/repo",
      staged: [],
      unstaged: [{ path: "src/a.ts", repoPath: "src/a.ts", repoRoot: "/work/repo", status: "M", staged: false, unstaged: true }],
      tracking: [{ repoRoot: "/work/repo", branch: "main", upstream: null, ahead: 0, behind: 0 }]
    }),
    terminalGitLog: vi.fn().mockResolvedValue({
      commits: [{ hash: "abcdef1234", shortHash: "abcdef1", author: "Dev", date: Date.now(), subject: "Fix bug", parents: [], decorations: "", refs: { heads: [], remotes: [], tags: [], isHead: false } }]
    }),
    workbenchSearchPaths: vi.fn().mockResolvedValue({
      files: [{ path: "/work/repo/src/quick.ts", relativePath: "src/quick.ts", kind: "file" }],
      truncated: false,
      engine: "rg"
    }),
    workbenchOpenPath: vi.fn().mockResolvedValue({ ok: true }),
    quickAgentHandoff: vi.fn().mockResolvedValue({ ok: true }),
    quickAgentSetPinned: vi.fn().mockImplementation(async (args: { pinned: boolean }) => ({ pinned: args.pinned })),
    quickAgentHide: vi.fn().mockResolvedValue({ ok: true }),
    quickAgentToggle: vi.fn().mockResolvedValue({ open: true }),
    ...overrides
  } as any;
}

function renderWindow(): ReturnType<typeof render> {
  return render(
    <I18nProvider>
      <QuickAgentWindow />
    </I18nProvider>
  );
}

describe("QuickAgentWindow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installBridge();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("restores the conversation this window last showed", async () => {
    window.localStorage.setItem("quick-agent-session-id", "sess_1");
    renderWindow();

    await waitFor(() =>
      expect(window.agentResume.thunderChatGetConversation).toHaveBeenCalledWith({ sessionId: "sess_1" })
    );
  });

  it("keeps the fresh conversation when the stored id no longer exists", async () => {
    window.localStorage.setItem("quick-agent-session-id", "sess_deleted");
    renderWindow();

    // Let the conversation list land, then assert nothing was re-opened.
    await waitFor(() => expect(window.agentResume.thunderChatListConversations).toHaveBeenCalled());
    expect(window.agentResume.thunderChatGetConversation).not.toHaveBeenCalled();
  });

  it("defaults a fresh conversation to a fast model and carries the role preamble on the first run", async () => {
    const { thunderListModels, thunderGetStatus } = window.agentResume as any;
    const FAST = { ...MODELS[0], id: "gpt-4o-mini", name: "GPT-4o mini", selection_id: "openai/gpt-4o-mini" };
    thunderListModels.mockResolvedValue([FAST]);
    thunderGetStatus.mockResolvedValue({
      available: true, repoPath: "/p", daemonPath: "/d", tuiPath: "/t",
      models: [FAST], source: "dev-sibling"
    });
    renderWindow();
    const composer = await screen.findByRole("textbox");
    await userEvent.type(composer, "hello");
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(window.agentResume.thunderChatRunTask).toHaveBeenCalledWith(
        expect.objectContaining({ model: "openai/gpt-4o-mini", roleContext: expect.stringContaining("Quick Agent") })
      )
    );
  });

  it("answers /find from local search without an LLM run", async () => {
    window.localStorage.setItem("chat-selected-workspace", "/work/repo");
    renderWindow();
    await waitFor(() => expect(window.agentResume.quickAgentGetState).toHaveBeenCalled());
    const composer = await screen.findByRole("textbox");
    await userEvent.type(composer, "/find quick");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(window.agentResume.workbenchSearchPaths).toHaveBeenCalledWith({ rootPaths: ["/work/repo"], query: "quick" }));
    expect(await screen.findByText("src/quick.ts")).toBeTruthy();
    expect(window.agentResume.thunderChatRunTask).not.toHaveBeenCalled();
  });

  it("answers /git status from the workspace branch", async () => {
    window.localStorage.setItem("chat-selected-workspace", "/work/repo");
    renderWindow();
    await waitFor(() => expect(window.agentResume.quickAgentGetState).toHaveBeenCalled());
    const composer = await screen.findByRole("textbox");
    await userEvent.type(composer, "/git status");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(window.agentResume.terminalGitStatus).toHaveBeenCalledWith({ cwd: "/work/repo" }));
    expect(await screen.findByText(/M\s+src\/a\.ts/)).toBeTruthy();
    expect(window.agentResume.thunderChatRunTask).not.toHaveBeenCalled();
  });

  it("hands the active conversation off to a workbench", async () => {
    window.localStorage.setItem("quick-agent-session-id", "sess_1");
    renderWindow();
    await waitFor(() =>
      expect(window.agentResume.thunderChatGetConversation).toHaveBeenCalledWith({ sessionId: "sess_1" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue in Workbench" }));
    await waitFor(() =>
      expect(window.agentResume.quickAgentHandoff).toHaveBeenCalledWith({ sessionId: "sess_1", projectPath: "/work/repo" })
    );
  });

  it("keeps the header to its own controls — no trace or changes pills", async () => {
    const { container } = renderWindow();
    await waitFor(() => expect(window.agentResume.quickAgentGetState).toHaveBeenCalled());
    const header = container.querySelector(".tb-chat-header")!;
    // The four window controls are there…
    expect(header.querySelectorAll(".qa-header-btn").length).toBeGreaterThanOrEqual(3);
    // …and the run's pills are not drawn in this window at all.
    expect(header.textContent).not.toContain("Trace");
    expect(header.querySelectorAll(".tb-header-action-btn:not(.qa-header-btn)").length).toBe(0);
  });

  it("hides on Escape outside editable targets, but not from an input", async () => {
    const { getByRole } = renderWindow();
    await waitFor(() => expect(window.agentResume.quickAgentGetState).toHaveBeenCalled());

    const composer = getByRole("textbox");
    fireEvent.keyDown(composer, { key: "Escape" });
    expect(window.agentResume.quickAgentHide).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(window.agentResume.quickAgentHide).toHaveBeenCalled();
  });
});
