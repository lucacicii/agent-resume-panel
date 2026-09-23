import React, { useEffect } from "react";
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
    workspaceDir,
    useMock,
    daemonStatus,
    setSelectedModel,
    setWorkspaceDir,
    setUseMock,
    selectSession,
    createNewSession,
    deleteSession,
    sendMessage,
    resendUserMessage,
    regenerateResponse,
    composerPrefill,
    prefillComposer,
    cancelCurrentTask,
    refreshDaemonStatus
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

  if (!host) return null;

  return createPortal(
    <div className={`tb-chat-view${active ? " is-active" : ""}`} style={{ display: active ? "flex" : "none" }}>
      <ChatSidebar
        conversations={conversations}
        activeSessionId={activeSessionId}
        onSelectSession={selectSession}
        onNewSession={createNewSession}
        onDeleteSession={deleteSession}
        daemonStatus={daemonStatus}
        onRefreshDaemon={refreshDaemonStatus}
      />

      <ChatMain
        sessionTitle={activeSession?.title}
        messages={messages}
        isStreaming={isStreaming}
        streamingText={streamingText}
        streamingReasoning={streamingReasoning}
        streamingTools={streamingTools}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        workspaceDir={workspaceDir}
        onSelectWorkspaceDir={setWorkspaceDir}
        useMock={useMock}
        onToggleMock={setUseMock}
        onSendMessage={sendMessage}
        onCancelTask={cancelCurrentTask}
        onNewSession={createNewSession}
        onRegenerate={regenerateResponse}
        onResend={resendUserMessage}
        onEditPrompt={prefillComposer}
        prefillPrompt={composerPrefill}
        daemonOnline={Boolean(daemonStatus?.available)}
      />
    </div>,
    host
  );
}
