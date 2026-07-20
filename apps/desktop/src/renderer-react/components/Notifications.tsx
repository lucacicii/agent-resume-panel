import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

export type NotificationKind = "error" | "ok" | "info";

export interface DesktopNotificationInput {
  text: string;
  kind?: NotificationKind;
  durationMs?: number;
}

type DesktopNotification = DesktopNotificationInput & {
  id: number;
  exiting: boolean;
};

const EVENT_NAME = "agent-resume:notification";
const EXIT_DURATION_MS = 280;
const DEFAULT_DURATION_MS = 3000;

/** Publish a transient notification from any Desktop renderer feature. */
export function notifyDesktop(input: DesktopNotificationInput): void {
  window.dispatchEvent(new CustomEvent<DesktopNotificationInput>(EVENT_NAME, { detail: input }));
}

export function Notifications(): React.ReactPortal | null {
  const [notifications, setNotifications] = useState<DesktopNotification[]>([]);
  const timers = useRef(new Map<number, number[]>());
  const nextId = useRef(0);

  useEffect(() => {
    const clearTimers = (id: number) => {
      timers.current.get(id)?.forEach((timer) => window.clearTimeout(timer));
      timers.current.delete(id);
    };
    const remove = (id: number) => {
      clearTimers(id);
      setNotifications((current) => current.filter((notification) => notification.id !== id));
    };
    const onNotification = (event: Event) => {
      const input = (event as CustomEvent<DesktopNotificationInput>).detail;
      if (!input?.text.trim()) return;
      const id = ++nextId.current;
      const notification: DesktopNotification = { id, text: input.text, kind: input.kind || "info", exiting: false };
      setNotifications((current) => [...current.slice(-3), notification]);
      const exitTimer = window.setTimeout(() => {
        setNotifications((current) => current.map((item) => item.id === id ? { ...item, exiting: true } : item));
        const removeTimer = window.setTimeout(() => remove(id), EXIT_DURATION_MS);
        timers.current.set(id, [removeTimer]);
      }, input.durationMs ?? DEFAULT_DURATION_MS);
      timers.current.set(id, [exitTimer]);
    };

    window.addEventListener(EVENT_NAME, onNotification);
    return () => {
      window.removeEventListener(EVENT_NAME, onNotification);
      timers.current.forEach((items) => items.forEach((timer) => window.clearTimeout(timer)));
      timers.current.clear();
    };
  }, []);

  return createPortal(
    <div className="desktop-notifications" aria-live="polite" aria-relevant="additions">
      {notifications.map((notification) => <div className={`desktop-notification ${notification.kind}${notification.exiting ? " is-exiting" : ""}`} key={notification.id} role={notification.kind === "error" ? "alert" : "status"}>{notification.text}</div>)}
    </div>,
    document.body
  );
}
