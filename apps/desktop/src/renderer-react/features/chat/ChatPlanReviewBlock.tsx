import React from "react";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";

/**
 * The plan under review, rendered as a full-width block in the transcript
 * feed while its approval dialog is pending.
 *
 * This is the *pending* edition: expanded (`<details open>`) so the reader
 * can read the whole plan in place without opening the small docked card.
 * Answering unmounts the dialog, which unmounts this block with it — the
 * durable record is the collapsed edition A's local receipt appends to the
 * feed (`buildUiAnswerReceipt` in `useThunderChat`), not this block.
 */
export function ChatPlanReviewBlock({
  path,
  content,
  title
}: {
  path?: string | null;
  content?: string | null;
  title: string;
}): React.JSX.Element {
  return (
    <section
      className="tb-plan-review-block"
      data-plan-review="pending"
      aria-label={title}
    >
      <header className="tb-plan-review-head">
        {path ? <span className="tb-plan-review-path">{path}</span> : null}
        <span className="tb-plan-review-badge">待审批</span>
      </header>
      <details className="tb-plan-review-body" open>
        <summary className="tb-plan-review-summary">{title}</summary>
        <div className="tb-plan-review-document">
          <StreamdownRenderer content={content ?? ""} />
        </div>
      </details>
    </section>
  );
}
