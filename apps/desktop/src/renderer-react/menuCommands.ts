/**
 * Menu → renderer bridge for commands the menu bar owns.
 *
 * macOS consumes a registered menu accelerator, so the key never reaches the
 * page. Find is implemented as a window `keydown` listener in every pane that
 * owns a find bar (diff view, transcript, terminal, code editor, note editor,
 * standalone note, floating note), each with its own guard for whether that pane
 * is the active one. Re-dispatching the same key event keeps exactly one
 * implementation of "open the find bar" and preserves those guards, so ⌘F and
 * Edit ▸ Find… cannot drift apart.
 */
export function startMenuCommandBridge(): () => void {
  const api = window.agentResume;
  if (typeof api?.onMenuFind !== "function") return () => undefined;
  return api.onMenuFind(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true })
    );
  });
}
