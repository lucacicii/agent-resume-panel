import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChatSidebar } from "./ChatSidebar";
import { ChatMain } from "./ChatMain";
import { useThunderChat } from "./useThunderChat";

export function ChatView({ active }: { active: boolean }): React.JSX.Element | null {
  const host = document.getElementById("react-chat");
  const {
    conversations,
    activeSessionId,
    messages,
    isStreaming,
    streamingText,
    streamingReasoning,
    streamingTools,
    models,
    selectedModel,
    thinkingLevel,
    workspaceDir,
    workspaceSource,
    taskNoteId,
    isWorkspaceLocked,
    daemonStatus,
    setSelectedModel,
    setThinkingLevel,
    setWorkspaceDir,
    setWorkspaceGtdTask,
    setWorkspaceFinderDir,
    selectSession,
    createNewSession,
    deleteSession,
    aiRenameSession,
    renameSession,
    titleNotice,
    dismissTitleNotice,
    pendingQuestion,
    answerQuestion,
    dismissQuestion,
    roles,
    sendMessage,
    resendUserMessage,
    regenerateResponse,
    composerPrefill,
    prefillComposer,
    cancelCurrentTask,
    refreshDaemonStatus,
    currentTrace,
    traceSpans,
    fileChanges,
    telemetryNotices,
    isCollectingTrace,
    lastRunMetrics,
    streamingMetrics,
    sessionTotalTokens,
    currentContextTokens,
    contextWindowLimit
  } = useThunderChat();

  // Keyboard shortcut: ⌘N for new conversation
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        createNewSession();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, createNewSession]);

  const activeSession = conversations.find((c) => c.id === activeSessionId);

  // Track which session is currently being AI-renamed (for sidebar loading state)
  const [aiRenamingSessionId, setAiRenamingSessionId] = useState<string | null>(null);
  const handleAiRename = async (sessionId: string) => {
    setAiRenamingSessionId(sessionId);
    try {
      await aiRenameSession(sessionId);
    } finally {
      setAiRenamingSessionId(null);
    }
  };

  // Auto-dismiss success notices after 5s (errors stay until dismissed)
  useEffect(() => {
    if (titleNotice?.kind !== "success") return;
    const timer = setTimeout(dismissTitleNotice, 5000);
    return () => clearTimeout(timer);
  }, [titleNotice, dismissTitleNotice]);

  if (!host) return null;

  return createPortal(
    <div className={`tb-chat-view${active ? " is-active" : ""}`} style={{ display: active ? "flex" : "none" }}>
      {titleNotice && (
        <div
          className={`tb-chat-title-notice ${titleNotice.kind}`}
          role="status"
          onClick={dismissTitleNotice}
          title="点击关闭"
        >
          <span className="tb-chat-title-notice-text">{titleNotice.text}</span>
          <button
            type="button"
            className="tb-chat-title-notice-close"
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              dismissTitleNotice();
            }}
          >
            ×
          </button>
        </div>
      )}
      <ChatSidebar
        conversations={conversations}
        activeSessionId={activeSessionId}
        onSelectSession={selectSession}
        onNewSession={createNewSession}
        onDeleteSession={deleteSession}
        onAiRenameSession={handleAiRename}
        onRenameSession={renameSession}
        aiRenamingSessionId={aiRenamingSessionId}
        daemonStatus={daemonStatus}
        onRefreshDaemon={refreshDaemonStatus}
      />

      <ChatMain
        active={active}
        sessionId={activeSessionId}
        sessionTitle={activeSession?.title}
        messages={messages}
        isStreaming={isStreaming}
        streamingText={streamingText}
        streamingReasoning={streamingReasoning}
        streamingTools={streamingTools}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        thinkingLevel={thinkingLevel}
        onSelectThinkingLevel={setThinkingLevel}
        workspaceDir={workspaceDir}
        onSelectWorkspaceDir={setWorkspaceDir}
        workspaceSource={workspaceSource}
        taskNoteId={taskNoteId}
        onSelectGtdTask={setWorkspaceGtdTask}
        onSelectFinderDir={setWorkspaceFinderDir}
        isWorkspaceLocked={isWorkspaceLocked}
        onSendMessage={sendMessage}
        onCancelTask={cancelCurrentTask}
        onNewSession={createNewSession}
        onRegenerate={regenerateResponse}
        onResend={resendUserMessage}
        onEditPrompt={prefillComposer}
        prefillPrompt={composerPrefill}
        daemonOnline={Boolean(daemonStatus?.available)}
        currentTrace={currentTrace}
        traceSpans={traceSpans}
        fileChanges={fileChanges}
        telemetryNotices={telemetryNotices}
        isCollectingTrace={isCollectingTrace}
        lastRunMetrics={lastRunMetrics}
        streamingMetrics={streamingMetrics}
        sessionTotalTokens={sessionTotalTokens}
        currentContextTokens={currentContextTokens}
        contextWindowLimit={contextWindowLimit}
        roles={roles}
        pendingQuestion={pendingQuestion}
        onAnswerQuestion={answerQuestion}
        onDismissQuestion={dismissQuestion}
      />
    </div>,
    host
  );
}
