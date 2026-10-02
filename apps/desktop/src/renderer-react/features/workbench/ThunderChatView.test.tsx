import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { ThunderChatView } from "./ThunderChatView";
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

function installBridge(overrides: Record<string, unknown> = {}): void {
  window.agentResume = {
    getI18nBundle: vi.fn().mockResolvedValue({ locale: "en", messages: {} }),
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
    thunderListRoles: vi.fn().mockResolvedValue([]),
    thunderChatListConversations: vi.fn().mockResolvedValue([
      {
        id: "sess_1",
        title: "Bound conversation",
        status: "active",
        message_count: 2,
        turn_count: 1,
        total_tokens: 10,
        created_at_ms: Date.now() - 1000,
        updated_at_ms: Date.now() - 500
      }
    ]),
    thunderChatGetConversation: vi.fn().mockResolvedValue({
      id: "sess_1",
      title: "Bound conversation",
      model: "openai/gpt-4o",
      workspace: "/work/repo",
      thinking_level: "off",
      status: "active",
      messages: [
        { role: "user", content: "Check git status" },
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
    onThunderRolesChanged: vi.fn().mockReturnValue(() => undefined),
    notesRead: vi.fn().mockResolvedValue({ record: { work: { projects: [] } }, content: "" }),
    ...overrides
  } as any;
}

describe("ThunderChatView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installBridge();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("binds to a passed conversation and reports it as ready", async () => {
    const onSessionReady = vi.fn();
    render(
      <I18nProvider>
        <ThunderChatView
          sessionId="sess_1"
          projectPath="/work/repo"
          title="Thunder Chat"
          active
          onSessionReady={onSessionReady}
        />
      </I18nProvider>
    );

    await waitFor(() => expect(onSessionReady).toHaveBeenCalledWith("sess_1"));
    await waitFor(() => expect(window.agentResume.thunderChatGetConversation).toHaveBeenCalled());
  });

  it("auto-sends the initial prompt once models are available", async () => {
    const onInitialPromptSubmitted = vi.fn();
    render(
      <I18nProvider>
        <ThunderChatView
          projectPath="/work/repo"
          title="Thunder Chat"
          active
          initialPrompt="do the thing"
          onInitialPromptSubmitted={onInitialPromptSubmitted}
        />
      </I18nProvider>
    );

    await waitFor(() =>
      expect(window.agentResume.thunderChatRunTask).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "do the thing", workspaceDir: "/work/repo" })
      )
    );
    expect(onInitialPromptSubmitted).toHaveBeenCalled();
  });
});
