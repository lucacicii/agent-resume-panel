import { useEffect, useMemo, useRef, useState } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { desktopApi } from "../../bridge";
import { notifyDesktop } from "../../components/Notifications";
import { useI18n } from "../../i18n";
import { WORKBENCH_NEW_SESSION_TARGET_OPTIONS } from "../settings/model";
import type {
  WorkbenchActiveSessionDot,
  WorkbenchSendSelectionRequest,
  WorkbenchSendSelectionTarget
} from "../../../shared/workbenchSelection";

export type NoteSelectionMenuState = {
  x: number;
  y: number;
  text: string;
  projectPath?: string;
};

type Flyout = "agent" | "session" | null;

function submenuStyle(anchor: HTMLElement | null, x: number, y: number): { left: number; top: number } {
  const rect = anchor?.getBoundingClientRect();
  const width = 220;
  const height = 280;
  const left = rect
    ? (rect.right + width + 8 > window.innerWidth ? Math.max(8, rect.left - width - 4) : rect.right + 4)
    : Math.min(x + 168, window.innerWidth - width - 8);
  const top = rect
    ? Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))
    : Math.max(8, Math.min(y, window.innerHeight - height - 8));
  return { left, top };
}

export function NoteSelectionContextMenu({
  menu,
  onClose
}: {
  menu: NoteSelectionMenuState;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const agentItemRef = useRef<HTMLButtonElement>(null);
  const sessionItemRef = useRef<HTMLButtonElement>(null);
  const [flyout, setFlyout] = useState<Flyout>(null);
  const [sessions, setSessions] = useState<WorkbenchActiveSessionDot[]>([]);
  const closeTimer = useRef(0);

  useEffect(() => {
    const api = desktopApi();
    let cancelled = false;
    if (typeof api.getWorkbenchActiveSessions === "function") {
      void api.getWorkbenchActiveSessions().then((next) => {
        if (!cancelled && Array.isArray(next)) setSessions(next);
      }).catch(() => undefined);
    }
    const stop = typeof api.onWorkbenchActiveSessions === "function"
      ? api.onWorkbenchActiveSessions((next) => {
          if (Array.isArray(next)) setSessions(next);
        })
      : undefined;
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".notes-selection-menu")) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const openFlyout = (next: Flyout) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setFlyout(next);
  };
  const scheduleCloseFlyout = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFlyout(null), 180);
  };

  const send = async (request: WorkbenchSendSelectionRequest) => {
    onClose();
    try {
      await desktopApi().workbenchSendSelection(request);
    } catch (error) {
      notifyDesktop({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  };

  const sendToAgent = (target: WorkbenchSendSelectionTarget) => {
    void send({
      kind: "new-agent",
      text: menu.text,
      target,
      ...(menu.projectPath ? { projectPath: menu.projectPath } : {})
    });
  };

  const sendToSession = (session: WorkbenchActiveSessionDot) => {
    void send({
      kind: "existing-session",
      text: menu.text,
      paneKey: session.paneKey,
      ...(menu.projectPath || session.projectPath ? { projectPath: menu.projectPath || session.projectPath } : {})
    });
  };

  const agentFlyout = flyout === "agent";
  const sessionFlyout = flyout === "session";
  const agentPos = useMemo(
    () => submenuStyle(agentItemRef.current, menu.x, menu.y),
    [agentFlyout, menu.x, menu.y]
  );
  const sessionPos = useMemo(
    () => submenuStyle(sessionItemRef.current, menu.x, menu.y),
    [sessionFlyout, menu.x, menu.y]
  );

  return (
    <>
      <div
        className="notes-context-menu notes-selection-menu"
        role="menu"
        style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 220)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 96)) }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button
          ref={agentItemRef}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={agentFlyout}
          onMouseEnter={() => openFlyout("agent")}
          onMouseLeave={scheduleCloseFlyout}
          onFocus={() => openFlyout("agent")}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "Enter") {
              event.preventDefault();
              openFlyout("agent");
            }
          }}
        >
          <span>{t("desktop.notes.sendToAgent")}</span>
          <ThemeIcon name="chevron-right" className="context-menu-chevron" size={14} aria-hidden="true" />
        </button>
        <button
          ref={sessionItemRef}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={sessionFlyout}
          disabled={!sessions.length}
          onMouseEnter={() => openFlyout("session")}
          onMouseLeave={scheduleCloseFlyout}
          onFocus={() => openFlyout("session")}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight" || event.key === "Enter") {
              event.preventDefault();
              openFlyout("session");
            }
          }}
        >
          <span>{t("desktop.notes.sendToSession")}</span>
          <ThemeIcon name="chevron-right" className="context-menu-chevron" size={14} aria-hidden="true" />
        </button>
      </div>
      {agentFlyout ? (
        <div
          className="notes-context-menu notes-selection-menu notes-selection-submenu"
          role="menu"
          style={agentPos}
          onMouseEnter={() => openFlyout("agent")}
          onMouseLeave={scheduleCloseFlyout}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="notes-context-menu-label">{t("desktop.settings.newSessionGroupCli")}</div>
          {WORKBENCH_NEW_SESSION_TARGET_OPTIONS.filter((option) => option.group === "cli").map((option) => (
            <button
              type="button"
              role="menuitem"
              key={option.value}
              onClick={() => sendToAgent(option.value as WorkbenchSendSelectionTarget)}
            >
              {t(`desktop.settings.newSessionTarget.${option.value.replace(":", "_")}`)}
            </button>
          ))}
          <div className="context-menu-separator" role="separator" />
          <div className="notes-context-menu-label">{t("desktop.settings.newSessionGroupAcp")}</div>
          {WORKBENCH_NEW_SESSION_TARGET_OPTIONS.filter((option) => option.group === "acp").map((option) => (
            <button
              type="button"
              role="menuitem"
              key={option.value}
              onClick={() => sendToAgent(option.value as WorkbenchSendSelectionTarget)}
            >
              {t(`desktop.settings.newSessionTarget.${option.value.replace(":", "_")}`)}
            </button>
          ))}
        </div>
      ) : null}
      {sessionFlyout ? (
        <div
          className="notes-context-menu notes-selection-menu notes-selection-submenu"
          role="menu"
          style={sessionPos}
          onMouseEnter={() => openFlyout("session")}
          onMouseLeave={scheduleCloseFlyout}
          onContextMenu={(event) => event.preventDefault()}
        >
          {sessions.length ? sessions.map((session) => (
            <button
              type="button"
              role="menuitem"
              key={session.paneKey}
              onClick={() => sendToSession(session)}
            >
              {session.title || session.sessionKey || session.paneKey}
            </button>
          )) : (
            <div className="notes-context-menu-label">{t("desktop.notes.noActiveSessions")}</div>
          )}
        </div>
      ) : null}
    </>
  );
}
