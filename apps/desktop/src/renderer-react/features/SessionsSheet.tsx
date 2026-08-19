import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSession } from "@agent-resume/core";
import { desktopApi } from "../bridge";
import { useI18n } from "../i18n";
import { Sheet } from "../components/Sheet";
import { Status, type StatusKind } from "../components/Status";
import { syncTruncationTitle } from "../components/truncationTitle";
import { VirtualList } from "../components/VirtualList";

const SESSION_ROW_HEIGHT = 58;

interface SessionPreview {
  title: string;
  messages: Array<{ role: string; text: string; timestamp?: string }>;
  truncated?: boolean;
  warning?: string;
}

interface PreviewState {
  session: AgentSession;
  preview: SessionPreview;
  summary: string;
}

interface StatusState {
  text: string;
  kind?: StatusKind;
}

function sessionKey(session: Pick<AgentSession, "provider" | "id">): string {
  return `${session.provider}:${session.id}`;
}

function basename(value?: string): string {
  const normalized = String(value ?? "").replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).at(-1) || "";
}

function formatTime(value: number, locale: string): string {
  try {
    return new Date(value).toLocaleString(locale);
  } catch {
    return String(value);
  }
}

export function SessionsSheet(): React.JSX.Element {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<{ updatedAt: number; provider: string; id: string }>();
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSeq = useRef(0);
  const [selectedKey, setSelectedKey] = useState("");
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [assist, setAssist] = useState<"summary" | "rename" | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState(0);
  const [status, setStatus] = useState<StatusState>({ text: "" });

  const loadSessions = useCallback(async () => {
    const request = ++requestSeq.current;
    setLoading(true);
    setNextCursor(undefined);
    try {
      const page = await desktopApi().querySessionsPage({ limit: 100 });
      if (request !== requestSeq.current) return;
      setSessions(page.sessions);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
      setStatus({ text: "" });
    } catch (error) {
      if (request === requestSeq.current) setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      if (request === requestSeq.current) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const page = await desktopApi().querySessionsPage({ limit: 100, cursor: nextCursor });
      setSessions((current) => {
        const seen = new Set(current.map(sessionKey));
        return [...current, ...page.sessions.filter((session) => !seen.has(sessionKey(session)))];
      });
      setTotal(page.total);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, nextCursor]);

  const loadPreview = useCallback(async (session: AgentSession) => {
    setSelectedKey(sessionKey(session));
    setPreviewLoading(true);
    setStatus({ text: "" });
    try {
      const result = await desktopApi().previewSession({ provider: session.provider, id: session.id });
      setPreviewState({ session: result.session, preview: result.preview, summary: result.session.sessionSummary || "" });
    } catch (error) {
      setPreviewState(null);
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    window.dispatchEvent(new Event("agent-resume:sessions-closed"));
  }, []);

  const openSheet = useCallback(
    (session?: AgentSession) => {
      setOpen(true);
      void loadSessions();
      if (session?.provider && session.id) void loadPreview(session);
    },
    [loadPreview, loadSessions]
  );

  useEffect(() => {
    const onOpen = (event: Event) => openSheet((event as CustomEvent<AgentSession | undefined>).detail);
    const onClose = () => close();
    const onPreview = (event: Event) => {
      const session = (event as CustomEvent<AgentSession | undefined>).detail;
      if (session?.provider && session.id) openSheet(session);
    };
    window.addEventListener("agent-resume:sessions-open", onOpen);
    window.addEventListener("agent-resume:sessions-close", onClose);
    window.addEventListener("agent-resume:sessions-preview", onPreview);
    return () => {
      window.removeEventListener("agent-resume:sessions-open", onOpen);
      window.removeEventListener("agent-resume:sessions-close", onClose);
      window.removeEventListener("agent-resume:sessions-preview", onPreview);
    };
  }, [close, openSheet]);

  useEffect(() => {
    const unsubscribe = desktopApi().onSessionsSynced((result) => {
      setLastSyncedAt(result.syncedAt || Date.now());
      if (open) void loadSessions();
    });
    return unsubscribe;
  }, [loadSessions, open]);

  const refresh = async () => {
    setLoading(true);
    try {
      const result = await desktopApi().syncSessions();
      setLastSyncedAt(result.syncedAt || Date.now());
      await loadSessions();
      setStatus({ text: t("desktop.workbench.syncedCount", result.sessionCount), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setLoading(false);
    }
  };

  const summarize = async () => {
    if (!previewState) return;
    setAssist("summary");
    try {
      const result = await desktopApi().summarizeSession({
        provider: previewState.session.provider,
        id: previewState.session.id
      });
      setPreviewState((current) => (current ? { ...current, summary: result.summary } : current));
      setStatus({ text: t("desktop.sessions.summaryGenerated"), kind: "ok" });
      window.dispatchEvent(new Event("agent-resume:sessions-mutated"));
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setAssist(null);
    }
  };

  const autoRename = async () => {
    if (!previewState) return;
    setAssist("rename");
    try {
      const result = await desktopApi().autoRenameSession({
        provider: previewState.session.provider,
        id: previewState.session.id
      });
      setSessions((current) =>
        current.map((session) => (sessionKey(session) === selectedKey ? { ...session, title: result.title } : session))
      );
      setPreviewState((current) =>
        current
          ? { ...current, session: { ...current.session, title: result.title }, preview: { ...current.preview, title: result.title } }
          : current
      );
      let text = t("desktop.sessions.renamed", result.title);
      if (!result.nativeRenamed && result.nativeError) text += t("desktop.sessions.renamedNativeError", result.nativeError);
      setStatus({ text, kind: result.nativeRenamed || !result.nativeError ? "ok" : "error" });
      window.dispatchEvent(new CustomEvent("agent-resume:sessions-mutated", { detail: { kind: "session-title" } }));
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    } finally {
      setAssist(null);
    }
  };

  const resumeSession = useCallback(async () => {
    if (!previewState) return;
    const { provider, id } = previewState.session;
    if (!provider || !id) return;
    try {
      const result = await desktopApi().workbenchOpenSession({ provider, id });
      if (result.external) {
        // External terminal/editor is opening; keep the sheet open and report.
        setStatus({ text: t("desktop.agent.resumeStarted", provider, id), kind: "ok" });
        return;
      }
      close();
      // Workbench decides: focus the already-open pane, or open the session fresh.
      window.dispatchEvent(new CustomEvent("agent-resume:workbench-open-session", { detail: previewState.session }));
      setStatus({ text: t("desktop.agent.resumeStarted", provider, id), kind: "ok" });
    } catch (error) {
      setStatus({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [previewState, close, t]);

  const meta = useMemo(() => {
    const interval = t("desktop.common.oneMinute");
    const synced = lastSyncedAt ? t("desktop.sessions.lastSynced", formatTime(lastSyncedAt, locale)) : "";
    return t("desktop.sessions.meta", `${sessions.length} / ${total}`, interval, synced);
  }, [lastSyncedAt, locale, sessions.length, t]);
  const selectedIndex = useMemo(
    () => sessions.findIndex((session) => sessionKey(session) === selectedKey),
    [selectedKey, sessions]
  );

  return (
    <Sheet open={open} title={t("desktop.sessions.sheetTitle")} onClose={close} wide bodyClassName="sessions-split">
      <div className="sessions-list-pane">
        <div className="form-row">
          <button type="button" className="ghost-btn" onClick={() => void refresh()} disabled={loading}>
            {t("desktop.sessions.refreshList")}
          </button>
        </div>
        <p className="muted">{loading && !sessions.length ? t("desktop.common.loading") : meta}</p>
        <VirtualList
          className="sessions-list"
          items={sessions}
          itemHeight={SESSION_ROW_HEIGHT}
          getKey={sessionKey}
          scrollToIndex={selectedIndex}
          onEndReached={() => void loadMore()}
          renderItem={(session) => {
            const key = sessionKey(session);
            return (
              <button
                key={key}
                type="button"
                className={`session-row${key === selectedKey ? " active" : ""}`}
                onClick={() => void loadPreview(session)}
              >
                <div className="s-title" ref={(el) => syncTruncationTitle(el)}>{session.title}</div>
                <div className="s-meta">
                  <span className="s-provider-tag" data-provider={session.provider}>{session.provider}</span>
                  {" · "}{basename(session.projectPath)}{" · "}{formatTime(session.updatedAt, locale)}
                </div>
              </button>
            );
          }}
        />
      </div>
      <div className="session-preview-pane">
        {previewLoading && <p className="muted">{t("desktop.common.loadingPreview")}</p>}
        {!previewLoading && !previewState && <p className="muted">{t("desktop.sessions.previewHint")}</p>}
        {!previewLoading && previewState && (
          <>
            <div className="session-preview-head">
              <h3 className="session-preview-title">{previewState.preview.title || previewState.session.title}</h3>
              <div className="session-preview-actions">
                <button type="button" className="tool-btn" onClick={() => void summarize()} disabled={assist !== null}>
                  {assist === "summary" ? t("desktop.sessions.summarizing") : "Summarize"}
                </button>
                <button type="button" className="tool-btn" onClick={() => void autoRename()} disabled={assist !== null}>
                  {assist === "rename" ? t("desktop.sessions.renaming") : "Auto Rename"}
                </button>
                <button type="button" className="tool-btn" onClick={() => void resumeSession()}>
                  {t("desktop.agent.resumeSession")}
                </button>
              </div>
            </div>
            <div className="muted session-preview-meta">
              {previewState.session.provider}{" · "}{previewState.session.id}{" · "}{previewState.session.projectPath}
            </div>
            <Status kind={status.kind}>{status.text}</Status>
            {previewState.summary && (
              <div className="session-summary-box">
                <div className="session-summary-label">Summary</div>
                <div className="session-summary-body">{previewState.summary}</div>
              </div>
            )}
            {previewState.preview.warning && <Status kind="error">{previewState.preview.warning}</Status>}
            {!previewState.preview.messages.length ? (
              <p className="muted">{t("desktop.sessions.noMessages")}</p>
            ) : (
              previewState.preview.messages.map((message, index) => (
                <div key={`${message.timestamp || index}-${message.role}`} className={`preview-msg ${message.role}`}>
                  <div className="role">{message.role}</div>
                  <div>{message.text}</div>
                </div>
              ))
            )}
            {previewState.preview.truncated && <p className="muted">{t("desktop.sessions.truncated")}</p>}
          </>
        )}
        {!previewState && status.text && <Status kind={status.kind}>{status.text}</Status>}
      </div>
    </Sheet>
  );
}
