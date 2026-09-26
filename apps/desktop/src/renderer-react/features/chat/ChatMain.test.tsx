import { cleanup, fireEvent, render } from "@testing-library/react";
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

function renderChatMain(props: ReturnType<typeof baseProps>) {
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
});
