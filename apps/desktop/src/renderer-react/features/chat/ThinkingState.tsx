import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";

interface ThinkingStateProps {
  reasoning: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
}

const EMPTY_PLACEHOLDER = "Analyzing context and planning next steps...";

/**
 * A reasoning block, collapsed by default.
 *
 * While the model is thinking the collapsed row is a one-line window onto the
 * reasoning that rolls upward as new lines arrive — the newest line slides in
 * from the bottom as the previous one leaves the top, like a picker wheel.
 * Once the run is over the same slot settles into a one-line excerpt.
 */
export function ThinkingState({
  reasoning,
  isStreaming = false,
  defaultExpanded = false
}: ThinkingStateProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** A strategy while true: follow the newest reasoning unless the user scrolls up (B). */
  const stickToBottom = useRef(true);

  const scrollToBottom = useCallback((force = false) => {
    const node = contentRef.current;
    if (!node) return;
    if (!force && !stickToBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  // A strategy: follow streaming reasoning unless the user scrolled away (B).
  useLayoutEffect(() => {
    scrollToBottom();
  }, [reasoning, expanded, scrollToBottom]);

  // Opening the panel always resumes at the newest reasoning.
  useLayoutEffect(() => {
    if (!expanded) return;
    stickToBottom.current = true;
    scrollToBottom(true);
  }, [expanded, scrollToBottom]);

  useEffect(() => {
    if (isStreaming) {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        setSeconds(Math.max(1, Math.round((Date.now() - start) / 1000)));
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isStreaming]);

  const lines = useMemo(
    () =>
      reasoning
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    [reasoning]
  );
  const currentLine = lines[lines.length - 1] ?? "";
  const previousLine = lines.length > 1 ? lines[lines.length - 2] : "";
  /**
   * The ticker re-rolls once per new line, not once per token: the key only
   * changes when the line count grows, so a line still being written updates in
   * place while the next line animates the previous one out.
   */
  const lineIndex = lines.length;
  const firstLine = lines[0] ?? "";
  const lineCount = lines.length;

  if (!reasoning && !isStreaming) return null;

  return (
    <div className={`tb-thinking-container${expanded ? " is-expanded" : ""}${isStreaming ? " is-streaming" : ""}`}>
      <button
        type="button"
        className="tb-thinking-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={isStreaming ? "Thinking" : "Thought process"}
      >
        <div className="tb-thinking-header-left">
          <span className="tb-thinking-sparkle">
            <ThemeIcon name="sparkles" size={ICON_SIZE.dense} />
          </span>
          <span className="tb-thinking-title">
            {isStreaming ? "Thinking..." : "Thought Process"}
          </span>
          {seconds > 0 && (
            <span className="tb-thinking-time-badge">
              {seconds}s
            </span>
          )}
          {isStreaming && (
            <span className="tb-thinking-pulse" aria-hidden="true" />
          )}

          {expanded ? null : isStreaming ? (
            <span className="tb-thinking-ticker">
              {previousLine ? (
                <span className="tb-thinking-ticker-roll" key={lineIndex}>
                  <span className="tb-thinking-ticker-row">{previousLine}</span>
                  <span className="tb-thinking-ticker-row is-current">
                    {currentLine || EMPTY_PLACEHOLDER}
                  </span>
                </span>
              ) : (
                <span className="tb-thinking-ticker-row is-current">
                  {currentLine || EMPTY_PLACEHOLDER}
                </span>
              )}
            </span>
          ) : (
            <span className="tb-thinking-excerpt">
              {lineCount > 0 ? `${lineCount} ${lineCount === 1 ? "line" : "lines"} · ${firstLine}` : EMPTY_PLACEHOLDER}
            </span>
          )}
        </div>
        <span className={`tb-thinking-chevron${expanded ? " is-open" : ""}`}>
          <ThemeIcon name="chevron-right" size={ICON_SIZE.dense} />
        </span>
      </button>

      {expanded && (
        <div className="tb-thinking-body">
          <div
            className="tb-thinking-content"
            ref={contentRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              if (node.clientHeight <= 0) return;
              stickToBottom.current =
                node.scrollHeight - node.scrollTop - node.clientHeight < 24;
            }}
          >
            {reasoning || EMPTY_PLACEHOLDER}
            {isStreaming && <span className="tb-thinking-caret" />}
          </div>
        </div>
      )}
    </div>
  );
}
