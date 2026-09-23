import React, { useEffect, useRef } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { ChatMessageItem } from "./ChatMessageItem";
import { ChatComposer } from "./ChatComposer";
import { ChatEmptyState } from "./ChatEmptyState";
import type { ThunderChatMessage, ThunderModelInfo } from "@agent-resume/core";
import type { ActiveToolInfo } from "./useThunderChat";

interface ChatMainProps {
  sessionTitle?: string;
  messages: ThunderChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  streamingReasoning: string;
  streamingTools: ActiveToolInfo[];
  models: ThunderModelInfo[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
  thinkingLevel: string;
  onSelectThinkingLevel: (level: string) => void;
  workspaceDir: string;
  onSelectWorkspaceDir: (dir: string) => void;
  workspaceSource?: "finder" | "gtd";
  taskNoteId?: string | null;
  onSelectGtdTask?: (noteId: string, dir: string) => void;
  onSelectFinderDir?: (dir: string) => void;
  isWorkspaceLocked?: boolean;
  useMock: boolean;
  onToggleMock: (mock: boolean) => void;
  onSendMessage: (prompt: string, options?: { workspaceDir?: string; model?: string; thinking_level?: string }) => void;
  onCancelTask: () => void;
  onNewSession: () => void;
  onRegenerate?: (index: number) => void;
  onResend?: (index: number) => void;
  onEditPrompt?: (text: string) => void;
  prefillPrompt?: { text: string; id: number } | null;
  daemonOnline?: boolean;
}

export function ChatMain({
  sessionTitle,
  messages,
  isStreaming,
  streamingText,
  streamingReasoning,
  streamingTools,
  models,
  selectedModel,
  onSelectModel,
  thinkingLevel,
  onSelectThinkingLevel,
  workspaceDir,
  onSelectWorkspaceDir,
  workspaceSource,
  taskNoteId,
  onSelectGtdTask,
  onSelectFinderDir,
  isWorkspaceLocked,
  useMock,
  onToggleMock,
  onSendMessage,
  onCancelTask,
  onNewSession,
  onRegenerate,
  onResend,
  onEditPrompt,
  prefillPrompt,
  daemonOnline = true
}: ChatMainProps) {
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll when messages or streaming tokens change
  useEffect(() => {
    scrollEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages.length, streamingText, streamingReasoning, streamingTools.length]);

  const hasMessages = messages.length > 0 || isStreaming;

  return (
    <div className="tb-chat-main">
      {/* Chat Header */}
      <header className="tb-chat-header">
        <div className="tb-chat-header-title-box">
          <span className="tb-header-icon">
            <ThemeIcon name="sparkles" size={ICON_SIZE.dense} />
          </span>
          <span className="tb-header-title">{sessionTitle || "New Conversation"}</span>
        </div>

        <div className="tb-chat-header-actions">
          {hasMessages && (
            <button
              type="button"
              className="tb-header-action-btn"
              onClick={onNewSession}
              title="Start a new chat"
            >
              <ThemeIcon name="message-square-plus" size={ICON_SIZE.dense} />
              <span>New</span>
            </button>
          )}
        </div>
      </header>

      {/* Messages Feed or Empty State */}
      <div className="tb-chat-feed">
        {!hasMessages ? (
          <ChatEmptyState
            onSelectPrompt={onSendMessage}
            daemonOnline={daemonOnline}
          />
        ) : (
          <div className="tb-messages-container">
            {messages.map((msg, idx) => (
              <ChatMessageItem
                key={`msg_${idx}`}
                message={msg}
                index={idx}
                onRegenerate={onRegenerate}
                onResend={onResend}
                onEdit={onEditPrompt}
              />
            ))}

            {/* Live Streaming Turn */}
            {isStreaming && (
              <ChatMessageItem
                message={{
                  role: "assistant",
                  content: streamingText
                }}
                index={messages.length}
                isStreaming={true}
                streamingReasoning={streamingReasoning}
                streamingTools={streamingTools}
              />
            )}

            <div ref={scrollEndRef} className="tb-scroll-anchor" />
          </div>
        )}
      </div>

      {/* Floating Composer */}
      <ChatComposer
        onSend={onSendMessage}
        onCancel={onCancelTask}
        isStreaming={isStreaming}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        thinkingLevel={thinkingLevel}
        onSelectThinkingLevel={onSelectThinkingLevel}
        workspaceDir={workspaceDir}
        onSelectWorkspaceDir={onSelectWorkspaceDir}
        workspaceSource={workspaceSource}
        taskNoteId={taskNoteId}
        onSelectGtdTask={onSelectGtdTask}
        onSelectFinderDir={onSelectFinderDir}
        workspaceLocked={isWorkspaceLocked}
        useMock={useMock}
        onToggleMock={onToggleMock}
        prefillPrompt={prefillPrompt}
      />
    </div>
  );
}
