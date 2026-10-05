import React, { useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";
import { ThinkingState } from "./ThinkingState";
import { ToolCallsState } from "./ToolCallsState";
import type { ThunderChatMessage } from "@agent-resume/core";
import type { ActiveToolInfo, LiveSegment } from "./useThunderChat";

interface ChatMessageItemProps {
  message: ThunderChatMessage;
  index?: number;
  isStreaming?: boolean;
  /**
   * The ordered runs of a turn this renderer watched stream in. When present the
   * body is laid out in true time order; otherwise the message's own shape
   * (reasoning, then answer, then tool calls) is used.
   */
  segments?: LiveSegment[];
  onRegenerate?: (index: number) => void;
  onResend?: (index: number) => void;
  onEdit?: (text: string) => void;
  /** Translated text to show instead of the original message content. */
  displayText?: string;
  /** A translation for this message is currently showing. */
  translated?: boolean;
  /** A translation for this message is in flight. */
  isTranslating?: boolean;
  onTranslate?: (index: number, text: string) => void;
  translateLabel?: string;
  restoreLabel?: string;
  translatingLabel?: string;
}

export function ChatMessageItem({
  message,
  index = 0,
  isStreaming = false,
  segments,
  onRegenerate,
  onResend,
  onEdit,
  displayText,
  translated = false,
  isTranslating = false,
  onTranslate,
  translateLabel = "Translate",
  restoreLabel = "Show original",
  translatingLabel = "Translating…"
}: ChatMessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const isUser = message.role === "user";

  const handleCopy = async () => {
    if (message.content) {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // Convert stored tool_calls to ActiveToolInfo format for historical rendering
  const historicalTools: ActiveToolInfo[] = React.useMemo(() => {
    if (!message.tool_calls || message.tool_calls.length === 0) return [];
    return message.tool_calls.map((tc) => {
      let argsObj: Record<string, unknown> = {};
      try {
        argsObj = JSON.parse(tc.function.arguments);
      } catch {
        argsObj = { raw: tc.function.arguments };
      }
      return {
        toolCallId: tc.id,
        name: tc.function.name,
        arguments: argsObj,
        isRunning: false
      };
    });
  }, [message.tool_calls]);

  const activeReasoning = message.reasoning || "";
  const activeTools = message.tool_executions || historicalTools;
  const liveSegments = segments ?? [];
  const lastSegmentIndex = liveSegments.length - 1;
  const lastTextIndex = liveSegments.reduce(
    (found, segment, segmentIndex) => (segment.kind === "text" ? segmentIndex : found),
    -1
  );

  // A turn still streaming is one ordered stream; a turn read back from disk has
  // lost that order, so it falls back to the shape the engine persisted.
  const body =
    liveSegments.length > 0 ? (
      liveSegments.map((segment, segmentIndex) => {
        const isLast = segmentIndex === lastSegmentIndex;
        if (segment.kind === "reasoning") {
          return (
            <ThinkingState
              key={`seg_reasoning_${segmentIndex}`}
              reasoning={segment.text}
              isStreaming={isStreaming && isLast}
            />
          );
        }
        if (segment.kind === "tools") {
          return (
            <ToolCallsState
              key={`seg_tools_${segmentIndex}`}
              tools={segment.tools}
              isStreaming={isStreaming && isLast}
              defaultExpanded={false}
            />
          );
        }
        return (
          <div className="tb-message-bubble" key={`seg_text_${segmentIndex}`}>
            <StreamdownRenderer
              content={segmentIndex === lastTextIndex && displayText ? displayText : segment.text}
              isAnimating={isStreaming && isLast}
              className="tb-markdown-view markdown-body"
              hardBreaks
            />
          </div>
        );
      })
    ) : (
      <>
        {activeReasoning && (
          <ThinkingState reasoning={activeReasoning} isStreaming={isStreaming && !message.content} />
        )}

        {/* Grouped Tool Calls (Collapsed by default, similar to Thinking) */}
        {activeTools.length > 0 && (
          <ToolCallsState tools={activeTools} isStreaming={isStreaming} defaultExpanded={false} />
        )}

        <div className="tb-message-bubble">
          {isUser && message.parts && message.parts.some((p) => p.type === "image") && (
            <div className="wb-terminal-composer-pending-images tb-message-images">
              {message.parts
                .filter((p) => p.type === "image")
                .map((p, idx) => {
                  if (p.type !== "image") return null;
                  const src = p.data
                    ? p.data.startsWith("data:")
                      ? p.data
                      : `data:${p.mimeType};base64,${p.data}`
                    : p.path
                      ? `file://${p.path}`
                      : "";
                  if (!src) return null;
                  return (
                    <div className="wb-terminal-composer-pending-image" key={`img_${idx}`}>
                      <button
                        type="button"
                        className="wb-terminal-composer-pending-image-open"
                        onClick={() => setImagePreview(src)}
                        title={p.name || "Attached image"}
                      >
                        <img src={src} alt={p.name || ""} />
                      </button>
                    </div>
                  );
                })}
            </div>
          )}
          {message.content ? (
            <StreamdownRenderer
              content={displayText ?? message.content}
              isAnimating={isStreaming}
              className="tb-markdown-view markdown-body"
              hardBreaks
            />
          ) : isStreaming ? (
            <div className="tb-streaming-placeholder">
              <span className="tb-pulse-dot" />
              <span>Thunder agent is thinking...</span>
            </div>
          ) : null}
        </div>
      </>
    );

  return (
    <div className={`tb-message-row${isUser ? " is-user" : " is-assistant"}`}>
      <div className="tb-message-avatar">
        {isUser ? (
          <span className="tb-avatar-user">You</span>
        ) : (
          <span className="tb-avatar-agent">
            <ThemeIcon name="sparkles" size={ICON_SIZE.dense} />
          </span>
        )}
      </div>

      <div className="tb-message-container">
        {body}

        {/* User Message Action Toolbar */}
        {isUser && message.content && (
          <div className="tb-message-user-toolbar">
            <button
              type="button"
              className="tb-message-action-btn"
              onClick={handleCopy}
              title="Copy message"
            >
              <ThemeIcon name={copied ? "check" : "copy"} size={ICON_SIZE.inline} />
            </button>
            {onEdit && (
              <button
                type="button"
                className="tb-message-action-btn"
                onClick={() => onEdit(message.content || "")}
                title="Edit and quote to composer"
              >
                <ThemeIcon name="pencil" size={ICON_SIZE.inline} />
              </button>
            )}
            {onResend && (
              <button
                type="button"
                className="tb-message-action-btn"
                onClick={() => onResend(index)}
                disabled={isStreaming}
                title="Resend this message"
              >
                <ThemeIcon name="refresh" size={ICON_SIZE.inline} />
              </button>
            )}
          </div>
        )}

        {/* Message Actions & Meta Footer: translate + copy + regenerate */}
        {/* Error Retry Banner */}
        {!isUser && message.content?.startsWith("⚠️") && onRegenerate && (
          <div className="tb-message-error-action">
            <button
              type="button"
              className="tb-message-retry-btn"
              onClick={() => onRegenerate(index)}
              disabled={isStreaming}
              title="Retry task execution"
            >
              <ThemeIcon name="refresh" size={ICON_SIZE.inline} />
              <span>Retry Task</span>
            </button>
          </div>
        )}

        {/* Message Actions & Meta Footer: translate + copy + regenerate */}
        {!isUser && message.content && (
          <div className="tb-message-footer">
            {onTranslate ? (
              <button
                type="button"
                className="tb-message-action-btn"
                disabled={isTranslating || isStreaming}
                onClick={() => onTranslate(index, message.content || "")}
                title={translated ? restoreLabel : translateLabel}
                aria-label={translated ? restoreLabel : translateLabel}
              >
                <ThemeIcon name="globe" size={ICON_SIZE.inline} />
                <span>{translated ? restoreLabel : isTranslating ? translatingLabel : translateLabel}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="tb-message-action-btn"
              onClick={handleCopy}
              title="Copy answer"
            >
              <ThemeIcon name={copied ? "check" : "copy"} size={ICON_SIZE.inline} />
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>

            {onRegenerate && !message.content.startsWith("⚠️") && (
              <button
                type="button"
                className="tb-message-action-btn"
                onClick={() => onRegenerate(index)}
                disabled={isStreaming}
                title="Regenerate answer"
              >
                <ThemeIcon name="refresh" size={ICON_SIZE.inline} />
                <span>Regenerate</span>
              </button>
            )}

            {message.stats && (
              <span className="tb-message-stats">
                {message.stats.turn ? `Turn ${message.stats.turn}` : ""}
                {message.stats.completion_tokens ? ` • ${message.stats.completion_tokens} tokens` : ""}
                {message.stats.duration_ms ? ` • ${(message.stats.duration_ms / 1000).toFixed(1)}s` : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {imagePreview ? (
        <div
          className="notes-image-preview"
          role="dialog"
          aria-modal="true"
          onClick={() => setImagePreview(null)}
        >
          <img src={imagePreview} alt="" />
          <button
            type="button"
            className="notes-image-preview-close"
            aria-label="Close"
            onClick={() => setImagePreview(null)}
          >
            <ThemeIcon name="close" size={ICON_SIZE.default} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
