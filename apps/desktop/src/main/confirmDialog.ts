/**
 * Native confirmation alerts.
 *
 * `window.confirm` renders a Chromium dialog titled with the page origin and
 * blocks the renderer; this builds the `NSAlert` instead. The button order and
 * the default button are the parts macOS users read as "native", so they live in
 * one testable place rather than inline in the IPC handler.
 */
export interface ConfirmDialogRequest {
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function confirmDialogOptions(
  request: ConfirmDialogRequest,
  labels: { confirm: string; cancel: string }
): Electron.MessageBoxOptions {
  const destructive = request.destructive === true;
  return {
    type: destructive ? "warning" : "question",
    message: request.message,
    ...(request.detail && request.detail.trim() ? { detail: request.detail } : {}),
    // macOS: the safe choice leads the buttons, the destructive one trails it.
    buttons: [request.cancelLabel?.trim() || labels.cancel, request.confirmLabel?.trim() || labels.confirm],
    // Return must not destroy anything: on a destructive alert the default is
    // Cancel, so the user has to click the verb button on purpose.
    defaultId: destructive ? 0 : 1,
    cancelId: 0,
    noLink: true,
    normalizeAccessKeys: true
  };
}
