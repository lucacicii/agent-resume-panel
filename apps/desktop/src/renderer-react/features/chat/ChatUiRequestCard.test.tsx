import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatUiRequestCard } from "./ChatUiRequestCard";
import type { ThunderUiRequest } from "@agent-resume/core";

function request(overrides: Partial<ThunderUiRequest>): ThunderUiRequest {
  return {
    requestId: "ui_1",
    sessionId: "sess_a",
    source: "host",
    ui: "confirm",
    title: "Write file.txt?",
    ...overrides
  } as ThunderUiRequest;
}

describe("ChatUiRequestCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks a host request as Thunder's own, and a plugin's as not", () => {
    const { rerender } = render(
      <ChatUiRequestCard request={request({ source: "host" })} onAnswer={vi.fn()} />
    );
    expect(document.querySelector(".tb-ui-request-card.is-host")).toBeTruthy();
    expect(screen.getByText("Thunder")).toBeTruthy();

    // A plugin must never be able to pass for the host's approval chrome: the
    // badge changes with the source, and the card is styled as a different kind
    // of surface.
    rerender(<ChatUiRequestCard request={request({ source: "plugin" })} onAnswer={vi.fn()} />);
    expect(document.querySelector(".tb-ui-request-card.is-host")).toBeNull();
    expect(document.querySelector(".tb-ui-request-card.is-plugin")).toBeTruthy();
    expect(screen.getByText("Plugin")).toBeTruthy();
  });

  it("answers a confirmation with a boolean, and distinguishes no from never-asked", () => {
    const onAnswer = vi.fn();
    render(
      <ChatUiRequestCard
        request={request({ ui: "confirm", message: "This writes outside the workspace." })}
        onAnswer={onAnswer}
      />
    );
    expect(screen.getByText("This writes outside the workspace.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(onAnswer).toHaveBeenCalledWith({ confirmed: false });

    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onAnswer).toHaveBeenCalledWith({ confirmed: true });
  });

  it("returns the option label verbatim, because that is what the daemon matches on", () => {
    const onAnswer = vi.fn();
    render(
      <ChatUiRequestCard
        request={request({
          ui: "select",
          title: "Run shell?",
          options: ["Allow once", "Always allow", "Deny"]
        })}
        onAnswer={onAnswer}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    expect(onAnswer).toHaveBeenCalledWith({ value: "Always allow" });
  });

  it("cancels explicitly instead of leaving the agent to time out", () => {
    const onAnswer = vi.fn();
    render(
      <ChatUiRequestCard request={request({ ui: "confirm" })} onAnswer={onAnswer} />
    );

    fireEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(onAnswer).toHaveBeenCalledWith({ cancelled: true });
  });

  it("answers a plan review with the option clicked, over the plan body", () => {
    const onAnswer = vi.fn();
    render(
      <ChatUiRequestCard
        request={request({
          ui: "review",
          title: "Approve this plan?",
          path: "/w/.thunder/plans/sess_a.md",
          content: "# Plan\n\n1. Do the thing",
          options: ["Yes, but ask before each edit", "No, keep planning"]
        })}
        onAnswer={onAnswer}
      />
    );

    expect(screen.getByText("/w/.thunder/plans/sess_a.md")).toBeTruthy();
    expect(screen.getByText(/Do the thing/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Yes, but ask before each edit" }));
    expect(onAnswer).toHaveBeenCalledWith({ value: "Yes, but ask before each edit" });
  });

  it("sends free text from an input, and multi-line text from an editor", () => {
    const onAnswer = vi.fn();
    const { rerender } = render(
      <ChatUiRequestCard
        request={request({ ui: "input", title: "What should change?", placeholder: "be specific" })}
        onAnswer={onAnswer}
      />
    );

    const input = screen.getByPlaceholderText("be specific") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "start with the parser" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onAnswer).toHaveBeenCalledWith({ value: "start with the parser" });

    // An editor comes pre-filled, so submitting without touching it is a valid
    // answer rather than an empty one. Keyed by request id, as the dock does:
    // a second dialog is a new card, not the first one's leftover draft.
    rerender(
      <ChatUiRequestCard
        key="ui_2"
        request={request({ requestId: "ui_2", ui: "editor", title: "Edit it", prefill: "draft" })}
        onAnswer={onAnswer}
      />
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("draft");
    fireEvent.submit(textarea.closest("form") as HTMLFormElement);
    expect(onAnswer).toHaveBeenCalledWith({ value: "draft" });
  });
});
