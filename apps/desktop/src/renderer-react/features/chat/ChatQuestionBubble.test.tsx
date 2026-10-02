import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatQuestionBubble } from "./ChatQuestionBubble";

const single = [
  {
    question: "Which scope should the migration cover?",
    options: [
      { label: "Auth only", description: "Smallest blast radius" },
      { label: "Auth + billing" }
    ]
  }
];

const multi = [
  {
    question: "Which modules are in scope?",
    multiSelect: true,
    options: [{ label: "auth" }, { label: "billing" }, { label: "search" }]
  }
];

afterEach(() => cleanup());

describe("ChatQuestionBubble", () => {
  it("renders the question text and options", () => {
    render(<ChatQuestionBubble questionId="q1" questions={single} onAnswer={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Which scope should the migration cover?")).toBeTruthy();
    expect(screen.getByText("Auth only")).toBeTruthy();
    expect(screen.getByText("Smallest blast radius")).toBeTruthy();
  });

  it("answers immediately on a single-select fast path", () => {
    const onAnswer = vi.fn();
    render(<ChatQuestionBubble questionId="q1" questions={single} onAnswer={onAnswer} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByText("Auth only"));
    expect(onAnswer).toHaveBeenCalledWith({
      "Which scope should the migration cover?": "Auth only"
    });
  });

  it("collects multiple selections before submitting", () => {
    const onAnswer = vi.fn();
    render(<ChatQuestionBubble questionId="q2" questions={multi} onAnswer={onAnswer} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByText("auth"));
    fireEvent.click(screen.getByText("search"));
    // Not submitted yet: multi-select requires an explicit action.
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Answer"));
    expect(onAnswer).toHaveBeenCalledWith({
      "Which modules are in scope?": "auth, search"
    });
  });

  it("disables submit until every question has an answer", () => {
    const twoQuestions = [
      { question: "First?", options: [{ label: "a" }] },
      { question: "Second?", options: [{ label: "b" }] }
    ];
    const onAnswer = vi.fn();
    render(<ChatQuestionBubble questionId="q3" questions={twoQuestions} onAnswer={onAnswer} onDismiss={vi.fn()} />);

    // Multi-question path always renders the actions row.
    const submit = screen.getByText("Answer") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByText("a"));
    expect((screen.getByText("Answer") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("b"));
    expect((screen.getByText("Answer") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByText("Answer"));
    expect(onAnswer).toHaveBeenCalledWith({ "First?": "a", "Second?": "b" });
  });

  it("dismisses without answering", () => {
    const onDismiss = vi.fn();
    render(<ChatQuestionBubble questionId="q4" questions={multi} onAnswer={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText("Skip"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("renders nothing for an empty question list", () => {
    const { container } = render(
      <ChatQuestionBubble questionId="q5" questions={[]} onAnswer={vi.fn()} onDismiss={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });
});
