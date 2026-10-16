import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import type { ThunderUiRequest } from "@agent-resume/core";
import { ChatPlanReviewBlock } from "./ChatPlanReviewBlock";
import { ChatMain } from "./ChatMain";
import type { ThunderChatMessage } from "@agent-resume/core";

function reviewRequest(overrides: Partial<ThunderUiRequest> = {}): ThunderUiRequest {
  return {
    requestId: "ui_review_1",
    sessionId: "sess_a",
    source: "host",
    ui: "review",
    title: "Approve this plan?",
    path: "/w/.thunder/plans/sess_a.md",
    content: "# Plan\n\n1. Do the thing",
    options: ["Yes, but ask before each edit", "No, keep planning"],
    ...overrides
  } as ThunderUiRequest;
}

const messages: ThunderChatMessage[] = [{ role: "user", content: "Hello" }];

function feedProps(pendingUiRequest: ThunderUiRequest | null) {
  return {
    sessionId: "sess_a",
    sessionTitle: "Test Chat",
    messages,
    isStreaming: false,
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
    onNewSession: vi.fn(),
    pendingUiRequest,
    onAnswerUiRequest: vi.fn()
  };
}

describe("ChatPlanReviewBlock", () => {
  beforeEach(() => {
    window.agentResume = {
      getI18nBundle: vi.fn().mockResolvedValue({ locale: "en", messages: {} }),
      onI18nBundleChanged: vi.fn().mockReturnValue(() => undefined),
      onLocaleChanged: vi.fn().mockReturnValue(() => undefined),
      contextMenuShow: vi.fn().mockResolvedValue(null),
      getSettings: vi.fn().mockResolvedValue({}),
      notesListTasks: vi.fn().mockResolvedValue([]),
      selectionRunAction: vi.fn()
    } as any;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the plan expanded with a pending badge", () => {
    render(
      <ChatPlanReviewBlock
        path="/w/.thunder/plans/sess_a.md"
        content="# Plan"
        title="Approve this plan?"
      />
    );
    expect(screen.getByText("待审批")).toBeTruthy();
    expect(screen.getByText("/w/.thunder/plans/sess_a.md")).toBeTruthy();
    const details = document.querySelector(".tb-plan-review-body");
    expect(details?.hasAttribute("open")).toBe(true);
  });

  it("appears in the feed while a review is pending, and unmounts once answered", () => {
    const props = feedProps(reviewRequest());
    const { rerender } = render(
      <I18nProvider>
        <ChatMain {...props} />
      </I18nProvider>
    );
    expect(document.querySelector('[data-plan-review="pending"]')).toBeTruthy();

    // Answering unmounts the dialog, which unmounts the block with it — the
    // record left behind is A's local receipt (a feed message), not this block.
    rerender(
      <I18nProvider>
        <ChatMain {...props} pendingUiRequest={null} />
      </I18nProvider>
    );
    expect(document.querySelector('[data-plan-review="pending"]')).toBeNull();
  });

  it("does not render for non-review dialogs", () => {
    const props = feedProps(reviewRequest({ ui: "confirm", content: undefined }));
    render(
      <I18nProvider>
        <ChatMain {...props} />
      </I18nProvider>
    );
    expect(document.querySelector('[data-plan-review="pending"]')).toBeNull();
  });

  it("passes the clicked option label back verbatim", () => {
    const onAnswer = vi.fn();
    render(
      <I18nProvider>
        <ChatMain {...feedProps(reviewRequest())} onAnswerUiRequest={onAnswer} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes, but ask before each edit" }));
    expect(onAnswer).toHaveBeenCalledWith({ value: "Yes, but ask before each edit" });
  });
});
