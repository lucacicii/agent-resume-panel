import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";

interface ThinkingStateProps {
  reasoning: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
}

export function ThinkingState({
  reasoning,
  isStreaming = false,
  defaultExpanded = false
}: ThinkingStateProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || isStreaming);
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
      setExpanded(true);
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

  if (!reasoning && !isStreaming) return null;

  return (
    <div className={`tb-thinking-container${expanded ? " is-expanded" : ""}${isStreaming ? " is-streaming" : ""}`}>
      <button
        type="button"
        className="tb-thinking-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
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
            {reasoning || "Analyzing context and planning next steps..."}
            {isStreaming && <span className="tb-thinking-caret" />}
          </div>
        </div>
      )}
    </div>
  );
}
