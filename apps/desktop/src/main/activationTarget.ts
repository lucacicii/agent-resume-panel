type ActivationWindow = { isDestroyed(): boolean };

/**
 * The window a macOS reopen should bring forward.
 *
 * Clicking the Dock icon while the app runs emits `activate`, and the board used
 * to answer it unconditionally — so returning to the app threw away whatever
 * workbench the user was in. The window they left in front wins instead; the
 * board is only the answer when the system is asking for a window at all
 * (`hasVisibleWindows === false`) or when the remembered one is gone.
 */
export function activationTarget<T extends ActivationWindow>(
  lastActive: T | null,
  board: T | null,
  hasVisibleWindows: boolean
): T | null {
  if (!hasVisibleWindows) return board;
  if (!lastActive || lastActive.isDestroyed()) return board;
  return lastActive;
}
