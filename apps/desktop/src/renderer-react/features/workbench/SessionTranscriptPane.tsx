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
  isStreaming = false,
  isSearchTarget = false,
  onImageClick
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
  isSearchTarget?: boolean;
  onImageClick?: (url: string) => void;
}): React.JSX.Element {
  return (
    <article
      data-transcript-id={message.id}
      className={`preview-msg ${message.role}${isSelected ? " is-selected" : ""}${isSearchTarget ? " is-search-target" : ""}`}
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
                onImageClick={onImageClick}
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
            onImageClick={onImageClick}
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

function findTextRanges(root: HTMLElement, needle: string): Range[] {
  const ranges: Range[] = [];
  if (!needle || !root) return ranges;
  const lowerNeedle = needle.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent || !node.textContent.toLowerCase().includes(lowerNeedle)) {
        return NodeFilter.FILTER_SKIP;
      }
      const parent = node.parentElement;
      if (parent && (parent.closest("button") || parent.closest(".wb-transcript-head-search") || parent.closest(".wb-transcript-outline"))) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    const text = textNode.textContent || "";
    const lowerText = text.toLowerCase();
    let pos = 0;
    while ((pos = lowerText.indexOf(lowerNeedle, pos)) !== -1) {
      try {
        const range = new Range();
        range.setStart(textNode, pos);
        range.setEnd(textNode, pos + needle.length);
        ranges.push(range);
      } catch {
        // Range safety
      }
      pos += needle.length;
    }
  }
  return ranges;
}

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
  const [imagePreview, setImagePreview] = useState("");
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
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const matchedMessageIds = useMemo(() => {
    if (!normalizedQuery) return [];
    const hits: string[] = [];
    for (const msg of model.messages) {
      if (
        msg.text.toLowerCase().includes(normalizedQuery) ||
        (msg.thinking && msg.thinking.toLowerCase().includes(normalizedQuery))
      ) {
        hits.push(msg.id);
      }
    }
    return hits;
  }, [model.messages, normalizedQuery]);

  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const rangesRef = useRef<Range[]>([]);

  const applyHighlightRanges = useCallback((ranges: Range[], activeIdx: number) => {
    const cssObj = (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
    const highlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (!cssObj?.highlights || typeof highlightCtor !== "function") return;
    try {
      if (ranges.length === 0) {
        cssObj.highlights.delete("transcript-search");
        cssObj.highlights.delete("transcript-search-active");
        return;
      }
      const allHighlight = new highlightCtor(...ranges);
      cssObj.highlights.set("transcript-search", allHighlight);

      const targetRange = ranges[activeIdx];
      if (targetRange) {
        cssObj.highlights.set("transcript-search-active", new highlightCtor(targetRange));
        const el = targetRange.startContainer.parentElement;
        if (el && typeof el.scrollIntoView === "function") {
          userScrolledUpRef.current = true;
          setShowScrollBottom(true);
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      } else {
        cssObj.highlights.delete("transcript-search-active");
      }
    } catch {
      // Highlight API safety
    }
  }, []);

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

  const scrollToMessage = useCallback((messageId: string) => {
    setSelectedId(messageId);
    userScrolledUpRef.current = true;
    setShowScrollBottom(true);
    const node = bodyRef.current?.querySelector<HTMLElement>(`[data-transcript-id="${messageId}"]`);
    if (typeof node?.scrollIntoView === "function") {
      node.scrollIntoView({ block: "start" });
    }
  }, []);

  useEffect(() => {
    const root = bodyRef.current;
    if (!normalizedQuery || !root) {
      rangesRef.current = [];
      setTotalMatches(0);
      setCurrentMatchIndex(0);
      const cssObj = (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
      if (cssObj?.highlights) {
        cssObj.highlights.delete("transcript-search");
        cssObj.highlights.delete("transcript-search-active");
      }
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (!bodyRef.current) return;
      const ranges = findTextRanges(bodyRef.current, normalizedQuery);
      rangesRef.current = ranges;
      setTotalMatches(ranges.length);
      const initialIdx = 0;
      setCurrentMatchIndex(initialIdx);
      applyHighlightRanges(ranges, initialIdx);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      const cssObj = (window as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS;
      if (cssObj?.highlights) {
        cssObj.highlights.delete("transcript-search");
        cssObj.highlights.delete("transcript-search-active");
      }
    };
  }, [normalizedQuery, preview?.messages, renderMarkdownView, applyHighlightRanges]);

  const nextMatch = useCallback(() => {
    const count = rangesRef.current.length;
    if (count === 0) return;
    const nextIdx = (currentMatchIndex + 1) % count;
    setCurrentMatchIndex(nextIdx);
    applyHighlightRanges(rangesRef.current, nextIdx);
  }, [currentMatchIndex, applyHighlightRanges]);

  const prevMatch = useCallback(() => {
    const count = rangesRef.current.length;
    if (count === 0) return;
    const prevIdx = (currentMatchIndex - 1 + count) % count;
    setCurrentMatchIndex(prevIdx);
    applyHighlightRanges(rangesRef.current, prevIdx);
  }, [currentMatchIndex, applyHighlightRanges]);

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        prevMatch();
      } else {
        nextMatch();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      searchInputRef.current?.blur();
    }
  };

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isFind = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f";
      if (isFind) {
        event.preventDefault();
        event.stopPropagation();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);

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
        <div className="wb-transcript-head-search">
          <ThemeIcon name="search" size={12} className="wb-transcript-head-search-icon" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            className="wb-transcript-head-search-input"
            value={query}
            placeholder={t("desktop.workbench.transcriptSearchPlaceholder")}
            aria-label={t("desktop.workbench.transcriptSearchPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />
          {normalizedQuery ? (
            <span className={`wb-transcript-head-search-count${(totalMatches || matchedMessageIds.length) === 0 ? " is-empty" : ""}`}>
              {(totalMatches || matchedMessageIds.length) > 0 ? `${currentMatchIndex + 1}/${totalMatches || matchedMessageIds.length}` : "0/0"}
            </span>
          ) : null}
          {normalizedQuery && (totalMatches || matchedMessageIds.length) > 0 ? (
            <div className="wb-transcript-head-search-nav">
              <button
                type="button"
                className="wb-transcript-head-search-btn"
                onClick={prevMatch}
                title={t("desktop.common.findPrev", "Previous match (Shift+Enter)")}
                aria-label={t("desktop.common.findPrev", "Previous match")}
              >
                <ThemeIcon name="arrow-up" size={11} />
              </button>
              <button
                type="button"
                className="wb-transcript-head-search-btn"
                onClick={nextMatch}
                title={t("desktop.common.findNext", "Next match (Enter)")}
                aria-label={t("desktop.common.findNext", "Next match")}
              >
                <ThemeIcon name="arrow-down" size={11} />
              </button>
            </div>
          ) : null}
        </div>
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
            {model.messages.length ? model.messages.map((message, index) => {
              const isLast = index === model.messages.length - 1;
              const isStreaming = isRunning && isLast && message.role === "assistant";
              const isSearchTarget = Boolean(
                normalizedQuery &&
                matchedMessageIds.length > 0 &&
                matchedMessageIds[currentMatchIndex] === message.id
              );
              return (
                <TranscriptMessageRow
                  key={message.id}
                  message={message}
                  isSelected={selectedId === message.id}
                  isSearchTarget={isSearchTarget}
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
                  onImageClick={setImagePreview}
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
              <span>{t("desktop.workbench.transcriptOutline")} · {model.outline.length}</span>
            </button>
            {outlineOpen ? (
              model.outline.length ? (
                <ol className="wb-transcript-outline-list">
                  {model.outline.map((item) => (
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
      {imagePreview ? <div className="notes-image-preview" role="dialog" aria-modal="true" onClick={() => setImagePreview("")}><img src={imagePreview} alt="" /><button type="button" className="notes-image-preview-close" aria-label={t("desktop.common.close")} onClick={() => setImagePreview("")}><ThemeIcon name="close" size={16} /></button></div> : null}
    </div>
  );
}
