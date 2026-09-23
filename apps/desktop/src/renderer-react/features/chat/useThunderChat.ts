import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi } from "../../bridge";
import type {
  ThunderChatMessage,
  ThunderConversation,
  ThunderConversationSummary,
  ThunderModelInfo,
  ThunderChatStreamPayload
} from "@agent-resume/core";

export interface ActiveToolInfo {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  isRunning?: boolean;
  isError?: boolean;
}

function normalizeConversationMessages(rawMessages: ThunderChatMessage[]): ThunderChatMessage[] {
  const result: ThunderChatMessage[] = [];
  const toolResultsByCallId = new Map<string, string>();

  // Collect tool outputs first
  for (const msg of rawMessages) {
    if (msg.role === "tool" && msg.tool_call_id && msg.content) {
      toolResultsByCallId.set(msg.tool_call_id, msg.content);
    }
  }

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];
    if (msg.role === "tool") {
      // Standalone tool messages are absorbed into the assistant turn's tool_executions
      continue;
    }

    if (msg.role === "user") {
      result.push(msg);
      continue;
    }

    if (msg.role === "assistant") {
      const executions: ActiveToolInfo[] = [];
      if (Array.isArray(msg.tool_executions)) {
        executions.push(...msg.tool_executions);
      } else if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let argsObj: Record<string, unknown> = {};
          try {
            argsObj = JSON.parse(tc.function.arguments);
          } catch {
            argsObj = { raw: tc.function.arguments };
          }
          executions.push({
            toolCallId: tc.id,
            name: tc.function.name,
            arguments: argsObj,
            result: toolResultsByCallId.get(tc.id),
            isRunning: false
          });
        }
      }

      const prevMsg = result[result.length - 1];
      if (prevMsg && prevMsg.role === "assistant" && (!prevMsg.content || !msg.content)) {
        if (executions.length > 0) {
          prevMsg.tool_executions = [...(prevMsg.tool_executions || []), ...executions];
        }
        if (msg.content) {
          prevMsg.content = msg.content;
        }
        if (msg.reasoning && !prevMsg.reasoning) {
          prevMsg.reasoning = msg.reasoning;
        }
      } else {
        result.push({
          ...msg,
          tool_executions: executions.length > 0 ? executions : msg.tool_executions
        });
      }
    }
  }

  return result;
}

export function useThunderChat() {
  const [conversations, setConversations] = useState<ThunderConversationSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThunderChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // Streaming buffers for active generation
  const [streamingText, setStreamingText] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingTools, setStreamingTools] = useState<ActiveToolInfo[]>([]);

  // Composer prefill trigger for editing previous prompts
  const [composerPrefill, setComposerPrefill] = useState<{ text: string; id: number } | null>(null);

  // Environment & configuration
  const [models, setModels] = useState<ThunderModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [workspaceDir, setWorkspaceDir] = useState<string>(() => {
    try {
      return (
        localStorage.getItem("chat-selected-workspace") ||
        localStorage.getItem("workbench-selected-project") ||
        ""
      );
    } catch {
      return "";
    }
  });
  const [useMock, setUseMock] = useState(false);
  const [daemonStatus, setDaemonStatus] = useState<{
    available: boolean;
    repoPath: string | null;
    daemonPath: string | null;
    models: ThunderModelInfo[];
    error?: string;
  } | null>(null);

  const activeTaskIdRef = useRef<string | null>(null);
  activeTaskIdRef.current = activeTaskId;

  const streamingTextRef = useRef("");
  streamingTextRef.current = streamingText;

  const streamingReasoningRef = useRef("");
  streamingReasoningRef.current = streamingReasoning;

  const streamingToolsRef = useRef<ActiveToolInfo[]>([]);
  streamingToolsRef.current = streamingTools;

  const refreshDaemonStatus = useCallback(async () => {
    try {
      const status = await desktopApi().thunderGetStatus();
      setDaemonStatus(status);
      if (status.models && status.models.length > 0) {
        setModels(status.models);
        setSelectedModel((prev) => prev || status.models[0].selection_id || status.models[0].id);
      }
    } catch (err) {
      console.warn("Failed to get thunder daemon status:", err);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      setLoading(true);
      const list = await desktopApi().thunderChatListConversations();
      setConversations(list);
    } catch (err) {
      console.error("Failed to load conversations:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectSession = useCallback(async (sessionId: string) => {
    try {
      setLoading(true);
      setActiveSessionId(sessionId);
      const conv = await desktopApi().thunderChatGetConversation({ sessionId });
      if (conv && Array.isArray(conv.messages)) {
        setMessages(normalizeConversationMessages(conv.messages));
      } else {
        setMessages([]);
      }
      setStreamingText("");
      setStreamingReasoning("");
      setStreamingTools([]);
    } catch (err) {
      console.error("Failed to load conversation:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const createNewSession = useCallback(() => {
    setActiveSessionId(null);
    setMessages([]);
    setStreamingText("");
    setStreamingReasoning("");
    setStreamingTools([]);
  }, []);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await desktopApi().thunderChatDeleteConversation({ sessionId });
        if (activeSessionId === sessionId) {
          createNewSession();
        }
        await loadConversations();
      } catch (err) {
        console.error("Failed to delete conversation:", err);
      }
    },
    [activeSessionId, createNewSession, loadConversations]
  );

  const sendMessage = useCallback(
    async (prompt: string, options?: { model?: string; workspaceDir?: string }) => {
      const trimmed = prompt.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: ThunderChatMessage = {
        role: "user",
        content: trimmed
      };

      setMessages((prev) => [...prev, userMsg]);
      setStreamingText("");
      setStreamingReasoning("");
      setStreamingTools([]);
      setIsStreaming(true);

      const taskId = `task_${Date.now()}`;
      setActiveTaskId(taskId);

      const model = options?.model || selectedModel || (models[0]?.selection_id ?? "mock");
      const ws =
        options?.workspaceDir ||
        workspaceDir ||
        (() => {
          try {
            return (
              localStorage.getItem("chat-selected-workspace") ||
              localStorage.getItem("workbench-selected-project") ||
              undefined
            );
          } catch {
            return undefined;
          }
        })();

      if (ws && ws !== workspaceDir) {
        setWorkspaceDir(ws);
      }

      try {
        const result = await desktopApi().thunderChatRunTask({
          taskId,
          prompt: trimmed,
          sessionId: activeSessionId || undefined,
          model,
          workspaceDir: ws,
          useMock
        });

        // Task finalized
        const finalContent = result.finalContent || streamingTextRef.current;
        const finalReasoning = streamingReasoningRef.current;
        const finalTools =
          streamingToolsRef.current.length > 0 ? [...streamingToolsRef.current] : undefined;

        const assistantMsg: ThunderChatMessage = {
          role: "assistant",
          content: finalContent || "(No response output)",
          reasoning: finalReasoning || undefined,
          tool_executions: finalTools
        };

        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingText("");
        setStreamingReasoning("");
        setStreamingTools([]);

        // Reload conversation list and session if newly created
        await loadConversations();
      } catch (err) {
        console.error("Thunder task execution failed:", err);
        const errMsg: ThunderChatMessage = {
          role: "assistant",
          content: `⚠️ **Task failed**: ${err instanceof Error ? err.message : String(err)}`,
          reasoning: streamingReasoningRef.current || undefined,
          tool_executions:
            streamingToolsRef.current.length > 0 ? [...streamingToolsRef.current] : undefined
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setIsStreaming(false);
        setActiveTaskId(null);
      }
    },
    [activeSessionId, isStreaming, loadConversations, models, selectedModel, useMock, workspaceDir]
  );

  const prefillComposer = useCallback((text: string) => {
    setComposerPrefill({ text, id: Date.now() });
  }, []);

  const resendUserMessage = useCallback(
    async (userIndex: number, options?: { model?: string; workspaceDir?: string }) => {
      if (isStreaming || userIndex < 0 || userIndex >= messages.length) return;
      const targetMsg = messages[userIndex];
      if (targetMsg.role !== "user" || !targetMsg.content) return;

      const prompt = targetMsg.content;

      // Truncate in-memory messages to before this user message
      setMessages((prev) => prev.slice(0, userIndex));

      // Truncate disk conversation if active session exists
      if (activeSessionId) {
        try {
          await desktopApi().thunderChatTruncateConversation({
            sessionId: activeSessionId,
            keepCount: userIndex
          });
        } catch (err) {
          console.warn("Failed to truncate disk conversation on resend:", err);
        }
      }

      // Re-send the prompt
      await sendMessage(prompt, options);
    },
    [activeSessionId, isStreaming, messages, sendMessage]
  );

  const regenerateResponse = useCallback(
    async (assistantIndex: number, options?: { model?: string; workspaceDir?: string }) => {
      if (isStreaming || assistantIndex < 0 || assistantIndex >= messages.length) return;

      // Find preceding user prompt
      let userIndex = -1;
      for (let i = assistantIndex - 1; i >= 0; i--) {
        if (messages[i].role === "user" && messages[i].content) {
          userIndex = i;
          break;
        }
      }

      if (userIndex === -1) return;

      const prompt = messages[userIndex].content!;

      // Truncate in-memory messages to before this user turn
      setMessages((prev) => prev.slice(0, userIndex));

      // Truncate disk conversation
      if (activeSessionId) {
        try {
          await desktopApi().thunderChatTruncateConversation({
            sessionId: activeSessionId,
            keepCount: userIndex
          });
        } catch (err) {
          console.warn("Failed to truncate disk conversation on regenerate:", err);
        }
      }

      // Re-send the prompt
      await sendMessage(prompt, options);
    },
    [activeSessionId, isStreaming, messages, sendMessage]
  );

  const cancelCurrentTask = useCallback(async () => {
    if (!activeTaskIdRef.current) return;
    try {
      await desktopApi().thunderChatCancelTask({ taskId: activeTaskIdRef.current });
    } catch (err) {
      console.error("Failed to cancel thunder task:", err);
    }
  }, []);

  // Subscribe to real-time events from Thunder daemon
  useEffect(() => {
    const unsub = desktopApi().onThunderChatEvent((payload: ThunderChatStreamPayload) => {
      if (activeTaskIdRef.current && payload.taskId !== activeTaskIdRef.current) return;

      const ev = payload.event?.event;
      if (!ev) return;

      switch (ev.type) {
        case "token_delta": {
          const delta = (ev as any).delta || "";
          setStreamingText((prev) => prev + delta);
          break;
        }
        case "reasoning_delta": {
          const delta = (ev as any).delta || "";
          setStreamingReasoning((prev) => prev + delta);
          break;
        }
        case "tool_exec_start": {
          const toolCallId = (ev as any).tool_call_id || `tool_${Date.now()}`;
          const name = (ev as any).name || "tool";
          const args = (ev as any).arguments || {};
          setStreamingTools((prev) => {
            const exists = prev.find((t) => t.toolCallId === toolCallId);
            if (exists) return prev;
            return [...prev, { toolCallId, name, arguments: args, isRunning: true }];
          });
          break;
        }
        case "tool_exec_result": {
          const toolCallId = (ev as any).tool_call_id;
          const result = (ev as any).result;
          setStreamingTools((prev) =>
            prev.map((t) => {
              if (t.toolCallId === toolCallId) {
                return {
                  ...t,
                  isRunning: false,
                  result: result?.output,
                  isError: Boolean(result?.is_error)
                };
              }
              return t;
            })
          );
          break;
        }
        case "error": {
          console.warn("[thunder-event:error]", (ev as any).message);
          break;
        }
      }
    });

    return () => unsub?.();
  }, []);

  // Initial load
  useEffect(() => {
    void refreshDaemonStatus();
    void loadConversations();
  }, [refreshDaemonStatus, loadConversations]);

  return {
    conversations,
    activeSessionId,
    messages,
    loading,
    isStreaming,
    activeTaskId,
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
    loadConversations,
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
  };
}
