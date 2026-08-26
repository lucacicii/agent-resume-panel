import { useEffect, useRef, useState } from "react";
import { ThemeIcon } from "./ThemeIcon";
import { useI18n } from "../i18n";
import {
  getConfig,
  getHistory,
  subscribe,
  type NotificationEntry
} from "./notificationStore";
import { NotificationHistoryPopover } from "./NotificationHistoryPopover";

export function BellNotificationButton(): React.JSX.Element {
  const { ready, t } = useI18n();
  const [history, setHistory] = useState<NotificationEntry[]>(getHistory());
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [shake, setShake] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const lastCount = useRef(history.length);

  useEffect(() => {
    return subscribe(() => {
      setHistory(getHistory());
    });
  }, []);

  useEffect(() => {
    if (history.length > lastCount.current) {
      setUnread((prev) => prev + (history.length - lastCount.current));
      setShake(true);
      const timer = window.setTimeout(() => setShake(false), 500);
      lastCount.current = history.length;
      return () => window.clearTimeout(timer);
    }
    lastCount.current = history.length;
  }, [history.length]);

  const handleToggle = () => {
    setOpen((prev) => {
      if (!prev) setUnread(0);
      return !prev;
    });
  };

  const bellLabel = ready ? t("desktop.notifications.bell") : "Notifications";
  const hasNotifications = history.length > 0;

  return (
    <>
      <button
        ref={bellRef}
        type="button"
        className={`bell-btn${shake ? " is-shaking" : ""}${open ? " is-open" : ""}${hasNotifications ? " has-unread" : ""}`}
        onClick={handleToggle}
        aria-label={bellLabel}
        aria-expanded={open}
        title={bellLabel}
      >
        <ThemeIcon name="bell" aria-hidden="true" />
        {unread > 0 && <span className="bell-badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && bellRef.current && (
        <NotificationHistoryPopover
          anchor={bellRef.current}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
