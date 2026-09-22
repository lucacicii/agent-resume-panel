import { useCallback, useState } from "react";
import type { AgentSession, GtdStatus } from "@agent-resume/core";
import { Sheet } from "../../components/Sheet";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { notifyDesktop } from "../../components/Notifications";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { desktopGtdColumn, desktopGtdLabelKey } from "../../gtd";
import { ensureTaskWorkbenches } from "../workbench/workbenchModel";
import { SessionTranscriptPane } from "../workbench/SessionTranscriptPane";
import { projectLabel, relativeTime, sessionKey } from "./sessionFormat";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The session detail popup, modelled on the extension's session preview panel:
 * title and actions in the head, the session's facts underneath, then the
 * conversation.
 *
 * It reuses the workbench transcript pane rather than growing a second
 * renderer: search, Markdown, copy and the image preview come along for free.
 */
export function SessionDetailSheet({
  session,
  gtdStatus,
  onClose,
  onTitleChanged
}: {
  session: AgentSession | null;
  gtdStatus?: GtdStatus;
  onClose: () => void;
  onTitleChanged?: (key: string, title: string) => void;
}): React.JSX.Element | null {
  const { ready, t, locale } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const text = useCallback(
    (key: string, ...args: Array<string | number>) => (ready ? t(key, ...args) : key),
    [ready, t]
  );

  /** Open the workbench window of the task this session belongs to. */
  const openInWorkbench = useCallback(async () => {
    if (!session) return;
    try {
      if (typeof desktopApi().notesTaskNoteIdForSession !== "function") return;
      const noteId = await desktopApi().notesTaskNoteIdForSession({
        provider: session.provider,
        sessionId: session.id
      });
      if (!noteId) {
        notifyDesktop({ text: text("desktop.sessions.noTask"), kind: "error", durationMs: 4000 });
        return;
      }
      const workbenches = await ensureTaskWorkbenches(noteId);
      const workbenchId = workbenches[0]?.workbenchId;
      if (!workbenchId) throw new Error(text("desktop.gtd.windowNoWorkbench"));
      const opened = await desktopApi().taskWindowOpen({
        noteId,
        workbenchId,
        title: session.title || session.id
      });
      if (!opened.ok) {
        notifyDesktop({ text: text("desktop.gtd.windowLimit", opened.limit), kind: "error", durationMs: 6000 });
        return;
      }
      onClose();
    } catch (error) {
      notifyDesktop({ text: errorMessage(error), kind: "error" });
    }
  }, [session, text, onClose]);

  const applyTitle = useCallback(async (title: string) => {
    if (!session) return;
    const trimmed = title.trim();
    setRenaming(false);
    if (!trimmed || trimmed === session.title) return;
    setBusy(true);
    try {
      const result = await desktopApi().renameSession({
        provider: session.provider,
        id: session.id,
        title: trimmed
      });
      onTitleChanged?.(sessionKey(session), trimmed);
      notifyDesktop({
        text: text("desktop.sessions.renamed", trimmed) + (result?.nativeError ? text("desktop.sessions.renamedNativeError", result.nativeError) : ""),
        durationMs: 4000
      });
    } catch (error) {
      notifyDesktop({ text: text("desktop.sessions.renameFailed", errorMessage(error)), kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [session, onTitleChanged, text]);

  const autoRename = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      const result = await desktopApi().autoRenameSession({
        provider: session.provider,
        id: session.id,
        persist: true
      });
      const title = result?.title?.trim();
      if (title) {
        onTitleChanged?.(sessionKey(session), title);
        notifyDesktop({
          text: text("desktop.sessions.renamed", title) + (result?.nativeError ? text("desktop.sessions.renamedNativeError", result.nativeError) : ""),
          durationMs: 4000
        });
      }
    } catch (error) {
      notifyDesktop({ text: errorMessage(error), kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [session, onTitleChanged, text]);

  const copyKey = useCallback(async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(sessionKey(session));
      notifyDesktop({ text: text("desktop.common.copied"), durationMs: 2000 });
    } catch (error) {
      notifyDesktop({ text: errorMessage(error), kind: "error" });
    }
  }, [session, text]);

  if (!session) return null;

  const title = session.title || session.id;
  const project = session.projectPath;

  const actions = (
    <>
      <button
        type="button"
        className="ghost-btn"
        disabled={busy}
        onClick={() => {
          setDraft(title);
          setRenaming(true);
        }}
      >
        <ThemeIcon name="pencil" size={ICON_SIZE.dense} aria-hidden="true" />
        {text("desktop.common.rename")}
      </button>
      <button type="button" className="ghost-btn" disabled={busy} onClick={() => void autoRename()}>
        <ThemeIcon name="sparkles" size={ICON_SIZE.dense} aria-hidden="true" />
        {text("desktop.sessions.autoRename")}
      </button>
      <button type="button" className="ghost-btn session-detail-primary" disabled={busy} onClick={() => void openInWorkbench()}>
        <ThemeIcon name="square-kanban" size={ICON_SIZE.dense} aria-hidden="true" />
        {text("desktop.sessions.openWorkbench")}
      </button>
    </>
  );

  return (
    <Sheet open title={title} wide onClose={onClose} actions={actions} bodyClassName="session-detail-body">
      <div className="session-detail">
        {renaming ? (
          <div className="session-detail-rename">
            <input
              className="session-detail-rename-input"
              autoFocus
              value={draft}
              aria-label={text("desktop.common.rename")}
              disabled={busy}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void applyTitle(draft);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setRenaming(false);
                }
              }}
              onBlur={() => void applyTitle(draft)}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={text("desktop.common.cancel")}
              title={text("desktop.common.cancel")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setRenaming(false)}
            >
              <ThemeIcon name="close" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div className="session-detail-facts">
          <span className="session-detail-label">{text("desktop.sessions.colProvider")}</span>
          <span className="session-detail-value">
            <span className="s-provider-tag" data-provider={session.acpProvider || session.provider}>
              {session.acpProvider ? `acp/${session.acpProvider}` : session.provider}
            </span>
            {gtdStatus ? (
              <span className={`wb-gtd-status-badge is-${desktopGtdColumn(gtdStatus)}`}>
                {text(desktopGtdLabelKey(gtdStatus))}
              </span>
            ) : null}
          </span>

          <span className="session-detail-label">{text("desktop.sessions.colProject")}</span>
          <span className="session-detail-value session-detail-path" title={project || ""}>{projectLabel(project)}</span>

          <span className="session-detail-label">{text("desktop.sessions.colUpdated")}</span>
          <span className="session-detail-value" title={new Date(session.updatedAt).toLocaleString()}>
            {relativeTime(session.updatedAt, locale)}
          </span>

          <span className="session-detail-label">{text("desktop.sessions.colSessionId")}</span>
          <span className="session-detail-value session-detail-id">
            <code>{session.id}</code>
            <button
              type="button"
              className="icon-btn"
              aria-label={text("desktop.sessions.copyKey")}
              title={text("desktop.sessions.copyKey")}
              onClick={() => void copyKey()}
            >
              <ThemeIcon name="copy" size={ICON_SIZE.dense} aria-hidden="true" />
            </button>
          </span>

          {session.model || session.branch || session.messageCount != null ? (
            <>
              <span className="session-detail-label">{text("desktop.sessions.colInfo")}</span>
              <span className="session-detail-value session-detail-info">
                {[session.model, session.branch, session.messageCount != null ? text("desktop.sessions.messageCount", session.messageCount) : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </>
          ) : null}

          {session.sessionSummary?.trim() ? (
            <>
              <span className="session-detail-label">{text("desktop.sessions.colSummary")}</span>
              <span className="session-detail-value session-detail-summary">{session.sessionSummary.trim()}</span>
            </>
          ) : null}
        </div>

        <div className="session-detail-transcript">
          <SessionTranscriptPane
            provider={session.provider}
            sessionId={session.id}
            iconProvider={session.acpProvider || session.provider}
            active
            onRefresh={async () => {
              await desktopApi().syncSessions?.();
            }}
          />
        </div>
      </div>
    </Sheet>
  );
}
