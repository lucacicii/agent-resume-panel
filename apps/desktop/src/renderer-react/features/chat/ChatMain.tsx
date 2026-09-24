import React, { useEffect, useRef, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { ChatMessageItem } from "./ChatMessageItem";
import { ChatComposer } from "./ChatComposer";
import { ChatEmptyState } from "./ChatEmptyState";
import { TracePopover } from "./TracePopover";
import { FileChangesPopover } from "./FileChangesPopover";
import type {
  ThunderChatMessage,
  ThunderModelInfo,
  ThunderFileChangeRecord,
  ThunderTaskTrace,
  ThunderTelemetryNotice
} from "@agent-resume/core";
import type { ActiveToolInfo } from "./useThunderChat";
import type { TraceSpan } from "./useTraceCollector";

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
  currentTrace?: ThunderTaskTrace | null;
  traceSpans?: TraceSpan[];
  fileChanges?: ThunderFileChangeRecord[];
  telemetryNotices?: ThunderTelemetryNotice[];
  isCollectingTrace?: boolean;
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
  daemonOnline = true,
  currentTrace,
  traceSpans = [],
  fileChanges = [],
  telemetryNotices = [],
  isCollectingTrace = false
}: ChatMainProps) {
  const scrollEndRef = useRef<HTMLDivElement | null>(null);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [isFilesOpen, setIsFilesOpen] = useState(false);

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
          {/* Trace Popover Trigger */}
          <button
            type="button"
            className={`tb-header-action-btn${isTraceOpen ? " is-active" : ""}`}
            onClick={() => setIsTraceOpen(!isTraceOpen)}
            title="View execution trace and telemetry"
          >
            <ThemeIcon name="activity" size={ICON_SIZE.dense} />
            <span>Trace</span>
            {isCollectingTrace ? (
              <span className="tb-header-pulse" />
            ) : currentTrace?.duration_ms ? (
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--color-label-tertiary)",
                  fontFamily: "var(--font-family-mono, monospace)"
                }}
              >
                {(currentTrace.duration_ms / 1000).toFixed(1)}s
              </span>
            ) : null}
          </button>

          {/* Files Popover Trigger */}
          <button
            type="button"
            className={`tb-header-action-btn${isFilesOpen ? " is-active" : ""}`}
            onClick={() => setIsFilesOpen(!isFilesOpen)}
            title="View modified files"
          >
            <ThemeIcon name="file-diff" size={ICON_SIZE.dense} />
            <span>Files</span>
            {fileChanges.length > 0 && (
              <span className="tb-header-badge">{fileChanges.length}</span>
            )}
          </button>
        </div>
      </header>

      {/* Popovers */}
      <TracePopover
        isOpen={isTraceOpen}
        onClose={() => setIsTraceOpen(false)}
        trace={currentTrace || null}
        spans={traceSpans}
        telemetryNotices={telemetryNotices}
        isCollecting={isCollectingTrace}
      />

      <FileChangesPopover
        isOpen={isFilesOpen}
        onClose={() => setIsFilesOpen(false)}
        files={fileChanges}
        workspaceDir={workspaceDir}
      />

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
