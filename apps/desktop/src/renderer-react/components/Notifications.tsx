import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { DesktopNotificationInput, NotificationKind } from "./notificationStore";
import type { NotificationEntry } from "./notificationStore";

export type { DesktopNotificationInput, NotificationEntry };
export type { NotificationKind } from "./notificationStore";

interface ToastState {
  id: number;
  text: string;
  kind: NotificationKind;
  exiting: boolean;
}

const EXIT_DURATION_MS = 280;
const DEFAULT_DURATION_MS = 3000;

/** Publish a transient notification from any Desktop renderer feature. */
export function notifyDesktop(input: DesktopNotificationInput): void {
  window.dispatchEvent(new CustomEvent<DesktopNotificationInput>("agent-resume:notification", { detail: input }));
}

export function Notifications(): React.ReactPortal | null {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const timers = useRef(new Map<number, number[]>());
  const idCounter = useRef(0);

  useEffect(() => {
    const clearTimers = (id: number) => {
      timers.current.get(id)?.forEach((timer) => window.clearTimeout(timer));
      timers.current.delete(id);
    };
    const remove = (id: number) => {
      clearTimers(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    };
    const onNotification = (event: Event) => {
      const input = (event as CustomEvent<DesktopNotificationInput>).detail;
      if (!input?.text.trim()) return;
      const id = ++idCounter.current;
      const kind = input.kind ?? "info";
      setToasts((current) => [...current.slice(-3), { id, text: input.text, kind, exiting: false }]);
      const exitTimer = window.setTimeout(() => {
        setToasts((current) => current.map((item) => item.id === id ? { ...item, exiting: true } : item));
        const removeTimer = window.setTimeout(() => remove(id), EXIT_DURATION_MS);
        timers.current.set(id, [removeTimer]);
      }, input.durationMs ?? DEFAULT_DURATION_MS);
      timers.current.set(id, [exitTimer]);
    };
    window.addEventListener("agent-resume:notification", onNotification);
    return () => {
      window.removeEventListener("agent-resume:notification", onNotification);
      timers.current.forEach((items) => items.forEach((timer) => window.clearTimeout(timer)));
      timers.current.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="desktop-notifications" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <div
          className={`desktop-notification ${toast.kind}${toast.exiting ? " is-exiting" : ""}`}
          key={toast.id}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {toast.text}
        </div>
      ))}
    </div>,
    document.body
  );
}
