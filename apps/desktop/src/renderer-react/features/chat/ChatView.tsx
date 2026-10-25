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
    liveSegments,
    liveTurns,
    models,
    selectedModel,
    thinkingLevel,
    permissionMode,
    workspaceDir,
    workspaceSource,
    taskNoteId,
    isWorkspaceLocked,
    daemonStatus,
    setSelectedModel,
    setThinkingLevel,
    setPermissionMode,
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
    sendMessage,
    resendUserMessage,
    regenerateResponse,
    composerPrefill,
    prefillComposer,
    cancelCurrentTask,
    pausedTask,
    pauseCurrentTask,
    resumeCurrentTask,
    queued,
    steerRunningTask,
    followUpRunningTask,
    refreshDaemonStatus,
    traceSpans,
    fileChanges,
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


  if (!host) return null;

  return createPortal(
    <div className={`tb-chat-view${active ? " is-active" : ""}`} style={{ display: active ? "flex" : "none" }}>
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
        notice={titleNotice}
        onDismissNotice={dismissTitleNotice}
        showWorkspacePicker={false}
        sessionId={activeSessionId}
        sessionTitle={activeSession?.title}
        messages={messages}
        isStreaming={isStreaming}
        liveSegments={liveSegments}
        liveTurns={liveTurns}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        thinkingLevel={thinkingLevel}
        onSelectThinkingLevel={setThinkingLevel}
        permissionMode={permissionMode}
        onSelectPermissionMode={setPermissionMode}
        workspaceDir={workspaceDir}
        onSelectWorkspaceDir={setWorkspaceDir}
        workspaceSource={workspaceSource}
        taskNoteId={taskNoteId}
        onSelectGtdTask={setWorkspaceGtdTask}
        onSelectFinderDir={setWorkspaceFinderDir}
        isWorkspaceLocked={isWorkspaceLocked}
        onSendMessage={sendMessage}
        onCancelTask={cancelCurrentTask}
        pausedTask={pausedTask}
        onPauseTask={pauseCurrentTask}
        onResumeTask={resumeCurrentTask}
        queuedCount={queued.steering.length + queued.followUp.length}
        onSteerMessage={(message, attachments) => void steerRunningTask(message, attachments)}
        onFollowUpMessage={(message, attachments) =>
          void followUpRunningTask(message, attachments)
        }
        onNewSession={createNewSession}
        onRegenerate={regenerateResponse}
        onResend={resendUserMessage}
        onEditPrompt={prefillComposer}
        prefillPrompt={composerPrefill}
        daemonOnline={Boolean(daemonStatus?.available)}
        traceSpans={traceSpans}
        fileChanges={fileChanges}
        lastRunMetrics={lastRunMetrics}
        streamingMetrics={streamingMetrics}
        sessionTotalTokens={sessionTotalTokens}
        currentContextTokens={currentContextTokens}
        contextWindowLimit={contextWindowLimit}
        pendingQuestion={pendingQuestion}
        onAnswerQuestion={answerQuestion}
        onDismissQuestion={dismissQuestion}
      />
    </div>,
    host
  );
}
