import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChatSidebar } from "./ChatSidebar";
import { ChatMain } from "./ChatMain";
import { useThunderChat } from "./useThunderChat";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";

export function ChatView({ active }: { active: boolean }): React.JSX.Element | null {
  const host = document.getElementById("react-chat");
  const {
    conversations,
    activeSessionId,
    messages,
    isStreaming,
    liveSegments,
    allLiveSegments,
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

  const activeSession = conversations.find((c) => c.id === activeSessionId);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const stored = localStorage.getItem("agent-resume:chat-sidebar-open");
      return stored === "1"; // Default closed for clean single-entry experience
    } catch {
      return false;
    }
  });

  // Keyboard shortcut: ⌘N for new conversation, ⌘B to toggle session history
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        createNewSession();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((prev) => {
          const next = !prev;
          try {
            localStorage.setItem("agent-resume:chat-sidebar-open", next ? "1" : "0");
          } catch {
            /* ignore */
          }
          return next;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, createNewSession]);

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
      {sidebarOpen ? (
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
      ) : null}

      <ChatMain
        headerExtra={
          <div className="tb-chat-header-session-actions" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              className={`tb-chat-header-btn${sidebarOpen ? " is-active" : ""}`}
              onClick={() => {
                setSidebarOpen((prev) => {
                  const next = !prev;
                  try {
                    localStorage.setItem("agent-resume:chat-sidebar-open", next ? "1" : "0");
                  } catch {
                    /* ignore */
                  }
                  return next;
                });
              }}
              title={sidebarOpen ? "Hide session history (⌘B)" : "Show session history (⌘B)"}
              aria-label="Toggle session history"
            >
              <ThemeIcon name="history" size={ICON_SIZE.default} />
            </button>
            <button
              type="button"
              className="tb-chat-header-btn"
              onClick={createNewSession}
              title="New conversation (⌘N)"
              aria-label="New conversation"
            >
              <ThemeIcon name="plus" size={ICON_SIZE.default} />
            </button>
          </div>
        }
        active={active}
        notice={titleNotice}
        onDismissNotice={dismissTitleNotice}
        showWorkspacePicker={true}
        sessionId={activeSessionId}
        sessionTitle={activeSession?.title}
        messages={messages}
        isStreaming={isStreaming}
        liveSegments={liveSegments}
        allLiveSegments={allLiveSegments}
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
