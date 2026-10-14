import React, { useState } from "react";
import type { ThunderUiRequest } from "@agent-resume/core";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";

/**
 * The dialog the agent is blocked on, docked above the composer.
 *
 * Thunder's `ui_request` is a *blocking* call: the run is parked until this card
 * answers, and the daemon fails closed (denied) when nobody does. So the card is
 * docked rather than floating, and closing it is not an answer — dismissing
 * sends an explicit `cancelled`, which is what makes the daemon stop waiting
 * now instead of at the end of `timeoutMs`.
 *
 * `source` decides the chrome, and it is not decoration. `host` marks an
 * interaction the host itself raised — a permission approval, a plan review —
 * and is rendered with a title bar a plugin cannot produce. `plugin` requests
 * are display only: they are marked as such and never framed as an
 * authorisation, because a plugin that could dress itself up as the approval
 * prompt could ask for anything.
 *
 * Mounted with `key={request.requestId}`: the free-text answer lives in local
 * state, and the daemon raises one dialog at a time, so a new dialog is a new
 * card rather than the previous one's draft.
 */
export function ChatUiRequestCard({
  request,
  onAnswer
}: {
  request: ThunderUiRequest;
  onAnswer: (answer: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void | Promise<void>;
}): React.JSX.Element {
  const isHost = request.source === "host";
  const [text, setText] = useState(request.prefill ?? "");

  const answer = (value: string) => void onAnswer({ value });
  const cancel = () => void onAnswer({ cancelled: true });

  return (
    <div
      className={`tb-ui-request-card${isHost ? " is-host" : " is-plugin"}`}
      role="dialog"
      aria-label={isHost ? "Thunder needs your input" : "A plugin is asking"}
      data-request-id={request.requestId}
      data-ui={request.ui}
    >
      <div className="tb-ui-request-head">
        <ThemeIcon
          name={isHost ? "shield-check" : "wrench"}
          size={ICON_SIZE.inline}
          aria-hidden="true"
        />
        <strong>{request.title}</strong>
        <span className="tb-ui-request-source">
          {isHost ? "Thunder" : "Plugin"}
        </span>
      </div>

      {request.ui === "review" ? (
        <>
          {request.path ? <div className="tb-ui-request-path">{request.path}</div> : null}
          {/* The document *is* the thing being approved, so it gets the body
              rather than a summary line above the buttons. */}
          <div className="tb-ui-request-document">
            <StreamdownRenderer content={request.content ?? ""} />
          </div>
        </>
      ) : null}

      {request.ui === "confirm" && request.message ? (
        <div className="tb-ui-request-message">{request.message}</div>
      ) : null}

      {request.ui === "select" || request.ui === "review" ? (
        <div className="tb-ui-request-options">
          {(request.options ?? []).map((option) => (
            <button
              key={option}
              type="button"
              className="tb-ui-request-option"
              /* The daemon matches the answer against the label it sent, so the
                 string clicked is returned verbatim — never a translation of it. */
              onClick={() => answer(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}

      {request.ui === "confirm" ? (
        <div className="tb-ui-request-options">
          {/* "Deny" is an answer, not a dismissal: it says no on purpose, where
              cancelling says nobody was asked. Both fail closed; only one is a
              decision the user actually made. */}
          <button
            type="button"
            className="tb-ui-request-option"
            onClick={() => void onAnswer({ confirmed: true })}
          >
            Allow
          </button>
          <button
            type="button"
            className="tb-ui-request-option"
            onClick={() => void onAnswer({ confirmed: false })}
          >
            Deny
          </button>
        </div>
      ) : null}

      {request.ui === "input" ? (
        <form
          className="tb-ui-request-form"
          onSubmit={(e) => {
            e.preventDefault();
            answer(text);
          }}
        >
          <input
            className="tb-ui-request-input"
            autoFocus
            value={text}
            placeholder={request.placeholder ?? ""}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="tb-ui-request-option">
            Send
          </button>
        </form>
      ) : null}

      {request.ui === "editor" ? (
        <form
          className="tb-ui-request-form is-editor"
          onSubmit={(e) => {
            e.preventDefault();
            answer(text);
          }}
        >
          <textarea
            className="tb-ui-request-textarea"
            autoFocus
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="tb-ui-request-option">
            Send
          </button>
        </form>
      ) : null}

      <div className="tb-ui-request-foot">
        <button type="button" className="tb-ui-request-dismiss" onClick={cancel}>
          {isHost ? "Dismiss (declines)" : "Dismiss"}
        </button>
        <span className="tb-ui-request-note">
          The agent is waiting — if this goes unanswered it is declined
          automatically.
        </span>
      </div>
    </div>
  );
}
