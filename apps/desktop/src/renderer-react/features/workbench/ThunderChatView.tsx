import { useCallback, useEffect, useRef, type JSX } from "react";
import { desktopApi } from "../../bridge";
import { ChatMain } from "../chat/ChatMain";
import { useThunderChat } from "../chat/useThunderChat";

export type ThunderChatViewProps = {
  /** Bound Thunder conversation (`sess_*`). Absent → the pane mints one on first send. */
  sessionId?: string;
  projectPath: string;
  title: string;
  active: boolean;
  /** GTD task this pane serves; the conversation is linked to it when set. */
  taskNoteId?: string | null;
  initialPrompt?: string;
  /** Fired after the first task so the parent can persist the real session id. */
  onSessionReady?: (sessionId: string) => void;
  onTitleChange?: (title: string) => void;
  onInitialPromptSubmitted?: () => void;
};

/**
 * Thunder's visual chat embedded in the Workbench tab strip.
 *
 * It intentionally reuses the board `ChatView`'s hook and `ChatMain` rather than
 * duplicating the streaming/tool/trace rendering: the daemon broadcasts events
 * with a `sessionId`, so each mounted pane only reacts to its own conversation.
 */
export function ThunderChatView({
  sessionId,
  projectPath,
  title,
  active,
  taskNoteId,
  initialPrompt,
  onSessionReady,
  onTitleChange,
  onInitialPromptSubmitted
}: ThunderChatViewProps): JSX.Element {
  const chat = useThunderChat();
  const initialPromptRef = useRef(initialPrompt?.trim() || "");
  const initialPromptSentRef = useRef(false);
  const boundWorkspaceRef = useRef("");

  // Bind the pane to its task workspace before any run, so the daemon jails the
  // agent to the right directory and the conversation is linked to the task.
  useEffect(() => {
    const workspace = projectPath?.trim();
    if (!workspace || boundWorkspaceRef.current === `${taskNoteId || ""}\n${workspace}`) return;
    boundWorkspaceRef.current = `${taskNoteId || ""}\n${workspace}`;
    if (taskNoteId) chat.setWorkspaceGtdTask(taskNoteId, workspace);
    else chat.setWorkspaceFinderDir(workspace);
  }, [chat, projectPath, taskNoteId]);

  // Attach to the requested conversation, else start a fresh one.
  useEffect(() => {
    const target = sessionId?.trim();
    if (target) {
      if (target !== chat.activeSessionId) void chat.selectSession(target);
      return;
    }
    if (!chat.activeSessionId) chat.createNewSession();
    // Deliberately keyed on the requested id only: a user-created session inside
    // this pane must not re-trigger the reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Surface the minted/selected session id + title so the tab and task link update.
  useEffect(() => {
    if (!chat.activeSessionId) return;
    onSessionReady?.(chat.activeSessionId);
    const conversation = chat.conversations.find((item) => item.id === chat.activeSessionId);
    if (conversation?.title) onTitleChange?.(conversation.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.activeSessionId, chat.conversations]);

  const handleSend = useCallback(
    (
      prompt: string,
      options?: { workspaceDir?: string; model?: string; thinking_level?: string }
    ) => {
      void chat.sendMessage(prompt, { ...options, workspaceDir: options?.workspaceDir || projectPath });
    },
    [chat, projectPath]
  );

  // Send the initial prompt once the daemon has reported models and the pane's
  // workspace binding has committed, so the run neither falls back to the mock
  // model nor misses the task context / GTD link.
  useEffect(() => {
    const prompt = initialPromptRef.current;
    if (!prompt || initialPromptSentRef.current) return;
    if (chat.models.length === 0 && !chat.daemonStatus) return;
    const workspaceReady = taskNoteId
      ? chat.workspaceSource === "gtd" && chat.taskNoteId === taskNoteId
      : chat.workspaceDir === projectPath;
    if (!workspaceReady) return;
    initialPromptSentRef.current = true;
    void chat.sendMessage(prompt, { workspaceDir: projectPath }).then(() => {
      initialPromptRef.current = "";
      onInitialPromptSubmitted?.();
    });
  }, [chat, projectPath, taskNoteId, onInitialPromptSubmitted]);

  const activeConversation = chat.conversations.find((item) => item.id === chat.activeSessionId);

  return (
    <div className="wb-thunder-chat" hidden={!active}>
    <ChatMain
      active={active}
      sessionId={chat.activeSessionId}
      sessionTitle={activeConversation?.title || title}
      messages={chat.messages}
      isStreaming={chat.isStreaming}
      streamingText={chat.streamingText}
      streamingReasoning={chat.streamingReasoning}
      streamingTools={chat.streamingTools}
      models={chat.models}
      selectedModel={chat.selectedModel}
      onSelectModel={chat.setSelectedModel}
      thinkingLevel={chat.thinkingLevel}
      onSelectThinkingLevel={chat.setThinkingLevel}
      workspaceDir={chat.workspaceDir || projectPath}
      onSelectWorkspaceDir={chat.setWorkspaceDir}
      workspaceSource={chat.workspaceSource}
      taskNoteId={chat.taskNoteId}
      onSelectGtdTask={chat.setWorkspaceGtdTask}
      onSelectFinderDir={chat.setWorkspaceFinderDir}
      isWorkspaceLocked={chat.isWorkspaceLocked}
      onSendMessage={handleSend}
      onCancelTask={chat.cancelCurrentTask}
      onNewSession={chat.createNewSession}
      onRegenerate={chat.regenerateResponse}
      onResend={chat.resendUserMessage}
      onEditPrompt={chat.prefillComposer}
      prefillPrompt={chat.composerPrefill}
      daemonOnline={Boolean(chat.daemonStatus?.available)}
      currentTrace={chat.currentTrace}
      traceSpans={chat.traceSpans}
      fileChanges={chat.fileChanges}
      telemetryNotices={chat.telemetryNotices}
      isCollectingTrace={chat.isCollectingTrace}
      lastRunMetrics={chat.lastRunMetrics}
      streamingMetrics={chat.streamingMetrics}
      sessionTotalTokens={chat.sessionTotalTokens}
      currentContextTokens={chat.currentContextTokens}
      contextWindowLimit={chat.contextWindowLimit}
      pendingQuestion={chat.pendingQuestion}
      onAnswerQuestion={chat.answerQuestion}
      onDismissQuestion={chat.dismissQuestion}
    />
    </div>
  );
}
