import React, { useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";
import { ThinkingState } from "./ThinkingState";
import { ToolCallsState } from "./ToolCallsState";
import type { ThunderChatMessage } from "@agent-resume/core";
import type { ActiveToolInfo } from "./useThunderChat";

interface ChatMessageItemProps {
  message: ThunderChatMessage;
  index?: number;
  isStreaming?: boolean;
  streamingReasoning?: string;
  streamingTools?: ActiveToolInfo[];
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
  streamingReasoning = "",
  streamingTools = [],
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

  const activeReasoning = (isStreaming ? streamingReasoning : "") || message.reasoning || "";
  const activeTools =
    (isStreaming && streamingTools.length > 0 ? streamingTools : null) ||
    message.tool_executions ||
    historicalTools;

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
        {/* Thinking / Reasoning Section */}
        {activeReasoning && (
          <ThinkingState
            reasoning={activeReasoning}
            isStreaming={isStreaming && !message.content}
          />
        )}

        {/* Grouped Tool Calls (Collapsed by default, similar to Thinking) */}
        {activeTools.length > 0 && (
          <ToolCallsState
            tools={activeTools}
            isStreaming={isStreaming}
            defaultExpanded={false}
          />
        )}

        {/* Message Content */}
        <div className="tb-message-bubble">
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
    </div>
  );
}
