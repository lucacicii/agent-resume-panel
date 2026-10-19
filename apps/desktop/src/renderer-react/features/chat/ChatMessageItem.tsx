import React, { useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";
import { toFileUrl } from "../../components/markdownImage";
import { ThinkingState } from "./ThinkingState";
import { ToolCallsState } from "./ToolCallsState";
import type { ActiveToolInfo, LiveSegment, RenderedChatMessage } from "./useThunderChat";

interface ChatMessageItemProps {
  message: RenderedChatMessage;
  index?: number;
  /**
   * Rendered as `data-timeline-index` on the row, so the chat timeline can
   * measure this message's real offset in the scroll content. Absent on rows
   * that are not jump targets.
   */
  anchorIndex?: number;
  isStreaming?: boolean;
  /**
   * The ordered runs of a turn this renderer watched stream in. When present the
   * body is laid out in true time order; otherwise the message's own shape
   * (reasoning, then answer, then tool calls) is used.
   */
  segments?: LiveSegment[];
  /**
   * The run's finished turns, as the pile of dots that hangs off this reply.
   * Rendered as the container's first child, so it lands right after the avatar
   * and above the answer — the history of a run belongs to the agent's reply,
   * not to the pane. `ChatMain` decides which row owns the paint: the streaming
   * one while the run is live, the run's answer once it is over.
   */
  turnDots?: React.ReactNode;
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
  anchorIndex,
  isStreaming = false,
  segments,
  turnDots,
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
  const [turnsExpanded, setTurnsExpanded] = useState<boolean | null>(null);
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
  const turns = message.turns ?? [];

  const allReasoning = React.useMemo(() => {
    if (activeReasoning) return activeReasoning;
    if (turns.length > 0) {
      const texts: string[] = [];
      for (const t of turns) {
        for (const seg of t.segments) {
          if (seg.kind === "reasoning" && seg.text) {
            texts.push(seg.text);
          }
        }
      }
      return texts.join("\n\n---\n\n");
    }
    return "";
  }, [activeReasoning, turns]);

  const allTools: ActiveToolInfo[] = React.useMemo(() => {
    if (activeTools && activeTools.length > 0) return activeTools;
    if (turns.length > 0) {
      const result: ActiveToolInfo[] = [];
      for (const t of turns) {
        for (const seg of t.segments) {
          if (seg.kind === "tools" && seg.tools) {
            result.push(...seg.tools);
          }
        }
      }
      return result;
    }
    return [];
  }, [activeTools, turns]);

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
              // Live segments ride on assistant rows (the user row carries no
              // segments); still, a bare pasted path is quoted text, never an
              // attachment, so promotion stays off wherever the row is the user's.
              imageOptions={isUser ? { promoteBarePaths: false } : undefined}
            />
          </div>
        );
      })
) : (
  <>
        {turns.length > 0 ? (
          <div className="tb-chronological-timeline">
            {turns.length > 2 && (
              <div className="tb-timeline-summary-bar">
                <button
                  type="button"
                  className="tb-timeline-summary-toggle"
                  onClick={() => setTurnsExpanded((prev) => !(prev ?? (turns.length <= 2)))}
                >
                  <span className="tb-timeline-summary-icon">
                    <ThemeIcon name="sparkles" size={ICON_SIZE.dense} />
                  </span>
                  <span className="tb-timeline-summary-label">
                    {turns.length} steps in sequence ({allTools.length} {allTools.length === 1 ? "action" : "actions"})
                  </span>
                  <span className="tb-timeline-summary-hint">
                    {(turnsExpanded ?? (turns.length <= 2)) ? "Hide sequence ▴" : "Show sequence ▾"}
                  </span>
                </button>
              </div>
            )}

            <div className={`tb-timeline-steps-stream${(turnsExpanded ?? (turns.length <= 2)) ? " is-expanded" : " is-collapsed"}`}>
              {turns.map((turn, tIdx) => {
                const hasSegments = turn.segments && turn.segments.length > 0;
                return (
                  <div key={`turn_seq_${turn.turn}_${tIdx}`} className="tb-timeline-turn-block">
                    <div className="tb-timeline-turn-header">
                      <span className="tb-timeline-turn-dot" />
                      <span className="tb-timeline-turn-title">Step {turn.turn}</span>
                      {turn.durationMs !== undefined && turn.durationMs > 0 && (
                        <span className="tb-timeline-turn-time">{(turn.durationMs / 1000).toFixed(1)}s</span>
                      )}
                      {turn.status === "error" && (
                        <span className="tb-timeline-turn-error">failed</span>
                      )}
                    </div>
                    <div className="tb-timeline-turn-body">
                      {hasSegments ? (
                        turn.segments.map((seg, sIdx) => {
                          if (seg.kind === "reasoning" && seg.text) {
                            return (
                              <ThinkingState
                                key={`turn_${turn.turn}_r_${sIdx}`}
                                reasoning={seg.text}
                                isStreaming={false}
                                defaultExpanded={false}
                              />
                            );
                          }
                          if (seg.kind === "tools" && seg.tools && seg.tools.length > 0) {
                            return (
                              <ToolCallsState
                                key={`turn_${turn.turn}_t_${sIdx}`}
                                tools={seg.tools}
                                isStreaming={false}
                                defaultExpanded={false}
                              />
                            );
                          }
                          return null;
                        })
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {allReasoning ? (
              <ThinkingState reasoning={allReasoning} isStreaming={isStreaming && !message.content} defaultExpanded={false} />
            ) : null}
            {allTools.length > 0 ? (
              <ToolCallsState tools={allTools} isStreaming={isStreaming} defaultExpanded={false} />
            ) : null}
          </>
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
                      ? toFileUrl(p.path)
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
              // A user row's real attachments arrive as `parts` (painted above);
              // a bare path in its text is quoted terminal output. Promoting it
              // would paint a phantom image for a file the daemon never saw.
              imageOptions={isUser ? { promoteBarePaths: false } : undefined}
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
    <div
      className={`tb-message-row${isUser ? " is-user" : " is-assistant"}`}
      data-timeline-index={anchorIndex}
    >
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
        {turnDots}
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
