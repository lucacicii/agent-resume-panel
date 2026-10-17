import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TaskWorktreeInfo } from "../../../../shared/worktreeTypes";
import { confirmAction } from "../../../confirmAction";
import { useI18n } from "../../../i18n";
import type { TaskWorktrees } from "./useTaskWorktrees";

export type WorktreeReminders = {
  /**
   * Runs while the window is closing. Answers whether the close may go ahead;
   * false means the user asked to look at the worktrees instead.
   */
  remindBeforeClose: () => Promise<boolean>;
};

type Pending = { repoLabel: string; worktree: TaskWorktreeInfo };

/**
 * The moments a person is reminded that checkouts are still around.
 *
 * All three are reminders and nothing else: no path in the panel deletes a
 * worktree on its own — not a timer, not a close, not "the task is finished" —
 * so these dialogs name what exists and offer to show it. The one place a
 * checkout is removed remains the task settings sheet, behind its own numbered
 * confirmation.
 *
 * They fire on the three occasions where the reminder is worth an interruption:
 * a task that finished, a window that is closing, and a task that was opened
 * with checkout leftovers. Anything more would be nagging, which is why the
 * "don't remind me again" answer is remembered per checkout rather than
 * pretended to be a global preference.
 */
export function useWorktreeReminders(options: {
  noteId: string | null;
  /** The task's workflow status as the panel knows it; `done` ends the task. */
  status: string | undefined;
  worktrees: TaskWorktrees;
  /** Show them: opens the task settings sheet. */
  onOpenWorktrees: () => void;
}): WorktreeReminders {
  const { noteId, status, worktrees, onOpenWorktrees } = options;
  const { saveState } = worktrees;
  // A native dialog cannot be re-rendered once it is up, so none is shown before
  // the strings are in hand: the keys would be on screen instead of the words.
  const { t, ready } = useI18n();

  /** Everything that would have to be cleaned up: every checkout but the main one. */
  const pending = useMemo<Pending[]>(
    () => (worktrees.listing?.repos ?? []).flatMap((repo) => repo.worktrees.filter((worktree) => !worktree.isMain).map((worktree) => ({ repoLabel: repo.label, worktree }))),
    [worktrees.listing]
  );
  // The close handler is registered once, so it reads the current state through
  // refs rather than capturing the first render's values.
  const pendingRef = useRef<Pending[]>(pending);
  pendingRef.current = pending;
  const dismissedRef = useRef(worktrees.state.dismissed ?? {});
  dismissedRef.current = worktrees.state.dismissed ?? {};
  const openRef = useRef(onOpenWorktrees);
  openRef.current = onOpenWorktrees;

  const detailFor = useCallback(
    (items: Pending[]): string =>
      items.map((item) => `${item.repoLabel} ▸ ${item.worktree.branch || item.worktree.head.slice(0, 7) || item.worktree.path}`).join("\n"),
    []
  );

  /**
   * Opening a task that still has checkouts says so once. Entries the user has
   * already waved away are left out, and choosing to wave them away again
   * remembers every entry that was listed — a dialog with two buttons can only
   * carry one answer, so it carries the one that stops the interruption.
   */
  const openNoticeShownRef = useRef(false);
  useEffect(() => {
    if (!ready || !noteId || openNoticeShownRef.current) return;
    const fresh = pending.filter((item) => !dismissedRef.current[item.worktree.path]);
    if (!fresh.length) return;
    openNoticeShownRef.current = true;
    void (async () => {
      const forget = await confirmAction(t("desktop.workbench.worktreeOpenNotice", String(fresh.length)), {
        detail: detailFor(fresh),
        confirmLabel: t("desktop.workbench.worktreeDontRemind"),
        cancelLabel: t("desktop.workbench.worktreeLater"),
        // Alert style: Return and Escape both mean "later", so forgetting a
        // reminder has to be a deliberate click.
        destructive: true
      });
      if (!forget) return;
      await saveState({ dismissed: Object.fromEntries(fresh.map((item) => [item.worktree.path, Date.now()])) });
    })();
  }, [detailFor, noteId, pending, ready, saveState, t]);

  /**
   * A task marked done is the moment its checkouts stop having a purpose, so the
   * reminder offers to show them instead of just reporting them.
   *
   * Only a transition counts: a task that was already done when the window
   * opened has not just finished, and opening it is not an occasion to nag.
   */
  const previousStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!ready || !noteId) {
      if (!noteId) previousStatusRef.current = undefined;
      return;
    }
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previous === undefined || previous === status || status !== "done") return;
    const items = pendingRef.current;
    if (!items.length) return;
    void (async () => {
      const review = await confirmAction(t("desktop.workbench.worktreeDoneNotice", String(items.length)), {
        detail: detailFor(items),
        confirmLabel: t("desktop.workbench.worktreeReview"),
        cancelLabel: t("desktop.workbench.worktreeLater"),
        destructive: true
      });
      if (review) openRef.current();
    })();
  }, [detailFor, noteId, ready, status, t]);

  /**
   * Closing a window lists every checkout at once rather than one dialog per
   * checkout. Nothing is deleted: the default answer closes the window exactly
   * as it would have without the reminder.
   */
  const closeNoticeShownRef = useRef(false);
  const remindBeforeClose = useCallback(async (): Promise<boolean> => {
    const items = pendingRef.current;
    if (!ready || !items.length || closeNoticeShownRef.current) return true;
    closeNoticeShownRef.current = true;
    const review = await confirmAction(t("desktop.workbench.worktreeCloseNotice", String(items.length)), {
      detail: `${detailFor(items)}\n${t("desktop.workbench.worktreeNothingDeleted")}`,
      confirmLabel: t("desktop.workbench.worktreeReview"),
      cancelLabel: t("desktop.common.close"),
      destructive: true
    });
    if (!review) return true;
    openRef.current();
    return false;
  }, [detailFor, ready, t]);

  return { remindBeforeClose };
}
