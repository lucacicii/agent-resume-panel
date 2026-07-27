import { describe, expect, it } from "vitest";
import {
  buildQuestionAnswers,
  makeAcceptedQuestionResponse,
  makeCancelledQuestionResponse,
  parseAskUserQuestionParams
} from "./askUserQuestion";

describe("askUserQuestion wire helpers", () => {
  it("parses questions and options from extension params", () => {
    const parsed = parseAskUserQuestionParams({
      sessionId: "s1",
      questions: [
        {
          question: "Pick one",
          multiSelect: false,
          options: [
            { label: "A", description: "alpha" },
            { label: "B" },
            { label: "  " }
          ]
        }
      ]
    });
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.questions).toEqual([
      {
        question: "Pick one",
        multiSelect: false,
        options: [
          { label: "A", description: "alpha", preview: undefined },
          { label: "B", description: undefined, preview: undefined }
        ]
      }
    ]);
  });

  it("builds accepted/cancelled responses with required outcome field", () => {
    expect(makeAcceptedQuestionResponse({ "Pick one": "A" })).toEqual({
      outcome: "accepted",
      answers: { "Pick one": "A" },
      annotations: {}
    });
    expect(makeCancelledQuestionResponse()).toEqual({ outcome: "cancelled" });
  });

  it("joins multi-select labels with comma+space", () => {
    const answers = buildQuestionAnswers(
      [
        {
          question: "Colors?",
          multiSelect: true,
          options: [{ label: "Red" }, { label: "Blue" }]
        }
      ],
      { 0: ["Red", "Blue"] }
    );
    expect(answers).toEqual({ "Colors?": "Red, Blue" });
  });
});
