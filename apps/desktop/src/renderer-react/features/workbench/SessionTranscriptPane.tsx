import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../bridge";
import { renderMarkdown } from "../../components/Markdown";
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
import { applyTranscriptPointerSelection } from "./transcriptTextSelection";

type TranscriptPreview = {
  title: string;
  messages: TranscriptPreviewMessage[];
  truncated?: boolean;
  warning?: string;
};

const TRANSCRIPT_AUTO_REFRESH_MS = 5_000;

export function SessionTranscriptPane({
  provider,
  sessionId,
  iconProvider,
  active,
  autoRefreshMs = TRANSCRIPT_AUTO_REFRESH_MS,
  fontSize = 14,
  focusUserMessage
}: {
  provider: string;
  sessionId: string;
  iconProvider?: string;
  active: boolean;
  autoRefreshMs?: number;
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
  const [renderMarkdownView, setRenderMarkdownView] = useState(true);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<TranscriptPreview | null>(null);
  const requestRef = useRef(0);
  const pointerSelectAnchorRef = useRef<Range | null>(null);

  const selectionInsideTranscript = (): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const root = bodyRef.current;
    const anchor = selection.anchorNode;
    return Boolean(root && anchor && root.contains(anchor));
  };

  const loadPreview = useCallback(async (silent = false) => {
    if (!provider || !sessionId) return;
    if (silent && selectionInsideTranscript()) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await desktopApi().previewSession({ provider, id: sessionId });
      if (requestRef.current !== requestId) return;
      if (silent && selectionInsideTranscript()) return;
      if (!sameTranscriptPreview(previewRef.current, result.preview)) {
        previewRef.current = result.preview;
        setPreview(result.preview);
      }
      if (silent) setError("");
    } catch (caught) {
      if (requestRef.current !== requestId) return;
      if (!silent) {
        previewRef.current = null;
        setPreview(null);
      }
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestRef.current === requestId && !silent) setLoading(false);
    }
  }, [provider, sessionId]);

  useEffect(() => {
    setQuery("");
    setSelectedId(null);
    previewRef.current = null;
    setPreview(null);
    setError("");
    setExpandedThinking({});
    if (!active || !provider || !sessionId) return;
    void loadPreview();
  }, [active, loadPreview, provider, sessionId]);

  useEffect(() => {
    if (!active || !provider || !sessionId) return;
    if (autoRefreshMs <= 0) return;
    const timer = window.setInterval(() => {
      void loadPreview(true);
    }, autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [active, autoRefreshMs, loadPreview, provider, sessionId]);

  const model = useMemo(
    () => buildSessionTranscriptModel(preview?.messages || []),
    [preview?.messages]
  );
  const visible = useMemo(() => filterSessionTranscript(model, query), [model, query]);

  const scrollToMessage = (messageId: string) => {
    setSelectedId(messageId);
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
        <>
          <section className="wb-transcript-outline">
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
          </section>

          <div
            className="wb-transcript-body"
            ref={bodyRef}
            style={{ ["--wb-transcript-font-size" as string]: `${fontSize}px` }}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 2) return;
              if (event.pointerType === "mouse" && event.button === 2) event.preventDefault();
              const root = bodyRef.current;
              if (!root) return;
              pointerSelectAnchorRef.current = applyTranscriptPointerSelection(
                root,
                event.clientX,
                event.clientY,
                null
              );
            }}
            onPointerMove={(event) => {
              if (!pointerSelectAnchorRef.current) return;
              if (event.pointerType === "mouse" && event.buttons !== 2) return;
              event.preventDefault();
              const root = bodyRef.current;
              if (!root) return;
              applyTranscriptPointerSelection(
                root,
                event.clientX,
                event.clientY,
                pointerSelectAnchorRef.current
              );
            }}
            onPointerUp={() => {
              pointerSelectAnchorRef.current = null;
            }}
            onPointerCancel={() => {
              pointerSelectAnchorRef.current = null;
            }}
          >
            {visible.messages.length ? visible.messages.map((message) => {
              const stamp = formatTimestamp(message.timestamp);
              return (
                <article
                  key={message.id}
                  data-transcript-id={message.id}
                  className={`preview-msg ${message.role}${selectedId === message.id ? " is-selected" : ""}`}
                >
                  <div className="role">
                    {message.role === "assistant"
                      ? <ProviderIcon provider={roleIconProvider} size={13} className="wb-transcript-role-icon" />
                      : <ThemeIcon name="user" size={13} className="wb-transcript-role-icon" aria-hidden="true" />}
                    {roleLabel(message)}
                    {stamp ? ` · ${stamp}` : ""}
                  </div>
                  {message.thinking ? (
                    <div className="wb-transcript-thinking">
                      <button
                        type="button"
                        className="wb-transcript-thinking-toggle"
                        aria-expanded={expandedThinking[message.id] === true}
                        onClick={() => setExpandedThinking((current) => ({
                          ...current,
                          [message.id]: !current[message.id]
                        }))}
                      >
                        <ThemeIcon name="chevron-right" className={expandedThinking[message.id] ? "is-expanded" : ""} size={12} />
                        <span>{t("desktop.workbench.transcriptThinking")}</span>
                      </button>
                      {expandedThinking[message.id] ? (
                        renderMarkdownView ? (
                          <div
                            className="wb-transcript-thinking-body wb-transcript-md markdown-body"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.thinking) }}
                          />
                        ) : (
                          <div className="wb-transcript-thinking-body wb-transcript-plain">{message.thinking}</div>
                        )
                      ) : null}
                    </div>
                  ) : null}
                  {message.text ? (
                    renderMarkdownView ? (
                      <div
                        className="wb-transcript-md markdown-body"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
                      />
                    ) : (
                      <div className="wb-transcript-plain">{message.text}</div>
                    )
                  ) : null}
                </article>
              );
            }) : (
              <p className="muted wb-transcript-status">{t("desktop.workbench.transcriptNoMatches")}</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
