import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { useTextSearchHighlight } from "../../components/useTextSearch";
import { desktopApi } from "../../bridge";
import { ChatMessageItem } from "./ChatMessageItem";
import { ChatTimeline } from "./ChatTimeline";
import { buildTimelineItems, scrollTopForAnchor } from "./timelineModel";
import { ChatComposer } from "./ChatComposer";
import { ChatQuestionBubble } from "./ChatQuestionBubble";
import { ChatUiRequestCard } from "./ChatUiRequestCard";
import { ChatEmptyState } from "./ChatEmptyState";
import { AgentStatusChip } from "./AgentStatusChip";
import { TurnDetailOverlay, TurnDots } from "./TurnDots";
import { TracePopover } from "./TracePopover";
import { ChatChangesPopover } from "./ChatChangesPopover";
import { useConversationChanges } from "./useConversationChanges";
import type { GitNestedScanOptions } from "./gitDiffUtils";
import type {
  PanelSettings,
  ThunderModelInfo,
  ThunderQuestionItem,
  ThunderFileChangeRecord,
  ThunderTaskTrace,
  ThunderTelemetryNotice,
  ThunderAgentStatus
} from "@agent-resume/core";
import type { ChatRunMetrics, LiveSegment, LiveTurn, RenderedChatMessage } from "./useThunderChat";
import type { TraceSpan } from "./useTraceCollector";
import { useI18n } from "../../i18n";

interface ChatMainProps {
  /** Whether this chat view is the visible one (several stay mounted, hidden). */
  active?: boolean;
  sessionId?: string | null;
  sessionTitle?: string;
  messages: RenderedChatMessage[];
  isStreaming: boolean;
  /** Pending steering / follow-up count, for the composer badge. */
  queuedCount?: number;
  /** Queue text into the running task (steering / follow-up). */
  onSteerMessage?: (
    message: string,
    attachments?: import("@agent-resume/core").ThunderImageAttachment[]
  ) => void;
  onFollowUpMessage?: (
    message: string,
    attachments?: import("@agent-resume/core").ThunderImageAttachment[]
  ) => void;
  /** The in-flight turn as ordered runs, so the feed stays in true time order. */
  liveSegments: LiveSegment[];
  /** Every turn of the in-flight run, for the dots row. */
  liveTurns?: LiveTurn[];
  models: ThunderModelInfo[];
  selectedModel: string;
  onSelectModel: (model: string) => void;
  thinkingLevel: string;
  onSelectThinkingLevel: (level: string) => void;
  /** Approval mode for this session; `""` until the daemon has been asked. */
  permissionMode?: import("@agent-resume/core").ThunderPermissionMode | "";
  onSelectPermissionMode?: (mode: import("@agent-resume/core").ThunderPermissionMode) => void;
  workspaceDir: string;
  onSelectWorkspaceDir: (dir: string) => void;
  workspaceSource?: "finder" | "gtd";
  taskNoteId?: string | null;
  onSelectGtdTask?: (noteId: string, dir: string) => void;
  onSelectFinderDir?: (dir: string) => void;
  isWorkspaceLocked?: boolean;
  onSendMessage: (
    prompt: string,
    options?: {
      workspaceDir?: string;
      model?: string;
      thinking_level?: string;
      attachments?: import("@agent-resume/core").ThunderImageAttachment[];
    }
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
  /** What thunder says the run is doing; `null` when nothing is running. */
  agentStatus?: ThunderAgentStatus | null;
  /** Question the agent is blocked on, rendered as a bubble. */
  pendingQuestion?: { questionId: string; taskId: string; questions: ThunderQuestionItem[] } | null;
  onAnswerQuestion?: (answers: Record<string, string> | undefined, cancelled?: boolean) => void | Promise<void>;
  onDismissQuestion?: () => void | Promise<void>;
  /**
   * Dialog the daemon is blocking on (`ui_request`) — a plan approval, an
   * `ask`-mode permission prompt, or a plugin's own question.
   */
  pendingUiRequest?: import("@agent-resume/core").ThunderUiRequest | null;
  onAnswerUiRequest?: (answer: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void | Promise<void>;
}

export function ChatMain({
  active = true,
  sessionId,
  sessionTitle,
  messages,
  isStreaming,
  liveSegments,
  liveTurns = [],
  queuedCount,
  onSteerMessage,
  onFollowUpMessage,
  models,
  selectedModel,
  onSelectModel,
  thinkingLevel,
  onSelectThinkingLevel,
  permissionMode,
  onSelectPermissionMode,
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
  agentStatus,
  pendingQuestion,
  onAnswerQuestion,
  onDismissQuestion,
  pendingUiRequest,
  onAnswerUiRequest
}: ChatMainProps) {
  const feedRef = useRef<HTMLDivElement | null>(null);
  /** A strategy while true: follow the newest content (正文 + thinking). */
  const stickToBottom = useRef(true);
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [isChangesOpen, setIsChangesOpen] = useState(false);
  /** Index into `liveTurns` of the turn whose drawer is open; null = closed. */
  const [openTurnIndex, setOpenTurnIndex] = useState<number | null>(null);
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

  // The live turn is one ordered stream; the answer text and the tool list are
  // read back out of it for the parts of the UI that still need them flat.
  const liveContent = useMemo(
    () =>
      liveSegments
        .filter((segment): segment is Extract<LiveSegment, { kind: "text" }> => segment.kind === "text")
        .map((segment) => segment.text)
        .join(""),
    [liveSegments]
  );
  const streamingTools = useMemo(
    () =>
      liveSegments
        .filter((segment): segment is Extract<LiveSegment, { kind: "tools" }> => segment.kind === "tools")
        .flatMap((segment) => segment.tools),
    [liveSegments]
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
    deps: [messages, isStreaming, liveSegments]
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

  // Single source of truth for conversation git changes: drives both the header
  // badge and every tab of the Changes panel, so the two numbers can never disagree.
  const changes = useConversationChanges({
    workspaceDirs,
    workspaceDir,
    nestedScan,
    fileChanges,
    messages,
    streamingTools
  });

  const scrollToBottom = useCallback((force = false) => {
    const node = feedRef.current;
    if (!node) return;
    if (!force && !stickToBottom.current) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  /**
   * Jump the feed to a message the timeline points at.
   *
   * The offset is computed from the row's measured position rather than
   * `scrollIntoView`, which would also scroll the window and every ancestor —
   * wrong inside the Workbench pane, where this chat shares the column with
   * other views. Pinning is re-decided from the target: landing on the newest
   * message keeps following the stream, landing anywhere else stops it so the
   * next commit cannot yank the reader back to the bottom.
   */
  const jumpToMessage = useCallback(
    (index: number) => {
      const node = feedRef.current;
      if (!node) return;
      const row = node.querySelector<HTMLElement>(`[data-timeline-index="${index}"]`);
      if (!row) return;
      const target = scrollTopForAnchor(
        node.getBoundingClientRect().top,
        row.getBoundingClientRect().top,
        node.scrollTop
      );
      stickToBottom.current = node.scrollHeight - node.clientHeight - target < 80;
      const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // jsdom has no `scrollTo`; falling back to the plain assignment keeps the
      // jump observable in tests and identical for the user without smooth scrolling.
      if (typeof node.scrollTo !== "function") {
        node.scrollTop = target;
        return;
      }
      node.scrollTo({ top: target, behavior: reducedMotion ? "auto" : "smooth" });
    },
    []
  );

  /** One rail entry per feed row, plus the turn still streaming. */
  const timelineItems = useMemo(
    () => buildTimelineItems(messages, { content: liveContent, streaming: isStreaming }),
    [messages, liveContent, isStreaming]
  );

  // Switching conversations always starts pinned to the newest content, and
  // drops the turn drawer: its index means nothing against a different run.
  useEffect(() => {
    setOpenTurnIndex(null);
  }, [sessionId]);
  // A new run clears the turns before filling them, so an index left over from
  // the previous run would point at an unrelated turn. Closing on the empty
  // frame means the drawer can never survive into a run it does not belong to.
  useEffect(() => {
    if (liveTurns.length === 0) setOpenTurnIndex((prev) => (prev === null ? prev : null));
  }, [liveTurns]);

  // Switching conversations always starts pinned to the newest content.
  useLayoutEffect(() => {
    stickToBottom.current = true;
    scrollToBottom(true);
  }, [sessionId, scrollToBottom]);

  // The pane is hidden rather than unmounted while another board view shows, so
  // content that arrived in the meantime left the feed unpinned; re-pin on show.
  useLayoutEffect(() => {
    if (!active) return;
    stickToBottom.current = true;
    scrollToBottom(true);
  }, [active, scrollToBottom]);

  const hasMessages = messages.length > 0 || isStreaming;
  const showEmptyState = !hasMessages;
  /** The agent is blocked on ask_user_question — the card docks above the composer. */
  const hasQuestion = Boolean(pendingQuestion && pendingQuestion.questions.length > 0);
  /** A `ui_request` dialog is docked in the same slot; only one ever shows at a
      time, because the daemon raises one blocking dialog per run. */
  const hasDialog = Boolean(pendingUiRequest || hasQuestion);

  // A strategy: follow streaming content unless the user scrolled away (B).
  // The question card also docks/un-docks, so re-pin then too.
  useLayoutEffect(() => {
    scrollToBottom();
  }, [messages.length, liveSegments, hasDialog, scrollToBottom]);

  return (
    <div className={hasDialog ? "tb-chat-main has-question" : "tb-chat-main"}>
      {/* Chat Header */}
      <header className="tb-chat-header">
        <div className="tb-chat-header-title-box">
          <span className="tb-header-icon">
            <ThemeIcon name="sparkles" size={ICON_SIZE.dense} />
          </span>
          <span className="tb-header-title">{sessionTitle || "New Conversation"}</span>
        </div>

        <div className="tb-chat-header-actions">
          <AgentStatusChip status={agentStatus} />

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

          {/* Changes Popover Trigger (single entry for diff + footprint) */}
          <button
            type="button"
            className={`tb-header-action-btn${isChangesOpen ? " is-active" : ""}`}
            onClick={() => setIsChangesOpen(!isChangesOpen)}
            title={t("desktop.chat.changes.tooltip")}
          >
            <ThemeIcon name="git-branch" size={ICON_SIZE.dense} />
            <span>{t("desktop.chat.changes.label")}</span>
            {changes.badgeCount > 0 && (
              <span className="tb-header-badge">{changes.badgeCount}</span>
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

      <ChatChangesPopover
        isOpen={isChangesOpen}
        onClose={() => setIsChangesOpen(false)}
        workspaceDir={workspaceDir}
        changes={changes}
      />

      {/* Feed + the floating timeline rail. The rail is absolutely positioned
          over the feed's own right padding, so it takes no layout width. */}
      <div className="tb-chat-body">

        {/* The run's turns. The feed below renders only the running one, so the
            finished turns are only reachable through these dots. */}
        {liveTurns.length > 0 && (
          <TurnDots
            turns={liveTurns}
            openIndex={openTurnIndex}
            onOpen={setOpenTurnIndex}
            onClose={() => setOpenTurnIndex(null)}
          />
        )}
        <div
          className="tb-chat-feed"
          ref={feedRef}
          onScroll={(event) => {
            const node = event.currentTarget;
            if (node.clientHeight <= 0) return;
            stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          }}
        >
          {showEmptyState ? (
            <ChatEmptyState onSelectPrompt={onSendMessage} daemonOnline={daemonOnline} />
          ) : (
            <div className="tb-messages-container">
              {messages.map((msg, idx) => (
                <ChatMessageItem
                  key={`msg_${idx}`}
                  message={msg}
                  index={idx}
                  anchorIndex={idx}
                  segments={msg.segments}
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
                    content: liveContent
                  }}
                  index={messages.length}
                  anchorIndex={messages.length}
                  isStreaming={true}
                  segments={liveSegments}
                />
              )}

              <div className="tb-scroll-anchor" />
            </div>
          )}
        </div>

        <ChatTimeline feedRef={feedRef} entries={timelineItems} onJump={jumpToMessage} />
      </div>

      {/* Composer row: the last row of the pane's flex column, below the
          scrollable feed. The agent question bubble (task parked until
          answered) docks directly above the input in the same row, so the
          composer can never cover it — and the row now takes its own height,
          so neither can cover the messages. */}
      <ChatComposer
        docked={
          pendingUiRequest && onAnswerUiRequest ? (
            /* Keyed by request: answer text belongs to the dialog that was up,
               and the daemon only ever has one in flight, so a new dialog must
               arrive as a new card rather than inherit the last one's draft. */
            <ChatUiRequestCard
              key={pendingUiRequest.requestId}
              request={pendingUiRequest}
              onAnswer={onAnswerUiRequest}
            />
          ) : hasQuestion && pendingQuestion ? (
            <ChatQuestionBubble
              questionId={pendingQuestion.questionId}
              questions={pendingQuestion.questions}
              onAnswer={(answers) => onAnswerQuestion?.(answers, false)}
              onDismiss={() => onDismissQuestion?.()}
            />
          ) : null
        }
        onSend={onSendMessage}
        onCancel={onCancelTask}
        isStreaming={isStreaming}
        queuedCount={queuedCount}
        onSteer={onSteerMessage}
        onFollowUp={onFollowUpMessage}
        models={models}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        thinkingLevel={thinkingLevel}
        onSelectThinkingLevel={onSelectThinkingLevel}
        permissionMode={permissionMode}
        onSelectPermissionMode={onSelectPermissionMode}
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
      />

      {/* Turn detail drawer: over the pane, so it neither reflows the feed nor
          hides the composer. The running turn keeps streaming into it. */}
      {openTurnIndex !== null && liveTurns[openTurnIndex]
        ? (() => {
            const turn = liveTurns[openTurnIndex];
            const isRunningTurn = turn.status === "running";
            return (
              <TurnDetailOverlay
                turn={turn}
                segments={isRunningTurn ? liveSegments : turn.segments}
                isStreaming={isRunningTurn}
                index={openTurnIndex}
                total={liveTurns.length}
                onPrev={() =>
                  setOpenTurnIndex((prev) => (prev === null ? prev : Math.max(0, prev - 1)))
                }
                onNext={() =>
                  setOpenTurnIndex((prev) =>
                    prev === null ? prev : Math.min(liveTurns.length - 1, prev + 1)
                  )
                }
                onClose={() => setOpenTurnIndex(null)}
              />
            );
          })()
        : null}
    </div>
  );
}
