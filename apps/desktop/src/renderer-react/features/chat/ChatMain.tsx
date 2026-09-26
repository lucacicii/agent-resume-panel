import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import { ChatMessageItem } from "./ChatMessageItem";
import { ChatComposer } from "./ChatComposer";
import { ChatQuestionBubble } from "./ChatQuestionBubble";
import { ChatEmptyState } from "./ChatEmptyState";
import { TracePopover } from "./TracePopover";
import { FileChangesPopover } from "./FileChangesPopover";
import { GitDiffPopover } from "./GitDiffPopover";
import {
  extractConversationTouchedPaths,
  filterConversationDirtyFiles
} from "./gitDiffUtils";
import type {
  ThunderChatMessage,
  ThunderModelInfo,
  ThunderRoleInfo,
  ThunderQuestionItem,
  ThunderFileChangeRecord,
  ThunderTaskTrace,
  ThunderTelemetryNotice
} from "@agent-resume/core";
import type { ActiveToolInfo, ChatRunMetrics } from "./useThunderChat";
import type { TraceSpan } from "./useTraceCollector";

interface ChatMainProps {
  sessionId?: string | null;
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
  onSendMessage: (
    prompt: string,
    options?: { workspaceDir?: string; model?: string; thinking_level?: string; role?: string }
  ) => void;
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
  lastRunMetrics?: ChatRunMetrics | null;
  streamingMetrics?: { tokensCount: number; tps: number; reasoningCount?: number } | null;
  sessionTotalTokens?: number;
  currentContextTokens?: number;
  contextWindowLimit?: number;
  /** Roles offered as slash commands. */
  roles?: ThunderRoleInfo[];
  /** Question the agent is blocked on, rendered as a bubble. */
  pendingQuestion?: { questionId: string; taskId: string; questions: ThunderQuestionItem[] } | null;
  onAnswerQuestion?: (answers: Record<string, string> | undefined, cancelled?: boolean) => void | Promise<void>;
  onDismissQuestion?: () => void | Promise<void>;
}

export function ChatMain({
  sessionId,
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
  isCollectingTrace = false,
  lastRunMetrics,
  streamingMetrics,
  sessionTotalTokens,
  currentContextTokens,
  contextWindowLimit,
  roles = [],
  pendingQuestion,
  onAnswerQuestion,
  onDismissQuestion
}: ChatMainProps) {
  const feedRef = useRef<HTMLDivElement | null>(null);
  /** A strategy while true: follow the newest content (正文 + thinking). */
  const stickToBottom = useRef(true);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [isFilesOpen, setIsFilesOpen] = useState(false);
  const [isGitDiffOpen, setIsGitDiffOpen] = useState(false);
  const [conversationDirtyCount, setConversationDirtyCount] = useState<number>(0);

  // Keep git diff badge count in sync with conversation file modifications
  useEffect(() => {
    let cancelled = false;
    if (!workspaceDir) {
      setConversationDirtyCount(0);
      return;
    }

    const updateCount = async () => {
      try {
        const gitInfo = await desktopApi()
          .terminalGitInfo({ cwd: workspaceDir })
          .catch(() => ({ isRepo: false, repoRoot: null, branch: null }));
        if (!gitInfo.isRepo || cancelled) {
          if (!cancelled) setConversationDirtyCount(0);
          return;
        }
        const root = gitInfo.repoRoot || workspaceDir;
        const touched = extractConversationTouchedPaths({
          fileChanges,
          messages,
          streamingTools,
          repoRoot: root,
          workspaceDir
        });
        if (touched.size === 0) {
          if (!cancelled) setConversationDirtyCount(0);
          return;
        }
        const status = await desktopApi()
          .terminalGitStatus({ cwd: root })
          .catch(() => null);
        if (!status || cancelled) return;
        const dirtyCandidates = [
          ...(status.unstaged || []),
          ...(status.staged || [])
        ].map((f) => ({ path: f.path, repoPath: f.repoPath, status: f.status }));
        const matched = filterConversationDirtyFiles(dirtyCandidates, touched);
        if (!cancelled) {
          setConversationDirtyCount(matched.length);
        }
      } catch {
        if (!cancelled) setConversationDirtyCount(0);
      }
    };

    void updateCount();
    return () => {
      cancelled = true;
    };
  }, [workspaceDir, fileChanges, messages, streamingTools]);

  const scrollToBottom = useCallback((force = false) => {
    const node = feedRef.current;
    if (!node) return;
    if (!force && !stickToBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  // Switching conversations always starts pinned to the newest content.
  useLayoutEffect(() => {
    stickToBottom.current = true;
    scrollToBottom(true);
  }, [sessionId, scrollToBottom]);

  // A strategy: follow streaming content unless the user scrolled away (B).
  useLayoutEffect(() => {
    scrollToBottom();
  }, [messages.length, streamingText, streamingReasoning, streamingTools, scrollToBottom]);

  const hasMessages = messages.length > 0 || isStreaming;
  const showEmptyState = !hasMessages;

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

          {/* Git Diff Popover Trigger */}
          <button
            type="button"
            className={`tb-header-action-btn${isGitDiffOpen ? " is-active" : ""}`}
            onClick={() => setIsGitDiffOpen(!isGitDiffOpen)}
            title="View Git diff and commit conversation changes"
          >
            <ThemeIcon name="git-branch" size={ICON_SIZE.dense} />
            <span>Git Diff</span>
            {conversationDirtyCount > 0 && (
              <span className="tb-header-badge">{conversationDirtyCount}</span>
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

      <GitDiffPopover
        isOpen={isGitDiffOpen}
        onClose={() => setIsGitDiffOpen(false)}
        workspaceDir={workspaceDir}
        fileChanges={fileChanges}
        messages={messages}
        streamingTools={streamingTools}
        onCommitSuccess={() => setConversationDirtyCount(0)}
      />

      {/* Messages Feed or Empty State */}
      <div className="tb-chat-feed" ref={feedRef} onScroll={(event) => {
        const node = event.currentTarget;
        if (node.clientHeight <= 0) return;
        stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}>
        {showEmptyState ? (
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

            <div className="tb-scroll-anchor" />
          </div>
        )}
      </div>

      {/* Agent question bubble — the task is parked until answered */}
      {pendingQuestion && pendingQuestion.questions.length > 0 ? (
        <ChatQuestionBubble
          questionId={pendingQuestion.questionId}
          questions={pendingQuestion.questions}
          onAnswer={(answers) => onAnswerQuestion?.(answers, false)}
          onDismiss={() => onDismissQuestion?.()}
        />
      ) : null}

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
        prefillPrompt={prefillPrompt}
        lastRunMetrics={lastRunMetrics}
        streamingMetrics={streamingMetrics}
        sessionTotalTokens={sessionTotalTokens}
        currentContextTokens={currentContextTokens}
        contextWindowLimit={contextWindowLimit}
        roles={roles}
      />
    </div>
  );
}
