import React, { useMemo, useState } from "react";
import type { ThunderQuestionItem } from "@agent-resume/core";

/**
 * Inline bubble shown when the agent is blocked on `ask_user_question`.
 *
 * Mirrors the ACP question card (`wb-acp-question-*`) so both agent surfaces
 * feel like one product, but is driven by the Thunder event stream.
 */
export function ChatQuestionBubble({
  questionId,
  questions,
  onAnswer,
  onDismiss
}: {
  questionId: string;
  questions: ThunderQuestionItem[];
  onAnswer: (answers: Record<string, string>) => void | Promise<void>;
  onDismiss: () => void | Promise<void>;
}): React.JSX.Element | null {
  const [selections, setSelections] = useState<Record<number, string[]>>({});

  const canSubmit = useMemo(
    () => questions.every((_, index) => (selections[index] || []).length > 0),
    [questions, selections]
  );

  if (!questions.length) return null;

  const toggle = (index: number, label: string, multi: boolean) => {
    setSelections((prev) => {
      const current = prev[index] || [];
      const next = multi
        ? current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
        : [label];
      return { ...prev, [index]: next };
    });
  };

  const submit = () => {
    const answers: Record<string, string> = {};
    questions.forEach((item, index) => {
      const labels = selections[index] || [];
      if (labels.length) answers[item.question] = labels.join(", ");
    });
    void onAnswer(answers);
  };

  // Single, single-select question: one click is the whole answer.
  const singleFast =
    questions.length === 1 && !(questions[0].multiSelect ?? questions[0].multi_select) && (questions[0].options?.length ?? 0) > 0;

  return (
    <div className="wb-acp-question-card" role="dialog" aria-label="Agent question" data-question-id={questionId}>
      <div className="wb-acp-question-head">
        <strong>Agent needs your input</strong>
      </div>
      <div className="wb-acp-question-list">
        {questions.map((item, questionIndex) => {
          const multi = Boolean(item.multiSelect ?? item.multi_select);
          const selected = selections[questionIndex] || [];
          return (
            <div className="wb-acp-question-item" key={`${questionIndex}-${item.question}`}>
              <div className="wb-acp-question-text">{item.question}</div>
              <div className="wb-acp-question-options">
                {(item.options || []).map((option) => {
                  const isSelected = selected.includes(option.label);
                  return (
                    <button
                      type="button"
                      key={option.label}
                      className={`wb-acp-question-option${isSelected ? " is-selected" : ""}`}
                      title={option.description || option.label}
                      onClick={() => {
                        if (singleFast) {
                          void onAnswer({ [item.question]: option.label });
                          return;
                        }
                        toggle(questionIndex, option.label, multi);
                      }}
                    >
                      <span className="wb-acp-question-option-label">{option.label}</span>
                      {option.description ? (
                        <span className="wb-acp-question-option-desc">{option.description}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {!singleFast ? (
        <div className="wb-acp-question-actions">
          <button type="button" className="ghost-btn" onClick={() => void onDismiss()}>
            Skip
          </button>
          <button type="button" className="primary-btn" disabled={!canSubmit} onClick={submit}>
            Answer
          </button>
        </div>
      ) : null}
    </div>
  );
}
