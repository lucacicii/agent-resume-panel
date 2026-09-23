import React, { useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";
import { ThinkingState } from "./ThinkingState";
import { ToolChip } from "./ToolChip";
import type { ThunderChatMessage } from "@agent-resume/core";
import type { ActiveToolInfo } from "./useThunderChat";

interface ChatMessageItemProps {
  message: ThunderChatMessage;
  isStreaming?: boolean;
  streamingReasoning?: string;
  streamingTools?: ActiveToolInfo[];
}

export function ChatMessageItem({
  message,
  isStreaming = false,
  streamingReasoning = "",
  streamingTools = []
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

  const activeReasoning = message.reasoning || (isStreaming ? streamingReasoning : "");
  const activeTools = isStreaming ? streamingTools : historicalTools;

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

        {/* Tool Call Chips */}
        {activeTools.length > 0 && (
          <div className="tb-message-tools-stack">
            {activeTools.map((tool) => (
              <ToolChip key={tool.toolCallId} tool={tool} />
            ))}
          </div>
        )}

        {/* Message Content */}
        <div className="tb-message-bubble">
          {message.content ? (
            <StreamdownRenderer
              content={message.content}
              isAnimating={isStreaming}
              className="tb-markdown-view"
            />
          ) : isStreaming ? (
            <div className="tb-streaming-placeholder">
              <span className="tb-pulse-dot" />
              <span>Thunder agent is thinking...</span>
            </div>
          ) : null}
        </div>

        {/* Message Actions & Meta Footer */}
        {!isUser && message.content && (
          <div className="tb-message-footer">
            <button
              type="button"
              className="tb-message-action-btn"
              onClick={handleCopy}
              title="Copy answer"
            >
              <ThemeIcon name={copied ? "check" : "copy"} size={ICON_SIZE.inline} />
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>

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
