import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { clearAll, getPage, getTotalCount, subscribe, type NotificationEntry } from "./notificationStore";

const PAGE_SIZE = 10;

function formatTime(ms: number): string {
  const diff = Date.now() - ms;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export function NotificationHistoryPopover({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }): React.JSX.Element {
  const { ready, t } = useI18n();
  const [page, setPage] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);

  const total = getTotalCount();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const items = getPage(safePage, PAGE_SIZE);

  useEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const popover = popoverRef.current;
    if (popover) {
      const gap = 6;
      const left = Math.max(8, Math.min(rect.right - 340, window.innerWidth - 348));
      const top = Math.min(rect.bottom + gap, window.innerHeight - 488);
      popover.style.left = `${left}px`;
      popover.style.top = `${Math.max(8, top)}px`;
    }
  }, [anchor]);

  useEffect(() => {
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current && !popoverRef.current.contains(target) &&
        !anchor.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [anchor, onClose]);

  useEffect(() => {
    const stop = subscribe(() => {
      // Force re-render by updating page (which triggers getPage call)
      setPage((p) => p);
    });
    return stop;
  }, []);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [safePage, page]);

  const translate = (key: string) => (ready ? t(key) : key);

  return createPortal(
    <div ref={popoverRef} className="notification-popover" role="dialog" aria-label={translate("desktop.notifications.title")}>
      <div className="notification-popover-header">
        <span className="notification-popover-title">{translate("desktop.notifications.title")}</span>
        {total > 0 && (
          <button
            type="button"
            className="notification-clear-btn"
            onClick={() => {
              clearAll();
              setPage(0);
            }}
          >
            {translate("desktop.notifications.clearAll")}
          </button>
        )}
      </div>
      <div className="notification-list">
        {items.length === 0
          ? <div className="notification-empty">{translate("desktop.notifications.empty")}</div>
          : items.map((item) => (
            <div className={`notification-item ${item.kind}`} key={item.id}>
              <span className={`notification-dot is-${item.kind}`} aria-hidden="true" />
              <span className="notification-text">{item.text}</span>
              <span className="notification-time">{formatTime(item.timestamp)}</span>
            </div>
          ))
        }
      </div>
      {totalPages > 1 && (
        <div className="notification-pagination">
          <button
            type="button"
            className="notification-page-btn"
            disabled={safePage <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label={translate("desktop.notifications.prev")}
          >
            ‹
          </button>
          <span className="notification-page-indicator">
            {ready ? t("desktop.notifications.page", safePage + 1, totalPages) : `Page ${safePage + 1} of ${totalPages}`}
          </span>
          <button
            type="button"
            className="notification-page-btn"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            aria-label={translate("desktop.notifications.next")}
          >
            ›
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}
