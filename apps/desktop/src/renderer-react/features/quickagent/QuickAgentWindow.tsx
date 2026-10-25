import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { ChatMain } from "../chat/ChatMain";
import { useThunderChat } from "../chat/useThunderChat";

const SESSION_STORAGE_KEY = "quick-agent-session-id";

/**
 * Prepended to the first message of every Quick Agent conversation. The daemon's
 * run protocol has no system-prompt channel, so this rides the same
 * prompt-prefix mechanism as the GTD task context.
 */
const QUICK_AGENT_ROLE = [
  "You are the Quick Agent — a fast lookup assistant in a floating window.",
  "Answer in 1-3 sentences or a short list, using the fewest tool calls (git, grep/rg, file reads).",
  "Cite file paths with line numbers (path:line).",
  "When a request needs edits, long runs, or many files, say so and suggest moving it to a workbench.",
  "你是悬浮窗里的快捷查询助手：优先用 git / rg 等工具，答案保持简短（1-3 句或短列表），引用文件带行号（path:line）；需要改代码或跑长任务时，明确建议转到工作台。"
].join(" ");

/** Heuristic tier for the model the Quick Agent picks by default. */
const FAST_MODEL_PATTERN = /flash|haiku|mini|turbo|instant/i;

type SlashCommand =
  | { kind: "gitStatus" }
  | { kind: "gitLog"; limit: number }
  | { kind: "find"; query: string }
  | { kind: "help" };

type SlashResultLine = {
  text: string;
  /** Absolute or workspace-relative path; present when the line opens a file. */
  path?: string;
};

type SlashResult = {
  title: string;
  lines: SlashResultLine[];
  error?: boolean;
};

function parseSlashCommand(raw: string): SlashCommand | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/")) return null;
  const [head, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (head.toLowerCase()) {
    case "git":
      if (rest[0]?.toLowerCase() === "status" && rest.length === 1) return { kind: "gitStatus" };
      if (rest[0]?.toLowerCase() === "log") {
        const n = Number.parseInt(rest[1] ?? "", 10);
        return { kind: "gitLog", limit: Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 10 };
      }
      return null;
    case "find":
    case "search":
      return arg ? { kind: "find", query: arg } : null;
    case "help":
      return { kind: "help" };
    default:
      return null;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT")
  );
}

function readStoredSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The floating Quick Agent: one Thunder conversation in a global toggle window.
 *
 * It reuses the board chat's hook and `ChatMain` — the daemon broadcasts events
 * per session id, so this window is just one more surface on the shared
 * conversation store. The conversation itself lives in the daemon and survives
 * the window hiding or the app quitting; only its id is persisted here so the
 * window reopens on the conversation the user left.
 *
 * Beyond the shared chat it carries four quick-lookup affordances: a role
 * preamble on the conversation's first run, a fast model default for fresh
 * conversations, slash commands that answer from local tools without an LLM
 * round trip, and a handoff that moves this conversation into a workbench
 * window.
 */
export function QuickAgentWindow(): JSX.Element {
  const chat = useThunderChat();
  const { t } = useI18n();
  const [pinned, setPinned] = useState(false);
  const [slashResult, setSlashResult] = useState<SlashResult | null>(null);
  const restoreAttemptedRef = useRef(false);
  const fastModelAppliedRef = useRef(false);

  // Reopen the conversation this window last showed, once the daemon's list
  // lands. A stored id that no longer exists (or no list yet) changes nothing:
  // the hook has already booted in the fresh-conversation state.
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    const stored = readStoredSessionId();
    if (!stored) return;
    if (!chat.conversations.some((item) => item.id === stored)) return;
    restoreAttemptedRef.current = true;
    void chat.selectSession(stored);
  }, [chat.conversations, chat.selectSession]);

  // Remember whichever session this window settles on — restored above, or
  // minted by the first send — so the next open continues it.
  useEffect(() => {
    if (!chat.activeSessionId) return;
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, chat.activeSessionId);
    } catch {
      // ignore
    }
  }, [chat.activeSessionId]);

  // Fresh conversations default to a fast tier; an explicit choice (or the
  // restored conversation's own model) wins from then on.
  useEffect(() => {
    if (fastModelAppliedRef.current || chat.activeSessionId || !chat.models.length) return;
    fastModelAppliedRef.current = true;
    const fast = chat.models.find((model) =>
      FAST_MODEL_PATTERN.test(`${model.selection_id} ${model.id} ${model.name}`)
    );
    const fastId = fast?.selection_id || fast?.id;
    if (fastId && fastId !== chat.selectedModel) chat.setSelectedModel(fastId);
  }, [chat.activeSessionId, chat.models, chat.selectedModel, chat.setSelectedModel]);

  useEffect(() => {
    void desktopApi()
      .quickAgentGetState()
      .then((state) => setPinned(state.pinned))
      .catch(() => undefined);
  }, []);

  const togglePinned = useCallback(() => {
    void desktopApi()
      .quickAgentSetPinned({ pinned: !pinned })
      .then((state) => setPinned(state.pinned))
      .catch(() => undefined);
  }, [pinned]);

  const hideWindow = useCallback(() => {
    void desktopApi().quickAgentHide().catch(() => undefined);
  }, []);

  // Escape hides the window, unless the focused element owns Escape itself —
  // the composer, the find field, or a dialog input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isEditableTarget(event.target)) return;
      if (slashResult) {
        setSlashResult(null);
        return;
      }
      hideWindow();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hideWindow, slashResult]);

  const workspace = chat.workspaceDir.trim();

  const openResultPath = useCallback(
    (path: string) => {
      const rootPath = workspace || undefined;
      if (!rootPath) return;
      void desktopApi()
        .workbenchOpenPath({ rootPath, filePath: path })
        .catch(() => undefined);
    },
    [workspace]
  );

  const runSlashCommand = useCallback(
    async (command: SlashCommand) => {
      const api = desktopApi();
      if (command.kind === "help") {
        setSlashResult({
          title: t("desktop.quickAgent.slashHelpTitle"),
          lines: [
            { text: "/git status — " + t("desktop.quickAgent.slashGitStatus") },
            { text: "/git log [n] — " + t("desktop.quickAgent.slashGitLog") },
            { text: "/find <query> — " + t("desktop.quickAgent.slashFind") }
          ]
        });
        return;
      }
      if (!workspace) {
        setSlashResult({ title: t("desktop.quickAgent.slashTitle"), error: true, lines: [{ text: t("desktop.quickAgent.slashNoWorkspace") }] });
        return;
      }
      try {
        if (command.kind === "gitStatus") {
          const status = await api.terminalGitStatus({ cwd: workspace });
          if (!status.isRepo) {
            setSlashResult({ title: t("desktop.quickAgent.slashTitle"), error: true, lines: [{ text: t("desktop.quickAgent.slashNotARepo") }] });
            return;
          }
          const dirty = [...status.staged, ...status.unstaged];
          const branch = status.tracking?.find((item) => item.branch)?.branch ?? "";
          setSlashResult({
            title: branch ? `git · ${branch}` : t("desktop.quickAgent.slashTitle"),
            lines: dirty.length
              ? dirty.slice(0, 50).map((change) => ({
                  text: `${change.status}  ${change.path}`,
                  path: change.repoPath
                }))
              : [{ text: t("desktop.quickAgent.slashCleanTree") }]
          });
          return;
        }
        if (command.kind === "gitLog") {
          const log = await api.terminalGitLog({ repoRoot: workspace, limit: command.limit });
          setSlashResult({
            title: t("desktop.quickAgent.slashTitle"),
            lines: log.commits.length
              ? log.commits.map((commit) => ({
                  text: `${commit.shortHash}  ${commit.subject}${commit.author ? `  ·  ${commit.author}` : ""}`
                }))
              : [{ text: t("desktop.quickAgent.slashNoResults") }]
          });
          return;
        }
        const found = await api.workbenchSearchPaths({ rootPaths: [workspace], query: command.query });
        setSlashResult({
          title: t("desktop.quickAgent.slashTitle"),
          lines: found.files.length
            ? found.files.slice(0, 50).map((file) => ({ text: file.relativePath || file.path, path: file.path }))
            : [{ text: t("desktop.quickAgent.slashNoResults") }]
        });
      } catch (error) {
        setSlashResult({
          title: t("desktop.quickAgent.slashTitle"),
          error: true,
          lines: [{ text: String((error as Error)?.message ?? error) }]
        });
      }
    },
    [t, workspace]
  );

  const handleSend = useCallback(
    (
      prompt: string,
      options?: { workspaceDir?: string; model?: string; thinking_level?: string; extraWorkspaceDirs?: string[] }
    ) => {
      const command = parseSlashCommand(prompt);
      if (command) {
        void runSlashCommand(command);
        return;
      }
      // The role preamble rides only the run that mints the conversation.
      const roleContext = chat.activeSessionId ? undefined : QUICK_AGENT_ROLE;
      void chat.sendMessage(prompt, { ...options, roleContext });
    },
    [chat, runSlashCommand]
  );

  const handoff = useCallback(() => {
    const sessionId = chat.activeSessionId;
    if (!sessionId) return;
    void desktopApi()
      .quickAgentHandoff({ sessionId, projectPath: workspace })
      .catch(() => undefined);
  }, [chat.activeSessionId, workspace]);

  const activeConversation = chat.conversations.find((item) => item.id === chat.activeSessionId);

  const headerExtra: ReactNode = (
    <>
      {chat.activeSessionId ? (
        <button
          type="button"
          className="tb-header-action-btn qa-header-btn"
          onClick={handoff}
          title={t("desktop.quickAgent.handoff")}
          aria-label={t("desktop.quickAgent.handoff")}
        >
          <ThemeIcon name="app-window" size={ICON_SIZE.dense} />
        </button>
      ) : null}
      <button
        type="button"
        className={`tb-header-action-btn qa-header-btn${pinned ? " is-active" : ""}`}
        onClick={togglePinned}
        title={pinned ? t("desktop.quickAgent.unpin") : t("desktop.quickAgent.pin")}
        aria-label={pinned ? t("desktop.quickAgent.unpin") : t("desktop.quickAgent.pin")}
        aria-pressed={pinned}
      >
        <ThemeIcon name="pin" size={ICON_SIZE.dense} />
      </button>
      <button
        type="button"
        className="tb-header-action-btn qa-header-btn"
        onClick={chat.createNewSession}
        title={t("desktop.quickAgent.newSession")}
        aria-label={t("desktop.quickAgent.newSession")}
      >
        <ThemeIcon name="message-square-plus" size={ICON_SIZE.dense} />
      </button>
      <button
        type="button"
        className="tb-header-action-btn qa-header-btn"
        onClick={hideWindow}
        title={t("desktop.quickAgent.hide")}
        aria-label={t("desktop.quickAgent.hide")}
      >
        <ThemeIcon name="close" size={ICON_SIZE.dense} />
      </button>
    </>
  );

  return (
    <div className="qa-window">
      {slashResult ? (
        <div className={`qa-slash-result${slashResult.error ? " is-error" : ""}`} role="status">
          <div className="qa-slash-result-head">
            <span className="qa-slash-result-title">{slashResult.title}</span>
            <button
              type="button"
              className="tb-header-action-btn qa-header-btn"
              onClick={() => setSlashResult(null)}
              aria-label={t("desktop.common.close")}
            >
              <ThemeIcon name="close" size={ICON_SIZE.dense} />
            </button>
          </div>
          <div className="qa-slash-result-lines">
            {slashResult.lines.map((line, index) => (
              <button
                key={`${index}-${line.text}`}
                type="button"
                className={`qa-slash-line${line.path ? " is-file" : ""}`}
                disabled={!line.path}
                onClick={() => line.path && openResultPath(line.path)}
              >
                {line.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <ChatMain
        active
        sessionId={chat.activeSessionId}
        sessionTitle={activeConversation?.title || t("desktop.quickAgent.title")}
        headerExtra={headerExtra}
        notice={chat.titleNotice}
        onDismissNotice={chat.dismissTitleNotice}
        showWorkspacePicker={false}
        messages={chat.messages}
        isStreaming={chat.isStreaming}
        liveSegments={chat.liveSegments}
        liveTurns={chat.liveTurns}
        models={chat.models}
        selectedModel={chat.selectedModel}
        onSelectModel={chat.setSelectedModel}
        thinkingLevel={chat.thinkingLevel}
        onSelectThinkingLevel={chat.setThinkingLevel}
        permissionMode={chat.permissionMode}
        onSelectPermissionMode={chat.setPermissionMode}
        workspaceDir={chat.workspaceDir}
        onSelectWorkspaceDir={chat.setWorkspaceDir}
        workspaceSource={chat.workspaceSource}
        taskNoteId={chat.taskNoteId}
        onSelectGtdTask={chat.setWorkspaceGtdTask}
        onSelectFinderDir={chat.setWorkspaceFinderDir}
        isWorkspaceLocked={chat.isWorkspaceLocked}
        onSendMessage={handleSend}
        onCancelTask={chat.cancelCurrentTask}
        pausedTask={chat.pausedTask}
        onPauseTask={chat.pauseCurrentTask}
        onResumeTask={chat.resumeCurrentTask}
        queuedCount={chat.queued.steering.length + chat.queued.followUp.length}
        onSteerMessage={(message, attachments) => void chat.steerRunningTask(message, attachments)}
        onFollowUpMessage={(message, attachments) => void chat.followUpRunningTask(message, attachments)}
        onNewSession={chat.createNewSession}
        onRegenerate={chat.regenerateResponse}
        onResend={chat.resendUserMessage}
        onEditPrompt={chat.prefillComposer}
        prefillPrompt={chat.composerPrefill}
        daemonOnline={Boolean(chat.daemonStatus?.available)}
        traceSpans={chat.traceSpans}
        fileChanges={chat.fileChanges}
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
