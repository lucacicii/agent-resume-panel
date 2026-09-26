import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useTextSearchHighlight } from "../../components/useTextSearch";
import { desktopApi } from "../../bridge";
import { ChatMessageItem } from "./ChatMessageItem";
import { ChatComposer } from "./ChatComposer";
import { ChatQuestionBubble } from "./ChatQuestionBubble";
import { ChatEmptyState } from "./ChatEmptyState";
import { TracePopover } from "./TracePopover";
import { FileChangesPopover } from "./FileChangesPopover";
import { GitDiffPopover } from "./GitDiffPopover";
import {
  loadConversationGitFiles,
  type GitNestedScanOptions
} from "./gitDiffUtils";
import type {
  PanelSettings,
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
import { useI18n } from "../../i18n";

interface ChatMainProps {
  /** Whether this chat view is the visible one (several stay mounted, hidden). */
  active?: boolean;
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
  active = true,
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
  const [nestedScan, setNestedScan] = useState<GitNestedScanOptions | undefined>(undefined);
  const [workspaceDirs, setWorkspaceDirs] = useState<string[]>(() => (workspaceDir ? [workspaceDir] : []));

  const { t } = useI18n();
  const translateLabel = t("desktop.chat.translate", "Translate");
  const restoreLabel = t("desktop.chat.restore", "Show original");
  const translatingLabel = t("desktop.chat.translating", "Translating…");

  // Per-message translation (same selectionRunAction pipeline as the transcript pane).
  // Key = `${index}:${contentLength}` so a regenerated message naturally drops its stale translation.
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const translationsRef = useRef(translations);
  useEffect(() => {
    translationsRef.current = translations;
  }, [translations]);

  useEffect(() => {
    setTranslations({});
    setTranslatingIds(new Set());
  }, [sessionId]);

  const messageKey = useCallback(
    (idx: number, content?: string | null) => `${idx}:${content?.length ?? 0}`,
    []
  );

  const toggleTranslate = useCallback(async (idx: number, text: string) => {
    if (!text.trim()) return;
    const key = `${idx}:${text.length}`;
    if (translationsRef.current[key]) {
      setTranslations((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    setTranslatingIds((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    try {
      const result = await desktopApi().selectionRunAction({ actionId: "translate", text });
      setTranslations((current) => ({ ...current, [key]: result.text }));
    } catch (caught) {
      console.error("[ChatMain] translate failed:", caught);
    } finally {
      setTranslatingIds((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, []);

  // Find-in-feed: matches are highlighted via the CSS Custom Highlight API.
  // Hidden by default; Cmd/Ctrl+F opens it, Escape closes it.
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFocusSeq, setSearchFocusSeq] = useState(0);
  const search = useTextSearchHighlight({
    rootRef: feedRef,
    highlightPrefix: "chat-search",
    deps: [messages, isStreaming, streamingText]
  });

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [searchOpen, searchFocusSeq]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f";
      if (isFind) {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
        setSearchFocusSeq((seq) => seq + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

  // Mirror the workbench's nested-repo scan configuration.
  useEffect(() => {
    let cancelled = false;
    const applySettings = (settings: PanelSettings | undefined) => {
      if (cancelled) return;
      setNestedScan({
        maxDepth: settings?.workbench?.gitNestedScanMaxDepth,
        ignoreDirs: settings?.workbench?.gitNestedScanIgnoreDirs
      });
    };
    const load = async () => {
      try {
        applySettings(await desktopApi().getSettings());
      } catch {
        // Git diff is supplementary; keep the main-process defaults on failure.
      }
    };
    void load();
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ settings?: PanelSettings }>).detail;
      if (detail?.settings) applySettings(detail.settings);
      else void load();
    };
    window.addEventListener("agent-resume:settings-saved", onSaved);
    return () => {
      cancelled = true;
      window.removeEventListener("agent-resume:settings-saved", onSaved);
    };
  }, []);

  // Resolve the session's workspace roots: the selected dir plus, for a GTD task,
  // every project it shares. This is the chat's shared workspace, matching the
  // workbench's per-project git status sweep.
  useEffect(() => {
    let cancelled = false;
    const commit = (dirs: string[]) => {
      if (cancelled) return;
      setWorkspaceDirs([...new Set(dirs.map((dir) => dir?.trim()).filter(Boolean))]);
    };
    if (workspaceSource !== "gtd" || !taskNoteId) {
      commit(workspaceDir ? [workspaceDir] : []);
      return () => { cancelled = true; };
    }
    const load = async () => {
      try {
        const res = await desktopApi().notesRead({ noteId: taskNoteId });
        commit([workspaceDir, ...(res?.record?.work?.projects || [])]);
      } catch {
        commit(workspaceDir ? [workspaceDir] : []);
      }
    };
    void load();
    const onMutated = () => void load();
    window.addEventListener("agent-resume:notes-mutated", onMutated);
    return () => {
      cancelled = true;
      window.removeEventListener("agent-resume:notes-mutated", onMutated);
    };
  }, [workspaceDir, workspaceSource, taskNoteId]);

  // Keep the git diff badge in sync with conversation file modifications across
  // every repo in the workspace.
  useEffect(() => {
    let cancelled = false;
    if (!workspaceDirs.length) {
      setConversationDirtyCount(0);
      return;
    }
    const updateCount = async () => {
      try {
        const snapshot = await loadConversationGitFiles({
          workspaceDirs,
          workspaceDir,
          nestedScan,
          fileChanges,
          messages,
          streamingTools
        });
        if (!cancelled) setConversationDirtyCount(snapshot.files.length);
      } catch {
        if (!cancelled) setConversationDirtyCount(0);
      }
    };
    void updateCount();
    return () => {
      cancelled = true;
    };
  }, [workspaceDirs, workspaceDir, nestedScan, fileChanges, messages, streamingTools]);

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
          {/* Find in conversation (opened via Cmd/Ctrl+F) */}
          {searchOpen ? (
          <div className="tb-chat-search">
            <ThemeIcon name="search" size={ICON_SIZE.inline} className="tb-chat-search-icon" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              className="tb-chat-search-input"
              value={search.query}
              placeholder="Search"
              aria-label="Search in conversation"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => search.setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (event.shiftKey) {
                    search.prevMatch();
                  } else {
                    search.nextMatch();
                  }
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  search.reset();
                  setSearchOpen(false);
                }
              }}
            />
            {search.normalizedQuery ? (
              <span className={`tb-chat-search-count${search.totalMatches === 0 ? " is-empty" : ""}`}>
                {search.totalMatches > 0 ? `${search.currentMatchIndex + 1}/${search.totalMatches}` : "0/0"}
              </span>
            ) : null}
            {search.normalizedQuery && search.totalMatches > 0 ? (
              <div className="tb-chat-search-nav">
                <button
                  type="button"
                  className="tb-chat-search-btn"
                  onClick={search.prevMatch}
                  title="Previous match (Shift+Enter)"
                  aria-label="Previous match"
                >
                  <ThemeIcon name="arrow-up" size={ICON_SIZE.inline} />
                </button>
                <button
                  type="button"
                  className="tb-chat-search-btn"
                  onClick={search.nextMatch}
                  title="Next match (Enter)"
                  aria-label="Next match"
                >
                  <ThemeIcon name="arrow-down" size={ICON_SIZE.inline} />
                </button>
              </div>
            ) : null}
          </div>
          ) : null}

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
        workspaceDirs={workspaceDirs}
        nestedScan={nestedScan}
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
                displayText={translations[messageKey(idx, msg.content)]}
                translated={Boolean(translations[messageKey(idx, msg.content)])}
                isTranslating={translatingIds.has(messageKey(idx, msg.content))}
                onTranslate={toggleTranslate}
                translateLabel={translateLabel}
                restoreLabel={restoreLabel}
                translatingLabel={translatingLabel}
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
