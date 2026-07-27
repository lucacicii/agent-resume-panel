/**
 * Grok Build ACP extension: `x.ai/ask_user_question` / `_x.ai/ask_user_question`.
 * Wire format recovered from Grok binary / community clients (not in published ACP schema).
 *
 * Request: { sessionId, questions: [{ question, options: [{label, description?, preview?}], multiSelect? }] }
 * Response: { outcome: "accepted", answers, annotations } | { outcome: "cancelled" }
 * answers: Record<questionText, chosenLabel> (multi-select labels joined with ", ")
 */

export type AskUserQuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

export type AskUserQuestionItem = {
  question: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
};

export type AskUserQuestionRequest = {
  sessionId?: string;
  questions: AskUserQuestionItem[];
};

export type AskUserQuestionResponse =
  | { outcome: "accepted"; answers: Record<string, string>; annotations: Record<string, unknown> }
  | { outcome: "cancelled" };

export type AskUserQuestionPromptHandler = (
  params: AskUserQuestionRequest
) => Promise<AskUserQuestionResponse>;

let promptHandler: AskUserQuestionPromptHandler | null = null;

export function setAskUserQuestionHandler(handler: AskUserQuestionPromptHandler | null): void {
  promptHandler = handler;
}

/** Accept both `x.ai/` and `_x.ai/` prefixes (Grok has used either). */
export const ASK_USER_QUESTION_METHODS = [
  "x.ai/ask_user_question",
  "_x.ai/ask_user_question"
] as const;

export function parseAskUserQuestionParams(raw: unknown): AskUserQuestionRequest {
  if (!raw || typeof raw !== "object") {
    return { questions: [] };
  }
  const obj = raw as Record<string, unknown>;
  const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : undefined;
  const questionsRaw = Array.isArray(obj.questions) ? obj.questions : [];
  const questions: AskUserQuestionItem[] = [];
  for (const entry of questionsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const question = typeof row.question === "string" ? row.question.trim() : "";
    if (!question) continue;
    const optionsRaw = Array.isArray(row.options) ? row.options : [];
    const options: AskUserQuestionOption[] = [];
    for (const opt of optionsRaw) {
      if (!opt || typeof opt !== "object") continue;
      const o = opt as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label.trim() : "";
      if (!label) continue;
      options.push({
        label,
        description: typeof o.description === "string" ? o.description : undefined,
        preview: typeof o.preview === "string" ? o.preview : undefined
      });
    }
    questions.push({
      question,
      options,
      multiSelect: row.multiSelect === true
    });
  }
  return { sessionId, questions };
}

export function makeAcceptedQuestionResponse(
  answers: Record<string, string>
): AskUserQuestionResponse {
  return { outcome: "accepted", answers, annotations: {} };
}

export function makeCancelledQuestionResponse(): AskUserQuestionResponse {
  return { outcome: "cancelled" };
}

/**
 * Build answers map: question text → selected label(s).
 * Multi-select labels are joined with ", " (community client convention).
 */
export function buildQuestionAnswers(
  questions: AskUserQuestionItem[],
  selections: Record<number, string[]>
): Record<string, string> {
  const answers: Record<string, string> = {};
  questions.forEach((item, index) => {
    const labels = (selections[index] || []).map((label) => label.trim()).filter(Boolean);
    if (!labels.length) return;
    answers[item.question] = labels.join(", ");
  });
  return answers;
}

export async function askUserQuestion(params: AskUserQuestionRequest): Promise<AskUserQuestionResponse> {
  if (!promptHandler) {
    return makeCancelledQuestionResponse();
  }
  if (!params.questions.length) {
    return makeCancelledQuestionResponse();
  }
  return promptHandler(params);
}
