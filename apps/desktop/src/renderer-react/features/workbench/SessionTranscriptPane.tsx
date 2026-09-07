import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../bridge";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";
import { ProviderIcon } from "../../components/ProviderIcon";

import { ThemeIcon } from "../../components/ThemeIcon";
import { useI18n } from "../../i18n";
import {
  buildSessionTranscriptModel,
  filterSessionTranscript,
  sameTranscriptPreview,
  type TranscriptMessage,
  type TranscriptPreviewMessage
} from "./sessionTranscriptModel";
import { findTranscriptUserMessage } from "./composerTipMatch";

const TranscriptMessageRow = React.memo(function TranscriptMessageRow({
  message,
  isSelected,
  roleIconProvider,
  roleLabelText,
  stamp,
  thinkingExpanded,
  onToggleThinking,
  thinkingLabel,
  renderMarkdownView,
  isStreaming = false
}: {
  message: TranscriptMessage;
  isSelected: boolean;
  roleIconProvider: string;
  roleLabelText: string;
  stamp: string;
  thinkingExpanded: boolean;
  onToggleThinking: () => void;
  thinkingLabel: string;
  renderMarkdownView: boolean;
  isStreaming?: boolean;
}): React.JSX.Element {
  return (
    <article
      data-transcript-id={message.id}
      className={`preview-msg ${message.role}${isSelected ? " is-selected" : ""}`}
    >
      <div className="role">
        {message.role === "assistant"
          ? <ProviderIcon provider={roleIconProvider} size={13} className="wb-transcript-role-icon" />
          : <ThemeIcon name="user" size={13} className="wb-transcript-role-icon" aria-hidden="true" />}
        {roleLabelText}
        {stamp ? ` · ${stamp}` : ""}
      </div>
      {message.thinking ? (
        <div className="wb-transcript-thinking">
          <button
            type="button"
            className="wb-transcript-thinking-toggle"
            aria-expanded={thinkingExpanded}
            onClick={onToggleThinking}
          >
            <ThemeIcon name="chevron-right" className={thinkingExpanded ? "is-expanded" : ""} size={12} />
            <span>{thinkingLabel}</span>
          </button>
          {thinkingExpanded ? (
            renderMarkdownView ? (
              <StreamdownRenderer
                content={message.thinking}
                className="wb-transcript-thinking-body wb-transcript-md markdown-body"
              />
            ) : (
              <div className="wb-transcript-thinking-body wb-transcript-plain">{message.thinking}</div>
            )
          ) : null}
        </div>
      ) : null}
      {message.text ? (
        renderMarkdownView ? (
          <StreamdownRenderer
            content={message.text}
            isAnimating={isStreaming}
            className="wb-transcript-md markdown-body"
          />
        ) : (
          <div className="wb-transcript-plain">{message.text}</div>
        )
      ) : null}
    </article>
  );
});

type TranscriptPreview = {
  title: string;
  messages: TranscriptPreviewMessage[];
  truncated?: boolean;
  warning?: string;
};

const LIVE_REFRESH_INTERVAL_MS = 500;

export function SessionTranscriptPane({
  provider,
  sessionId,
  iconProvider,
  active,
  isRunning = false,
  fontSize = 14,
  focusUserMessage
}: {
  provider: string;
  sessionId: string;
  iconProvider?: string;
  active: boolean;
  isRunning?: boolean;
  fontSize?: number;
  focusUserMessage?: { text: string; sentAtMs?: number; nonce: number } | null;
}): React.JSX.Element {
  const roleIconProvider = iconProvider || provider;
  const { locale, t } = useI18n();
  const [preview, setPreview] = useState<TranscriptPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [renderMarkdownView, setRenderMarkdownView] = useState(true);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const previewRef = useRef<TranscriptPreview | null>(null);
  const requestRef = useRef(0);
  const currentSessionKeyRef = useRef("");

  const loadPreview = useCallback(async () => {
    if (!provider || !sessionId) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const result = await desktopApi().previewSession({ provider, id: sessionId });
      if (requestRef.current !== requestId) return;
      if (!sameTranscriptPreview(previewRef.current, result.preview)) {
        previewRef.current = result.preview;
        setPreview(result.preview);
      }
      setError("");
    } catch (caught) {
      if (requestRef.current !== requestId) return;
      previewRef.current = null;
      setPreview(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [provider, sessionId]);

  useEffect(() => {
    const sessionKey = `${provider}:${sessionId}`;
    if (!active || !provider || !sessionId) return;
    if (currentSessionKeyRef.current === sessionKey && previewRef.current) {
      return;
    }
    currentSessionKeyRef.current = sessionKey;
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
    setQuery("");
    setSelectedId(null);
    previewRef.current = null;
    setPreview(null);
    setError("");
    setExpandedThinking({});
    void loadPreview();
  }, [active, loadPreview, provider, sessionId]);

  const hasActiveSelection = (): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const root = bodyRef.current;
    const anchor = selection.anchorNode;
    return Boolean(root && anchor && root.contains(anchor));
  };

  const syncLivePreview = useCallback(async () => {
    if (!provider || !sessionId) return;
    if (hasActiveSelection()) return;
    try {
      const result = await desktopApi().previewSession({ provider, id: sessionId });
      if (!sameTranscriptPreview(previewRef.current, result.preview)) {
        previewRef.current = result.preview;
        setPreview(result.preview);
      }
    } catch {
      // Silent poll failures are ignored to avoid disrupting the UI
    }
  }, [provider, sessionId]);

  useEffect(() => {
    if (!active || !provider || !sessionId || !isRunning) return;
    const timer = window.setInterval(() => {
      void syncLivePreview();
    }, LIVE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, isRunning, provider, sessionId, syncLivePreview]);

  const model = useMemo(
    () => buildSessionTranscriptModel(preview?.messages || []),
    [preview?.messages]
  );
  const visible = useMemo(() => filterSessionTranscript(model, query), [model, query]);

  const scrollToBottom = useCallback((smooth = false) => {
    userScrolledUpRef.current = false;
    setShowScrollBottom(false);
    if (bodyRef.current) {
      bodyRef.current.scrollTo({
        top: bodyRef.current.scrollHeight,
        behavior: smooth ? "smooth" : "instant"
      });
    }
  }, []);

  const handleScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
    userScrolledUpRef.current = !isNearBottom;
    setShowScrollBottom(!isNearBottom);
  }, []);

  useEffect(() => {
    if (!userScrolledUpRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [preview?.messages]);

  const scrollToMessage = (messageId: string) => {
    setSelectedId(messageId);
    userScrolledUpRef.current = true;
    setShowScrollBottom(true);
    const node = bodyRef.current?.querySelector<HTMLElement>(`[data-transcript-id="${messageId}"]`);
    node?.scrollIntoView({ block: "start" });
  };

  useEffect(() => {
    if (!focusUserMessage?.text || !model.messages.length) return;
    const hit = findTranscriptUserMessage(
      model.messages.filter((message) => message.role === "user"),
      focusUserMessage.text,
      focusUserMessage.sentAtMs
    );
    if (!hit) return;
    const frame = window.requestAnimationFrame(() => scrollToMessage(hit.id));
    return () => window.cancelAnimationFrame(frame);
  }, [focusUserMessage, model.messages]);

  const formatTimestamp = (value?: string): string => {
    if (!value) return "";
    const numeric = Number(value);
    const date = Number.isFinite(numeric) && String(numeric) === value
      ? new Date(numeric)
      : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleString(locale);
    } catch {
      return date.toLocaleString();
    }
  };

  const roleLabel = (message: TranscriptMessage): string => (
    message.role === "user"
      ? t("desktop.workbench.transcriptRoleUser")
      : t("desktop.workbench.transcriptRoleAssistant")
  );

  if (!provider || !sessionId) {
    return (
      <div className="wb-side-pane wb-transcript-pane">
        <div className="wb-side-pane-head">
          <span className="wb-side-pane-title">{t("desktop.workbench.sidePanelTranscript")}</span>
        </div>
        <p className="muted wb-transcript-status">{t("desktop.workbench.transcriptNeedSession")}</p>
      </div>
    );
  }

  return (
    <div className="wb-side-pane wb-transcript-pane">
      <div className="wb-side-pane-head">
        <span className="wb-side-pane-title">{t("desktop.workbench.sidePanelTranscript")}</span>
        <button
          type="button"
          className="wb-git-action-btn"
          disabled={loading || !active}
          onClick={() => void loadPreview()}
          aria-label={t("desktop.common.refresh")}
          title={t("desktop.common.refresh")}
        >
          <ThemeIcon name="refresh" size={14} className={loading ? "spin" : undefined} />
        </button>
        <button
          type="button"
          className={`wb-git-action-btn${renderMarkdownView ? " is-active" : ""}`}
          aria-pressed={renderMarkdownView}
          aria-label={renderMarkdownView ? t("desktop.workbench.transcriptShowOriginal") : t("desktop.workbench.transcriptShowMarkdown")}
          title={renderMarkdownView ? t("desktop.workbench.transcriptShowOriginal") : t("desktop.workbench.transcriptShowMarkdown")}
          onClick={() => setRenderMarkdownView((current) => !current)}
        >
          <ThemeIcon name={renderMarkdownView ? "file-text" : "eye"} size={14} />
        </button>
      </div>

      <div className="wb-transcript-toolbar">
        <input
          type="search"
          className="wb-search-input"
          value={query}
          placeholder={t("desktop.workbench.transcriptSearchPlaceholder")}
          aria-label={t("desktop.workbench.transcriptSearchPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {loading && !preview ? (
        <p className="muted wb-transcript-status" role="status">{t("desktop.common.loadingPreview")}</p>
      ) : null}
      {error ? <p className="status error">{error}</p> : null}
      {preview?.warning ? <p className="status warning">{preview.warning}</p> : null}
      {preview?.truncated ? <p className="muted wb-transcript-status">{t("desktop.sessions.truncated")}</p> : null}

      {!loading && preview && !model.messages.length ? (
        <p className="muted wb-transcript-status">{t("desktop.sessions.noMessages")}</p>
      ) : null}

      {model.messages.length ? (
        <div className="wb-transcript-content-wrap">
          <div
            className={`wb-transcript-body${outlineOpen ? " has-outline-open" : ""}`}
            ref={bodyRef}
            onScroll={handleScroll}
            style={{ ["--wb-transcript-font-size" as string]: `${fontSize}px` }}
          >
            {visible.messages.length ? visible.messages.map((message, index) => {
              const isLast = index === visible.messages.length - 1;
              const isStreaming = isRunning && isLast && message.role === "assistant";
              return (
                <TranscriptMessageRow
                  key={message.id}
                  message={message}
                  isSelected={selectedId === message.id}
                  roleIconProvider={roleIconProvider}
                  roleLabelText={roleLabel(message)}
                  stamp={formatTimestamp(message.timestamp)}
                  thinkingExpanded={expandedThinking[message.id] === true}
                  onToggleThinking={() => setExpandedThinking((current) => ({
                    ...current,
                    [message.id]: !current[message.id]
                  }))}
                  thinkingLabel={t("desktop.workbench.transcriptThinking")}
                  renderMarkdownView={renderMarkdownView}
                  isStreaming={isStreaming}
                />
              );
            }) : (
              <p className="muted wb-transcript-status">{t("desktop.workbench.transcriptNoMatches")}</p>
            )}
          </div>

          <aside className={`wb-transcript-outline${outlineOpen ? " is-open" : " is-collapsed"}`}>
            <button
              type="button"
              className="wb-transcript-outline-toggle"
              aria-expanded={outlineOpen}
              onClick={() => setOutlineOpen((current) => !current)}
            >
              <ThemeIcon name="chevron-right" className={outlineOpen ? "is-expanded" : ""} size={12} />
              <span>{t("desktop.workbench.transcriptOutline")} · {visible.outline.length}</span>
            </button>
            {outlineOpen ? (
              visible.outline.length ? (
                <ol className="wb-transcript-outline-list">
                  {visible.outline.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`wb-transcript-outline-item${selectedId === item.messageId ? " is-selected" : ""}`}
                        onClick={() => scrollToMessage(item.messageId)}
                      >
                        <span className="wb-transcript-outline-index">#{item.index}</span>
                        <span className="wb-transcript-outline-title">{item.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted wb-transcript-status">{t("desktop.workbench.transcriptNoMatches")}</p>
              )
            ) : null}
          </aside>

          {showScrollBottom ? (
            <button
              type="button"
              className="wb-transcript-scroll-bottom-btn"
              onClick={() => scrollToBottom(true)}
              aria-label={t("desktop.workbench.transcriptScrollToBottom", "Scroll to bottom")}
              title={t("desktop.workbench.transcriptScrollToBottom", "Scroll to bottom")}
            >
              <ThemeIcon name="chevron-down" size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
